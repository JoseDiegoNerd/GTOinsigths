-- GTO Insights - Check social format metrics table and views
-- Safe validation: returns true/false by item.

with expected_objects(object_name, object_type) as (
  values
    ('stage_social_format_metrics', 'table'),
    ('vw_instagram_metricas_formato', 'view'),
    ('vw_facebook_metricas_formato', 'view')
),
object_status as (
  select
    eo.object_name,
    eo.object_type,
    to_regclass('public.' || eo.object_name) is not null as object_exists,
    case
      when eo.object_type = 'table' then exists (
        select 1
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relname = eo.object_name
          and c.relrowsecurity = true
          and c.relforcerowsecurity = true
      )
      else exists (
        select 1
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relname = eo.object_name
          and c.reloptions::text like '%security_invoker=true%'
      )
    end as security_enabled,
    has_table_privilege('authenticated', 'public.' || eo.object_name, 'select') as authenticated_can_select,
    not has_table_privilege('anon', 'public.' || eo.object_name, 'select') as anon_is_blocked
  from expected_objects eo
)
select
  object_name,
  object_type,
  object_exists,
  security_enabled,
  authenticated_can_select,
  anon_is_blocked,
  (
    object_exists
    and security_enabled
    and authenticated_can_select
    and anon_is_blocked
  ) as ready_for_frontend
from object_status
order by object_type, object_name;
