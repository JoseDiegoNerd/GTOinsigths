-- GTO Insights - Verify expected migration 002 tables
-- Read-only diagnostic query.

with expected_tables(table_name) as (
  values
    ('dados_cartoes_credsystem'),
    ('stage_rd_station_marketing'),
    ('stage_meta_business_analytics'),
    ('stage_google_business_profile')
)
select
  e.table_name,
  to_regclass('public.' || e.table_name) is not null as table_exists,
  t.table_schema,
  t.table_type
from expected_tables e
left join information_schema.tables t
  on t.table_schema = 'public'
 and t.table_name = e.table_name
order by e.table_name;
