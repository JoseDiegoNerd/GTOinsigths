with expected_columns(column_name) as (
  values
    ('conta_confirmada'),
    ('ignorada'),
    ('observacao')
),
column_status as (
  select
    ec.column_name,
    exists (
      select 1
      from information_schema.columns c
      where c.table_schema = 'public'
        and c.table_name = 'integracao_meta_contas'
        and c.column_name = ec.column_name
    ) as column_exists
  from expected_columns ec
),
view_status as (
  select
    to_regclass('public.vw_integracao_meta_contas_publica') is not null as view_exists,
    exists (
      select 1
      from information_schema.columns c
      where c.table_schema = 'public'
        and c.table_name = 'vw_integracao_meta_contas_publica'
        and c.column_name = 'conta_confirmada'
    ) as view_has_mapping_columns
),
rls_status as (
  select
    coalesce(c.relrowsecurity, false) as rls_enabled,
    coalesce(c.relforcerowsecurity, false) as rls_forced
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'integracao_meta_contas'
)
select
  'integracao_meta_contas_mapping' as check_name,
  bool_and(cs.column_exists) as columns_exist,
  (select view_exists from view_status) as view_exists,
  (select view_has_mapping_columns from view_status) as view_has_mapping_columns,
  coalesce((select rls_enabled from rls_status), false) as rls_enabled,
  coalesce((select rls_forced from rls_status), false) as rls_forced,
  exists (
    select 1
    from information_schema.role_table_grants g
    where g.table_schema = 'public'
      and g.table_name = 'vw_integracao_meta_contas_publica'
      and g.grantee = 'authenticated'
      and g.privilege_type = 'SELECT'
  ) as authenticated_can_read_public_view,
  not exists (
    select 1
    from information_schema.role_table_grants g
    where g.table_schema = 'public'
      and g.table_name in ('integracao_meta_contas', 'vw_integracao_meta_contas_publica')
      and g.grantee = 'anon'
  ) as anon_is_blocked
from column_status cs;
