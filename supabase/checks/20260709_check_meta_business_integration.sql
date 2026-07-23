with expected_objects(object_name, object_type) as (
  values
    ('integracao_meta_contas', 'table'),
    ('stage_social_format_metrics', 'table'),
    ('logs_integracao_meta', 'table'),
    ('vw_integracao_meta_contas_publica', 'view')
),
object_status as (
  select
    eo.object_name,
    eo.object_type,
    to_regclass('public.' || eo.object_name) is not null as object_exists,
    case
      when eo.object_type = 'table' then coalesce(c.relrowsecurity, false)
      else exists (
        select 1
        from pg_class vc
        join pg_namespace vn on vn.oid = vc.relnamespace
        where vn.nspname = 'public'
          and vc.relname = eo.object_name
          and vc.reloptions::text like '%security_invoker=true%'
      )
    end as security_enabled,
    case
      when eo.object_type = 'table' then coalesce(c.relforcerowsecurity, false)
      else true
    end as rls_forced
  from expected_objects eo
  left join pg_class c
    on c.oid = to_regclass('public.' || eo.object_name)
),
policy_status as (
  select
    tablename as object_name,
    count(*)::integer as policy_count,
    bool_or(cmd = 'SELECT') as select_policy,
    bool_or(cmd = 'INSERT') as insert_policy,
    bool_or(cmd = 'UPDATE') as update_policy,
    bool_or(cmd = 'DELETE') as delete_policy
  from pg_policies
  where schemaname = 'public'
    and tablename in (
      'integracao_meta_contas',
      'stage_social_format_metrics',
      'logs_integracao_meta'
    )
  group by tablename
),
grant_status as (
  select
    table_name as object_name,
    bool_or(grantee = 'authenticated' and privilege_type = 'SELECT') as authenticated_can_select,
    bool_or(grantee = 'anon') as anon_has_any_grant
  from information_schema.role_table_grants
  where table_schema = 'public'
    and table_name in (
      'integracao_meta_contas',
      'stage_social_format_metrics',
      'logs_integracao_meta',
      'vw_integracao_meta_contas_publica'
    )
  group by table_name
),
trigger_status as (
  select
    c.relname as object_name,
    bool_or(t.tgname like '%set_atualizado_em%') as has_updated_trigger,
    bool_or(t.tgname like '%auditoria%') as has_audit_trigger
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in (
      'integracao_meta_contas',
      'stage_social_format_metrics',
      'logs_integracao_meta'
    )
    and not t.tgisinternal
  group by c.relname
)
select
  os.object_name,
  os.object_type,
  os.object_exists,
  os.security_enabled,
  os.rls_forced,
  coalesce(ps.policy_count, 0) as policy_count,
  coalesce(ps.select_policy, os.object_type = 'view') as select_policy,
  coalesce(ps.insert_policy, os.object_type = 'view') as insert_policy,
  coalesce(ps.update_policy, os.object_type in ('view') or os.object_name = 'logs_integracao_meta') as update_policy_or_not_required,
  coalesce(ps.delete_policy, os.object_type in ('view') or os.object_name = 'logs_integracao_meta') as delete_policy_or_not_required,
  coalesce(gs.authenticated_can_select, false) as authenticated_can_select,
  not coalesce(gs.anon_has_any_grant, false) as anon_is_blocked,
  case
    when os.object_type = 'table' and os.object_name <> 'logs_integracao_meta'
      then coalesce(ts.has_updated_trigger, false)
    else true
  end as atualizado_em_trigger_ok,
  case
    when os.object_type = 'table'
      then coalesce(ts.has_audit_trigger, false)
    else true
  end as audit_trigger_ok,
  (
    os.object_exists
    and os.security_enabled
    and os.rls_forced
    and coalesce(gs.authenticated_can_select, false)
    and not coalesce(gs.anon_has_any_grant, false)
  ) as ready_for_frontend
from object_status os
left join policy_status ps on ps.object_name = os.object_name
left join grant_status gs on gs.object_name = os.object_name
left join trigger_status ts on ts.object_name = os.object_name
order by os.object_name;
