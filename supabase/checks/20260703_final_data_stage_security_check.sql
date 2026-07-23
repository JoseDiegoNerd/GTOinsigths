-- GTO Insights - Final data/stage security validation
-- Read-only check. Safe when an expected table, policy or trigger does not exist.

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
rls_status as (
  select
    ts.table_name,
    coalesce(c.relrowsecurity, false) as rls_enabled,
    coalesce(c.relforcerowsecurity, false) as rls_forced
  from table_status ts
  left join pg_class c
    on c.oid = ts.relation_oid
),
policy_status as (
  select
    ts.table_name,
    count(p.policyname) as policy_count,
    count(p.policyname) filter (where p.cmd = 'SELECT') > 0 as select_policy_exists,
    count(p.policyname) filter (where p.cmd = 'INSERT') > 0 as insert_policy_exists,
    count(p.policyname) filter (where p.cmd = 'UPDATE') > 0 as update_policy_exists,
    count(p.policyname) filter (where p.cmd = 'DELETE') > 0 as delete_policy_exists
  from table_status ts
  left join pg_policies p
    on p.schemaname = 'public'
   and p.tablename = ts.table_name
  group by ts.table_name
),
trigger_status as (
  select
    ts.table_name,
    count(tr.trigger_name) > 0 as any_trigger_exists,
    count(tr.trigger_name) filter (
      where tr.action_statement ilike '%gto_set_atualizado_em%'
         or tr.trigger_name ilike '%atualizado_em%'
    ) > 0 as atualizado_em_trigger_exists,
    count(tr.trigger_name) filter (
      where tr.action_statement ilike '%gto_registrar_auditoria%'
         or tr.trigger_name ilike '%auditoria%'
    ) > 0 as auditoria_trigger_exists
  from table_status ts
  left join information_schema.triggers tr
    on tr.event_object_schema = 'public'
   and tr.event_object_table = ts.table_name
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
  rs.rls_enabled,
  rs.rls_forced,
  ps.policy_count,
  ps.select_policy_exists,
  ps.insert_policy_exists,
  ps.update_policy_exists,
  ps.delete_policy_exists,
  (
    ps.select_policy_exists
    and ps.insert_policy_exists
    and ps.update_policy_exists
    and ps.delete_policy_exists
  ) as all_expected_policies_exist,
  trs.any_trigger_exists,
  trs.atualizado_em_trigger_exists,
  trs.auditoria_trigger_exists,
  (
    trs.atualizado_em_trigger_exists
    and trs.auditoria_trigger_exists
  ) as all_expected_triggers_exist,
  ag.authenticated_schema_usage,
  ag.authenticated_can_select,
  ag.authenticated_can_insert,
  ag.authenticated_can_update,
  ag.authenticated_can_delete,
  (
    ag.authenticated_schema_usage
    and ag.authenticated_can_select
    and ag.authenticated_can_insert
    and ag.authenticated_can_update
    and ag.authenticated_can_delete
  ) as authenticated_has_required_access,
  agn.anon_can_select,
  agn.anon_can_insert,
  agn.anon_can_update,
  agn.anon_can_delete,
  (
    not agn.anon_can_select
    and not agn.anon_can_insert
    and not agn.anon_can_update
    and not agn.anon_can_delete
  ) as anon_is_blocked
from table_status ts
join rls_status rs on rs.table_name = ts.table_name
join policy_status ps on ps.table_name = ts.table_name
join trigger_status trs on trs.table_name = ts.table_name
join authenticated_grants ag on ag.table_name = ts.table_name
join anon_grants agn on agn.table_name = ts.table_name
order by ts.table_name;
