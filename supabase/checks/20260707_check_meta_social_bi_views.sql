-- GTO Insights - Check Meta Social BI views
-- Safe validation: returns true/false by item and never selects directly from missing views.

with expected_views(view_name) as (
  values
    ('vw_meta_social_periodos'),
    ('vw_meta_social_resumo_marca'),
    ('vw_meta_social_ranking_conteudo')
),
view_status as (
  select
    ev.view_name,
    to_regclass('public.' || ev.view_name) is not null as view_exists,
    exists (
      select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = ev.view_name
        and c.reloptions::text like '%security_invoker=true%'
    ) as uses_security_invoker,
    has_table_privilege('authenticated', 'public.' || ev.view_name, 'select') as authenticated_can_select,
    not has_table_privilege('anon', 'public.' || ev.view_name, 'select') as anon_is_blocked
  from expected_views ev
)
select
  view_name,
  view_exists,
  uses_security_invoker,
  authenticated_can_select,
  anon_is_blocked,
  (
    view_exists
    and uses_security_invoker
    and authenticated_can_select
    and anon_is_blocked
  ) as ready_for_frontend
from view_status
order by view_name;
