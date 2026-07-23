-- GTO Insights - Find similar public table names
-- Read-only diagnostic query.

select
  t.table_schema,
  t.table_name,
  t.table_type
from information_schema.tables t
where t.table_schema = 'public'
  and (
    t.table_name ilike '%cartao%'
    or t.table_name ilike '%cartoes%'
    or t.table_name ilike '%credsystem%'
    or t.table_name ilike '%rd%'
    or t.table_name ilike '%station%'
    or t.table_name ilike '%meta%'
    or t.table_name ilike '%google%'
    or t.table_name ilike '%business%'
    or t.table_name ilike '%stage%'
  )
order by t.table_name;
