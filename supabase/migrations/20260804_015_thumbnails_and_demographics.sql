-- GTO Insights - Post thumbnails and audience demographics
-- Scope: adds an image URL per post/reel (for visual ranking tables, inspired by mLabs' post
-- thumbnails) and a new table for Instagram follower demographics (age, gender, country, city).
-- Safe to run multiple times.

begin;

alter table public.stage_social_format_metrics
  add column if not exists imagem_url text;

create table if not exists public.stage_meta_audience_demographics (
  id uuid primary key default gen_random_uuid(),
  marca public.bandeira_marca not null,
  rede_social text not null default 'Instagram',
  conta_id text not null,
  dimensao text not null check (dimensao in ('genero', 'idade', 'pais', 'cidade')),
  categoria text not null,
  valor integer not null default 0 check (valor >= 0),
  percentual numeric(6,2) not null default 0 check (percentual >= 0 and percentual <= 100),
  data_referencia date not null default current_date,
  payload_bruto jsonb not null default '{}'::jsonb,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),

  constraint stage_meta_audience_marca_dimensao_categoria_uk
    unique (marca, conta_id, dimensao, categoria, data_referencia)
);

comment on table public.stage_meta_audience_demographics is
  'Demografia de seguidores do Instagram (genero, idade, pais, cidade), atualizada a cada sincronizacao.';

create index if not exists stage_meta_audience_marca_idx
  on public.stage_meta_audience_demographics (marca, dimensao, data_referencia desc);

drop trigger if exists trg_stage_meta_audience_set_atualizado_em
  on public.stage_meta_audience_demographics;
create trigger trg_stage_meta_audience_set_atualizado_em
before update on public.stage_meta_audience_demographics
for each row
execute function public.gto_set_atualizado_em();

alter table public.stage_meta_audience_demographics enable row level security;
alter table public.stage_meta_audience_demographics force row level security;

drop policy if exists "stage_meta_audience_select_por_marca" on public.stage_meta_audience_demographics;
create policy "stage_meta_audience_select_por_marca"
on public.stage_meta_audience_demographics
for select
to authenticated
using (public.gto_tem_acesso_marca(marca));

drop policy if exists "stage_meta_audience_insert_por_marca" on public.stage_meta_audience_demographics;
create policy "stage_meta_audience_insert_por_marca"
on public.stage_meta_audience_demographics
for insert
to authenticated
with check (public.gto_tem_acesso_marca(marca));

drop policy if exists "stage_meta_audience_update_por_marca" on public.stage_meta_audience_demographics;
create policy "stage_meta_audience_update_por_marca"
on public.stage_meta_audience_demographics
for update
to authenticated
using (public.gto_tem_acesso_marca(marca))
with check (public.gto_tem_acesso_marca(marca));

drop policy if exists "stage_meta_audience_delete_admin_gestor" on public.stage_meta_audience_demographics;
create policy "stage_meta_audience_delete_admin_gestor"
on public.stage_meta_audience_demographics
for delete
to authenticated
using (public.gto_eh_admin_ou_gestor());

revoke all on public.stage_meta_audience_demographics from anon;
grant select, insert, update, delete on public.stage_meta_audience_demographics to authenticated;

commit;
