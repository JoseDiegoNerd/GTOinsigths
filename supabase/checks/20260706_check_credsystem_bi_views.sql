-- GTO Insights - Check CredSystem BI views
-- Safe validation: returns true/false by item and never selects directly from missing views.

with expected_views(view_name) as (
  values
    ('vw_credsystem_resumo_geral'),
    ('vw_credsystem_por_marca'),
    ('vw_credsystem_por_loja'),
    ('vw_credsystem_motivos_rejeicao'),
    ('vw_credsystem_funil_propostas_emissoes')
),
view_status as (
  select
    ev.view_name,
    to_regclass('public.' || ev.view_name) is not null as view_exists,
    exists (
      select 1
      from information_schema.role_table_grants g
      where g.table_schema = 'public'
        and g.table_name = ev.view_name
        and g.grantee = 'authenticated'
        and g.privilege_type = 'SELECT'
    ) as authenticated_can_select,
    not exists (
      select 1
      from information_schema.role_table_grants g
      where g.table_schema = 'public'
        and g.table_name = ev.view_name
        and g.grantee = 'anon'
    ) as anon_is_blocked,
    exists (
      select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = ev.view_name
        and c.reloptions::text like '%security_invoker=true%'
    ) as uses_security_invoker
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
