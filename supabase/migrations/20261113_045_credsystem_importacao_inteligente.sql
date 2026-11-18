-- GTO Insights - Cartao Proprio CredSystem: importacao inteligente + CRM + indicadores no servidor
--
-- Escopo (todas as mudancas sao aditivas; nada e apagado):
--   1. credsystem_bin_marca ........ configuracao BIN -> marca (editavel por Admin).
--   2. credsystem_loja_marca ....... vinculo opcional codigo de loja -> marca (vazio por padrao).
--   3. importacao_lotes / importacao_erros_linha / importacao_modelos_colunas
--                                    rastreabilidade de cada arquivo importado (hash, contadores,
--                                    status, erros por linha) e modelos de mapeamento reutilizaveis.
--   4. credsystem_campanhas_crm .... planilha de campanhas CRM (22 campos + metadados originais).
--   5. credsystem_transacoes ....... base transacional individualizada (Tipo C), pronta e vazia.
--   6. dados_cartoes_credsystem / stage_credsystem_propostas: colunas novas (lote, chave natural,
--      cliente pseudonimizado, flag excluido_bi) - SEM apagar nenhuma linha existente.
--   7. Saneamento nao destrutivo: marca excluido_bi = true em linhas que comprovadamente nao sao
--      emissoes reais (arquivo de PROPOSTAS gravado na tabela de emissoes, reimportacao duplicada
--      sem id_cod_cartao e seed manual de teste). Reversivel com um UPDATE.
--   8. RPCs de gravacao (SECURITY DEFINER): o servidor revalida marca (BIN > loja > aba), permissao
--      do usuario na marca, tipos e faixas, e faz upsert idempotente por chave natural.
--      authenticated NAO recebe insert/update/delete nas tabelas novas - so grava via RPC.
--   9. RPCs de leitura (SECURITY INVOKER, respeitam RLS): resumo operacional com funil de coorte e
--      taxas de periodo, e resumo de retencao (so calcula com dados transacionais).
--  10. Views BI antigas (vw_credsystem_*) passam a ignorar linhas excluido_bi.
--
-- Seguranca: o role postgres (dono das funcoes) tem BYPASSRLS, entao toda RPC SECURITY DEFINER
-- abaixo checa explicitamente auth.uid(), gto_aal2_ok() e gto_tem_acesso_marca(marca) por linha.
--
-- Idempotente (if not exists / create or replace / on conflict). Testada localmente com PGlite
-- (tests/credsystem/sql.test.js).

begin;

-- 0. Infra auxiliar -----------------------------------------------------------------------------

create schema if not exists gto_private;
revoke all on schema gto_private from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on schema gto_private from anon'; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'revoke all on schema gto_private from authenticated'; end if;
end $$;

create table if not exists gto_private.segredos (
  nome text primary key,
  valor bytea not null,
  criado_em timestamptz not null default now()
);
revoke all on gto_private.segredos from public;

-- Pepper da pseudonimizacao (HMAC-SHA256). Gerado uma unica vez, nunca exposto ao frontend.
insert into gto_private.segredos (nome, valor)
values ('credsystem_pseudonimo_pepper', extensions.gen_random_bytes(32))
on conflict (nome) do nothing;

-- Pseudonimiza identificadores pessoais (CPF, numero de cartao) com HMAC + pepper secreto. So os
-- digitos entram no hash, entao "123.456.789-00" e "12345678900" geram o mesmo pseudonimo.
create or replace function public.gto_pseudonimizar(p_valor text, p_tipo text default 'cpf')
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_digitos text := regexp_replace(coalesce(p_valor, ''), '\D', '', 'g');
  v_pepper bytea;
begin
  if v_digitos = '' then return null; end if;
  if p_tipo = 'cpf' then v_digitos := lpad(v_digitos, 11, '0'); end if;
  select valor into v_pepper from gto_private.segredos where nome = 'credsystem_pseudonimo_pepper';
  return p_tipo || ':' || encode(extensions.hmac(v_digitos, encode(v_pepper, 'hex'), 'sha256'), 'hex');
end;
$$;
revoke all on function public.gto_pseudonimizar(text, text) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function public.gto_pseudonimizar(text, text) from authenticated';
  end if;
end $$;

-- Normalizacao textual usada nas chaves naturais (sem acento, minusculo, espacos colapsados).
create or replace function public.gto_cs_norm(p text)
returns text
language sql
immutable
as $$
  select nullif(
    regexp_replace(
      lower(translate(trim(coalesce(p, '')),
        'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ',
        'AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn')),
      '\s+', ' ', 'g'),
    '');
$$;

-- Canal normalizado (mantem o original em ds_canal).
create or replace function public.gto_cs_canal(p text)
returns text
language sql
immutable
as $$
  select case
    when public.gto_cs_norm(p) is null then null
    when replace(replace(public.gto_cs_norm(p), '-', ''), ' ', '') in ('email', 'emkt', 'emailmarketing') then 'E-mail'
    when public.gto_cs_norm(p) like 'whats%' or public.gto_cs_norm(p) in ('wpp', 'zap') then 'WhatsApp'
    when public.gto_cs_norm(p) like 'sms%' then 'SMS'
    when public.gto_cs_norm(p) like 'push%' then 'Push'
    when public.gto_cs_norm(p) like 'rcs%' then 'RCS'
    when public.gto_cs_norm(p) in ('ura', 'voz', 'ligacao', 'telefone', 'call center', 'callcenter') then 'Voz/URA'
    else upper(left(trim(p), 1)) || lower(substr(trim(p), 2))
  end;
$$;

-- Categoria de campanha normalizada (mantem o original em ds_cluster_campanha).
create or replace function public.gto_cs_cluster(p text)
returns text
language sql
immutable
as $$
  select case
    when public.gto_cs_norm(p) is null then null
    when public.gto_cs_norm(p) like '%reativa%' then 'Reativação'
    when public.gto_cs_norm(p) like '%ativa%' then 'Ativação'
    when public.gto_cs_norm(p) like '%aniver%' then 'Aniversário'
    when public.gto_cs_norm(p) like '%boas%vindas%' or public.gto_cs_norm(p) like '%onboard%' then 'Boas-vindas'
    when public.gto_cs_norm(p) like '%recompra%' or public.gto_cs_norm(p) like '%recorr%' then 'Recompra'
    when public.gto_cs_norm(p) like '%fatura%' or public.gto_cs_norm(p) like '%cobran%' then 'Fatura/Cobrança'
    else upper(left(trim(p), 1)) || lower(substr(trim(p), 2))
  end;
$$;

-- Texto vindo de planilha: remove caracteres de controle e limita tamanho. NAO altera o conteudo
-- visivel (formulas/HTML ficam como texto literal; escape e feito na exibicao/exportacao).
create or replace function public.gto_cs_texto(p text, p_max integer default 500)
returns text
language sql
immutable
as $$
  select nullif(left(trim(regexp_replace(coalesce(p, ''), '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]', '', 'g')), p_max), '');
$$;

-- Numero vindo do cliente (ja normalizado como "1234.56" ou numero JSON). Devolve null para
-- ausente; levanta excecao (capturada pela RPC) para valor presente mas invalido.
create or replace function public.gto_cs_numeric(p jsonb)
returns numeric
language plpgsql
immutable
as $$
begin
  if p is null or jsonb_typeof(p) = 'null' then return null; end if;
  if jsonb_typeof(p) = 'number' then return (p #>> '{}')::numeric; end if;
  if jsonb_typeof(p) = 'string' then
    if trim(p #>> '{}') = '' then return null; end if;
    if (p #>> '{}') !~ '^\s*-?\d+(\.\d+)?\s*$' then
      raise exception 'VALOR_NUMERICO_INVALIDO';
    end if;
    return trim(p #>> '{}')::numeric;
  end if;
  raise exception 'VALOR_NUMERICO_INVALIDO';
end;
$$;

-- 1. BIN -> marca --------------------------------------------------------------------------------

create table if not exists public.credsystem_bin_marca (
  bin text primary key check (bin ~ '^\d{6,8}$'),
  marca public.bandeira_marca not null,
  ativo boolean not null default true,
  observacao text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

comment on table public.credsystem_bin_marca is
  'Configuracao BIN (NR_BIN das planilhas CredSystem) -> marca. Fonte de verdade da identificacao de marca no servidor.';

insert into public.credsystem_bin_marca (bin, marca, observacao) values
  ('960358', 'Tesoura de Ouro', 'Mapeamento inicial'),
  ('960360', 'Free Center Calçados', 'Mapeamento inicial'),
  ('960361', 'Magazine da Economia', 'Mapeamento inicial')
on conflict (bin) do nothing;

drop trigger if exists trg_credsystem_bin_marca_atualizado_em on public.credsystem_bin_marca;
create trigger trg_credsystem_bin_marca_atualizado_em
before update on public.credsystem_bin_marca
for each row execute function public.gto_set_atualizado_em();

drop trigger if exists trg_credsystem_bin_marca_auditoria on public.credsystem_bin_marca;
create trigger trg_credsystem_bin_marca_auditoria
after insert or update or delete on public.credsystem_bin_marca
for each row execute function public.gto_registrar_auditoria();

alter table public.credsystem_bin_marca enable row level security;
alter table public.credsystem_bin_marca force row level security;

drop policy if exists "credsystem_bin_marca_select" on public.credsystem_bin_marca;
create policy "credsystem_bin_marca_select" on public.credsystem_bin_marca
for select to authenticated using ((select public.gto_aal2_ok()));

drop policy if exists "credsystem_bin_marca_admin_write" on public.credsystem_bin_marca;
create policy "credsystem_bin_marca_admin_write" on public.credsystem_bin_marca
for all to authenticated
using ((select public.gto_eh_admin()))
with check ((select public.gto_eh_admin()));

-- 2. Codigo de loja -> marca (opcional, cadastro manual) -----------------------------------------

create table if not exists public.credsystem_loja_marca (
  cd_loja text primary key check (length(trim(cd_loja)) between 1 and 40),
  marca public.bandeira_marca not null,
  nm_loja text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

comment on table public.credsystem_loja_marca is
  'Vinculo confiavel codigo de loja CredSystem -> marca. Usado na identificacao de marca quando a linha nao traz BIN. Vazio ate ser cadastrado.';

drop trigger if exists trg_credsystem_loja_marca_atualizado_em on public.credsystem_loja_marca;
create trigger trg_credsystem_loja_marca_atualizado_em
before update on public.credsystem_loja_marca
for each row execute function public.gto_set_atualizado_em();

alter table public.credsystem_loja_marca enable row level security;
alter table public.credsystem_loja_marca force row level security;

drop policy if exists "credsystem_loja_marca_select" on public.credsystem_loja_marca;
create policy "credsystem_loja_marca_select" on public.credsystem_loja_marca
for select to authenticated using ((select public.gto_aal2_ok()));

drop policy if exists "credsystem_loja_marca_admin_write" on public.credsystem_loja_marca;
create policy "credsystem_loja_marca_admin_write" on public.credsystem_loja_marca
for all to authenticated
using ((select public.gto_eh_admin()))
with check ((select public.gto_eh_admin()));

-- Resolve a marca de uma linha. Prioridade: BIN explicito validado > codigo de loja cadastrado >
-- marca informada (aba/coluna/selecao). Divergencia entre fontes = conflito (linha bloqueada).
-- Retorna (marca, origem, erro_codigo, erro_mensagem).
create or replace function public.gto_cs_resolver_marca(p_bin text, p_cd_loja text, p_marca_hint text)
returns table (marca public.bandeira_marca, origem text, erro_codigo text, erro_mensagem text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_bin text := nullif(regexp_replace(coalesce(p_bin, ''), '\D', '', 'g'), '');
  v_marca_bin public.bandeira_marca;
  v_marca_loja public.bandeira_marca;
  v_marca_hint public.bandeira_marca;
begin
  if nullif(trim(coalesce(p_marca_hint, '')), '') is not null then
    if not exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
                   where t.typname = 'bandeira_marca' and e.enumlabel = trim(p_marca_hint)) then
      return query select null::public.bandeira_marca, null::text, 'MARCA_INVALIDA', format('Marca "%s" nao reconhecida.', left(p_marca_hint, 60));
      return;
    end if;
    v_marca_hint := trim(p_marca_hint)::public.bandeira_marca;
  end if;

  if v_bin is not null then
    select b.marca into v_marca_bin from public.credsystem_bin_marca b where b.bin = v_bin and b.ativo;
    if v_marca_bin is null then
      return query select null::public.bandeira_marca, null::text, 'BIN_DESCONHECIDO', format('BIN %s nao cadastrado em credsystem_bin_marca.', left(v_bin, 12));
      return;
    end if;
  end if;

  if nullif(trim(coalesce(p_cd_loja, '')), '') is not null then
    select l.marca into v_marca_loja from public.credsystem_loja_marca l where l.cd_loja = trim(p_cd_loja);
  end if;

  if v_marca_bin is not null and v_marca_loja is not null and v_marca_bin <> v_marca_loja then
    return query select null::public.bandeira_marca, null::text, 'CONFLITO_MARCA',
      format('BIN indica %s, mas a loja %s esta vinculada a %s.', v_marca_bin, left(p_cd_loja, 40), v_marca_loja);
    return;
  end if;
  if v_marca_hint is not null and coalesce(v_marca_bin, v_marca_loja) is not null and v_marca_hint <> coalesce(v_marca_bin, v_marca_loja) then
    return query select null::public.bandeira_marca, null::text, 'CONFLITO_MARCA',
      format('%s indica %s, mas a aba/coluna/selecao indica %s.',
        case when v_marca_bin is not null then 'BIN ' || v_bin else 'Loja ' || left(p_cd_loja, 40) end,
        coalesce(v_marca_bin, v_marca_loja), v_marca_hint);
    return;
  end if;

  if v_marca_bin is not null then
    return query select v_marca_bin, 'bin'::text, null::text, null::text;
  elsif v_marca_loja is not null then
    return query select v_marca_loja, 'loja'::text, null::text, null::text;
  elsif v_marca_hint is not null then
    return query select v_marca_hint, 'aba_ou_selecao'::text, null::text, null::text;
  else
    return query select null::public.bandeira_marca, null::text, 'MARCA_NAO_IDENTIFICADA', 'Linha sem BIN, sem loja cadastrada e sem marca informada.'::text;
  end if;
end;
$$;
revoke all on function public.gto_cs_resolver_marca(text, text, text) from public;
grant execute on function public.gto_cs_resolver_marca(text, text, text) to authenticated;

-- 3. Lotes de importacao, erros por linha e modelos de mapeamento --------------------------------

create table if not exists public.importacao_lotes (
  id uuid primary key default gen_random_uuid(),
  tipo_arquivo text not null check (tipo_arquivo in (
    'credsystem_crm_campanhas', 'credsystem_propostas', 'credsystem_emissoes', 'credsystem_transacoes'
  )),
  nome_arquivo text not null check (length(nome_arquivo) between 1 and 255),
  hash_conteudo text not null check (hash_conteudo ~ '^[0-9a-f]{64}$'),
  importado_por uuid default auth.uid() references auth.users(id) on delete set null,
  iniciado_em timestamptz not null default now(),
  concluido_em timestamptz,
  marcas public.bandeira_marca[] not null default '{}',
  periodo_inicio date,
  periodo_fim date,
  abas text[] not null default '{}',
  linhas_lidas integer not null default 0 check (linhas_lidas >= 0),
  linhas_importadas integer not null default 0 check (linhas_importadas >= 0),
  linhas_atualizadas integer not null default 0 check (linhas_atualizadas >= 0),
  linhas_ignoradas integer not null default 0 check (linhas_ignoradas >= 0),
  linhas_rejeitadas integer not null default 0 check (linhas_rejeitadas >= 0),
  status text not null default 'processando' check (status in (
    'processando', 'concluido', 'concluido_com_erros', 'falhou', 'cancelado'
  )),
  metadados jsonb not null default '{}'::jsonb
);

comment on table public.importacao_lotes is
  'Um registro por arquivo importado: hash do conteudo, responsavel, marcas/periodo identificados e contadores. '
  'linhas_importadas = inseridas; linhas_atualizadas = ja existiam e mudaram; linhas_ignoradas = ja existiam identicas '
  '(reimportacao) ou linhas vazias/duplicadas no proprio arquivo; linhas_rejeitadas = erro de validacao.';

create index if not exists importacao_lotes_hash_idx on public.importacao_lotes (tipo_arquivo, hash_conteudo);
create index if not exists importacao_lotes_iniciado_idx on public.importacao_lotes (iniciado_em desc);

create table if not exists public.importacao_erros_linha (
  id bigint generated always as identity primary key,
  lote_id uuid not null references public.importacao_lotes(id) on delete cascade,
  aba text,
  linha integer,
  campo text,
  codigo text not null,
  mensagem text not null,
  valor_original text,
  marca public.bandeira_marca,
  severidade text not null default 'erro' check (severidade in ('erro', 'alerta')),
  criado_em timestamptz not null default now()
);
create index if not exists importacao_erros_linha_lote_idx on public.importacao_erros_linha (lote_id, linha);

create table if not exists public.importacao_modelos_colunas (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (length(trim(nome)) between 1 and 120),
  tipo_arquivo text not null check (tipo_arquivo in (
    'credsystem_crm_campanhas', 'credsystem_propostas', 'credsystem_emissoes', 'credsystem_transacoes'
  )),
  assinatura_cabecalho text,
  mapeamento jsonb not null check (jsonb_typeof(mapeamento) = 'object'),
  criado_por uuid default auth.uid() references auth.users(id) on delete set null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint importacao_modelos_colunas_nome_uk unique (tipo_arquivo, nome)
);
comment on column public.importacao_modelos_colunas.mapeamento is
  'Objeto { campo_destino: "cabecalho normalizado na planilha" } salvo no mapeamento manual.';
comment on column public.importacao_modelos_colunas.assinatura_cabecalho is
  'Cabecalhos normalizados e ordenados, separados por "|", para reaplicar o modelo automaticamente.';

drop trigger if exists trg_importacao_modelos_atualizado_em on public.importacao_modelos_colunas;
create trigger trg_importacao_modelos_atualizado_em
before update on public.importacao_modelos_colunas
for each row execute function public.gto_set_atualizado_em();

alter table public.importacao_lotes enable row level security;
alter table public.importacao_lotes force row level security;
alter table public.importacao_erros_linha enable row level security;
alter table public.importacao_erros_linha force row level security;
alter table public.importacao_modelos_colunas enable row level security;
alter table public.importacao_modelos_colunas force row level security;

-- Le o lote quem importou, Admin/Gestor, ou quem tem acesso a alguma das marcas do lote (para
-- mostrar "ultima importacao" nos dashboards da propria marca).
drop policy if exists "importacao_lotes_select" on public.importacao_lotes;
create policy "importacao_lotes_select" on public.importacao_lotes
for select to authenticated
using (
  (select public.gto_eh_admin_ou_gestor())
  or importado_por = (select auth.uid())
  or exists (select 1 from unnest(marcas) m where public.gto_tem_acesso_marca(m))
);

drop policy if exists "importacao_erros_linha_select" on public.importacao_erros_linha;
create policy "importacao_erros_linha_select" on public.importacao_erros_linha
for select to authenticated
using (exists (select 1 from public.importacao_lotes l where l.id = lote_id));

drop policy if exists "importacao_modelos_select" on public.importacao_modelos_colunas;
create policy "importacao_modelos_select" on public.importacao_modelos_colunas
for select to authenticated using ((select public.gto_aal2_ok()));

drop policy if exists "importacao_modelos_write" on public.importacao_modelos_colunas;
create policy "importacao_modelos_write" on public.importacao_modelos_colunas
for all to authenticated
using ((select public.gto_eh_admin_ou_gestor()) or criado_por = (select auth.uid()))
with check ((select public.gto_meu_cargo()) is not null);

-- 4. Campanhas CRM CredSystem ---------------------------------------------------------------------

create table if not exists public.credsystem_campanhas_crm (
  id uuid primary key default gen_random_uuid(),
  marca public.bandeira_marca not null,
  marca_origem text not null check (marca_origem in ('bin', 'loja', 'aba_ou_selecao')),
  chave_natural text not null,
  nr_bin text,
  dt_disparo date not null,
  dh_disparo timestamp without time zone,
  data_derivada_mes_ano boolean not null default false,
  mes smallint check (mes between 1 and 12),
  ano smallint check (ano between 2000 and 2100),
  ds_campanha text not null,
  ds_canal text,
  canal_normalizado text,
  ds_step text,
  ds_cluster_campanha text,
  cluster_normalizado text,
  fl_regua text,
  qt_abordado bigint check (qt_abordado >= 0),
  qt_adesao_abordado bigint check (qt_adesao_abordado >= 0),
  vl_gasto_abordado numeric(18, 2) check (vl_gasto_abordado >= 0),
  tkm_abordado numeric(18, 2) check (tkm_abordado >= 0),
  qt_controle bigint check (qt_controle >= 0),
  qt_adesao_controle bigint check (qt_adesao_controle >= 0),
  vl_gasto_controle numeric(18, 2) check (vl_gasto_controle >= 0),
  tkm_controle numeric(18, 2) check (tkm_controle >= 0),
  tx_conv_abordado numeric(9, 4) check (tx_conv_abordado between 0 and 100),
  tx_conv_controle numeric(9, 4) check (tx_conv_controle between 0 and 100),
  vl_vendas_incrementais numeric(18, 2),
  ds_frase text,
  ds_titulo_push text,
  id_registro_origem text,
  aba_origem text,
  linha_origem integer,
  dados_originais jsonb not null default '{}'::jsonb,
  transformacoes jsonb not null default '[]'::jsonb,
  alertas text[] not null default '{}',
  lote_id uuid references public.importacao_lotes(id) on delete set null,
  primeiro_lote_id uuid references public.importacao_lotes(id) on delete set null,
  importado_por uuid default auth.uid() references auth.users(id) on delete set null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint credsystem_campanhas_crm_chave_uk unique (marca, chave_natural)
);

comment on table public.credsystem_campanhas_crm is
  'Planilha de campanhas CRM CredSystem (uma linha por disparo/etapa agregada). Valores comerciais sao '
  '"associados as campanhas" (sem causalidade) e a soma entre campanhas NAO e faturamento deduplicado.';
comment on column public.credsystem_campanhas_crm.chave_natural is
  'md5 de marca|id|id_registro quando a planilha traz id_registro (Modelo Padrao 2026); senao md5 de '
  'marca|data/hora|campanha|canal|etapa|cluster|regua|titulo push|frase normalizados. Reimportar a mesma linha atualiza em vez de duplicar.';
comment on column public.credsystem_campanhas_crm.id_registro_origem is
  'Identificador da linha informado pela propria planilha (coluna id_registro), quando existir.';
comment on column public.credsystem_campanhas_crm.tx_conv_abordado is
  'Conversao informada na planilha, normalizada para escala 0-100 (ver transformacoes). Consolidados usam somas ponderadas, nunca esta coluna.';
comment on column public.credsystem_campanhas_crm.dados_originais is
  'Valores originais das 22 colunas, com os nomes originais dos cabecalhos, para rastreabilidade.';

create index if not exists credsystem_campanhas_crm_marca_data_idx on public.credsystem_campanhas_crm (marca, dt_disparo desc);
create index if not exists credsystem_campanhas_crm_lote_idx on public.credsystem_campanhas_crm (lote_id);

drop trigger if exists trg_credsystem_campanhas_crm_atualizado_em on public.credsystem_campanhas_crm;
create trigger trg_credsystem_campanhas_crm_atualizado_em
before update on public.credsystem_campanhas_crm
for each row execute function public.gto_set_atualizado_em();

alter table public.credsystem_campanhas_crm enable row level security;
alter table public.credsystem_campanhas_crm force row level security;

drop policy if exists "credsystem_campanhas_crm_select_por_marca" on public.credsystem_campanhas_crm;
create policy "credsystem_campanhas_crm_select_por_marca" on public.credsystem_campanhas_crm
for select to authenticated
using ((select public.gto_eh_admin_ou_gestor()) or public.gto_tem_acesso_marca(marca));

drop policy if exists "credsystem_campanhas_crm_delete_admin_gestor" on public.credsystem_campanhas_crm;
create policy "credsystem_campanhas_crm_delete_admin_gestor" on public.credsystem_campanhas_crm
for delete to authenticated
using ((select public.gto_eh_admin_ou_gestor()));

-- 5. Transacoes (Tipo C) --------------------------------------------------------------------------

create table if not exists public.credsystem_transacoes (
  id uuid primary key default gen_random_uuid(),
  marca public.bandeira_marca not null,
  marca_origem text not null check (marca_origem in ('bin', 'loja', 'aba_ou_selecao')),
  chave_natural text not null,
  id_transacao text,
  cliente_pseudo_id text,
  id_cod_cartao text,
  dt_transacao date not null,
  cd_loja text,
  nm_loja text,
  vl_transacao numeric(18, 2) not null,
  qt_itens integer check (qt_itens >= 0),
  forma_pagamento text,
  aba_origem text,
  linha_origem integer,
  dados_originais jsonb not null default '{}'::jsonb,
  lote_id uuid references public.importacao_lotes(id) on delete set null,
  importado_por uuid default auth.uid() references auth.users(id) on delete set null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint credsystem_transacoes_chave_uk unique (marca, chave_natural)
);
comment on table public.credsystem_transacoes is
  'Compras individualizadas (Tipo C). Cliente apenas pseudonimizado (HMAC); nunca CPF ou numero de cartao em texto puro.';

create index if not exists credsystem_transacoes_marca_data_idx on public.credsystem_transacoes (marca, dt_transacao desc);
create index if not exists credsystem_transacoes_cliente_idx on public.credsystem_transacoes (marca, cliente_pseudo_id, dt_transacao);

drop trigger if exists trg_credsystem_transacoes_atualizado_em on public.credsystem_transacoes;
create trigger trg_credsystem_transacoes_atualizado_em
before update on public.credsystem_transacoes
for each row execute function public.gto_set_atualizado_em();

alter table public.credsystem_transacoes enable row level security;
alter table public.credsystem_transacoes force row level security;

drop policy if exists "credsystem_transacoes_select_por_marca" on public.credsystem_transacoes;
create policy "credsystem_transacoes_select_por_marca" on public.credsystem_transacoes
for select to authenticated
using ((select public.gto_eh_admin_ou_gestor()) or public.gto_tem_acesso_marca(marca));

drop policy if exists "credsystem_transacoes_delete_admin_gestor" on public.credsystem_transacoes;
create policy "credsystem_transacoes_delete_admin_gestor" on public.credsystem_transacoes
for delete to authenticated
using ((select public.gto_eh_admin_ou_gestor()));

-- 6. Colunas novas nas tabelas operacionais existentes -------------------------------------------

alter table public.dados_cartoes_credsystem
  add column if not exists chave_natural text,
  add column if not exists cliente_pseudo_id text,
  add column if not exists importacao_lote_id uuid references public.importacao_lotes(id) on delete set null,
  add column if not exists excluido_bi boolean not null default false,
  add column if not exists motivo_exclusao_bi text;

alter table public.stage_credsystem_propostas
  add column if not exists cliente_pseudo_id text,
  add column if not exists motivo_rejeicao text,
  add column if not exists dt_aprovacao date,
  add column if not exists importacao_lote_id uuid references public.importacao_lotes(id) on delete set null;

comment on column public.dados_cartoes_credsystem.excluido_bi is
  'true = linha mantida para auditoria mas fora de todos os indicadores (ver motivo_exclusao_bi). Nao apaga nada.';
comment on column public.dados_cartoes_credsystem.chave_natural is
  '"id:<id_cod_cartao>" quando ha ID do cartao; senao "nk:<md5 de data_emissao|loja|cliente pseudonimizado|tipo|canal>". Base da deduplicacao.';

create unique index if not exists dados_cartoes_credsystem_marca_chave_uk
  on public.dados_cartoes_credsystem (marca, chave_natural);
create index if not exists dados_cartoes_credsystem_bi_idx
  on public.dados_cartoes_credsystem (marca, data_emissao) where not excluido_bi;
create index if not exists dados_cartoes_credsystem_cartao_idx
  on public.dados_cartoes_credsystem (marca, id_cod_cartao) where id_cod_cartao is not null;
create index if not exists stage_credsystem_propostas_cartao_idx
  on public.stage_credsystem_propostas (marca, id_cod_cartao) where id_cod_cartao is not null;

-- Qualquer caminho de gravacao (inclusive o assistente manual antigo, que grava direto na tabela)
-- passa a ter a mesma chave natural quando ha id_cod_cartao - evita conflito entre os dois indices
-- unicos (marca,id_cod_cartao) e (marca,chave_natural) e mantem a reimportacao idempotente.
create or replace function public.gto_cs_cartoes_chave_natural()
returns trigger
language plpgsql
as $$
begin
  if new.id_cod_cartao is not null and (new.chave_natural is null or new.chave_natural like 'id:%') then
    new.chave_natural := 'id:' || new.id_cod_cartao;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_cartoes_chave_natural on public.dados_cartoes_credsystem;
create trigger trg_cartoes_chave_natural
before insert or update of id_cod_cartao, chave_natural on public.dados_cartoes_credsystem
for each row execute function public.gto_cs_cartoes_chave_natural();

-- 7. Saneamento nao destrutivo -------------------------------------------------------------------

-- 7a. Arquivo de PROPOSTAS gravado na tabela de EMISSOES (origem conferida em 13/11/2026: 12.760
-- linhas, todas sem id_cod_cartao e com valor 0 - sao as mesmas propostas de stage_credsystem_propostas).
update public.dados_cartoes_credsystem
set excluido_bi = true,
    motivo_exclusao_bi = 'Arquivo de propostas importado por engano como emissao (' || origem_arquivo || ')'
where not excluido_bi
  and origem_arquivo ilike '%PROPOSTA%'
  and id_cod_cartao is null;

-- 7b. Reimportacao do arquivo de emissoes antes da migration 012 (sem id_cod_cartao): so marca as
-- linhas que tem gemea identica (mesma marca, data, loja, cliente e ativacao) COM id_cod_cartao.
update public.dados_cartoes_credsystem d
set excluido_bi = true,
    motivo_exclusao_bi = 'Duplicata de reimportacao sem id_cod_cartao (gemea com ID existe)'
where not d.excluido_bi
  and d.id_cod_cartao is null
  and exists (
    select 1 from public.dados_cartoes_credsystem g
    where g.marca = d.marca
      and g.id_cod_cartao is not null
      and g.data_emissao = d.data_emissao
      and g.loja_operacao is not distinct from d.loja_operacao
      and g.nome_cliente is not distinct from d.nome_cliente
      and g.data_ativacao is not distinct from d.data_ativacao
      and g.origem_arquivo is not distinct from d.origem_arquivo
  );

-- 7c. Registros de seed manual (teste) nao sao dados reais.
update public.dados_cartoes_credsystem
set excluido_bi = true, motivo_exclusao_bi = 'Registro de seed manual (teste)'
where not excluido_bi and origem_arquivo = 'seed_manual';

-- 7d. Backfill da chave natural e do pseudonimo nas linhas validas existentes.
update public.dados_cartoes_credsystem
set chave_natural = 'id:' || id_cod_cartao
where chave_natural is null and id_cod_cartao is not null and not excluido_bi;

update public.dados_cartoes_credsystem
set cliente_pseudo_id = public.gto_pseudonimizar(cpf_cliente, 'cpf')
where cliente_pseudo_id is null and cpf_cliente is not null;

update public.stage_credsystem_propostas
set cliente_pseudo_id = public.gto_pseudonimizar(cpf_cliente, 'cpf')
where cliente_pseudo_id is null and cpf_cliente is not null;

-- 8. RPCs de gravacao -----------------------------------------------------------------------------

-- Inicia um lote. Devolve o id e as importacoes anteriores com o MESMO conteudo (hash), para a UI
-- avisar "este arquivo ja foi importado em ..." - a deduplicacao de registros continua valendo.
create or replace function public.rpc_importacao_iniciar(
  p_tipo_arquivo text, p_nome_arquivo text, p_hash text, p_metadados jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_anteriores jsonb;
begin
  if auth.uid() is null or not public.gto_aal2_ok() or public.gto_meu_cargo() is null then
    raise exception 'Sessao sem permissao para importar.' using errcode = '42501';
  end if;
  if p_tipo_arquivo not in ('credsystem_crm_campanhas', 'credsystem_propostas', 'credsystem_emissoes', 'credsystem_transacoes') then
    raise exception 'Tipo de arquivo invalido.' using errcode = '22023';
  end if;
  if p_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Hash do arquivo invalido.' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'iniciado_em', l.iniciado_em, 'status', l.status, 'nome_arquivo', l.nome_arquivo) order by l.iniciado_em desc), '[]'::jsonb)
  into v_anteriores
  from public.importacao_lotes l
  where l.tipo_arquivo = p_tipo_arquivo and l.hash_conteudo = p_hash
    and l.status in ('concluido', 'concluido_com_erros');

  insert into public.importacao_lotes (tipo_arquivo, nome_arquivo, hash_conteudo, importado_por, metadados)
  values (p_tipo_arquivo, left(public.gto_cs_texto(p_nome_arquivo, 255), 255), p_hash, auth.uid(), coalesce(p_metadados, '{}'::jsonb))
  returning id into v_id;

  return jsonb_build_object('lote_id', v_id, 'importacoes_anteriores', v_anteriores);
end;
$$;

-- Registra erros detectados no cliente (linhas que nem foram enviadas, ex.: data ilegivel) e soma
-- nos contadores do lote. Limite de 2000 por chamada.
create or replace function public.rpc_importacao_registrar_erros(p_lote_id uuid, p_erros jsonb, p_linhas_ignoradas integer default 0)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lote public.importacao_lotes;
  v_n integer;
  v_rejeitadas integer;
begin
  select * into v_lote from public.importacao_lotes where id = p_lote_id;
  if v_lote.id is null or v_lote.importado_por is distinct from auth.uid() or not public.gto_aal2_ok() then
    raise exception 'Lote inexistente ou de outro usuario.' using errcode = '42501';
  end if;
  if v_lote.status <> 'processando' then
    raise exception 'Lote ja finalizado.' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_erros, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_erros, '[]'::jsonb)) > 2000 then
    raise exception 'Lista de erros invalida (maximo 2000).' using errcode = '22023';
  end if;

  insert into public.importacao_erros_linha (lote_id, aba, linha, campo, codigo, mensagem, valor_original, severidade)
  select p_lote_id,
         public.gto_cs_texto(e->>'aba', 120),
         case when (e->>'linha') ~ '^\d{1,9}$' then (e->>'linha')::integer end,
         public.gto_cs_texto(e->>'campo', 120),
         coalesce(public.gto_cs_texto(e->>'codigo', 60), 'ERRO_VALIDACAO'),
         coalesce(public.gto_cs_texto(e->>'mensagem', 500), 'Erro de validacao.'),
         public.gto_cs_texto(e->>'valor_original', 300),
         case when e->>'severidade' = 'alerta' then 'alerta' else 'erro' end
  from jsonb_array_elements(coalesce(p_erros, '[]'::jsonb)) e;
  get diagnostics v_n = row_count;

  -- So erros (nao alertas) contam como linhas rejeitadas; uma linha com varios erros conta uma vez.
  select count(distinct (coalesce(e->>'aba', ''), coalesce(e->>'linha', '')))
  into v_rejeitadas
  from jsonb_array_elements(coalesce(p_erros, '[]'::jsonb)) e
  where coalesce(e->>'severidade', 'erro') = 'erro';

  update public.importacao_lotes
  set linhas_rejeitadas = linhas_rejeitadas + coalesce(v_rejeitadas, 0),
      linhas_ignoradas = linhas_ignoradas + greatest(coalesce(p_linhas_ignoradas, 0), 0)
  where id = p_lote_id;
  return v_n;
end;
$$;

-- Finaliza o lote: status e linhas lidas/abas. Marcas e periodo ja foram acumulados no servidor
-- pelas RPCs de gravacao (inclusive linhas reimportadas sem alteracao).
drop function if exists public.rpc_importacao_finalizar(uuid, integer, text[], boolean);
create or replace function public.rpc_importacao_finalizar(p_lote_id uuid, p_linhas_lidas integer, p_abas text[] default '{}', p_cancelado boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lote public.importacao_lotes;
begin
  select * into v_lote from public.importacao_lotes where id = p_lote_id;
  if v_lote.id is null or v_lote.importado_por is distinct from auth.uid() or not public.gto_aal2_ok() then
    raise exception 'Lote inexistente ou de outro usuario.' using errcode = '42501';
  end if;
  if v_lote.status <> 'processando' then
    return to_jsonb(v_lote);
  end if;

  update public.importacao_lotes
  set status = case
        when p_cancelado then 'cancelado'
        when linhas_importadas + linhas_atualizadas + linhas_ignoradas = 0 and linhas_rejeitadas > 0 then 'falhou'
        when linhas_rejeitadas > 0 then 'concluido_com_erros'
        else 'concluido' end,
      concluido_em = now(),
      linhas_lidas = greatest(coalesce(p_linhas_lidas, 0), 0),
      abas = (select coalesce(array_agg(left(a, 120)), '{}') from unnest(coalesce(p_abas, '{}')) a)
  where id = p_lote_id
  returning * into v_lote;

  return to_jsonb(v_lote);
end;
$$;

-- Helper interno: registra erro de linha.
create or replace function public.gto_cs_erro(p_lote uuid, p_linha jsonb, p_codigo text, p_mensagem text, p_campo text default null, p_valor text default null, p_marca public.bandeira_marca default null, p_severidade text default 'erro')
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.importacao_erros_linha (lote_id, aba, linha, campo, codigo, mensagem, valor_original, marca, severidade)
  values (p_lote,
          public.gto_cs_texto(p_linha->>'aba', 120),
          case when (p_linha->>'linha') ~ '^\d{1,9}$' then (p_linha->>'linha')::integer end,
          p_campo, p_codigo, left(p_mensagem, 500), public.gto_cs_texto(p_valor, 300), p_marca, p_severidade);
$$;
revoke all on function public.gto_cs_erro(uuid, jsonb, text, text, text, text, public.bandeira_marca, text) from public;

-- Helper interno: valida o lote para uma chamada de gravacao.
create or replace function public.gto_cs_lote_para_gravar(p_lote_id uuid, p_tipo text, p_linhas jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lote public.importacao_lotes;
begin
  if auth.uid() is null or not public.gto_aal2_ok() then
    raise exception 'Sessao sem permissao para importar.' using errcode = '42501';
  end if;
  select * into v_lote from public.importacao_lotes where id = p_lote_id;
  if v_lote.id is null or v_lote.importado_por is distinct from auth.uid() then
    raise exception 'Lote inexistente ou de outro usuario.' using errcode = '42501';
  end if;
  if v_lote.tipo_arquivo <> p_tipo then
    raise exception 'Lote de outro tipo de arquivo.' using errcode = '22023';
  end if;
  if v_lote.status <> 'processando' then
    raise exception 'Lote ja finalizado.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_linhas) <> 'array' or jsonb_array_length(p_linhas) > 1000 then
    raise exception 'Envie de 1 a 1000 linhas por chamada.' using errcode = '22023';
  end if;
end;
$$;
revoke all on function public.gto_cs_lote_para_gravar(uuid, text, jsonb) from public;

-- 8a. Campanhas CRM -------------------------------------------------------------------------------
create or replace function public.rpc_credsystem_crm_importar(p_lote_id uuid, p_linhas jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r jsonb;
  v_res record;
  v_marca public.bandeira_marca;
  v_dt date;
  v_dh timestamp;
  v_derivada boolean;
  v_mes smallint;
  v_ano smallint;
  v_campanha text;
  v_chave text;
  v_inserted boolean;
  v_ins integer := 0;
  v_upd integer := 0;
  v_ign integer := 0;
  v_rej integer := 0;
  v_marcas_ok public.bandeira_marca[] := '{}';
  v_ini_ok date;
  v_fim_ok date;
  v_alertas text[];
  v_num record;
  v_id_reg text;
begin
  perform public.gto_cs_lote_para_gravar(p_lote_id, 'credsystem_crm_campanhas', p_linhas);

  for r in select value from jsonb_array_elements(p_linhas) loop
    begin
      -- marca: BIN > loja (n/a no CRM) > aba
      select * into v_res from public.gto_cs_resolver_marca(r->>'nr_bin', null, r->>'marca_aba');
      if v_res.erro_codigo is not null then
        perform public.gto_cs_erro(p_lote_id, r, v_res.erro_codigo, v_res.erro_mensagem, 'NR_BIN', r->>'nr_bin');
        v_rej := v_rej + 1; continue;
      end if;
      v_marca := v_res.marca;
      if not public.gto_tem_acesso_marca(v_marca) then
        perform public.gto_cs_erro(p_lote_id, r, 'SEM_PERMISSAO_MARCA', format('Usuario sem permissao para a marca %s.', v_marca), null, null, v_marca);
        v_rej := v_rej + 1; continue;
      end if;

      v_campanha := public.gto_cs_texto(r->>'ds_campanha', 300);
      if v_campanha is null then
        perform public.gto_cs_erro(p_lote_id, r, 'CAMPO_OBRIGATORIO', 'DS_CAMPANHA vazio.', 'DS_CAMPANHA', null, v_marca);
        v_rej := v_rej + 1; continue;
      end if;

      v_mes := case when (r->>'mes') ~ '^\d{1,2}$' and (r->>'mes')::int between 1 and 12 then (r->>'mes')::smallint end;
      v_ano := case when (r->>'ano') ~ '^\d{4}$' and (r->>'ano')::int between 2000 and 2100 then (r->>'ano')::smallint end;
      v_dh := null; v_derivada := false; v_alertas := '{}';
      if (r->>'dh_disparo') ~ '^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?$' then
        v_dh := (r->>'dh_disparo')::timestamp;
        v_dt := v_dh::date;
        if length(r->>'dh_disparo') = 10 then v_dh := null; end if;
      elsif v_mes is not null and v_ano is not null then
        v_dt := make_date(v_ano, v_mes, 1);
        v_derivada := true;
        v_alertas := array_append(v_alertas, 'DATA_DERIVADA_MES_ANO');
      else
        perform public.gto_cs_erro(p_lote_id, r, 'DATA_INVALIDA', 'DH_DISPARO ausente/ilegivel e MES/ANO insuficientes.', 'DH_DISPARO', r->>'dh_disparo', v_marca);
        v_rej := v_rej + 1; continue;
      end if;
      if extract(year from v_dt) not between 2000 and 2100 then
        perform public.gto_cs_erro(p_lote_id, r, 'DATA_FORA_DA_FAIXA', 'Data de disparo fora da faixa 2000-2100.', 'DH_DISPARO', r->>'dh_disparo', v_marca);
        v_rej := v_rej + 1; continue;
      end if;
      if not v_derivada and v_mes is not null and v_ano is not null
         and (extract(month from v_dt) <> v_mes or extract(year from v_dt) <> v_ano) then
        v_alertas := array_append(v_alertas, 'MES_ANO_DIVERGENTE_DA_DATA');
        perform public.gto_cs_erro(p_lote_id, r, 'MES_ANO_DIVERGENTE', format('MES/ANO (%s/%s) diferente da data de disparo (%s); usada a data.', v_mes, v_ano, v_dt), 'MES', null, v_marca, 'alerta');
      end if;

      -- metricas (numeric validado; contagens inteiras e nao negativas)
      select public.gto_cs_numeric(r->'qt_abordado') qa, public.gto_cs_numeric(r->'qt_adesao_abordado') qaa,
             public.gto_cs_numeric(r->'vl_gasto_abordado') vga, public.gto_cs_numeric(r->'tkm_abordado') tka,
             public.gto_cs_numeric(r->'qt_controle') qc, public.gto_cs_numeric(r->'qt_adesao_controle') qac,
             public.gto_cs_numeric(r->'vl_gasto_controle') vgc, public.gto_cs_numeric(r->'tkm_controle') tkc,
             public.gto_cs_numeric(r->'tx_conv_abordado') txa, public.gto_cs_numeric(r->'tx_conv_controle') txc,
             public.gto_cs_numeric(r->'vl_vendas_incrementais') vvi
      into v_num;

      if (v_num.qa is not null and (v_num.qa < 0 or v_num.qa <> trunc(v_num.qa)))
         or (v_num.qaa is not null and (v_num.qaa < 0 or v_num.qaa <> trunc(v_num.qaa)))
         or (v_num.qc is not null and (v_num.qc < 0 or v_num.qc <> trunc(v_num.qc)))
         or (v_num.qac is not null and (v_num.qac < 0 or v_num.qac <> trunc(v_num.qac))) then
        perform public.gto_cs_erro(p_lote_id, r, 'QUANTIDADE_INVALIDA', 'Quantidades devem ser inteiras e nao negativas.', 'QT_*', null, v_marca);
        v_rej := v_rej + 1; continue;
      end if;
      if coalesce(v_num.vga, 0) < 0 or coalesce(v_num.vgc, 0) < 0 or coalesce(v_num.tka, 0) < 0 or coalesce(v_num.tkc, 0) < 0 then
        perform public.gto_cs_erro(p_lote_id, r, 'VALOR_NEGATIVO', 'Valores gastos e tickets nao podem ser negativos.', 'VL_GASTO_*', null, v_marca);
        v_rej := v_rej + 1; continue;
      end if;
      if (v_num.txa is not null and v_num.txa not between 0 and 100) or (v_num.txc is not null and v_num.txc not between 0 and 100) then
        perform public.gto_cs_erro(p_lote_id, r, 'TAXA_FORA_DA_FAIXA', 'Taxas de conversao devem estar entre 0 e 100 apos normalizacao.', 'TX_CONV_*', null, v_marca);
        v_rej := v_rej + 1; continue;
      end if;
      if v_num.qa is not null and v_num.qaa is not null and v_num.qaa > v_num.qa then
        v_alertas := array_append(v_alertas, 'ADESOES_MAIOR_QUE_ABORDADOS');
        perform public.gto_cs_erro(p_lote_id, r, 'ADESOES_MAIOR_QUE_ABORDADOS', 'QT_ADESAO_ABORDADO maior que QT_ABORDADO (importado com alerta).', 'QT_ADESAO_ABORDADO', null, v_marca, 'alerta');
      end if;
      if v_num.qc is not null and v_num.qac is not null and v_num.qac > v_num.qc then
        v_alertas := array_append(v_alertas, 'ADESOES_MAIOR_QUE_CONTROLE');
        perform public.gto_cs_erro(p_lote_id, r, 'ADESOES_MAIOR_QUE_CONTROLE', 'QT_ADESAO_CONTROLE maior que QT_CONTROLE (importado com alerta).', 'QT_ADESAO_CONTROLE', null, v_marca, 'alerta');
      end if;
      if v_num.vga is not null and v_num.qaa is not null and v_num.qaa > 0 and v_num.tka is not null
         and abs(v_num.vga / v_num.qaa - v_num.tka) > greatest(0.05, v_num.tka * 0.02) then
        v_alertas := array_append(v_alertas, 'TICKET_ABORDADO_DIVERGENTE');
        perform public.gto_cs_erro(p_lote_id, r, 'TICKET_DIVERGENTE', format('TKM_ABORDADO (%s) difere de VL_GASTO/QT_ADESAO (%s).', v_num.tka, round(v_num.vga / v_num.qaa, 2)), 'TKM_ABORDADO', null, v_marca, 'alerta');
      end if;

      v_id_reg := public.gto_cs_texto(r->>'id_registro', 120);
      if v_id_reg is not null then
        v_chave := md5(concat_ws('|', v_marca::text, 'id', v_id_reg));
      else
      v_chave := md5(concat_ws('|',
        coalesce((v_marca::text)::text, ''),
        coalesce((coalesce(to_char(v_dh, 'YYYY-MM-DD"T"HH24:MI:SS'), v_dt::text))::text, ''),
        coalesce((public.gto_cs_norm(v_campanha))::text, ''),
        coalesce((public.gto_cs_norm(r->>'ds_canal'))::text, ''),
        coalesce((public.gto_cs_norm(r->>'ds_step'))::text, ''),
        coalesce((public.gto_cs_norm(r->>'ds_cluster_campanha'))::text, ''),
        coalesce((public.gto_cs_norm(r->>'fl_regua'))::text, ''),
        coalesce((public.gto_cs_norm(r->>'ds_titulo_push'))::text, ''),
        coalesce(public.gto_cs_norm(r->>'ds_frase'), '')));
      end if;

      insert into public.credsystem_campanhas_crm as t (
        marca, marca_origem, chave_natural, nr_bin, dt_disparo, dh_disparo, data_derivada_mes_ano, mes, ano,
        ds_campanha, ds_canal, canal_normalizado, ds_step, ds_cluster_campanha, cluster_normalizado, fl_regua,
        qt_abordado, qt_adesao_abordado, vl_gasto_abordado, tkm_abordado,
        qt_controle, qt_adesao_controle, vl_gasto_controle, tkm_controle,
        tx_conv_abordado, tx_conv_controle, vl_vendas_incrementais, ds_frase, ds_titulo_push, id_registro_origem,
        aba_origem, linha_origem, dados_originais, transformacoes, alertas, lote_id, primeiro_lote_id, importado_por
      ) values (
        v_marca, v_res.origem, v_chave, nullif(regexp_replace(coalesce(r->>'nr_bin', ''), '\D', '', 'g'), ''),
        v_dt, v_dh, v_derivada, v_mes, v_ano,
        v_campanha, public.gto_cs_texto(r->>'ds_canal', 120), public.gto_cs_canal(r->>'ds_canal'),
        public.gto_cs_texto(r->>'ds_step', 200), public.gto_cs_texto(r->>'ds_cluster_campanha', 200), public.gto_cs_cluster(r->>'ds_cluster_campanha'),
        public.gto_cs_texto(r->>'fl_regua', 40),
        v_num.qa, v_num.qaa, round(v_num.vga, 2), round(v_num.tka, 2),
        v_num.qc, v_num.qac, round(v_num.vgc, 2), round(v_num.tkc, 2),
        round(v_num.txa, 4), round(v_num.txc, 4), round(v_num.vvi, 2),
        public.gto_cs_texto(r->>'ds_frase', 2000), public.gto_cs_texto(r->>'ds_titulo_push', 300), v_id_reg,
        public.gto_cs_texto(r->>'aba', 120), case when (r->>'linha') ~ '^\d{1,9}$' then (r->>'linha')::integer end,
        case when jsonb_typeof(r->'dados_originais') = 'object' then r->'dados_originais' else '{}'::jsonb end,
        case when jsonb_typeof(r->'transformacoes') = 'array' then r->'transformacoes' else '[]'::jsonb end,
        v_alertas, p_lote_id, p_lote_id, auth.uid()
      )
      on conflict (marca, chave_natural) do update set
        qt_abordado = excluded.qt_abordado, qt_adesao_abordado = excluded.qt_adesao_abordado,
        vl_gasto_abordado = excluded.vl_gasto_abordado, tkm_abordado = excluded.tkm_abordado,
        qt_controle = excluded.qt_controle, qt_adesao_controle = excluded.qt_adesao_controle,
        vl_gasto_controle = excluded.vl_gasto_controle, tkm_controle = excluded.tkm_controle,
        tx_conv_abordado = excluded.tx_conv_abordado, tx_conv_controle = excluded.tx_conv_controle,
        vl_vendas_incrementais = excluded.vl_vendas_incrementais,
        ds_campanha = excluded.ds_campanha, ds_canal = excluded.ds_canal, canal_normalizado = excluded.canal_normalizado,
        ds_step = excluded.ds_step, ds_cluster_campanha = excluded.ds_cluster_campanha, cluster_normalizado = excluded.cluster_normalizado,
        mes = excluded.mes, ano = excluded.ano, nr_bin = excluded.nr_bin, marca_origem = excluded.marca_origem,
        aba_origem = excluded.aba_origem, linha_origem = excluded.linha_origem,
        dados_originais = excluded.dados_originais, transformacoes = excluded.transformacoes, alertas = excluded.alertas,
        lote_id = excluded.lote_id
      where (t.qt_abordado, t.qt_adesao_abordado, t.vl_gasto_abordado, t.tkm_abordado,
             t.qt_controle, t.qt_adesao_controle, t.vl_gasto_controle, t.tkm_controle,
             t.tx_conv_abordado, t.tx_conv_controle, t.vl_vendas_incrementais, t.ds_campanha, t.ds_canal, t.ds_step,
             t.ds_cluster_campanha, t.mes, t.ano)
        is distinct from
            (excluded.qt_abordado, excluded.qt_adesao_abordado, excluded.vl_gasto_abordado, excluded.tkm_abordado,
             excluded.qt_controle, excluded.qt_adesao_controle, excluded.vl_gasto_controle, excluded.tkm_controle,
             excluded.tx_conv_abordado, excluded.tx_conv_controle, excluded.vl_vendas_incrementais, excluded.ds_campanha, excluded.ds_canal, excluded.ds_step,
             excluded.ds_cluster_campanha, excluded.mes, excluded.ano)
      returning (xmax = 0) into v_inserted;

      if not found then v_ign := v_ign + 1;
      elsif v_inserted then v_ins := v_ins + 1;
      else v_upd := v_upd + 1;
      end if;
      if not (v_marca = any (v_marcas_ok)) then v_marcas_ok := array_append(v_marcas_ok, v_marca); end if;
      v_ini_ok := least(v_ini_ok, v_dt); v_fim_ok := greatest(v_fim_ok, v_dt);
    exception
      when others then
        perform public.gto_cs_erro(p_lote_id, r,
          case when sqlerrm = 'VALOR_NUMERICO_INVALIDO' then 'VALOR_NUMERICO_INVALIDO' else 'ERRO_LINHA' end,
          case when sqlerrm = 'VALOR_NUMERICO_INVALIDO' then 'Valor numerico invalido em uma das metricas.' else 'Linha rejeitada pelo banco: ' || left(sqlerrm, 200) end,
          null, null, v_marca);
        v_rej := v_rej + 1;
    end;
  end loop;

  update public.importacao_lotes
  set linhas_importadas = linhas_importadas + v_ins,
      linhas_atualizadas = linhas_atualizadas + v_upd,
      linhas_ignoradas = linhas_ignoradas + v_ign,
      linhas_rejeitadas = linhas_rejeitadas + v_rej,
      marcas = (select coalesce(array_agg(distinct m order by m), '{}') from unnest(marcas || v_marcas_ok) m),
      periodo_inicio = least(periodo_inicio, v_ini_ok), periodo_fim = greatest(periodo_fim, v_fim_ok)
  where id = p_lote_id;

  return jsonb_build_object('inseridas', v_ins, 'atualizadas', v_upd, 'inalteradas', v_ign, 'rejeitadas', v_rej);
end;
$$;

-- 8b. Propostas (e, quando a linha traz cartao + emissao, a emissao correspondente) --------------
create or replace function public.rpc_credsystem_propostas_importar(p_lote_id uuid, p_linhas jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r jsonb;
  v_res record;
  v_marca public.bandeira_marca;
  v_id text;
  v_dt date;
  v_aprov integer;
  v_rejei integer;
  v_status text;
  v_inserted boolean;
  v_ins integer := 0;
  v_upd integer := 0;
  v_ign integer := 0;
  v_rej integer := 0;
  v_marcas_ok public.bandeira_marca[] := '{}';
  v_ini_ok date;
  v_fim_ok date;
  v_payload jsonb;
begin
  perform public.gto_cs_lote_para_gravar(p_lote_id, 'credsystem_propostas', p_linhas);

  for r in select value from jsonb_array_elements(p_linhas) loop
    begin
      select * into v_res from public.gto_cs_resolver_marca(r->>'nr_bin', r->>'cd_loja_cs', r->>'marca_hint');
      if v_res.erro_codigo is not null then
        perform public.gto_cs_erro(p_lote_id, r, v_res.erro_codigo, v_res.erro_mensagem, 'MARCA', coalesce(r->>'nr_bin', r->>'marca_hint'));
        v_rej := v_rej + 1; continue;
      end if;
      v_marca := v_res.marca;
      if not public.gto_tem_acesso_marca(v_marca) then
        perform public.gto_cs_erro(p_lote_id, r, 'SEM_PERMISSAO_MARCA', format('Usuario sem permissao para a marca %s.', v_marca), null, null, v_marca);
        v_rej := v_rej + 1; continue;
      end if;

      v_id := public.gto_cs_texto(r->>'id_cod_proposta', 80);
      if v_id is null then
        perform public.gto_cs_erro(p_lote_id, r, 'SEM_IDENTIFICADOR', 'Proposta sem identificador (ID_COD_PROPOSTA): nao e possivel deduplicar.', 'ID_COD_PROPOSTA', null, v_marca);
        v_rej := v_rej + 1; continue;
      end if;
      if (r->>'dt_proposta') !~ '^\d{4}-\d{2}-\d{2}$' then
        perform public.gto_cs_erro(p_lote_id, r, 'DATA_INVALIDA', 'Data da proposta ausente ou ilegivel.', 'DT_PROPOSTA', r->>'dt_proposta', v_marca);
        v_rej := v_rej + 1; continue;
      end if;
      v_dt := (r->>'dt_proposta')::date;

      -- status: aprovada/rejeitada a partir das flags 0/1 ou de um status textual
      v_status := public.gto_cs_norm(r->>'status');
      v_aprov := case when (r->>'proposta_aprov') in ('1', 'true') then 1 when (r->>'proposta_aprov') in ('0', 'false') then 0 end;
      v_rejei := case when (r->>'proposta_rejei') in ('1', 'true') then 1 when (r->>'proposta_rejei') in ('0', 'false') then 0 end;
      if v_aprov is null and v_rejei is null and v_status is not null then
        v_aprov := case when v_status like 'aprov%' then 1 else 0 end;
        v_rejei := case when v_status like 'rejei%' or v_status like 'recus%' or v_status like 'negad%' or v_status like 'reprov%' then 1 else 0 end;
      end if;
      if v_aprov is null and v_rejei is null then
        perform public.gto_cs_erro(p_lote_id, r, 'STATUS_AUSENTE', 'Proposta sem status (aprovada/rejeitada).', 'STATUS', r->>'status', v_marca);
        v_rej := v_rej + 1; continue;
      end if;
      v_aprov := coalesce(v_aprov, 0); v_rejei := coalesce(v_rejei, 0);
      if v_aprov = 1 and v_rejei = 1 then
        perform public.gto_cs_erro(p_lote_id, r, 'STATUS_CONFLITANTE', 'Proposta marcada como aprovada e rejeitada ao mesmo tempo.', 'STATUS', null, v_marca);
        v_rej := v_rej + 1; continue;
      end if;

      -- payload sem dados pessoais diretos (CPF, telefone, numero de cartao)
      v_payload := coalesce((
        select jsonb_object_agg(k, v) from jsonb_each(case when jsonb_typeof(r->'dados_originais') = 'object' then r->'dados_originais' else '{}'::jsonb end) as x(k, v)
        where public.gto_cs_norm(k) !~ '(cpf|tel|fone|celular|nr_cartao|numero_cartao|num_cartao|pan|nome_cliente|nm_cliente)'
      ), '{}'::jsonb);

      insert into public.stage_credsystem_propostas as t (
        marca, dt_proposta, hr_proposta, cd_loja_cs, nm_loja, id_cod_proposta, cd_cliente, id_cod_cartao,
        campanha, origem_prop, proposta_aprov, proposta_rejei, motivo, motivo_rejeicao, dt_aprovacao, nivel_2,
        cliente_pseudo_id, payload_bruto, origem_arquivo, importacao_lote_id, lote_importacao, importado_por
      ) values (
        v_marca, v_dt,
        case when (r->>'hr_proposta') ~ '^\d{2}:\d{2}(:\d{2})?$' then (r->>'hr_proposta')::time end,
        public.gto_cs_texto(r->>'cd_loja_cs', 40), public.gto_cs_texto(r->>'nm_loja', 200), v_id,
        public.gto_cs_texto(r->>'cd_cliente', 80), public.gto_cs_texto(r->>'id_cod_cartao', 80),
        public.gto_cs_texto(r->>'campanha', 200), public.gto_cs_texto(r->>'origem_prop', 200),
        v_aprov, v_rejei, public.gto_cs_texto(r->>'motivo', 200), public.gto_cs_texto(r->>'motivo_rejeicao', 200),
        case when (r->>'dt_aprovacao') ~ '^\d{4}-\d{2}-\d{2}$' then (r->>'dt_aprovacao')::date end,
        public.gto_cs_texto(r->>'nivel_2', 200),
        coalesce(public.gto_pseudonimizar(r->>'cpf_cliente', 'cpf'), public.gto_cs_texto(r->>'cliente_pseudo_id', 120)),
        v_payload, public.gto_cs_texto(r->>'origem_arquivo', 255), p_lote_id, p_lote_id, auth.uid()
      )
      on conflict (marca, id_cod_proposta) do update set
        dt_proposta = excluded.dt_proposta, hr_proposta = excluded.hr_proposta, cd_loja_cs = excluded.cd_loja_cs,
        nm_loja = excluded.nm_loja, id_cod_cartao = excluded.id_cod_cartao, campanha = excluded.campanha,
        origem_prop = excluded.origem_prop, proposta_aprov = excluded.proposta_aprov, proposta_rejei = excluded.proposta_rejei,
        motivo = excluded.motivo, motivo_rejeicao = excluded.motivo_rejeicao, dt_aprovacao = excluded.dt_aprovacao,
        nivel_2 = excluded.nivel_2, cliente_pseudo_id = coalesce(excluded.cliente_pseudo_id, t.cliente_pseudo_id),
        importacao_lote_id = excluded.importacao_lote_id
      where (t.dt_proposta, t.hr_proposta, t.cd_loja_cs, t.nm_loja, t.id_cod_cartao, t.campanha, t.origem_prop,
             t.proposta_aprov, t.proposta_rejei, t.motivo, t.motivo_rejeicao, t.dt_aprovacao, t.nivel_2)
        is distinct from
            (excluded.dt_proposta, excluded.hr_proposta, excluded.cd_loja_cs, excluded.nm_loja, excluded.id_cod_cartao, excluded.campanha, excluded.origem_prop,
             excluded.proposta_aprov, excluded.proposta_rejei, excluded.motivo, excluded.motivo_rejeicao, excluded.dt_aprovacao, excluded.nivel_2)
      returning (xmax = 0) into v_inserted;

      if not found then v_ign := v_ign + 1;
      elsif v_inserted then v_ins := v_ins + 1;
      else v_upd := v_upd + 1;
      end if;
      if not (v_marca = any (v_marcas_ok)) then v_marcas_ok := array_append(v_marcas_ok, v_marca); end if;
      v_ini_ok := least(v_ini_ok, v_dt); v_fim_ok := greatest(v_fim_ok, v_dt);

      -- Arquivo operacional combinado: se a linha traz cartao + data de emissao, grava/atualiza a emissao.
      if public.gto_cs_texto(r->>'id_cod_cartao', 80) is not null and (r->>'dt_emissao') ~ '^\d{4}-\d{2}-\d{2}$' then
        insert into public.dados_cartoes_credsystem as c (
          marca, data_emissao, data_ativacao, loja_operacao, id_cod_cartao, chave_natural, cliente_pseudo_id,
          origem_arquivo, importacao_lote_id, importado_por
        ) values (
          v_marca, (r->>'dt_emissao')::date,
          case when (r->>'dt_ativacao') ~ '^\d{4}-\d{2}-\d{2}$' and (r->>'dt_ativacao')::date >= (r->>'dt_emissao')::date then (r->>'dt_ativacao')::date end,
          coalesce(public.gto_cs_texto(r->>'nm_loja', 200), public.gto_cs_texto(r->>'cd_loja_cs', 40), 'Nao informado'),
          public.gto_cs_texto(r->>'id_cod_cartao', 80), 'id:' || public.gto_cs_texto(r->>'id_cod_cartao', 80),
          coalesce(public.gto_pseudonimizar(r->>'cpf_cliente', 'cpf'), public.gto_cs_texto(r->>'cliente_pseudo_id', 120)),
          public.gto_cs_texto(r->>'origem_arquivo', 255), p_lote_id, auth.uid()
        )
        on conflict (marca, chave_natural) do update set
          data_emissao = excluded.data_emissao,
          data_ativacao = coalesce(excluded.data_ativacao, c.data_ativacao),
          importacao_lote_id = excluded.importacao_lote_id
        where (c.data_emissao, c.data_ativacao) is distinct from (excluded.data_emissao, coalesce(excluded.data_ativacao, c.data_ativacao));
      end if;
    exception
      when others then
        perform public.gto_cs_erro(p_lote_id, r, 'ERRO_LINHA', 'Linha rejeitada pelo banco: ' || left(sqlerrm, 200), null, null, v_marca);
        v_rej := v_rej + 1;
    end;
  end loop;

  update public.importacao_lotes
  set linhas_importadas = linhas_importadas + v_ins, linhas_atualizadas = linhas_atualizadas + v_upd,
      linhas_ignoradas = linhas_ignoradas + v_ign, linhas_rejeitadas = linhas_rejeitadas + v_rej,
      marcas = (select coalesce(array_agg(distinct m order by m), '{}') from unnest(marcas || v_marcas_ok) m),
      periodo_inicio = least(periodo_inicio, v_ini_ok), periodo_fim = greatest(periodo_fim, v_fim_ok)
  where id = p_lote_id;

  return jsonb_build_object('inseridas', v_ins, 'atualizadas', v_upd, 'inalteradas', v_ign, 'rejeitadas', v_rej);
end;
$$;

-- 8c. Emissoes / ativacoes de cartao ---------------------------------------------------------------
create or replace function public.rpc_credsystem_emissoes_importar(p_lote_id uuid, p_linhas jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r jsonb;
  v_res record;
  v_marca public.bandeira_marca;
  v_emissao date;
  v_ativacao date;
  v_cartao text;
  v_pseudo text;
  v_loja text;
  v_chave text;
  v_inserted boolean;
  v_ins integer := 0;
  v_upd integer := 0;
  v_ign integer := 0;
  v_rej integer := 0;
  v_marcas_ok public.bandeira_marca[] := '{}';
  v_ini_ok date;
  v_fim_ok date;
begin
  perform public.gto_cs_lote_para_gravar(p_lote_id, 'credsystem_emissoes', p_linhas);

  for r in select value from jsonb_array_elements(p_linhas) loop
    begin
      select * into v_res from public.gto_cs_resolver_marca(r->>'nr_bin', r->>'cd_loja_cs', r->>'marca_hint');
      if v_res.erro_codigo is not null then
        perform public.gto_cs_erro(p_lote_id, r, v_res.erro_codigo, v_res.erro_mensagem, 'MARCA', coalesce(r->>'nr_bin', r->>'marca_hint'));
        v_rej := v_rej + 1; continue;
      end if;
      v_marca := v_res.marca;
      if not public.gto_tem_acesso_marca(v_marca) then
        perform public.gto_cs_erro(p_lote_id, r, 'SEM_PERMISSAO_MARCA', format('Usuario sem permissao para a marca %s.', v_marca), null, null, v_marca);
        v_rej := v_rej + 1; continue;
      end if;
      if (r->>'dt_emissao') !~ '^\d{4}-\d{2}-\d{2}$' then
        perform public.gto_cs_erro(p_lote_id, r, 'DATA_INVALIDA', 'Data de emissao ausente ou ilegivel.', 'DT_EMISSAO', r->>'dt_emissao', v_marca);
        v_rej := v_rej + 1; continue;
      end if;
      v_emissao := (r->>'dt_emissao')::date;
      v_ativacao := null;
      if nullif(trim(coalesce(r->>'dt_ativacao', '')), '') is not null then
        if (r->>'dt_ativacao') !~ '^\d{4}-\d{2}-\d{2}$' then
          perform public.gto_cs_erro(p_lote_id, r, 'DATA_INVALIDA', 'Data de ativacao ilegivel.', 'DT_ATIVACAO', r->>'dt_ativacao', v_marca);
          v_rej := v_rej + 1; continue;
        end if;
        v_ativacao := (r->>'dt_ativacao')::date;
        if v_ativacao < v_emissao then
          perform public.gto_cs_erro(p_lote_id, r, 'ATIVACAO_ANTES_DA_EMISSAO', 'Data de ativacao anterior a emissao.', 'DT_ATIVACAO', r->>'dt_ativacao', v_marca);
          v_rej := v_rej + 1; continue;
        end if;
      end if;

      v_cartao := public.gto_cs_texto(r->>'id_cod_cartao', 80);
      v_pseudo := coalesce(public.gto_pseudonimizar(r->>'cpf_cliente', 'cpf'), public.gto_cs_texto(r->>'cliente_pseudo_id', 120));
      v_loja := coalesce(public.gto_cs_texto(r->>'nm_loja', 200), public.gto_cs_texto(r->>'cd_loja_cs', 40), 'Nao informado');
      if v_cartao is null and v_pseudo is null then
        perform public.gto_cs_erro(p_lote_id, r, 'SEM_IDENTIFICADOR', 'Emissao sem ID do cartao e sem identificador de cliente: nao e possivel deduplicar.', 'ID_COD_CARTAO', null, v_marca);
        v_rej := v_rej + 1; continue;
      end if;
      v_chave := case when v_cartao is not null then 'id:' || v_cartao
                      else 'nk:' || md5(concat_ws('|', coalesce((v_emissao)::text, ''), coalesce((public.gto_cs_norm(v_loja))::text, ''), coalesce((v_pseudo)::text, ''), coalesce((public.gto_cs_norm(r->>'tipo_cartao'))::text, ''), coalesce(public.gto_cs_norm(r->>'canal'), ''))) end;

      insert into public.dados_cartoes_credsystem as c (
        marca, data_emissao, data_ativacao, loja_operacao, id_cod_cartao, chave_natural, cliente_pseudo_id,
        canal, sub_canal, tipo_cartao, origem_arquivo, importacao_lote_id, importado_por
      ) values (
        v_marca, v_emissao, v_ativacao, v_loja, v_cartao, v_chave, v_pseudo,
        public.gto_cs_texto(r->>'canal', 120), public.gto_cs_texto(r->>'sub_canal', 120), public.gto_cs_texto(r->>'tipo_cartao', 60),
        public.gto_cs_texto(r->>'origem_arquivo', 255), p_lote_id, auth.uid()
      )
      on conflict (marca, chave_natural) do update set
        data_emissao = excluded.data_emissao,
        data_ativacao = excluded.data_ativacao,
        loja_operacao = excluded.loja_operacao,
        canal = excluded.canal, sub_canal = excluded.sub_canal, tipo_cartao = excluded.tipo_cartao,
        cliente_pseudo_id = coalesce(excluded.cliente_pseudo_id, c.cliente_pseudo_id),
        importacao_lote_id = excluded.importacao_lote_id,
        excluido_bi = false, motivo_exclusao_bi = null
      where (c.data_emissao, c.data_ativacao, c.loja_operacao, c.canal, c.sub_canal, c.tipo_cartao, c.excluido_bi)
        is distinct from (excluded.data_emissao, excluded.data_ativacao, excluded.loja_operacao, excluded.canal, excluded.sub_canal, excluded.tipo_cartao, false)
      returning (xmax = 0) into v_inserted;

      if not found then v_ign := v_ign + 1;
      elsif v_inserted then v_ins := v_ins + 1;
      else v_upd := v_upd + 1;
      end if;
      if not (v_marca = any (v_marcas_ok)) then v_marcas_ok := array_append(v_marcas_ok, v_marca); end if;
      v_ini_ok := least(v_ini_ok, v_emissao); v_fim_ok := greatest(v_fim_ok, v_emissao);
    exception
      when others then
        perform public.gto_cs_erro(p_lote_id, r, 'ERRO_LINHA', 'Linha rejeitada pelo banco: ' || left(sqlerrm, 200), null, null, v_marca);
        v_rej := v_rej + 1;
    end;
  end loop;

  update public.importacao_lotes
  set linhas_importadas = linhas_importadas + v_ins, linhas_atualizadas = linhas_atualizadas + v_upd,
      linhas_ignoradas = linhas_ignoradas + v_ign, linhas_rejeitadas = linhas_rejeitadas + v_rej,
      marcas = (select coalesce(array_agg(distinct m order by m), '{}') from unnest(marcas || v_marcas_ok) m),
      periodo_inicio = least(periodo_inicio, v_ini_ok), periodo_fim = greatest(periodo_fim, v_fim_ok)
  where id = p_lote_id;

  return jsonb_build_object('inseridas', v_ins, 'atualizadas', v_upd, 'inalteradas', v_ign, 'rejeitadas', v_rej);
end;
$$;

-- 8d. Transacoes ----------------------------------------------------------------------------------
create or replace function public.rpc_credsystem_transacoes_importar(p_lote_id uuid, p_linhas jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r jsonb;
  v_res record;
  v_marca public.bandeira_marca;
  v_dt date;
  v_valor numeric;
  v_pseudo text;
  v_chave text;
  v_inserted boolean;
  v_ins integer := 0;
  v_upd integer := 0;
  v_ign integer := 0;
  v_rej integer := 0;
  v_marcas_ok public.bandeira_marca[] := '{}';
  v_ini_ok date;
  v_fim_ok date;
begin
  perform public.gto_cs_lote_para_gravar(p_lote_id, 'credsystem_transacoes', p_linhas);

  for r in select value from jsonb_array_elements(p_linhas) loop
    begin
      select * into v_res from public.gto_cs_resolver_marca(r->>'nr_bin', r->>'cd_loja', r->>'marca_hint');
      if v_res.erro_codigo is not null then
        perform public.gto_cs_erro(p_lote_id, r, v_res.erro_codigo, v_res.erro_mensagem, 'MARCA', coalesce(r->>'nr_bin', r->>'marca_hint'));
        v_rej := v_rej + 1; continue;
      end if;
      v_marca := v_res.marca;
      if not public.gto_tem_acesso_marca(v_marca) then
        perform public.gto_cs_erro(p_lote_id, r, 'SEM_PERMISSAO_MARCA', format('Usuario sem permissao para a marca %s.', v_marca), null, null, v_marca);
        v_rej := v_rej + 1; continue;
      end if;
      if (r->>'dt_transacao') !~ '^\d{4}-\d{2}-\d{2}$' then
        perform public.gto_cs_erro(p_lote_id, r, 'DATA_INVALIDA', 'Data da compra ausente ou ilegivel.', 'DT_TRANSACAO', r->>'dt_transacao', v_marca);
        v_rej := v_rej + 1; continue;
      end if;
      v_dt := (r->>'dt_transacao')::date;
      v_valor := public.gto_cs_numeric(r->'vl_transacao');
      if v_valor is null then
        perform public.gto_cs_erro(p_lote_id, r, 'CAMPO_OBRIGATORIO', 'Valor da compra ausente.', 'VL_TRANSACAO', null, v_marca);
        v_rej := v_rej + 1; continue;
      end if;
      v_pseudo := coalesce(public.gto_pseudonimizar(r->>'cpf_cliente', 'cpf'), public.gto_cs_texto(r->>'cliente_pseudo_id', 120));
      if public.gto_cs_texto(r->>'id_transacao', 120) is null and v_pseudo is null then
        perform public.gto_cs_erro(p_lote_id, r, 'SEM_IDENTIFICADOR', 'Compra sem ID da transacao e sem cliente: nao e possivel deduplicar.', 'ID_TRANSACAO', null, v_marca);
        v_rej := v_rej + 1; continue;
      end if;
      v_chave := case when public.gto_cs_texto(r->>'id_transacao', 120) is not null then 'id:' || public.gto_cs_texto(r->>'id_transacao', 120)
                      else 'nk:' || md5(concat_ws('|', coalesce((v_dt)::text, ''), coalesce((v_pseudo)::text, ''), coalesce((public.gto_cs_norm(r->>'cd_loja'))::text, ''), coalesce((v_valor::text)::text, ''), coalesce(public.gto_cs_texto(r->>'hr_transacao', 20), ''))) end;

      insert into public.credsystem_transacoes as t (
        marca, marca_origem, chave_natural, id_transacao, cliente_pseudo_id, id_cod_cartao, dt_transacao, cd_loja, nm_loja,
        vl_transacao, qt_itens, forma_pagamento, aba_origem, linha_origem, dados_originais, lote_id, importado_por
      ) values (
        v_marca, v_res.origem, v_chave, public.gto_cs_texto(r->>'id_transacao', 120), v_pseudo, public.gto_cs_texto(r->>'id_cod_cartao', 80),
        v_dt, public.gto_cs_texto(r->>'cd_loja', 40), public.gto_cs_texto(r->>'nm_loja', 200), round(v_valor, 2),
        case when (r->>'qt_itens') ~ '^\d{1,6}$' then (r->>'qt_itens')::integer end,
        public.gto_cs_texto(r->>'forma_pagamento', 60), public.gto_cs_texto(r->>'aba', 120),
        case when (r->>'linha') ~ '^\d{1,9}$' then (r->>'linha')::integer end,
        coalesce((select jsonb_object_agg(k, v) from jsonb_each(case when jsonb_typeof(r->'dados_originais') = 'object' then r->'dados_originais' else '{}'::jsonb end) as x(k, v)
                  where public.gto_cs_norm(k) !~ '(cpf|tel|fone|celular|nr_cartao|numero_cartao|num_cartao|pan|nome_cliente|nm_cliente)'), '{}'::jsonb),
        p_lote_id, auth.uid()
      )
      on conflict (marca, chave_natural) do update set
        dt_transacao = excluded.dt_transacao, vl_transacao = excluded.vl_transacao, cd_loja = excluded.cd_loja,
        nm_loja = excluded.nm_loja, qt_itens = excluded.qt_itens, forma_pagamento = excluded.forma_pagamento,
        cliente_pseudo_id = coalesce(excluded.cliente_pseudo_id, t.cliente_pseudo_id), lote_id = excluded.lote_id
      where (t.dt_transacao, t.vl_transacao, t.cd_loja, t.nm_loja, t.qt_itens, t.forma_pagamento)
        is distinct from (excluded.dt_transacao, excluded.vl_transacao, excluded.cd_loja, excluded.nm_loja, excluded.qt_itens, excluded.forma_pagamento)
      returning (xmax = 0) into v_inserted;

      if not found then v_ign := v_ign + 1;
      elsif v_inserted then v_ins := v_ins + 1;
      else v_upd := v_upd + 1;
      end if;
      if not (v_marca = any (v_marcas_ok)) then v_marcas_ok := array_append(v_marcas_ok, v_marca); end if;
      v_ini_ok := least(v_ini_ok, v_dt); v_fim_ok := greatest(v_fim_ok, v_dt);
    exception
      when others then
        perform public.gto_cs_erro(p_lote_id, r,
          case when sqlerrm = 'VALOR_NUMERICO_INVALIDO' then 'VALOR_NUMERICO_INVALIDO' else 'ERRO_LINHA' end,
          'Linha rejeitada: ' || left(sqlerrm, 200), null, null, v_marca);
        v_rej := v_rej + 1;
    end;
  end loop;

  update public.importacao_lotes
  set linhas_importadas = linhas_importadas + v_ins, linhas_atualizadas = linhas_atualizadas + v_upd,
      linhas_ignoradas = linhas_ignoradas + v_ign, linhas_rejeitadas = linhas_rejeitadas + v_rej,
      marcas = (select coalesce(array_agg(distinct m order by m), '{}') from unnest(marcas || v_marcas_ok) m),
      periodo_inicio = least(periodo_inicio, v_ini_ok), periodo_fim = greatest(periodo_fim, v_fim_ok)
  where id = p_lote_id;

  return jsonb_build_object('inseridas', v_ins, 'atualizadas', v_upd, 'inalteradas', v_ign, 'rejeitadas', v_rej);
end;
$$;

-- 9. RPCs de leitura (SECURITY INVOKER: RLS das tabelas base decide o que cada usuario ve) --------

-- Resumo operacional de propostas/cartoes. p_marca null = todas as marcas autorizadas.
-- Coorte: propostas com dt_proposta no periodo, acompanhadas ate o cartao (id_cod_cartao) e a
-- ativacao. Periodo: eventos (emissoes por data_emissao, ativacoes por data_ativacao) no periodo.
create or replace function public.rpc_credsystem_operacional_resumo(
  p_marca public.bandeira_marca default null, p_de date default null, p_ate date default null
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with cartoes_id as (
    -- um registro por cartao (marca + id), so linhas validas para BI
    select marca, id_cod_cartao, bool_or(data_ativacao is not null) as ativado
    from public.dados_cartoes_credsystem
    where id_cod_cartao is not null and not excluido_bi and (p_marca is null or marca = p_marca)
    group by marca, id_cod_cartao
  ),
  prop as (
    select p.marca, p.dt_proposta, date_trunc('month', p.dt_proposta)::date as mes,
           coalesce(nullif(trim(p.cd_loja_cs), ''), '—') as cd_loja,
           coalesce(nullif(trim(p.nm_loja), ''), 'Não informado') as nm_loja,
           coalesce(nullif(trim(p.motivo), ''), 'Sem motivo informado') as motivo,
           p.proposta_aprov, p.proposta_rejei, p.id_cod_cartao,
           c.id_cod_cartao is not null as emitida, coalesce(c.ativado, false) as ativada
    from public.stage_credsystem_propostas p
    left join cartoes_id c on c.marca = p.marca and c.id_cod_cartao = p.id_cod_cartao
    where (p_marca is null or p.marca = p_marca)
      and (p_de is null or p.dt_proposta >= p_de)
      and (p_ate is null or p.dt_proposta <= p_ate)
  ),
  cart as (
    select c.marca, c.data_emissao, c.data_ativacao from public.dados_cartoes_credsystem c
    where not c.excluido_bi and (p_marca is null or c.marca = p_marca)
  ),
  base_prop as (
    select marca, count(*) n, min(dt_proposta) ini, max(dt_proposta) fim, count(id_cod_cartao) com_vinculo
    from public.stage_credsystem_propostas where (p_marca is null or marca = p_marca) group by marca
  ),
  base_cart as (
    select marca, count(*) n, min(data_emissao) ini, max(data_emissao) fim from cart group by marca
  )
  select jsonb_build_object(
    'base', jsonb_build_object(
      'propostas', coalesce((select jsonb_agg(to_jsonb(b) order by b.marca) from base_prop b), '[]'::jsonb),
      'cartoes', coalesce((select jsonb_agg(to_jsonb(b) order by b.marca) from base_cart b), '[]'::jsonb)
    ),
    'por_marca', coalesce((
      select jsonb_agg(x order by x->>'marca') from (
        select jsonb_build_object(
          'marca', m.marca,
          'propostas', coalesce(pp.propostas, 0), 'aprovadas', coalesce(pp.aprovadas, 0), 'rejeitadas', coalesce(pp.rejeitadas, 0),
          'propostas_com_vinculo', coalesce(pp.com_vinculo, 0),
          'emitidas_coorte', coalesce(pp.emitidas, 0), 'ativadas_coorte', coalesce(pp.ativadas, 0),
          'emitidos_periodo', coalesce(cc.emitidos, 0), 'ativados_periodo', coalesce(cc.ativados, 0),
          'ativados_dos_emitidos_periodo', coalesce(cc.ativados_dos_emitidos, 0)
        ) x
        from (select marca from prop union select marca from cart) m
        left join (
          select marca, count(*) propostas, sum(proposta_aprov) aprovadas, sum(proposta_rejei) rejeitadas,
                 count(id_cod_cartao) com_vinculo,
                 count(*) filter (where emitida and proposta_aprov = 1) emitidas,
                 count(*) filter (where ativada and proposta_aprov = 1) ativadas
          from prop group by marca
        ) pp on pp.marca = m.marca
        left join (
          select marca,
                 count(*) filter (where (p_de is null or data_emissao >= p_de) and (p_ate is null or data_emissao <= p_ate)) emitidos,
                 count(*) filter (where data_ativacao is not null and (p_de is null or data_ativacao >= p_de) and (p_ate is null or data_ativacao <= p_ate)) ativados,
                 count(*) filter (where data_ativacao is not null and (p_de is null or data_emissao >= p_de) and (p_ate is null or data_emissao <= p_ate)) ativados_dos_emitidos
          from cart group by marca
        ) cc on cc.marca = m.marca
      ) s
    ), '[]'::jsonb),
    'mensal', coalesce((
      select jsonb_agg(x order by x->>'mes', x->>'marca') from (
        select jsonb_build_object('marca', coalesce(a.marca, b.marca), 'mes', coalesce(a.mes, b.mes),
          'propostas', coalesce(a.propostas, 0), 'aprovadas', coalesce(a.aprovadas, 0), 'rejeitadas', coalesce(a.rejeitadas, 0),
          'emitidas_coorte', coalesce(a.emitidas, 0), 'ativadas_coorte', coalesce(a.ativadas, 0),
          'emitidos_periodo', coalesce(b.emitidos, 0), 'ativados_periodo', coalesce(b.ativados, 0)) x
        from (
          select marca, mes, count(*) propostas, sum(proposta_aprov) aprovadas, sum(proposta_rejei) rejeitadas,
                 count(*) filter (where emitida and proposta_aprov = 1) emitidas, count(*) filter (where ativada and proposta_aprov = 1) ativadas
          from prop group by marca, mes
        ) a
        full join (
          select marca, mes, sum(emitidos) emitidos, sum(ativados) ativados from (
            select marca, date_trunc('month', data_emissao)::date mes, 1 emitidos, 0 ativados from cart
            where (p_de is null or data_emissao >= p_de) and (p_ate is null or data_emissao <= p_ate)
            union all
            select marca, date_trunc('month', data_ativacao)::date, 0, 1 from cart
            where data_ativacao is not null and (p_de is null or data_ativacao >= p_de) and (p_ate is null or data_ativacao <= p_ate)
          ) e group by marca, mes
        ) b on b.marca = a.marca and b.mes = a.mes
      ) s
    ), '[]'::jsonb),
    'lojas', coalesce((
      select jsonb_agg(jsonb_build_object('marca', marca, 'cd_loja', cd_loja, 'nm_loja', nm_loja,
        'propostas', propostas, 'aprovadas', aprovadas, 'rejeitadas', rejeitadas, 'emitidas', emitidas, 'ativadas', ativadas)
        order by propostas desc)
      from (
        select marca, cd_loja, min(nm_loja) nm_loja, count(*) propostas, sum(proposta_aprov) aprovadas, sum(proposta_rejei) rejeitadas,
               count(*) filter (where emitida and proposta_aprov = 1) emitidas, count(*) filter (where ativada and proposta_aprov = 1) ativadas
        from prop group by marca, cd_loja
      ) l
    ), '[]'::jsonb),
    'motivos', coalesce((
      select jsonb_agg(jsonb_build_object('marca', marca, 'motivo', motivo, 'total', total, 'aprovadas', aprovadas, 'rejeitadas', rejeitadas) order by total desc)
      from (select marca, motivo, count(*) total, sum(proposta_aprov) aprovadas, sum(proposta_rejei) rejeitadas from prop group by marca, motivo) mo
    ), '[]'::jsonb),
    'motivos_mensal', coalesce((
      select jsonb_agg(jsonb_build_object('marca', marca, 'mes', mes, 'motivo', motivo, 'total', total) order by mes, total desc)
      from (select marca, mes, motivo, count(*) total from prop group by marca, mes, motivo) mm
    ), '[]'::jsonb)
  );
$$;

-- Retencao e comportamento: so calcula com transacoes individualizadas (cliente pseudonimizado).
create or replace function public.rpc_credsystem_retencao_resumo(
  p_marca public.bandeira_marca default null, p_de date default null, p_ate date default null, p_dias_inatividade integer default 90
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with t as (
    select marca, cliente_pseudo_id cli, dt_transacao dt, vl_transacao vl
    from public.credsystem_transacoes
    where cliente_pseudo_id is not null and (p_marca is null or marca = p_marca)
  ),
  ref as (select coalesce(p_ate, (select max(dt) from t)) as ate),
  primeira as (select marca, cli, min(dt) primeira_compra from t group by marca, cli),
  per as (
    select t.* from t, ref where (p_de is null or t.dt >= p_de) and t.dt <= ref.ate
  ),
  cli as (
    select p.marca, p.cli, count(*) compras, sum(p.vl) valor, min(p.dt) pri_per, max(p.dt) ult_per,
           f.primeira_compra,
           (select max(t2.dt) from t t2, ref where t2.marca = p.marca and t2.cli = p.cli and t2.dt <= ref.ate) ultima_compra
    from per p join primeira f on f.marca = p.marca and f.cli = p.cli
    group by p.marca, p.cli, f.primeira_compra
  ),
  intervalos as (
    select avg(gap) media from (
      select dt - lag(dt) over (partition by marca, cli order by dt) gap from per
    ) g where gap is not null
  ),
  rfm as (
    select c.*, (select ate from ref) - c.ultima_compra recencia,
           ntile(3) over (order by (select ate from ref) - c.ultima_compra desc) r,
           ntile(3) over (order by c.compras) f,
           ntile(3) over (order by c.valor) m
    from cli c
  ),
  base_ant as (
    select distinct marca, cli from t, ref where t.dt < coalesce(p_de, '0001-01-01'::date)
  ),
  ultima_ant as (
    select marca, cli, max(dt) ult from t where dt < coalesce(p_de, '0001-01-01'::date) group by marca, cli
  ),
  coortes as (
    select date_trunc('month', f.primeira_compra)::date coorte,
           (extract(year from age(date_trunc('month', t.dt), date_trunc('month', f.primeira_compra))) * 12
            + extract(month from age(date_trunc('month', t.dt), date_trunc('month', f.primeira_compra))))::int mes_rel,
           count(distinct t.marca || t.cli) clientes
    from t join primeira f on f.marca = t.marca and f.cli = t.cli, ref
    where t.dt <= ref.ate and (p_de is null or f.primeira_compra >= p_de)
    group by 1, 2
  )
  select jsonb_build_object(
    'tem_dados', exists (select 1 from t),
    'transacoes_periodo', (select count(*) from per),
    'clientes_unicos', (select count(*) from cli),
    'clientes_novos', (select count(*) from cli where primeira_compra >= coalesce(p_de, primeira_compra)),
    'clientes_recorrentes', (select count(*) from cli where compras >= 2),
    'valor_total', (select coalesce(sum(valor), 0) from cli),
    'ticket_medio_transacao', (select case when count(*) = 0 then null else round(sum(vl) / count(*), 2) end from per),
    'valor_medio_por_cliente', (select case when count(*) = 0 then null else round(sum(valor) / count(*), 2) end from cli),
    'frequencia_media', (select case when count(*) = 0 then null else round(sum(compras)::numeric / count(*), 2) end from cli),
    'dias_medios_entre_compras', (select round(media::numeric, 1) from intervalos),
    'recencia_media_dias', (select round(avg((select ate from ref) - ultima_compra)::numeric, 1) from cli),
    'clientes_inativos', (select count(*) from ultima_ant u, ref where (ref.ate - u.ult) > p_dias_inatividade
                           and not exists (select 1 from per p where p.marca = u.marca and p.cli = u.cli)),
    'clientes_reativados', (select count(*) from cli c join ultima_ant u on u.marca = c.marca and u.cli = c.cli
                            where c.pri_per - u.ult > p_dias_inatividade),
    'rfm', coalesce((select jsonb_agg(jsonb_build_object('segmento', seg, 'clientes', n) order by n desc) from (
              select case
                when r = 3 and f = 3 then 'Campeões'
                when r >= 2 and f >= 2 then 'Leais'
                when r = 3 and f = 1 then 'Novos/Promissores'
                when r = 1 and f >= 2 then 'Em risco'
                when r = 1 and f = 1 then 'Hibernando'
                else 'Precisam de atenção' end seg, count(*) n
              from rfm group by 1) s), '[]'::jsonb),
    'coortes', coalesce((select jsonb_agg(jsonb_build_object('coorte', coorte, 'mes_relativo', mes_rel, 'clientes', clientes) order by coorte, mes_rel) from coortes), '[]'::jsonb),
    'valor_mensal', coalesce((select jsonb_agg(jsonb_build_object('mes', mes, 'valor', valor, 'clientes', clientes) order by mes) from (
              select date_trunc('month', dt)::date mes, sum(vl) valor, count(distinct marca || cli) clientes from per group by 1) v), '[]'::jsonb)
  );
$$;

-- Status de importacao por tipo, para os estados vazios dos dashboards ("sem dados importados" x
-- "sem registros no periodo"). Respeita RLS de importacao_lotes.
create or replace function public.rpc_credsystem_status_importacoes(p_marca public.bandeira_marca default null)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(jsonb_object_agg(tipo_arquivo, info), '{}'::jsonb) from (
    select tipo_arquivo, jsonb_build_object(
      'ultima_importacao', max(concluido_em),
      'lotes', count(*),
      'periodo_inicio', min(periodo_inicio),
      'periodo_fim', max(periodo_fim)
    ) info
    from public.importacao_lotes
    where status in ('concluido', 'concluido_com_erros')
      and (p_marca is null or p_marca = any (marcas))
    group by tipo_arquivo
  ) s;
$$;

-- Grants: authenticated so le (via RLS) e grava via RPC -------------------------------------------
revoke all on public.credsystem_bin_marca, public.credsystem_loja_marca, public.importacao_lotes,
  public.importacao_erros_linha, public.importacao_modelos_colunas, public.credsystem_campanhas_crm,
  public.credsystem_transacoes from anon;

grant select on public.credsystem_bin_marca, public.credsystem_loja_marca, public.importacao_lotes,
  public.importacao_erros_linha, public.credsystem_campanhas_crm, public.credsystem_transacoes to authenticated;
grant insert, update, delete on public.credsystem_bin_marca, public.credsystem_loja_marca to authenticated;
grant select, insert, update, delete on public.importacao_modelos_colunas to authenticated;
grant delete on public.credsystem_campanhas_crm, public.credsystem_transacoes to authenticated;

revoke all on function public.rpc_importacao_iniciar(text, text, text, jsonb) from public;
revoke all on function public.rpc_importacao_registrar_erros(uuid, jsonb, integer) from public;
revoke all on function public.rpc_importacao_finalizar(uuid, integer, text[], boolean) from public;
revoke all on function public.rpc_credsystem_crm_importar(uuid, jsonb) from public;
revoke all on function public.rpc_credsystem_propostas_importar(uuid, jsonb) from public;
revoke all on function public.rpc_credsystem_emissoes_importar(uuid, jsonb) from public;
revoke all on function public.rpc_credsystem_transacoes_importar(uuid, jsonb) from public;
revoke all on function public.rpc_credsystem_operacional_resumo(public.bandeira_marca, date, date) from public;
revoke all on function public.rpc_credsystem_retencao_resumo(public.bandeira_marca, date, date, integer) from public;
revoke all on function public.rpc_credsystem_status_importacoes(public.bandeira_marca) from public;

grant execute on function public.rpc_importacao_iniciar(text, text, text, jsonb) to authenticated;
grant execute on function public.rpc_importacao_registrar_erros(uuid, jsonb, integer) to authenticated;
grant execute on function public.rpc_importacao_finalizar(uuid, integer, text[], boolean) to authenticated;
grant execute on function public.rpc_credsystem_crm_importar(uuid, jsonb) to authenticated;
grant execute on function public.rpc_credsystem_propostas_importar(uuid, jsonb) to authenticated;
grant execute on function public.rpc_credsystem_emissoes_importar(uuid, jsonb) to authenticated;
grant execute on function public.rpc_credsystem_transacoes_importar(uuid, jsonb) to authenticated;
grant execute on function public.rpc_credsystem_operacional_resumo(public.bandeira_marca, date, date) to authenticated;
grant execute on function public.rpc_credsystem_retencao_resumo(public.bandeira_marca, date, date, integer) to authenticated;
grant execute on function public.rpc_credsystem_status_importacoes(public.bandeira_marca) to authenticated;

-- 10. Views BI antigas ignoram linhas excluidas do BI --------------------------------------------
create or replace view public.vw_credsystem_resumo_geral
with (security_invoker = true)
as
with emissoes as (
  select
    marca,
    count(*)::integer as total_cartoes,
    count(*) filter (where data_ativacao is not null)::integer as cartoes_ativados,
    coalesce(avg(valor_compra_inicial), 0)::numeric(14,2) as ticket_medio,
    coalesce(avg(frequencia_recorrencia), 0)::numeric(14,2) as recorrencia_media
  from public.dados_cartoes_credsystem
  where not excluido_bi
  group by marca
),
propostas as (
  select
    marca,
    count(*)::integer as total_propostas,
    coalesce(sum(proposta_aprov), 0)::integer as propostas_aprovadas,
    coalesce(sum(proposta_rejei), 0)::integer as propostas_rejeitadas
  from public.stage_credsystem_propostas
  group by marca
)
select
  coalesce(e.marca, p.marca) as marca,
  coalesce(e.total_cartoes, 0)::integer as total_cartoes,
  coalesce(e.cartoes_ativados, 0)::integer as cartoes_ativados,
  coalesce(e.ticket_medio, 0)::numeric(14,2) as ticket_medio,
  coalesce(e.recorrencia_media, 0)::numeric(14,2) as recorrencia_media,
  coalesce(p.total_propostas, 0)::integer as total_propostas,
  coalesce(p.propostas_aprovadas, 0)::integer as propostas_aprovadas,
  coalesce(p.propostas_rejeitadas, 0)::integer as propostas_rejeitadas,
  case
    when coalesce(p.total_propostas, 0) = 0 then 0::numeric(8,2)
    else round((coalesce(p.propostas_aprovadas, 0)::numeric / p.total_propostas::numeric) * 100, 2)
  end as taxa_aprovacao
from emissoes e
full outer join propostas p on p.marca = e.marca;

create or replace view public.vw_credsystem_por_loja
with (security_invoker = true)
as
with emissoes as (
  select
    marca,
    nullif(trim(loja_operacao), '') as loja,
    count(*)::integer as total_cartoes,
    count(*) filter (where data_ativacao is not null)::integer as cartoes_ativados
  from public.dados_cartoes_credsystem
  where not excluido_bi
  group by marca, nullif(trim(loja_operacao), '')
),
propostas as (
  select
    marca,
    coalesce(nullif(trim(nm_loja), ''), nullif(trim(cd_loja_cs), ''), 'Nao informado') as loja,
    count(*)::integer as total_propostas,
    coalesce(sum(proposta_aprov), 0)::integer as propostas_aprovadas,
    coalesce(sum(proposta_rejei), 0)::integer as propostas_rejeitadas
  from public.stage_credsystem_propostas
  group by marca, coalesce(nullif(trim(nm_loja), ''), nullif(trim(cd_loja_cs), ''), 'Nao informado')
)
select
  coalesce(e.marca, p.marca) as marca,
  coalesce(e.loja, p.loja, 'Nao informado') as loja,
  coalesce(e.total_cartoes, 0)::integer as total_cartoes,
  coalesce(e.cartoes_ativados, 0)::integer as cartoes_ativados,
  coalesce(p.total_propostas, 0)::integer as total_propostas,
  coalesce(p.propostas_aprovadas, 0)::integer as propostas_aprovadas,
  coalesce(p.propostas_rejeitadas, 0)::integer as propostas_rejeitadas,
  case
    when coalesce(p.total_propostas, 0) = 0 then 0::numeric(8,2)
    else round((coalesce(p.propostas_aprovadas, 0)::numeric / p.total_propostas::numeric) * 100, 2)
  end as taxa_aprovacao
from emissoes e
full outer join propostas p
  on p.marca = e.marca
 and p.loja = e.loja;

commit;
