-- GTO Insights - Check das tabelas/RPC/view novas de E-mail Marketing (campanhas -> disparos -> analise)
-- Safe validation: returns true/false by item and never selects directly from missing objects.

with expected_tables(table_name) as (
  values
    ('campanhas_email'),
    ('campanha_disparos'),
    ('campanha_analise_estrategica')
),
table_status as (
  select
    et.table_name,
    to_regclass('public.' || et.table_name) is not null as table_exists,
    coalesce((
      select c.relrowsecurity and c.relforcerowsecurity
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = et.table_name
    ), false) as rls_enforced,
    (
      select count(*)
      from pg_policies p
      where p.schemaname = 'public' and p.tablename = et.table_name
    ) as policy_count,
    has_table_privilege('authenticated', 'public.' || et.table_name, 'select') as authenticated_can_select,
    not has_table_privilege('anon', 'public.' || et.table_name, 'select') as anon_is_blocked
  from expected_tables et
)
select
  table_name,
  table_exists,
  rls_enforced,
  policy_count,
  authenticated_can_select,
  anon_is_blocked,
  (table_exists and rls_enforced and policy_count >= 3 and authenticated_can_select and anon_is_blocked)
    as ready_for_frontend
from table_status
order by table_name;

-- View de apoio ao dashboard
select
  to_regclass('public.vw_campanha_disparos_resumo') is not null as view_exists,
  exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'vw_campanha_disparos_resumo'
      and c.reloptions::text like '%security_invoker=true%'
  ) as uses_security_invoker,
  has_table_privilege('authenticated', 'public.vw_campanha_disparos_resumo', 'select') as authenticated_can_select,
  not has_table_privilege('anon', 'public.vw_campanha_disparos_resumo', 'select') as anon_is_blocked;

-- RPC atomica de salvamento
select
  exists (
    select 1
    from pg_proc pr
    join pg_namespace n on n.oid = pr.pronamespace
    where n.nspname = 'public'
      and pr.proname = 'rpc_salvar_campanha_email'
  ) as rpc_exists,
  has_function_privilege(
    'authenticated',
    'public.rpc_salvar_campanha_email(public.bandeira_marca, text, text, text, jsonb, jsonb)',
    'execute'
  ) as authenticated_can_execute;

-- Triggers de marca-por-heranca e auditoria presentes nas tabelas filhas
with expected_triggers(table_name, trigger_name) as (
  values
    ('campanha_disparos', 'trg_campanha_disparos_set_marca'),
    ('campanha_disparos', 'trg_campanha_disparos_auditoria'),
    ('campanha_analise_estrategica', 'trg_campanha_analise_set_marca'),
    ('campanha_analise_estrategica', 'trg_campanha_analise_auditoria'),
    ('campanhas_email', 'trg_campanhas_email_auditoria')
)
select
  et.table_name,
  et.trigger_name,
  exists (
    select 1
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = et.table_name
      and t.tgname = et.trigger_name
      and not t.tgisinternal
  ) as trigger_exists
from expected_triggers et
order by et.table_name, et.trigger_name;
