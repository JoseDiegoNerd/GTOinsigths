-- GTO Insights - Core security foundation
-- Scope: global ENUMs, user profiles, audit logs and initial RLS policies.

begin;

-- Required for gen_random_uuid().
create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'cargo_usuario') then
    create type public.cargo_usuario as enum (
      'Admin',
      'Gestor',
      'Coordenador',
      'Analista'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'bandeira_marca') then
    create type public.bandeira_marca as enum (
      'Tesoura de Ouro',
      'Magazine da Economia',
      'Free Center Calçados'
    );
  end if;
end $$;

create table if not exists public.perfis (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  nome text,
  cargo public.cargo_usuario not null default 'Analista',
  marca_vinculada public.bandeira_marca,
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),

  constraint perfis_email_formato_chk
    check (position('@' in email) > 1),
  constraint perfis_marca_obrigatoria_para_operacao_chk
    check (
      cargo in ('Admin', 'Gestor')
      or marca_vinculada is not null
      or ativo = false
    )
);

comment on table public.perfis is
  'Perfis de negocio vinculados a auth.users. marca_vinculada NULL significa acesso corporativo a todas as marcas.';
comment on column public.perfis.id is 'Mesmo UUID do usuario em auth.users.';
comment on column public.perfis.cargo is 'Cargo usado pelas politicas RLS.';
comment on column public.perfis.marca_vinculada is 'Marca autorizada para Coordenador/Analista. NULL reservado para Admin/Gestor.';

create table if not exists public.logs_atividades (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid references auth.users(id) on delete set null,
  email text,
  acao_realizada text not null,
  tabela_afetada text not null,
  registro_id text,
  dados_anteriores jsonb,
  dados_novos jsonb,
  criado_em timestamptz not null default now()
);

comment on table public.logs_atividades is
  'Registro corporativo de auditoria para alteracoes em tabelas sensiveis.';

create index if not exists perfis_cargo_idx
  on public.perfis (cargo);

create index if not exists perfis_marca_vinculada_idx
  on public.perfis (marca_vinculada)
  where marca_vinculada is not null;

create index if not exists logs_atividades_usuario_id_idx
  on public.logs_atividades (usuario_id);

create index if not exists logs_atividades_tabela_criado_idx
  on public.logs_atividades (tabela_afetada, criado_em desc);

create or replace function public.gto_set_atualizado_em()
returns trigger
language plpgsql
as $$
begin
  new.atualizado_em = now();
  return new;
end;
$$;

drop trigger if exists trg_perfis_set_atualizado_em on public.perfis;
create trigger trg_perfis_set_atualizado_em
before update on public.perfis
for each row
execute function public.gto_set_atualizado_em();

create or replace function public.gto_meu_cargo()
returns public.cargo_usuario
language sql
stable
security definer
set search_path = public
as $$
  select p.cargo
  from public.perfis p
  where p.id = auth.uid()
    and p.ativo = true
  limit 1;
$$;

create or replace function public.gto_minha_marca()
returns public.bandeira_marca
language sql
stable
security definer
set search_path = public
as $$
  select p.marca_vinculada
  from public.perfis p
  where p.id = auth.uid()
    and p.ativo = true
  limit 1;
$$;

create or replace function public.gto_eh_admin_ou_gestor()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.gto_meu_cargo() in ('Admin', 'Gestor'), false);
$$;

create or replace function public.gto_tem_acesso_marca(marca_alvo public.bandeira_marca)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.uid() is null then false
    when public.gto_eh_admin_ou_gestor() then true
    when marca_alvo is null then false
    else marca_alvo = public.gto_minha_marca()
  end;
$$;

comment on function public.gto_tem_acesso_marca(public.bandeira_marca) is
  'Funcao padrao para politicas RLS em tabelas com coluna marca.';

create or replace function public.gto_registrar_auditoria()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_usuario_id uuid := auth.uid();
  v_email text := coalesce(
    nullif(current_setting('request.jwt.claim.email', true), ''),
    (auth.jwt() ->> 'email')
  );
  v_registro_id text;
begin
  if tg_op = 'DELETE' then
    v_registro_id := to_jsonb(old) ->> 'id';

    insert into public.logs_atividades (
      usuario_id,
      email,
      acao_realizada,
      tabela_afetada,
      registro_id,
      dados_anteriores,
      dados_novos
    )
    values (
      v_usuario_id,
      v_email,
      tg_op,
      tg_table_schema || '.' || tg_table_name,
      v_registro_id,
      to_jsonb(old),
      null
    );

    return old;
  end if;

  v_registro_id := to_jsonb(new) ->> 'id';

  insert into public.logs_atividades (
    usuario_id,
    email,
    acao_realizada,
    tabela_afetada,
    registro_id,
    dados_anteriores,
    dados_novos
  )
  values (
    v_usuario_id,
    v_email,
    tg_op,
    tg_table_schema || '.' || tg_table_name,
    v_registro_id,
    case when tg_op = 'UPDATE' then to_jsonb(old) else null end,
    to_jsonb(new)
  );

  return new;
end;
$$;

drop trigger if exists trg_perfis_auditoria on public.perfis;
create trigger trg_perfis_auditoria
after insert or update or delete on public.perfis
for each row
execute function public.gto_registrar_auditoria();

create or replace function public.gto_criar_perfil_auth()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.perfis (
    id,
    email,
    nome,
    cargo,
    marca_vinculada,
    ativo
  )
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'nome', new.raw_user_meta_data ->> 'name'),
    'Analista',
    null,
    false
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists trg_auth_users_criar_perfil on auth.users;
create trigger trg_auth_users_criar_perfil
after insert on auth.users
for each row
execute function public.gto_criar_perfil_auth();

alter table public.perfis enable row level security;
alter table public.perfis force row level security;

alter table public.logs_atividades enable row level security;
alter table public.logs_atividades force row level security;

drop policy if exists "perfis_select_autenticado" on public.perfis;
create policy "perfis_select_autenticado"
on public.perfis
for select
to authenticated
using (
  auth.uid() = id
  or public.gto_eh_admin_ou_gestor()
);

drop policy if exists "perfis_insert_admin_gestor" on public.perfis;
create policy "perfis_insert_admin_gestor"
on public.perfis
for insert
to authenticated
with check (
  public.gto_eh_admin_ou_gestor()
);

drop policy if exists "perfis_update_admin_gestor" on public.perfis;
create policy "perfis_update_admin_gestor"
on public.perfis
for update
to authenticated
using (
  public.gto_eh_admin_ou_gestor()
)
with check (
  public.gto_eh_admin_ou_gestor()
);

drop policy if exists "perfis_delete_admin_gestor" on public.perfis;
create policy "perfis_delete_admin_gestor"
on public.perfis
for delete
to authenticated
using (
  public.gto_eh_admin_ou_gestor()
);

drop policy if exists "logs_select_admin_gestor" on public.logs_atividades;
create policy "logs_select_admin_gestor"
on public.logs_atividades
for select
to authenticated
using (
  public.gto_eh_admin_ou_gestor()
);

revoke all on public.perfis from anon;
revoke all on public.logs_atividades from anon;

grant usage on schema public to authenticated;
grant usage on type public.cargo_usuario to authenticated;
grant usage on type public.bandeira_marca to authenticated;
grant select, insert, update, delete on public.perfis to authenticated;
grant select on public.logs_atividades to authenticated;

commit;
