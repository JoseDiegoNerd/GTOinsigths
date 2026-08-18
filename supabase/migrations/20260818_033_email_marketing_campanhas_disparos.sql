-- GTO Insights - Modelo relacional de E-mail Marketing (campanhas -> disparos -> analise estrategica)
-- Scope: suporta o novo wizard "Importar Planilhas" (Destino = E-mail Marketing) e o novo
-- dashboard de E-mail Marketing, alinhados ao padrao oficial de relatorio de e-mail marketing das
-- 3 marcas. Substitui, para importacoes NOVAS a partir de agora, o modelo antigo baseado em
-- stage_rd_station_marketing (1 linha = 1 campanha inteira, sem granularidade de disparo).
--
-- Decisao deliberada: NAO migra dados historicos de stage_rd_station_marketing para este modelo
-- novo. Aquela tabela e as views vw_email_marketing_campanhas/vw_email_marketing_resumo_marca
-- (migrations 006/032) ficam intocadas - o novo dashboard passa a ler exclusivamente das tabelas
-- deste arquivo, com historico comecando vazio ate a primeira importacao pelo wizard novo. Import
-- de Cartoes Proprios e Midia Paga/Meta Ads continua usando as tabelas de sempre
-- (dados_cartoes_credsystem, stage_credsystem_propostas, stage_meta_business_analytics) - nao faz
-- parte deste escopo.
--
-- Modelo (3 tabelas):
--   campanhas_email           -> 1 linha por campanha importada (metadados)
--   campanha_disparos         -> 1 linha por disparo (envio de e-mail/SMS/WhatsApp) da campanha
--   campanha_analise_estrategica -> 1 linha por insight/diagnostico gerado pelo motor de regras
--                                   client-side (gerarAnaliseEstrategica() em public/index.html)
--                                   sobre os disparos importados
--
-- marca em campanha_disparos/campanha_analise_estrategica e DENORMALIZADA (nao um join na policy
-- RLS) e preenchida por trigger a partir da campanha-pai - mesma razao de performance das
-- migrations 025/029/030 (evita reavaliar um join por linha na policy). O app nunca precisa
-- escrever essa coluna explicitamente.
--
-- Colunas de taxa (taxa_entrega/taxa_abertura/ctr/ctor/taxa_bounce) sao generated columns, no
-- mesmo padrao da migration 032: nunca escritas pelo importador, sempre consistentes com os
-- numeros brutos, com guarda contra divisao por zero e propagacao de NULL quando o numerador nao
-- foi informado nesta importacao.
--
-- Nullable-vs-zero (mesma filosofia da migration 032): enviados/entregues sao NOT NULL DEFAULT 0
-- (sempre presentes em qualquer relatorio de disparo). aberturas_unicas/cliques_unicos/bounces/
-- engajados/desengajados/invalidos/indeterminados sao NULLABLE - NULL = "nao veio nesse relatorio",
-- 0 = "veio, e deu zero". Usar NOT NULL DEFAULT 0 faria um disparo sem essa metrica mostrar "0"
-- (numero errado) em vez de "sem dado" (o estado real).
--
-- Salvamento e atomico via RPC (rpc_salvar_campanha_email): insere a campanha, os disparos e a
-- analise estrategica numa unica transacao implicita da function. Isso evita o problema de
-- "campanha orfa sem disparos" que existiria fazendo 3 inserts sequenciais direto do client (como
-- o fluxo legado de Cartoes Proprios/Midia Paga faz hoje em confirmImport() - aceitavel la porque
-- cada chunk e da MESMA tabela; aqui sao 3 tabelas diferentes e um insert parcial deixaria o
-- dashboard listando uma campanha sem disparos).
--
-- RLS: sem policy de UPDATE em nenhuma das 3 tabelas - o dado e imutavel apos salvo (qualquer
-- edicao acontece client-side, na tela de preview, ANTES de confirmar o salvamento). Isso
-- simplifica a RLS e reflete a decisao de produto de nao permitir edicao de campanhas ja
-- importadas.
--
-- Safe to run multiple times.

begin;

create table if not exists public.campanhas_email (
  id uuid primary key default gen_random_uuid(),
  marca public.bandeira_marca not null,
  destino_canal text not null check (destino_canal in ('E-mail', 'SMS', 'WhatsApp')),
  tipo_disparo text not null check (
    tipo_disparo in ('Campanha Pontual', 'Fluxo/Automação', 'Newsletter Recorrente', 'Transacional')
  ),
  nome_campanha text not null check (length(trim(nome_campanha)) > 0),
  data_importacao timestamptz not null default now(),
  criado_por uuid default auth.uid() references auth.users(id) on delete set null
);

comment on table public.campanhas_email is
  'Campanhas de e-mail marketing importadas pelo wizard novo (Destino = E-mail Marketing). Uma linha por campanha; os disparos individuais ficam em campanha_disparos.';
comment on column public.campanhas_email.destino_canal is
  'Canal de disparo selecionado na Etapa 1 do wizard (E-mail/SMS/WhatsApp).';
comment on column public.campanhas_email.tipo_disparo is
  'Tipo de disparo selecionado na Etapa 2 do wizard (Campanha Pontual/Fluxo-Automacao/Newsletter Recorrente/Transacional).';

create index if not exists campanhas_email_marca_data_idx
  on public.campanhas_email (marca, data_importacao desc);

create table if not exists public.campanha_disparos (
  id uuid primary key default gen_random_uuid(),
  campanha_id uuid not null references public.campanhas_email(id) on delete cascade,
  marca public.bandeira_marca not null,
  data_hora timestamptz not null default now(),
  nome_disparo text not null check (length(trim(nome_disparo)) > 0),
  assunto_email text,
  segmentacao text,
  enviados integer not null default 0 check (enviados >= 0),
  entregues integer not null default 0 check (entregues >= 0 and entregues <= enviados),
  taxa_entrega numeric(7, 4)
    generated always as (
      case
        when enviados > 0 then round((entregues::numeric / enviados) * 100, 4)
        else null
      end
    ) stored,
  aberturas_unicas integer check (aberturas_unicas is null or (aberturas_unicas >= 0 and aberturas_unicas <= entregues)),
  taxa_abertura numeric(7, 4)
    generated always as (
      case
        when aberturas_unicas is not null and entregues > 0
          then round((aberturas_unicas::numeric / entregues) * 100, 4)
        else null
      end
    ) stored,
  cliques_unicos integer check (cliques_unicos is null or cliques_unicos >= 0),
  ctr numeric(7, 4)
    generated always as (
      case
        when cliques_unicos is not null and entregues > 0
          then round((cliques_unicos::numeric / entregues) * 100, 4)
        else null
      end
    ) stored,
  ctor numeric(7, 4)
    generated always as (
      case
        when cliques_unicos is not null and aberturas_unicas is not null and aberturas_unicas > 0
          then round((cliques_unicos::numeric / aberturas_unicas) * 100, 4)
        else null
      end
    ) stored,
  bounces integer check (bounces is null or (bounces >= 0 and bounces <= enviados)),
  taxa_bounce numeric(7, 4)
    generated always as (
      case
        when bounces is not null and enviados > 0 then round((bounces::numeric / enviados) * 100, 4)
        else null
      end
    ) stored,
  engajados integer check (engajados is null or engajados >= 0),
  desengajados integer check (desengajados is null or desengajados >= 0),
  invalidos integer check (invalidos is null or invalidos >= 0),
  indeterminados integer check (indeterminados is null or indeterminados >= 0),
  criado_em timestamptz not null default now(),

  constraint campanha_disparos_campanha_nome_uk unique (campanha_id, nome_disparo)
);

comment on table public.campanha_disparos is
  'Um disparo (envio) individual de uma campanha de e-mail marketing, com metricas reais de entrega/abertura/clique/bounce/qualidade de base. taxa_entrega/taxa_abertura/ctr/ctor/taxa_bounce sao generated columns.';
comment on column public.campanha_disparos.marca is
  'Denormalizada da campanha-pai por trigger (trg_campanha_disparos_set_marca) para manter a policy RLS num check simples, sem join.';
comment on column public.campanha_disparos.aberturas_unicas is
  'NULL = nao informado neste relatorio (dado indisponivel), 0 = informado e igual a zero.';
comment on column public.campanha_disparos.engajados is
  'Contatos que interagiram positivamente com o disparo (qualidade de base), conforme informado pela origem.';
comment on column public.campanha_disparos.indeterminados is
  'Contatos cujo status de engajamento nao pode ser classificado pela origem (nem engajado, nem desengajado, nem invalido).';

create index if not exists campanha_disparos_campanha_data_idx
  on public.campanha_disparos (campanha_id, data_hora);

create index if not exists campanha_disparos_marca_idx
  on public.campanha_disparos (marca);

create table if not exists public.campanha_analise_estrategica (
  id uuid primary key default gen_random_uuid(),
  campanha_id uuid not null references public.campanhas_email(id) on delete cascade,
  marca public.bandeira_marca not null,
  prioridade text not null check (prioridade in ('Alta', 'Media', 'Baixa')),
  tema text not null,
  diagnostico text not null,
  evidencia text not null,
  acao_recomendada text not null,
  kpi_principal text not null,
  criado_em timestamptz not null default now()
);

comment on table public.campanha_analise_estrategica is
  'Quadro de analise estrategica de uma campanha (prioridade/tema/diagnostico/acao recomendada), gerado automaticamente pelo motor de regras client-side (gerarAnaliseEstrategica()) a partir dos disparos importados, com edicao leve permitida antes de salvar.';
comment on column public.campanha_analise_estrategica.marca is
  'Denormalizada da campanha-pai por trigger (trg_campanha_analise_set_marca), mesmo motivo de campanha_disparos.marca.';

create index if not exists campanha_analise_campanha_idx
  on public.campanha_analise_estrategica (campanha_id);

-- Trigger compartilhado: preenche marca a partir da campanha-pai quando nao informada, para as
-- duas tabelas filhas.
create or replace function public.trg_set_marca_from_campanha_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.marca is null then
    select ce.marca into new.marca
    from public.campanhas_email ce
    where ce.id = new.campanha_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_campanha_disparos_set_marca on public.campanha_disparos;
create trigger trg_campanha_disparos_set_marca
before insert on public.campanha_disparos
for each row
execute function public.trg_set_marca_from_campanha_email();

drop trigger if exists trg_campanha_analise_set_marca on public.campanha_analise_estrategica;
create trigger trg_campanha_analise_set_marca
before insert on public.campanha_analise_estrategica
for each row
execute function public.trg_set_marca_from_campanha_email();

drop trigger if exists trg_campanhas_email_auditoria on public.campanhas_email;
create trigger trg_campanhas_email_auditoria
after insert or delete on public.campanhas_email
for each row
execute function public.gto_registrar_auditoria();

drop trigger if exists trg_campanha_disparos_auditoria on public.campanha_disparos;
create trigger trg_campanha_disparos_auditoria
after insert or delete on public.campanha_disparos
for each row
execute function public.gto_registrar_auditoria();

drop trigger if exists trg_campanha_analise_auditoria on public.campanha_analise_estrategica;
create trigger trg_campanha_analise_auditoria
after insert or delete on public.campanha_analise_estrategica
for each row
execute function public.gto_registrar_auditoria();

alter table public.campanhas_email enable row level security;
alter table public.campanhas_email force row level security;

alter table public.campanha_disparos enable row level security;
alter table public.campanha_disparos force row level security;

alter table public.campanha_analise_estrategica enable row level security;
alter table public.campanha_analise_estrategica force row level security;

-- Policies no formato otimizado introduzido pela migration 030 (InitPlan hoisting: o shortcut de
-- admin/gestor fica numa subquery `(select ...)` avaliada uma vez por statement, nao por linha).

drop policy if exists "campanhas_email_select_por_marca" on public.campanhas_email;
create policy "campanhas_email_select_por_marca"
on public.campanhas_email
for select
to authenticated
using ((select public.gto_eh_admin_ou_gestor()) or public.gto_tem_acesso_marca(marca));

drop policy if exists "campanhas_email_insert_por_marca" on public.campanhas_email;
create policy "campanhas_email_insert_por_marca"
on public.campanhas_email
for insert
to authenticated
with check ((select public.gto_eh_admin_ou_gestor()) or public.gto_tem_acesso_marca(marca));

drop policy if exists "campanhas_email_delete_admin_gestor" on public.campanhas_email;
create policy "campanhas_email_delete_admin_gestor"
on public.campanhas_email
for delete
to authenticated
using (public.gto_eh_admin_ou_gestor());

drop policy if exists "campanha_disparos_select_por_marca" on public.campanha_disparos;
create policy "campanha_disparos_select_por_marca"
on public.campanha_disparos
for select
to authenticated
using ((select public.gto_eh_admin_ou_gestor()) or public.gto_tem_acesso_marca(marca));

drop policy if exists "campanha_disparos_insert_por_marca" on public.campanha_disparos;
create policy "campanha_disparos_insert_por_marca"
on public.campanha_disparos
for insert
to authenticated
with check ((select public.gto_eh_admin_ou_gestor()) or public.gto_tem_acesso_marca(marca));

drop policy if exists "campanha_disparos_delete_admin_gestor" on public.campanha_disparos;
create policy "campanha_disparos_delete_admin_gestor"
on public.campanha_disparos
for delete
to authenticated
using (public.gto_eh_admin_ou_gestor());

drop policy if exists "campanha_analise_select_por_marca" on public.campanha_analise_estrategica;
create policy "campanha_analise_select_por_marca"
on public.campanha_analise_estrategica
for select
to authenticated
using ((select public.gto_eh_admin_ou_gestor()) or public.gto_tem_acesso_marca(marca));

drop policy if exists "campanha_analise_insert_por_marca" on public.campanha_analise_estrategica;
create policy "campanha_analise_insert_por_marca"
on public.campanha_analise_estrategica
for insert
to authenticated
with check ((select public.gto_eh_admin_ou_gestor()) or public.gto_tem_acesso_marca(marca));

drop policy if exists "campanha_analise_delete_admin_gestor" on public.campanha_analise_estrategica;
create policy "campanha_analise_delete_admin_gestor"
on public.campanha_analise_estrategica
for delete
to authenticated
using (public.gto_eh_admin_ou_gestor());

revoke all on public.campanhas_email from anon;
revoke all on public.campanha_disparos from anon;
revoke all on public.campanha_analise_estrategica from anon;

grant select, insert, delete on public.campanhas_email to authenticated;
grant select, insert, delete on public.campanha_disparos to authenticated;
grant select, insert, delete on public.campanha_analise_estrategica to authenticated;

-- RPC: salva a campanha + disparos + analise estrategica numa unica transacao atomica.
-- SECURITY INVOKER (nao DEFINER): roda com os privilegios do usuario autenticado que chamou via
-- supabase.rpc(...), entao as policies RLS de INSERT de cada tabela se aplicam normalmente a cada
-- insert dentro da function - sem escalonamento de privilegio.
create or replace function public.rpc_salvar_campanha_email(
  p_marca public.bandeira_marca,
  p_destino_canal text,
  p_tipo_disparo text,
  p_nome_campanha text,
  p_disparos jsonb,
  p_analise jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_campanha_id uuid;
begin
  insert into public.campanhas_email (marca, destino_canal, tipo_disparo, nome_campanha)
  values (p_marca, p_destino_canal, p_tipo_disparo, p_nome_campanha)
  returning id into v_campanha_id;

  insert into public.campanha_disparos (
    campanha_id, data_hora, nome_disparo, assunto_email, segmentacao,
    enviados, entregues, aberturas_unicas, cliques_unicos, bounces,
    engajados, desengajados, invalidos, indeterminados
  )
  select
    v_campanha_id,
    coalesce(x.data_hora, now()),
    x.nome_disparo,
    x.assunto_email,
    x.segmentacao,
    coalesce(x.enviados, 0),
    coalesce(x.entregues, 0),
    x.aberturas_unicas,
    x.cliques_unicos,
    x.bounces,
    x.engajados,
    x.desengajados,
    x.invalidos,
    x.indeterminados
  from jsonb_to_recordset(p_disparos) as x(
    data_hora timestamptz,
    nome_disparo text,
    assunto_email text,
    segmentacao text,
    enviados integer,
    entregues integer,
    aberturas_unicas integer,
    cliques_unicos integer,
    bounces integer,
    engajados integer,
    desengajados integer,
    invalidos integer,
    indeterminados integer
  );

  insert into public.campanha_analise_estrategica (
    campanha_id, prioridade, tema, diagnostico, evidencia, acao_recomendada, kpi_principal
  )
  select
    v_campanha_id, x.prioridade, x.tema, x.diagnostico, x.evidencia, x.acao_recomendada, x.kpi_principal
  from jsonb_to_recordset(p_analise) as x(
    prioridade text,
    tema text,
    diagnostico text,
    evidencia text,
    acao_recomendada text,
    kpi_principal text
  );

  return v_campanha_id;
end;
$$;

comment on function public.rpc_salvar_campanha_email(public.bandeira_marca, text, text, text, jsonb, jsonb) is
  'Salva campanhas_email + campanha_disparos + campanha_analise_estrategica numa unica transacao atomica (evita campanha orfa sem disparos se algum insert falhar no meio). SECURITY INVOKER - roda como o usuario chamador, RLS normal se aplica a cada insert.';

revoke all on function public.rpc_salvar_campanha_email(public.bandeira_marca, text, text, text, jsonb, jsonb) from public;
grant execute on function public.rpc_salvar_campanha_email(public.bandeira_marca, text, text, text, jsonb, jsonb) to authenticated;

-- View de apoio ao dashboard: uma linha por disparo, com os metadados da campanha-pai
-- denormalizados, para filtrar por marca+periodo (periodo vive em data_hora, no filho) numa
-- query so, sem passo intermediario de "buscar ids de campanha, depois buscar disparos".
create or replace view public.vw_campanha_disparos_resumo
with (security_invoker = true)
as
select
  cd.id,
  cd.campanha_id,
  cd.marca,
  ce.nome_campanha,
  ce.destino_canal,
  ce.tipo_disparo,
  ce.data_importacao,
  cd.data_hora,
  cd.nome_disparo,
  cd.assunto_email,
  cd.segmentacao,
  cd.enviados,
  cd.entregues,
  cd.taxa_entrega,
  cd.aberturas_unicas,
  cd.taxa_abertura,
  cd.cliques_unicos,
  cd.ctr,
  cd.ctor,
  cd.bounces,
  cd.taxa_bounce,
  cd.engajados,
  cd.desengajados,
  cd.invalidos,
  cd.indeterminados,
  cd.criado_em
from public.campanha_disparos cd
join public.campanhas_email ce on ce.id = cd.campanha_id;

comment on view public.vw_campanha_disparos_resumo is
  'Uma linha por disparo de e-mail marketing, com marca/nome/destino/canal/tipo/data de importacao da campanha-pai denormalizados - usada pelo dashboard de E-mail Marketing para os KPIs globais e filtros de marca/periodo.';

grant select on public.vw_campanha_disparos_resumo to authenticated;
revoke all on public.vw_campanha_disparos_resumo from anon;

-- PostgREST cacheia o schema e nao percebe sozinho a RPC nova (rpc_salvar_campanha_email) nem as
-- tabelas/view criadas aqui - sem isso, supabase.rpc("rpc_salvar_campanha_email", ...) do frontend
-- falha com "function not found" ate o cache expirar sozinho. Mesmo padrao ja usado nas migrations
-- 20260714_010 e 20260803_014 sempre que se cria algo novo que o frontend consome via
-- supabase.rpc()/.from().
notify pgrst, 'reload schema';

commit;
