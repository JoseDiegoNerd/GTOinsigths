-- GTO Insights - Meta Ads (Marketing API) integration
-- Scope: mirrors the organic Meta integration pattern (integracao_meta_contas /
-- stage_social_format_metrics): OAuth discovers ad accounts, a review table lets an Admin/Gestor
-- confirm which ad account belongs to which marca before any spend data is synced, and a stage
-- table holds campaign-level metrics (spend, reach, clicks, CPC/CPM/CTR).
-- Safe to run multiple times.

begin;

create table if not exists public.integracao_meta_ads_contas (
  id uuid primary key default gen_random_uuid(),
  marca public.bandeira_marca not null,
  ad_account_id text not null,
  ad_account_name text,
  moeda text,
  fuso_horario text,
  access_token text not null,
  token_type text,
  token_expires_at timestamptz,
  scopes text[] not null default '{}',
  ativo boolean not null default true,
  conta_confirmada boolean not null default false,
  ignorada boolean not null default false,
  observacao text,
  ultima_sincronizacao_em timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),

  constraint integracao_meta_ads_marca_conta_uk unique (marca, ad_account_id)
);

comment on table public.integracao_meta_ads_contas is
  'Contas de anuncios (Marketing API) recebidas via OAuth, com revisao manual por marca antes de sincronizar.';

create index if not exists integracao_meta_ads_marca_idx
  on public.integracao_meta_ads_contas (marca);

drop trigger if exists trg_integracao_meta_ads_set_atualizado_em
  on public.integracao_meta_ads_contas;
create trigger trg_integracao_meta_ads_set_atualizado_em
before update on public.integracao_meta_ads_contas
for each row
execute function public.gto_set_atualizado_em();

alter table public.integracao_meta_ads_contas enable row level security;
alter table public.integracao_meta_ads_contas force row level security;

drop policy if exists "integracao_meta_ads_select_admin_gestor" on public.integracao_meta_ads_contas;
create policy "integracao_meta_ads_select_admin_gestor"
on public.integracao_meta_ads_contas
for select
to authenticated
using (public.gto_eh_admin_ou_gestor() and public.gto_tem_acesso_marca(marca));

drop policy if exists "integracao_meta_ads_all_admin_gestor" on public.integracao_meta_ads_contas;
create policy "integracao_meta_ads_all_admin_gestor"
on public.integracao_meta_ads_contas
for all
to authenticated
using (public.gto_eh_admin_ou_gestor() and public.gto_tem_acesso_marca(marca))
with check (public.gto_eh_admin_ou_gestor() and public.gto_tem_acesso_marca(marca));

revoke all on public.integracao_meta_ads_contas from anon;
grant select, insert, update, delete on public.integracao_meta_ads_contas to authenticated;

create table if not exists public.stage_meta_ads_metrics (
  id uuid primary key default gen_random_uuid(),
  marca public.bandeira_marca not null,
  ad_account_id text not null,
  campaign_id text not null,
  campaign_name text,
  objetivo text,
  status text,
  data_referencia date not null default current_date,
  periodo_inicio date,
  periodo_fim date,
  investimento numeric(12,2) not null default 0 check (investimento >= 0),
  impressoes integer not null default 0 check (impressoes >= 0),
  alcance integer not null default 0 check (alcance >= 0),
  cliques integer not null default 0 check (cliques >= 0),
  cliques_link integer not null default 0 check (cliques_link >= 0),
  cpm numeric(12,4) not null default 0 check (cpm >= 0),
  cpc numeric(12,4) not null default 0 check (cpc >= 0),
  ctr numeric(7,4) not null default 0 check (ctr >= 0),
  frequencia numeric(7,4) not null default 0 check (frequencia >= 0),
  payload_bruto jsonb not null default '{}'::jsonb,
  origem_arquivo text default 'meta_marketing_api',
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),

  constraint stage_meta_ads_marca_conta_campanha_uk unique (marca, ad_account_id, campaign_id)
);

comment on table public.stage_meta_ads_metrics is
  'Metricas de campanhas do Meta Ads (Marketing API), atualizadas em janela rolante (ultimos 30 dias) a cada sincronizacao.';

create index if not exists stage_meta_ads_marca_data_idx
  on public.stage_meta_ads_metrics (marca, data_referencia desc);

drop trigger if exists trg_stage_meta_ads_set_atualizado_em
  on public.stage_meta_ads_metrics;
create trigger trg_stage_meta_ads_set_atualizado_em
before update on public.stage_meta_ads_metrics
for each row
execute function public.gto_set_atualizado_em();

alter table public.stage_meta_ads_metrics enable row level security;
alter table public.stage_meta_ads_metrics force row level security;

drop policy if exists "stage_meta_ads_select_por_marca" on public.stage_meta_ads_metrics;
create policy "stage_meta_ads_select_por_marca"
on public.stage_meta_ads_metrics
for select
to authenticated
using (public.gto_tem_acesso_marca(marca));

drop policy if exists "stage_meta_ads_insert_por_marca" on public.stage_meta_ads_metrics;
create policy "stage_meta_ads_insert_por_marca"
on public.stage_meta_ads_metrics
for insert
to authenticated
with check (public.gto_tem_acesso_marca(marca));

drop policy if exists "stage_meta_ads_update_por_marca" on public.stage_meta_ads_metrics;
create policy "stage_meta_ads_update_por_marca"
on public.stage_meta_ads_metrics
for update
to authenticated
using (public.gto_tem_acesso_marca(marca))
with check (public.gto_tem_acesso_marca(marca));

drop policy if exists "stage_meta_ads_delete_admin_gestor" on public.stage_meta_ads_metrics;
create policy "stage_meta_ads_delete_admin_gestor"
on public.stage_meta_ads_metrics
for delete
to authenticated
using (public.gto_eh_admin_ou_gestor());

revoke all on public.stage_meta_ads_metrics from anon;
grant select, insert, update, delete on public.stage_meta_ads_metrics to authenticated;

commit;
