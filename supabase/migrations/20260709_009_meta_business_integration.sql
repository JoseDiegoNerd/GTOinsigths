-- GTO Insights - Meta Business integration
-- Scope: secure Meta OAuth accounts, integration logs and direct social metrics ingestion.
-- Safe to run multiple times. It does not drop tables or delete imported data.

begin;

create table if not exists public.integracao_meta_contas (
  id uuid primary key default gen_random_uuid(),
  marca public.bandeira_marca not null,
  meta_business_id text,
  page_id text not null,
  page_name text,
  instagram_business_account_id text,
  instagram_username text,
  access_token text not null,
  token_type text,
  token_expires_at timestamptz,
  scopes text[] not null default array[]::text[],
  ativo boolean not null default true,
  ultima_sincronizacao_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint integracao_meta_contas_page_marca_uniq unique (marca, page_id)
);

comment on table public.integracao_meta_contas is
  'Contas Meta Business conectadas ao GTO Insights. Contem access_token e deve ser gerenciada apenas por Admin/Gestor ou service_role.';

create index if not exists integracao_meta_contas_marca_idx
  on public.integracao_meta_contas (marca);

create index if not exists integracao_meta_contas_ativo_idx
  on public.integracao_meta_contas (ativo)
  where ativo = true;

create table if not exists public.stage_social_format_metrics (
  id uuid primary key default gen_random_uuid(),
  marca public.bandeira_marca not null,
  rede_social text not null,
  criado_em timestamptz not null default now()
);

alter table public.stage_social_format_metrics
  add column if not exists conta_id text,
  add column if not exists conta_nome text,
  add column if not exists post_id text,
  add column if not exists post_url text,
  add column if not exists formato text,
  add column if not exists tipo_conteudo text,
  add column if not exists data_publicacao timestamptz,
  add column if not exists periodo_inicio date,
  add column if not exists periodo_fim date,
  add column if not exists alcance integer not null default 0,
  add column if not exists impressoes integer not null default 0,
  add column if not exists engajamento integer not null default 0,
  add column if not exists curtidas integer not null default 0,
  add column if not exists comentarios integer not null default 0,
  add column if not exists compartilhamentos integer not null default 0,
  add column if not exists salvos integer not null default 0,
  add column if not exists salvamentos integer not null default 0,
  add column if not exists visualizacoes integer not null default 0,
  add column if not exists cliques integer not null default 0,
  add column if not exists total_visualizacoes integer not null default 0,
  add column if not exists payload_bruto jsonb not null default '{}'::jsonb,
  add column if not exists origem_arquivo text,
  add column if not exists atualizado_em timestamptz not null default now();

create index if not exists stage_social_meta_marca_rede_data_idx
  on public.stage_social_format_metrics (marca, rede_social, data_publicacao desc);

create index if not exists stage_social_meta_post_idx
  on public.stage_social_format_metrics (post_id)
  where post_id is not null;

create table if not exists public.logs_integracao_meta (
  id uuid primary key default gen_random_uuid(),
  integracao_id uuid references public.integracao_meta_contas(id) on delete set null,
  marca public.bandeira_marca,
  tipo_evento text not null,
  status text not null check (status in ('sucesso', 'erro', 'aviso', 'iniciado')),
  mensagem text,
  payload_resumo jsonb not null default '{}'::jsonb,
  criado_em timestamptz not null default now()
);

comment on table public.logs_integracao_meta is
  'Logs operacionais das Edge Functions de OAuth e sincronizacao Meta.';

create index if not exists logs_integracao_meta_integracao_idx
  on public.logs_integracao_meta (integracao_id, criado_em desc);

create index if not exists logs_integracao_meta_marca_idx
  on public.logs_integracao_meta (marca, criado_em desc);

drop trigger if exists trg_integracao_meta_contas_set_atualizado_em
  on public.integracao_meta_contas;
create trigger trg_integracao_meta_contas_set_atualizado_em
before update on public.integracao_meta_contas
for each row
execute function public.gto_set_atualizado_em();

drop trigger if exists trg_stage_social_format_meta_set_atualizado_em
  on public.stage_social_format_metrics;
create trigger trg_stage_social_format_meta_set_atualizado_em
before update on public.stage_social_format_metrics
for each row
execute function public.gto_set_atualizado_em();

drop trigger if exists trg_integracao_meta_contas_auditoria
  on public.integracao_meta_contas;
create trigger trg_integracao_meta_contas_auditoria
after insert or update or delete on public.integracao_meta_contas
for each row
execute function public.gto_registrar_auditoria();

drop trigger if exists trg_stage_social_format_meta_auditoria
  on public.stage_social_format_metrics;
create trigger trg_stage_social_format_meta_auditoria
after insert or update or delete on public.stage_social_format_metrics
for each row
execute function public.gto_registrar_auditoria();

drop trigger if exists trg_logs_integracao_meta_auditoria
  on public.logs_integracao_meta;
create trigger trg_logs_integracao_meta_auditoria
after insert or update or delete on public.logs_integracao_meta
for each row
execute function public.gto_registrar_auditoria();

alter table public.integracao_meta_contas enable row level security;
alter table public.integracao_meta_contas force row level security;
alter table public.stage_social_format_metrics enable row level security;
alter table public.stage_social_format_metrics force row level security;
alter table public.logs_integracao_meta enable row level security;
alter table public.logs_integracao_meta force row level security;

drop policy if exists "integracao_meta_select_admin_gestor" on public.integracao_meta_contas;
create policy "integracao_meta_select_admin_gestor"
on public.integracao_meta_contas
for select
to authenticated
using (public.gto_eh_admin_ou_gestor());

drop policy if exists "integracao_meta_insert_admin_gestor" on public.integracao_meta_contas;
create policy "integracao_meta_insert_admin_gestor"
on public.integracao_meta_contas
for insert
to authenticated
with check (public.gto_eh_admin_ou_gestor() and public.gto_tem_acesso_marca(marca));

drop policy if exists "integracao_meta_update_admin_gestor" on public.integracao_meta_contas;
create policy "integracao_meta_update_admin_gestor"
on public.integracao_meta_contas
for update
to authenticated
using (public.gto_eh_admin_ou_gestor() and public.gto_tem_acesso_marca(marca))
with check (public.gto_eh_admin_ou_gestor() and public.gto_tem_acesso_marca(marca));

drop policy if exists "integracao_meta_delete_admin_gestor" on public.integracao_meta_contas;
create policy "integracao_meta_delete_admin_gestor"
on public.integracao_meta_contas
for delete
to authenticated
using (public.gto_eh_admin_ou_gestor() and public.gto_tem_acesso_marca(marca));

drop policy if exists "stage_social_format_select_por_marca" on public.stage_social_format_metrics;
create policy "stage_social_format_select_por_marca"
on public.stage_social_format_metrics
for select
to authenticated
using (public.gto_tem_acesso_marca(marca));

drop policy if exists "stage_social_format_insert_admin_gestor" on public.stage_social_format_metrics;
create policy "stage_social_format_insert_admin_gestor"
on public.stage_social_format_metrics
for insert
to authenticated
with check (public.gto_eh_admin_ou_gestor() and public.gto_tem_acesso_marca(marca));

drop policy if exists "stage_social_format_update_admin_gestor" on public.stage_social_format_metrics;
create policy "stage_social_format_update_admin_gestor"
on public.stage_social_format_metrics
for update
to authenticated
using (public.gto_eh_admin_ou_gestor() and public.gto_tem_acesso_marca(marca))
with check (public.gto_eh_admin_ou_gestor() and public.gto_tem_acesso_marca(marca));

drop policy if exists "stage_social_format_delete_admin_gestor" on public.stage_social_format_metrics;
create policy "stage_social_format_delete_admin_gestor"
on public.stage_social_format_metrics
for delete
to authenticated
using (public.gto_eh_admin_ou_gestor() and public.gto_tem_acesso_marca(marca));

drop policy if exists "logs_meta_select_por_marca" on public.logs_integracao_meta;
create policy "logs_meta_select_por_marca"
on public.logs_integracao_meta
for select
to authenticated
using (
  public.gto_eh_admin_ou_gestor()
  or (marca is not null and public.gto_tem_acesso_marca(marca))
);

drop policy if exists "logs_meta_insert_admin_gestor" on public.logs_integracao_meta;
create policy "logs_meta_insert_admin_gestor"
on public.logs_integracao_meta
for insert
to authenticated
with check (
  public.gto_eh_admin_ou_gestor()
  and (marca is null or public.gto_tem_acesso_marca(marca))
);

create or replace view public.vw_integracao_meta_contas_publica
with (security_invoker = true)
as
select
  id,
  marca,
  meta_business_id,
  page_id,
  page_name,
  instagram_business_account_id,
  instagram_username,
  token_type,
  token_expires_at,
  scopes,
  ativo,
  ultima_sincronizacao_em,
  criado_em,
  atualizado_em
from public.integracao_meta_contas;

grant select, insert, update, delete on public.integracao_meta_contas to authenticated;
grant select, insert, update, delete on public.stage_social_format_metrics to authenticated;
grant select, insert on public.logs_integracao_meta to authenticated;
grant select on public.vw_integracao_meta_contas_publica to authenticated;

revoke all on public.integracao_meta_contas from anon;
revoke all on public.stage_social_format_metrics from anon;
revoke all on public.logs_integracao_meta from anon;
revoke all on public.vw_integracao_meta_contas_publica from anon;

commit;
