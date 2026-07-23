-- GTO Insights - Core security validation
-- Run after: supabase/migrations/20260702_001_init_perfis_logs_rls.sql
-- This script only reads metadata. The optional auth trigger test is commented.

-- 1. Check core tables.
select
  table_schema,
  table_name,
  table_type
from information_schema.tables
where table_schema = 'public'
  and table_name in ('perfis', 'logs_atividades')
order by table_name;

-- 2. Check expected columns.
select
  table_name,
  column_name,
  data_type,
  udt_name,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in ('perfis', 'logs_atividades')
order by table_name, ordinal_position;

-- 3. Check RLS status.
select
  schemaname,
  tablename,
  rowsecurity as rls_enabled,
  forcerowsecurity as rls_forced
from pg_tables
where schemaname = 'public'
  and tablename in ('perfis', 'logs_atividades')
order by tablename;

-- 4. Check RLS policies.
select
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('perfis', 'logs_atividades')
order by tablename, policyname;

-- 5. Check business functions used by policies.
select
  n.nspname as schema_name,
  p.proname as function_name,
  pg_get_function_arguments(p.oid) as arguments,
  pg_get_function_result(p.oid) as result_type,
  case p.prosecdef when true then 'SECURITY DEFINER' else 'SECURITY INVOKER' end as security_mode
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'gto_set_atualizado_em',
    'gto_meu_cargo',
    'gto_minha_marca',
    'gto_eh_admin_ou_gestor',
    'gto_tem_acesso_marca',
    'gto_registrar_auditoria',
    'gto_criar_perfil_auth'
  )
order by p.proname;

-- 6. Check triggers on public.perfis and auth.users.
select
  event_object_schema,
  event_object_table,
  trigger_name,
  event_manipulation,
  action_timing,
  action_statement
from information_schema.triggers
where (event_object_schema = 'public' and event_object_table = 'perfis')
   or (event_object_schema = 'auth' and event_object_table = 'users')
order by event_object_schema, event_object_table, trigger_name, event_manipulation;

-- 7. Check anonymous grants were removed from sensitive public tables.
select
  table_schema,
  table_name,
  grantee,
  privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('perfis', 'logs_atividades')
  and grantee in ('anon', 'authenticated')
order by table_name, grantee, privilege_type;

-- 8. Optional controlled test for auth trigger.
-- Use only in a disposable Supabase project or after replacing the UUID/email.
-- This inserts directly into auth.users, which is not recommended for normal app usage.
--
-- insert into auth.users (
--   id,
--   instance_id,
--   aud,
--   role,
--   email,
--   encrypted_password,
--   email_confirmed_at,
--   raw_user_meta_data,
--   created_at,
--   updated_at
-- )
-- values (
--   '00000000-0000-0000-0000-000000000101',
--   '00000000-0000-0000-0000-000000000000',
--   'authenticated',
--   'authenticated',
--   'teste.trigger@gtoinsights.local',
--   crypt('senha-temporaria-nao-usar', gen_salt('bf')),
--   now(),
--   '{"nome": "Teste Trigger"}'::jsonb,
--   now(),
--   now()
-- );
--
-- select id, email, nome, cargo, marca_vinculada, ativo
-- from public.perfis
-- where id = '00000000-0000-0000-0000-000000000101';
--
-- delete from auth.users
-- where id = '00000000-0000-0000-0000-000000000101';
