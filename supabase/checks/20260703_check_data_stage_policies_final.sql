-- GTO Insights - Final policy validation for data/stage tables
-- Read-only check. Safe when an expected table, policy or grant does not exist.

with expected_tables(table_name) as (
  values
    ('dados_cartoes_credsystem'),
    ('stage_rd_station_marketing'),
    ('stage_meta_business_analytics'),
    ('stage_google_business_profile')
),
table_status as (
  select
    e.table_name,
    to_regclass('public.' || e.table_name) as relation_oid
  from expected_tables e
),
policy_status as (
  select
    ts.table_name,
    count(p.policyname) as policy_count,
    count(p.policyname) filter (where p.cmd = 'SELECT') > 0 as select_policy,
    count(p.policyname) filter (where p.cmd = 'INSERT') > 0 as insert_policy,
    count(p.policyname) filter (where p.cmd = 'UPDATE') > 0 as update_policy,
    count(p.policyname) filter (where p.cmd = 'DELETE') > 0 as delete_policy
  from table_status ts
  left join pg_policies p
    on p.schemaname = 'public'
   and p.tablename = ts.table_name
  group by ts.table_name
),
authenticated_grants as (
  select
    ts.table_name,
    has_schema_privilege('authenticated', 'public', 'USAGE') as authenticated_schema_usage,
    case
      when ts.relation_oid is null then false
      else has_table_privilege('authenticated', ts.relation_oid, 'SELECT')
    end as authenticated_can_select,
    case
      when ts.relation_oid is null then false
      else has_table_privilege('authenticated', ts.relation_oid, 'INSERT')
    end as authenticated_can_insert,
    case
      when ts.relation_oid is null then false
      else has_table_privilege('authenticated', ts.relation_oid, 'UPDATE')
    end as authenticated_can_update,
    case
      when ts.relation_oid is null then false
      else has_table_privilege('authenticated', ts.relation_oid, 'DELETE')
    end as authenticated_can_delete
  from table_status ts
),
anon_grants as (
  select
    ts.table_name,
    case
      when ts.relation_oid is null then false
      else has_table_privilege('anon', ts.relation_oid, 'SELECT')
    end as anon_can_select,
    case
      when ts.relation_oid is null then false
      else has_table_privilege('anon', ts.relation_oid, 'INSERT')
    end as anon_can_insert,
    case
      when ts.relation_oid is null then false
      else has_table_privilege('anon', ts.relation_oid, 'UPDATE')
    end as anon_can_update,
    case
      when ts.relation_oid is null then false
      else has_table_privilege('anon', ts.relation_oid, 'DELETE')
    end as anon_can_delete
  from table_status ts
)
select
  ts.table_name,
  ts.relation_oid is not null as table_exists,
  coalesce(c.relrowsecurity, false) as rls_enabled,
  coalesce(c.relforcerowsecurity, false) as rls_forced,
  ps.policy_count,
  ps.policy_count > 0 as has_policies,
  ps.select_policy,
  ps.insert_policy,
  ps.update_policy,
  ps.delete_policy,
  (
    ag.authenticated_schema_usage
    and ag.authenticated_can_select
    and ag.authenticated_can_insert
    and ag.authenticated_can_update
    and ag.authenticated_can_delete
  ) as authenticated_has_required_access,
  (
    not anon.anon_can_select
    and not anon.anon_can_insert
    and not anon.anon_can_update
    and not anon.anon_can_delete
  ) as anon_is_blocked
from table_status ts
left join pg_class c
  on c.oid = ts.relation_oid
join policy_status ps
  on ps.table_name = ts.table_name
join authenticated_grants ag
  on ag.table_name = ts.table_name
join anon_grants anon
  on anon.table_name = ts.table_name
order by ts.table_name;
