-- GTO Insights - Data and stage tables
-- Scope: CredSystem cards, RD Station, Meta Business and Google Business Profile.
-- Depends on: 20260702_001_init_perfis_logs_rls.sql

begin;

create table if not exists public.dados_cartoes_credsystem (
  id uuid primary key default gen_random_uuid(),
  marca public.bandeira_marca not null,
  data_emissao date not null,
  data_ativacao date,
  loja_operacao text not null,
  nome_cliente text,
  telefone text,
  valor_compra_inicial numeric(12, 2) check (
    valor_compra_inicial is null
    or valor_compra_inicial >= 0
  ),
  frequencia_recorrencia integer not null default 0 check (frequencia_recorrencia >= 0),
  origem_arquivo text,
  lote_importacao uuid default gen_random_uuid(),
  importado_por uuid default auth.uid() references auth.users(id) on delete set null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),

  constraint dados_cartoes_data_ativacao_chk
    check (
      data_ativacao is null
      or data_ativacao >= data_emissao
    )
);

comment on table public.dados_cartoes_credsystem is
  'Dados normalizados de emissao, ativacao e uso inicial de cartoes private label CredSystem.';
comment on column public.dados_cartoes_credsystem.marca is
  'Marca usada pelas politicas RLS por escopo de negocio.';
comment on column public.dados_cartoes_credsystem.valor_compra_inicial is
  'Valor usado para calculo de ticket medio inicial.';
comment on column public.dados_cartoes_credsystem.frequencia_recorrencia is
  'Quantidade de recorrencias observadas para o cliente/cartao no periodo importado.';

create table if not exists public.stage_rd_station_marketing (
  id uuid primary key default gen_random_uuid(),
  marca public.bandeira_marca not null,
  id_campanha text not null,
  nome_campanha text not null,
  enviados integer not null default 0 check (enviados >= 0),
  entregues integer not null default 0 check (entregues >= 0),
  taxa_abertura numeric(7, 4) check (
    taxa_abertura is null
    or (taxa_abertura >= 0 and taxa_abertura <= 100)
  ),
  taxa_clique numeric(7, 4) check (
    taxa_clique is null
    or (taxa_clique >= 0 and taxa_clique <= 100)
  ),
  descadastros integer not null default 0 check (descadastros >= 0),
  assunto_email text,
  preheader text,
  corpo_copy text,
  analise_copy_ia jsonb not null default '{}'::jsonb,
  payload_bruto jsonb not null default '{}'::jsonb,
  data_referencia date not null default current_date,
  origem_api text not null default 'rd_station',
  lote_importacao uuid default gen_random_uuid(),
  importado_por uuid default auth.uid() references auth.users(id) on delete set null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),

  constraint stage_rd_station_entregues_enviados_chk
    check (entregues <= enviados),
  constraint stage_rd_station_descadastros_enviados_chk
    check (descadastros <= enviados),
  constraint stage_rd_station_campanha_marca_ref_uk
    unique (marca, id_campanha, data_referencia)
);

comment on table public.stage_rd_station_marketing is
  'Espelho bruto e semicurado para metricas de email marketing vindas da RD Station.';
comment on column public.stage_rd_station_marketing.analise_copy_ia is
  'Campo reservado para score, insights, temas, tom e oportunidades gerados por IA.';
comment on column public.stage_rd_station_marketing.payload_bruto is
  'Payload original da API ou planilha para rastreabilidade.';

create table if not exists public.stage_meta_business_analytics (
  id uuid primary key default gen_random_uuid(),
  marca public.bandeira_marca not null,
  data_referencia date not null default current_date,
  seguidores_instagram integer not null default 0 check (seguidores_instagram >= 0),
  alcance_facebook integer not null default 0 check (alcance_facebook >= 0),
  engajamento_total integer not null default 0 check (engajamento_total >= 0),
  post_destaque_semana_url text,
  payload_bruto jsonb not null default '{}'::jsonb,
  origem_api text not null default 'meta_business',
  lote_importacao uuid default gen_random_uuid(),
  importado_por uuid default auth.uid() references auth.users(id) on delete set null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),

  constraint stage_meta_post_url_chk
    check (
      post_destaque_semana_url is null
      or post_destaque_semana_url ~* '^https?://'
    ),
  constraint stage_meta_marca_data_uk
    unique (marca, data_referencia)
);

comment on table public.stage_meta_business_analytics is
  'Espelho de metricas semanais ou diarias por marca vindas do Meta Business.';

create table if not exists public.stage_google_business_profile (
  id uuid primary key default gen_random_uuid(),
  marca public.bandeira_marca not null,
  id_loja_gmb text not null,
  nome_loja text,
  rating_medio numeric(3, 2) check (
    rating_medio is null
    or (rating_medio >= 0 and rating_medio <= 5)
  ),
  status_resposta text,
  horario_funcionamento jsonb not null default '{}'::jsonb,
  payload_bruto jsonb not null default '{}'::jsonb,
  data_referencia date not null default current_date,
  origem_api text not null default 'google_business_profile',
  lote_importacao uuid default gen_random_uuid(),
  importado_por uuid default auth.uid() references auth.users(id) on delete set null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),

  constraint stage_google_loja_marca_ref_uk
    unique (marca, id_loja_gmb, data_referencia)
);

comment on table public.stage_google_business_profile is
  'Espelho operacional das lojas fisicas no Google Business Profile.';
comment on column public.stage_google_business_profile.horario_funcionamento is
  'JSON com horarios por dia da semana, excecoes e feriados quando disponivel.';

create index if not exists dados_cartoes_marca_data_emissao_idx
  on public.dados_cartoes_credsystem (marca, data_emissao desc);

create index if not exists dados_cartoes_lote_importacao_idx
  on public.dados_cartoes_credsystem (lote_importacao);

create index if not exists stage_rd_marca_data_idx
  on public.stage_rd_station_marketing (marca, data_referencia desc);

create index if not exists stage_rd_lote_importacao_idx
  on public.stage_rd_station_marketing (lote_importacao);

create index if not exists stage_meta_marca_data_idx
  on public.stage_meta_business_analytics (marca, data_referencia desc);

create index if not exists stage_meta_lote_importacao_idx
  on public.stage_meta_business_analytics (lote_importacao);

create index if not exists stage_google_marca_data_idx
  on public.stage_google_business_profile (marca, data_referencia desc);

create index if not exists stage_google_lote_importacao_idx
  on public.stage_google_business_profile (lote_importacao);

drop trigger if exists trg_dados_cartoes_set_atualizado_em on public.dados_cartoes_credsystem;
create trigger trg_dados_cartoes_set_atualizado_em
before update on public.dados_cartoes_credsystem
for each row
execute function public.gto_set_atualizado_em();

drop trigger if exists trg_stage_rd_set_atualizado_em on public.stage_rd_station_marketing;
create trigger trg_stage_rd_set_atualizado_em
before update on public.stage_rd_station_marketing
for each row
execute function public.gto_set_atualizado_em();

drop trigger if exists trg_stage_meta_set_atualizado_em on public.stage_meta_business_analytics;
create trigger trg_stage_meta_set_atualizado_em
before update on public.stage_meta_business_analytics
for each row
execute function public.gto_set_atualizado_em();

drop trigger if exists trg_stage_google_set_atualizado_em on public.stage_google_business_profile;
create trigger trg_stage_google_set_atualizado_em
before update on public.stage_google_business_profile
for each row
execute function public.gto_set_atualizado_em();

drop trigger if exists trg_dados_cartoes_auditoria on public.dados_cartoes_credsystem;
create trigger trg_dados_cartoes_auditoria
after insert or update or delete on public.dados_cartoes_credsystem
for each row
execute function public.gto_registrar_auditoria();

drop trigger if exists trg_stage_rd_auditoria on public.stage_rd_station_marketing;
create trigger trg_stage_rd_auditoria
after insert or update or delete on public.stage_rd_station_marketing
for each row
execute function public.gto_registrar_auditoria();

drop trigger if exists trg_stage_meta_auditoria on public.stage_meta_business_analytics;
create trigger trg_stage_meta_auditoria
after insert or update or delete on public.stage_meta_business_analytics
for each row
execute function public.gto_registrar_auditoria();

drop trigger if exists trg_stage_google_auditoria on public.stage_google_business_profile;
create trigger trg_stage_google_auditoria
after insert or update or delete on public.stage_google_business_profile
for each row
execute function public.gto_registrar_auditoria();

alter table public.dados_cartoes_credsystem enable row level security;
alter table public.dados_cartoes_credsystem force row level security;

alter table public.stage_rd_station_marketing enable row level security;
alter table public.stage_rd_station_marketing force row level security;

alter table public.stage_meta_business_analytics enable row level security;
alter table public.stage_meta_business_analytics force row level security;

alter table public.stage_google_business_profile enable row level security;
alter table public.stage_google_business_profile force row level security;

drop policy if exists "dados_cartoes_select_por_marca" on public.dados_cartoes_credsystem;
create policy "dados_cartoes_select_por_marca"
on public.dados_cartoes_credsystem
for select
to authenticated
using (public.gto_tem_acesso_marca(marca));

drop policy if exists "dados_cartoes_insert_por_marca" on public.dados_cartoes_credsystem;
create policy "dados_cartoes_insert_por_marca"
on public.dados_cartoes_credsystem
for insert
to authenticated
with check (public.gto_tem_acesso_marca(marca));

drop policy if exists "dados_cartoes_update_por_marca" on public.dados_cartoes_credsystem;
create policy "dados_cartoes_update_por_marca"
on public.dados_cartoes_credsystem
for update
to authenticated
using (public.gto_tem_acesso_marca(marca))
with check (public.gto_tem_acesso_marca(marca));

drop policy if exists "dados_cartoes_delete_admin_gestor" on public.dados_cartoes_credsystem;
create policy "dados_cartoes_delete_admin_gestor"
on public.dados_cartoes_credsystem
for delete
to authenticated
using (public.gto_eh_admin_ou_gestor());

drop policy if exists "stage_rd_select_por_marca" on public.stage_rd_station_marketing;
create policy "stage_rd_select_por_marca"
on public.stage_rd_station_marketing
for select
to authenticated
using (public.gto_tem_acesso_marca(marca));

drop policy if exists "stage_rd_insert_por_marca" on public.stage_rd_station_marketing;
create policy "stage_rd_insert_por_marca"
on public.stage_rd_station_marketing
for insert
to authenticated
with check (public.gto_tem_acesso_marca(marca));

drop policy if exists "stage_rd_update_por_marca" on public.stage_rd_station_marketing;
create policy "stage_rd_update_por_marca"
on public.stage_rd_station_marketing
for update
to authenticated
using (public.gto_tem_acesso_marca(marca))
with check (public.gto_tem_acesso_marca(marca));

drop policy if exists "stage_rd_delete_admin_gestor" on public.stage_rd_station_marketing;
create policy "stage_rd_delete_admin_gestor"
on public.stage_rd_station_marketing
for delete
to authenticated
using (public.gto_eh_admin_ou_gestor());

drop policy if exists "stage_meta_select_por_marca" on public.stage_meta_business_analytics;
create policy "stage_meta_select_por_marca"
on public.stage_meta_business_analytics
for select
to authenticated
using (public.gto_tem_acesso_marca(marca));

drop policy if exists "stage_meta_insert_por_marca" on public.stage_meta_business_analytics;
create policy "stage_meta_insert_por_marca"
on public.stage_meta_business_analytics
for insert
to authenticated
with check (public.gto_tem_acesso_marca(marca));

drop policy if exists "stage_meta_update_por_marca" on public.stage_meta_business_analytics;
create policy "stage_meta_update_por_marca"
on public.stage_meta_business_analytics
for update
to authenticated
using (public.gto_tem_acesso_marca(marca))
with check (public.gto_tem_acesso_marca(marca));

drop policy if exists "stage_meta_delete_admin_gestor" on public.stage_meta_business_analytics;
create policy "stage_meta_delete_admin_gestor"
on public.stage_meta_business_analytics
for delete
to authenticated
using (public.gto_eh_admin_ou_gestor());

drop policy if exists "stage_google_select_por_marca" on public.stage_google_business_profile;
create policy "stage_google_select_por_marca"
on public.stage_google_business_profile
for select
to authenticated
using (public.gto_tem_acesso_marca(marca));

drop policy if exists "stage_google_insert_por_marca" on public.stage_google_business_profile;
create policy "stage_google_insert_por_marca"
on public.stage_google_business_profile
for insert
to authenticated
with check (public.gto_tem_acesso_marca(marca));

drop policy if exists "stage_google_update_por_marca" on public.stage_google_business_profile;
create policy "stage_google_update_por_marca"
on public.stage_google_business_profile
for update
to authenticated
using (public.gto_tem_acesso_marca(marca))
with check (public.gto_tem_acesso_marca(marca));

drop policy if exists "stage_google_delete_admin_gestor" on public.stage_google_business_profile;
create policy "stage_google_delete_admin_gestor"
on public.stage_google_business_profile
for delete
to authenticated
using (public.gto_eh_admin_ou_gestor());

revoke all on public.dados_cartoes_credsystem from anon;
revoke all on public.stage_rd_station_marketing from anon;
revoke all on public.stage_meta_business_analytics from anon;
revoke all on public.stage_google_business_profile from anon;

grant select, insert, update, delete on public.dados_cartoes_credsystem to authenticated;
grant select, insert, update, delete on public.stage_rd_station_marketing to authenticated;
grant select, insert, update, delete on public.stage_meta_business_analytics to authenticated;
grant select, insert, update, delete on public.stage_google_business_profile to authenticated;

commit;
