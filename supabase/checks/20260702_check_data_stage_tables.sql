-- GTO Insights - Data and stage tables validation
-- Run after: supabase/migrations/20260702_002_data_stage_tables_rls.sql

-- 1. Check data/stage tables.
select
  table_schema,
  table_name,
  table_type
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'dados_cartoes_credsystem',
    'stage_rd_station_marketing',
    'stage_meta_business_analytics',
    'stage_google_business_profile'
  )
order by table_name;

-- 2. Check RLS status.
select
  n.nspname as schemaname,
  c.relname as tablename,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'dados_cartoes_credsystem',
    'stage_rd_station_marketing',
    'stage_meta_business_analytics',
    'stage_google_business_profile'
  )
  and c.relkind = 'r'
order by c.relname;

-- 3. Check RLS policies by brand.
select
  tablename,
  policyname,
  roles,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename in (
    'dados_cartoes_credsystem',
    'stage_rd_station_marketing',
    'stage_meta_business_analytics',
    'stage_google_business_profile'
  )
order by tablename, policyname;

-- 4. Check audit and updated_at triggers.
select
  event_object_table,
  trigger_name,
  event_manipulation,
  action_timing,
  action_statement
from information_schema.triggers
where event_object_schema = 'public'
  and event_object_table in (
    'dados_cartoes_credsystem',
    'stage_rd_station_marketing',
    'stage_meta_business_analytics',
    'stage_google_business_profile'
  )
order by event_object_table, trigger_name, event_manipulation;

-- 5. Check grants exposed to Supabase authenticated clients.
select
  table_name,
  grantee,
  privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in (
    'dados_cartoes_credsystem',
    'stage_rd_station_marketing',
    'stage_meta_business_analytics',
    'stage_google_business_profile'
  )
  and grantee in ('anon', 'authenticated')
order by table_name, grantee, privilege_type;
