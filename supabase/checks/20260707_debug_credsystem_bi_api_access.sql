-- GTO Insights - Debug CredSystem BI API access
-- Use this when the database shows the views exist but the app still falls back.

with expected_views(view_name) as (
  values
    ('vw_credsystem_resumo_geral'),
    ('vw_credsystem_por_marca'),
    ('vw_credsystem_por_loja'),
    ('vw_credsystem_motivos_rejeicao'),
    ('vw_credsystem_funil_propostas_emissoes')
)
select
  ev.view_name,
  to_regclass('public.' || ev.view_name) is not null as view_exists,
  exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = ev.view_name
      and c.relkind = 'v'
  ) as is_view,
  exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = ev.view_name
      and c.reloptions::text like '%security_invoker=true%'
  ) as security_invoker_enabled,
  has_table_privilege('authenticated', 'public.' || ev.view_name, 'select') as authenticated_can_select,
  has_table_privilege('anon', 'public.' || ev.view_name, 'select') as anon_can_select,
  obj_description(('public.' || ev.view_name)::regclass, 'pg_class') is not null as has_comment
from expected_views ev
order by ev.view_name;

-- Optional smoke queries. Run after the table above if all rows are healthy.
select count(*) as resumo_rows from public.vw_credsystem_resumo_geral;
select count(*) as lojas_rows from public.vw_credsystem_por_loja;
select count(*) as motivos_rows from public.vw_credsystem_motivos_rejeicao;
select count(*) as funil_rows from public.vw_credsystem_funil_propostas_emissoes;
