-- GTO Insights - CredSystem proposals stage table
-- Scope: raw/semi-curated proposal files from CredSystem.

begin;

create table if not exists public.stage_credsystem_propostas (
  id uuid primary key default gen_random_uuid(),
  marca public.bandeira_marca not null,
  dt_proposta date not null,
  hr_proposta time,
  cd_loja_cs text,
  nm_loja text,
  id_cod_proposta text not null,
  cpf_cliente text,
  cd_cliente text,
  id_cod_cartao text,
  campanha text,
  origem_prop text,
  proposta_aprov integer not null default 0 check (proposta_aprov in (0, 1)),
  proposta_rejei integer not null default 0 check (proposta_rejei in (0, 1)),
  motivo text,
  cpf_promotor text,
  login_operador text,
  tel_celular text,
  cpf_operador text,
  nivel_2 text,
  payload_bruto jsonb not null default '{}'::jsonb,
  origem_arquivo text,
  lote_importacao uuid default gen_random_uuid(),
  importado_por uuid default auth.uid() references auth.users(id) on delete set null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),

  constraint stage_credsystem_propostas_marca_proposta_uk
    unique (marca, id_cod_proposta)
);

comment on table public.stage_credsystem_propostas is
  'Stage para arquivos CredSystem de propostas, incluindo aprovadas, rejeitadas e motivos.';

create index if not exists stage_credsystem_propostas_marca_data_idx
  on public.stage_credsystem_propostas (marca, dt_proposta desc);

create index if not exists stage_credsystem_propostas_lote_idx
  on public.stage_credsystem_propostas (lote_importacao);

drop trigger if exists trg_stage_credsystem_propostas_set_atualizado_em
  on public.stage_credsystem_propostas;
create trigger trg_stage_credsystem_propostas_set_atualizado_em
before update on public.stage_credsystem_propostas
for each row
execute function public.gto_set_atualizado_em();

drop trigger if exists trg_stage_credsystem_propostas_auditoria
  on public.stage_credsystem_propostas;
create trigger trg_stage_credsystem_propostas_auditoria
after insert or update or delete on public.stage_credsystem_propostas
for each row
execute function public.gto_registrar_auditoria();

alter table public.stage_credsystem_propostas enable row level security;
alter table public.stage_credsystem_propostas force row level security;

drop policy if exists "stage_credsystem_propostas_select_por_marca"
  on public.stage_credsystem_propostas;
drop policy if exists "stage_credsystem_propostas_insert_por_marca"
  on public.stage_credsystem_propostas;
drop policy if exists "stage_credsystem_propostas_update_por_marca"
  on public.stage_credsystem_propostas;
drop policy if exists "stage_credsystem_propostas_delete_por_marca"
  on public.stage_credsystem_propostas;

create policy "stage_credsystem_propostas_select_por_marca"
on public.stage_credsystem_propostas
for select
to authenticated
using (public.gto_tem_acesso_marca(marca));

create policy "stage_credsystem_propostas_insert_por_marca"
on public.stage_credsystem_propostas
for insert
to authenticated
with check (public.gto_tem_acesso_marca(marca));

create policy "stage_credsystem_propostas_update_por_marca"
on public.stage_credsystem_propostas
for update
to authenticated
using (public.gto_tem_acesso_marca(marca))
with check (public.gto_tem_acesso_marca(marca));

create policy "stage_credsystem_propostas_delete_por_marca"
on public.stage_credsystem_propostas
for delete
to authenticated
using (public.gto_tem_acesso_marca(marca));

grant select, insert, update, delete on public.stage_credsystem_propostas to authenticated;
revoke all on public.stage_credsystem_propostas from anon;

commit;
