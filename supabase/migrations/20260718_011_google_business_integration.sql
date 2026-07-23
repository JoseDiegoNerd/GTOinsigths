-- GTO Insights - Google Business Profile integration
-- Scope: secure Google OAuth accounts, integration logs and GBP data ingestion (locations, reviews, metrics, photos).
-- Safe to run multiple times. It does not drop tables or delete imported data.

begin;

create table if not exists public.integracao_google_contas (
  id uuid primary key default gen_random_uuid(),
  marca public.bandeira_marca not null,
  google_account_id text not null,
  email_conta text,
  access_token text not null,
  refresh_token text,
  token_type text,
  token_expires_at timestamptz,
  scopes text[] not null default array[]::text[],
  ativo boolean not null default true,
  conta_confirmada boolean not null default false,
  ignorada boolean not null default false,
  observacao text,
  ultima_sincronizacao_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint integracao_google_contas_marca_conta_uniq unique (marca, google_account_id)
);

comment on table public.integracao_google_contas is
  'Contas Google Business Profile conectadas ao GTO Insights. Contem access_token/refresh_token e deve ser gerenciada apenas por Admin/Gestor ou service_role.';

create index if not exists integracao_google_contas_marca_idx
  on public.integracao_google_contas (marca);

create index if not exists integracao_google_contas_ativo_idx
  on public.integracao_google_contas (ativo)
  where ativo = true;

create table if not exists public.integracao_google_locais (
  id uuid primary key default gen_random_uuid(),
  integracao_id uuid references public.integracao_google_contas(id) on delete set null,
  marca public.bandeira_marca not null,
  location_id text not null,
  nome_loja text,
  endereco_completo text,
  latitude numeric(10, 7),
  longitude numeric(10, 7),
  telefone text,
  descricao text,
  website text,
  redes_sociais jsonb not null default '{}'::jsonb,
  horario_funcionamento jsonb not null default '{}'::jsonb,
  horario_especial jsonb not null default '{}'::jsonb,
  status text,
  ativo boolean not null default true,
  payload_bruto jsonb not null default '{}'::jsonb,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint integracao_google_locais_marca_location_uniq unique (marca, location_id)
);

comment on table public.integracao_google_locais is
  'Dados cadastrais das lojas fisicas sincronizados do Google Business Profile.';

create index if not exists integracao_google_locais_marca_idx
  on public.integracao_google_locais (marca);

create index if not exists integracao_google_locais_integracao_idx
  on public.integracao_google_locais (integracao_id);

create table if not exists public.integracao_google_avaliacoes (
  id uuid primary key default gen_random_uuid(),
  integracao_id uuid references public.integracao_google_contas(id) on delete set null,
  local_id uuid references public.integracao_google_locais(id) on delete cascade,
  marca public.bandeira_marca not null,
  review_id text not null,
  autor_nome text,
  autor_foto_url text,
  rating smallint check (rating between 1 and 5),
  comentario text,
  avaliado_em timestamptz,
  status_resposta text not null default 'pendente' check (status_resposta in ('pendente', 'respondida')),
  resposta_texto text,
  resposta_em timestamptz,
  respondido_por uuid references auth.users(id) on delete set null,
  payload_bruto jsonb not null default '{}'::jsonb,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint integracao_google_avaliacoes_marca_review_uniq unique (marca, review_id)
);

comment on table public.integracao_google_avaliacoes is
  'Feed de avaliacoes (reviews) do Google Business Profile por loja.';

create index if not exists integracao_google_avaliacoes_marca_status_idx
  on public.integracao_google_avaliacoes (marca, status_resposta);

create index if not exists integracao_google_avaliacoes_local_idx
  on public.integracao_google_avaliacoes (local_id);

create table if not exists public.integracao_google_metricas_diarias (
  id uuid primary key default gen_random_uuid(),
  local_id uuid references public.integracao_google_locais(id) on delete cascade,
  marca public.bandeira_marca not null,
  data_referencia date not null,
  cliques_website integer not null default 0,
  chamadas_telefone integer not null default 0,
  solicitacoes_rota integer not null default 0,
  impressoes_busca integer not null default 0,
  impressoes_descoberta integer not null default 0,
  payload_bruto jsonb not null default '{}'::jsonb,
  criado_em timestamptz not null default now(),
  constraint integracao_google_metricas_local_data_uniq unique (local_id, data_referencia)
);

comment on table public.integracao_google_metricas_diarias is
  'Metricas diarias de desempenho (Business Profile Performance API) por loja.';

create index if not exists integracao_google_metricas_marca_data_idx
  on public.integracao_google_metricas_diarias (marca, data_referencia desc);

create table if not exists public.integracao_google_fotos (
  id uuid primary key default gen_random_uuid(),
  local_id uuid references public.integracao_google_locais(id) on delete cascade,
  marca public.bandeira_marca not null,
  media_id text not null,
  url text,
  origem text check (origem in ('proprietario', 'cliente')),
  categoria text,
  criado_em_google timestamptz,
  payload_bruto jsonb not null default '{}'::jsonb,
  criado_em timestamptz not null default now(),
  constraint integracao_google_fotos_local_media_uniq unique (local_id, media_id)
);

comment on table public.integracao_google_fotos is
  'Auditoria visual: metadados de fotos publicadas na ficha do Google Business Profile.';

create index if not exists integracao_google_fotos_marca_idx
  on public.integracao_google_fotos (marca);

create table if not exists public.logs_integracao_google (
  id uuid primary key default gen_random_uuid(),
  integracao_id uuid references public.integracao_google_contas(id) on delete set null,
  marca public.bandeira_marca,
  tipo_evento text not null,
  status text not null check (status in ('sucesso', 'erro', 'aviso', 'iniciado')),
  mensagem text,
  payload_resumo jsonb not null default '{}'::jsonb,
  criado_em timestamptz not null default now()
);

comment on table public.logs_integracao_google is
  'Logs operacionais das Edge Functions de OAuth e sincronizacao Google Business Profile.';

create index if not exists logs_integracao_google_integracao_idx
  on public.logs_integracao_google (integracao_id, criado_em desc);

create index if not exists logs_integracao_google_marca_idx
  on public.logs_integracao_google (marca, criado_em desc);

-- Funcao RLS parametrizada: permite compor listas de cargos alem do par Admin/Gestor
-- ja coberto por gto_eh_admin_ou_gestor(). Usada onde Coordenador/Analista tambem
-- precisam de acesso de escrita (ex.: responder avaliacoes do Google).
create or replace function public.gto_cargo_permitido(cargos_permitidos text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.cargo::text = any(cargos_permitidos)
     from public.perfis p
     where p.id = auth.uid()
       and p.ativo = true
     limit 1),
    false
  );
$$;

comment on function public.gto_cargo_permitido(text[]) is
  'Funcao RLS parametrizada: retorna true se o cargo do usuario autenticado esta na lista informada.';

drop trigger if exists trg_integracao_google_contas_set_atualizado_em
  on public.integracao_google_contas;
create trigger trg_integracao_google_contas_set_atualizado_em
before update on public.integracao_google_contas
for each row
execute function public.gto_set_atualizado_em();

drop trigger if exists trg_integracao_google_locais_set_atualizado_em
  on public.integracao_google_locais;
create trigger trg_integracao_google_locais_set_atualizado_em
before update on public.integracao_google_locais
for each row
execute function public.gto_set_atualizado_em();

drop trigger if exists trg_integracao_google_avaliacoes_set_atualizado_em
  on public.integracao_google_avaliacoes;
create trigger trg_integracao_google_avaliacoes_set_atualizado_em
before update on public.integracao_google_avaliacoes
for each row
execute function public.gto_set_atualizado_em();

drop trigger if exists trg_integracao_google_contas_auditoria
  on public.integracao_google_contas;
create trigger trg_integracao_google_contas_auditoria
after insert or update or delete on public.integracao_google_contas
for each row
execute function public.gto_registrar_auditoria();

drop trigger if exists trg_integracao_google_locais_auditoria
  on public.integracao_google_locais;
create trigger trg_integracao_google_locais_auditoria
after insert or update or delete on public.integracao_google_locais
for each row
execute function public.gto_registrar_auditoria();

drop trigger if exists trg_integracao_google_avaliacoes_auditoria
  on public.integracao_google_avaliacoes;
create trigger trg_integracao_google_avaliacoes_auditoria
after insert or update or delete on public.integracao_google_avaliacoes
for each row
execute function public.gto_registrar_auditoria();

drop trigger if exists trg_integracao_google_metricas_auditoria
  on public.integracao_google_metricas_diarias;
create trigger trg_integracao_google_metricas_auditoria
after insert or update or delete on public.integracao_google_metricas_diarias
for each row
execute function public.gto_registrar_auditoria();

drop trigger if exists trg_integracao_google_fotos_auditoria
  on public.integracao_google_fotos;
create trigger trg_integracao_google_fotos_auditoria
after insert or update or delete on public.integracao_google_fotos
for each row
execute function public.gto_registrar_auditoria();

drop trigger if exists trg_logs_integracao_google_auditoria
  on public.logs_integracao_google;
create trigger trg_logs_integracao_google_auditoria
after insert or update or delete on public.logs_integracao_google
for each row
execute function public.gto_registrar_auditoria();

alter table public.integracao_google_contas enable row level security;
alter table public.integracao_google_contas force row level security;
alter table public.integracao_google_locais enable row level security;
alter table public.integracao_google_locais force row level security;
alter table public.integracao_google_avaliacoes enable row level security;
alter table public.integracao_google_avaliacoes force row level security;
alter table public.integracao_google_metricas_diarias enable row level security;
alter table public.integracao_google_metricas_diarias force row level security;
alter table public.integracao_google_fotos enable row level security;
alter table public.integracao_google_fotos force row level security;
alter table public.logs_integracao_google enable row level security;
alter table public.logs_integracao_google force row level security;

-- integracao_google_contas: mesmo padrao de integracao_meta_contas (Admin/Gestor apenas).
drop policy if exists "integracao_google_select_admin_gestor" on public.integracao_google_contas;
create policy "integracao_google_select_admin_gestor"
on public.integracao_google_contas
for select
to authenticated
using (public.gto_eh_admin_ou_gestor());

drop policy if exists "integracao_google_insert_admin_gestor" on public.integracao_google_contas;
create policy "integracao_google_insert_admin_gestor"
on public.integracao_google_contas
for insert
to authenticated
with check (public.gto_eh_admin_ou_gestor() and public.gto_tem_acesso_marca(marca));

drop policy if exists "integracao_google_update_admin_gestor" on public.integracao_google_contas;
create policy "integracao_google_update_admin_gestor"
on public.integracao_google_contas
for update
to authenticated
using (public.gto_eh_admin_ou_gestor() and public.gto_tem_acesso_marca(marca))
with check (public.gto_eh_admin_ou_gestor() and public.gto_tem_acesso_marca(marca));

drop policy if exists "integracao_google_delete_admin_gestor" on public.integracao_google_contas;
create policy "integracao_google_delete_admin_gestor"
on public.integracao_google_contas
for delete
to authenticated
using (public.gto_eh_admin_ou_gestor() and public.gto_tem_acesso_marca(marca));

-- integracao_google_locais: leitura por marca, escrita Admin/Gestor (Edge Functions usam service_role).
drop policy if exists "integracao_google_locais_select_por_marca" on public.integracao_google_locais;
create policy "integracao_google_locais_select_por_marca"
on public.integracao_google_locais
for select
to authenticated
using (public.gto_tem_acesso_marca(marca));

drop policy if exists "integracao_google_locais_insert_admin_gestor" on public.integracao_google_locais;
create policy "integracao_google_locais_insert_admin_gestor"
on public.integracao_google_locais
for insert
to authenticated
with check (public.gto_eh_admin_ou_gestor() and public.gto_tem_acesso_marca(marca));

drop policy if exists "integracao_google_locais_update_admin_gestor" on public.integracao_google_locais;
create policy "integracao_google_locais_update_admin_gestor"
on public.integracao_google_locais
for update
to authenticated
using (public.gto_eh_admin_ou_gestor() and public.gto_tem_acesso_marca(marca))
with check (public.gto_eh_admin_ou_gestor() and public.gto_tem_acesso_marca(marca));

drop policy if exists "integracao_google_locais_delete_admin_gestor" on public.integracao_google_locais;
create policy "integracao_google_locais_delete_admin_gestor"
on public.integracao_google_locais
for delete
to authenticated
using (public.gto_eh_admin_ou_gestor() and public.gto_tem_acesso_marca(marca));

-- integracao_google_avaliacoes: leitura por marca; update tambem liberado para
-- Coordenador/Analista (respostas a avaliacoes), sempre restrito a marca.
drop policy if exists "integracao_google_avaliacoes_select_por_marca" on public.integracao_google_avaliacoes;
create policy "integracao_google_avaliacoes_select_por_marca"
on public.integracao_google_avaliacoes
for select
to authenticated
using (public.gto_tem_acesso_marca(marca));

drop policy if exists "integracao_google_avaliacoes_insert_admin_gestor" on public.integracao_google_avaliacoes;
create policy "integracao_google_avaliacoes_insert_admin_gestor"
on public.integracao_google_avaliacoes
for insert
to authenticated
with check (public.gto_eh_admin_ou_gestor() and public.gto_tem_acesso_marca(marca));

drop policy if exists "integracao_google_avaliacoes_update_cargos" on public.integracao_google_avaliacoes;
create policy "integracao_google_avaliacoes_update_cargos"
on public.integracao_google_avaliacoes
for update
to authenticated
using (
  public.gto_cargo_permitido(array['Admin', 'Gestor', 'Coordenador', 'Analista'])
  and public.gto_tem_acesso_marca(marca)
)
with check (
  public.gto_cargo_permitido(array['Admin', 'Gestor', 'Coordenador', 'Analista'])
  and public.gto_tem_acesso_marca(marca)
);

drop policy if exists "integracao_google_avaliacoes_delete_admin_gestor" on public.integracao_google_avaliacoes;
create policy "integracao_google_avaliacoes_delete_admin_gestor"
on public.integracao_google_avaliacoes
for delete
to authenticated
using (public.gto_eh_admin_ou_gestor() and public.gto_tem_acesso_marca(marca));

-- integracao_google_metricas_diarias: leitura por marca, escrita Admin/Gestor.
drop policy if exists "integracao_google_metricas_select_por_marca" on public.integracao_google_metricas_diarias;
create policy "integracao_google_metricas_select_por_marca"
on public.integracao_google_metricas_diarias
for select
to authenticated
using (public.gto_tem_acesso_marca(marca));

drop policy if exists "integracao_google_metricas_insert_admin_gestor" on public.integracao_google_metricas_diarias;
create policy "integracao_google_metricas_insert_admin_gestor"
on public.integracao_google_metricas_diarias
for insert
to authenticated
with check (public.gto_eh_admin_ou_gestor() and public.gto_tem_acesso_marca(marca));

drop policy if exists "integracao_google_metricas_update_admin_gestor" on public.integracao_google_metricas_diarias;
create policy "integracao_google_metricas_update_admin_gestor"
on public.integracao_google_metricas_diarias
for update
to authenticated
using (public.gto_eh_admin_ou_gestor() and public.gto_tem_acesso_marca(marca))
with check (public.gto_eh_admin_ou_gestor() and public.gto_tem_acesso_marca(marca));

drop policy if exists "integracao_google_metricas_delete_admin_gestor" on public.integracao_google_metricas_diarias;
create policy "integracao_google_metricas_delete_admin_gestor"
on public.integracao_google_metricas_diarias
for delete
to authenticated
using (public.gto_eh_admin_ou_gestor() and public.gto_tem_acesso_marca(marca));

-- integracao_google_fotos: leitura por marca, escrita Admin/Gestor.
drop policy if exists "integracao_google_fotos_select_por_marca" on public.integracao_google_fotos;
create policy "integracao_google_fotos_select_por_marca"
on public.integracao_google_fotos
for select
to authenticated
using (public.gto_tem_acesso_marca(marca));

drop policy if exists "integracao_google_fotos_insert_admin_gestor" on public.integracao_google_fotos;
create policy "integracao_google_fotos_insert_admin_gestor"
on public.integracao_google_fotos
for insert
to authenticated
with check (public.gto_eh_admin_ou_gestor() and public.gto_tem_acesso_marca(marca));

drop policy if exists "integracao_google_fotos_update_admin_gestor" on public.integracao_google_fotos;
create policy "integracao_google_fotos_update_admin_gestor"
on public.integracao_google_fotos
for update
to authenticated
using (public.gto_eh_admin_ou_gestor() and public.gto_tem_acesso_marca(marca))
with check (public.gto_eh_admin_ou_gestor() and public.gto_tem_acesso_marca(marca));

drop policy if exists "integracao_google_fotos_delete_admin_gestor" on public.integracao_google_fotos;
create policy "integracao_google_fotos_delete_admin_gestor"
on public.integracao_google_fotos
for delete
to authenticated
using (public.gto_eh_admin_ou_gestor() and public.gto_tem_acesso_marca(marca));

-- logs_integracao_google: mesmo padrao de logs_integracao_meta.
drop policy if exists "logs_google_select_por_marca" on public.logs_integracao_google;
create policy "logs_google_select_por_marca"
on public.logs_integracao_google
for select
to authenticated
using (
  public.gto_eh_admin_ou_gestor()
  or (marca is not null and public.gto_tem_acesso_marca(marca))
);

drop policy if exists "logs_google_insert_admin_gestor" on public.logs_integracao_google;
create policy "logs_google_insert_admin_gestor"
on public.logs_integracao_google
for insert
to authenticated
with check (
  public.gto_eh_admin_ou_gestor()
  and (marca is null or public.gto_tem_acesso_marca(marca))
);

create or replace view public.vw_integracao_google_contas_publica
with (security_invoker = true)
as
select
  id,
  marca,
  google_account_id,
  email_conta,
  token_type,
  token_expires_at,
  scopes,
  ativo,
  conta_confirmada,
  ignorada,
  observacao,
  ultima_sincronizacao_em,
  criado_em,
  atualizado_em
from public.integracao_google_contas;

grant select, insert, update, delete on public.integracao_google_contas to authenticated;
grant select, insert, update, delete on public.integracao_google_locais to authenticated;
grant select, insert, update, delete on public.integracao_google_avaliacoes to authenticated;
grant select, insert, update, delete on public.integracao_google_metricas_diarias to authenticated;
grant select, insert, update, delete on public.integracao_google_fotos to authenticated;
grant select, insert on public.logs_integracao_google to authenticated;
grant select on public.vw_integracao_google_contas_publica to authenticated;

revoke all on public.integracao_google_contas from anon;
revoke all on public.integracao_google_locais from anon;
revoke all on public.integracao_google_avaliacoes from anon;
revoke all on public.integracao_google_metricas_diarias from anon;
revoke all on public.integracao_google_fotos from anon;
revoke all on public.logs_integracao_google from anon;
revoke all on public.vw_integracao_google_contas_publica from anon;

commit;
