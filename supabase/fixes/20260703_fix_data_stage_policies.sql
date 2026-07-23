-- GTO Insights - Safe policy fix for data/stage tables
-- Purpose: create authenticated RLS policies by brand without changing data or recreating tables.

begin;

drop policy if exists "dados_cartoes_select_por_marca" on public.dados_cartoes_credsystem;
drop policy if exists "dados_cartoes_insert_por_marca" on public.dados_cartoes_credsystem;
drop policy if exists "dados_cartoes_update_por_marca" on public.dados_cartoes_credsystem;
drop policy if exists "dados_cartoes_delete_por_marca" on public.dados_cartoes_credsystem;
drop policy if exists "dados_cartoes_delete_admin_gestor" on public.dados_cartoes_credsystem;

create policy "dados_cartoes_select_por_marca"
on public.dados_cartoes_credsystem
for select
to authenticated
using (public.gto_tem_acesso_marca(marca));

create policy "dados_cartoes_insert_por_marca"
on public.dados_cartoes_credsystem
for insert
to authenticated
with check (public.gto_tem_acesso_marca(marca));

create policy "dados_cartoes_update_por_marca"
on public.dados_cartoes_credsystem
for update
to authenticated
using (public.gto_tem_acesso_marca(marca))
with check (public.gto_tem_acesso_marca(marca));

create policy "dados_cartoes_delete_por_marca"
on public.dados_cartoes_credsystem
for delete
to authenticated
using (public.gto_tem_acesso_marca(marca));

drop policy if exists "stage_rd_select_por_marca" on public.stage_rd_station_marketing;
drop policy if exists "stage_rd_insert_por_marca" on public.stage_rd_station_marketing;
drop policy if exists "stage_rd_update_por_marca" on public.stage_rd_station_marketing;
drop policy if exists "stage_rd_delete_por_marca" on public.stage_rd_station_marketing;
drop policy if exists "stage_rd_delete_admin_gestor" on public.stage_rd_station_marketing;

create policy "stage_rd_select_por_marca"
on public.stage_rd_station_marketing
for select
to authenticated
using (public.gto_tem_acesso_marca(marca));

create policy "stage_rd_insert_por_marca"
on public.stage_rd_station_marketing
for insert
to authenticated
with check (public.gto_tem_acesso_marca(marca));

create policy "stage_rd_update_por_marca"
on public.stage_rd_station_marketing
for update
to authenticated
using (public.gto_tem_acesso_marca(marca))
with check (public.gto_tem_acesso_marca(marca));

create policy "stage_rd_delete_por_marca"
on public.stage_rd_station_marketing
for delete
to authenticated
using (public.gto_tem_acesso_marca(marca));

drop policy if exists "stage_meta_select_por_marca" on public.stage_meta_business_analytics;
drop policy if exists "stage_meta_insert_por_marca" on public.stage_meta_business_analytics;
drop policy if exists "stage_meta_update_por_marca" on public.stage_meta_business_analytics;
drop policy if exists "stage_meta_delete_por_marca" on public.stage_meta_business_analytics;
drop policy if exists "stage_meta_delete_admin_gestor" on public.stage_meta_business_analytics;

create policy "stage_meta_select_por_marca"
on public.stage_meta_business_analytics
for select
to authenticated
using (public.gto_tem_acesso_marca(marca));

create policy "stage_meta_insert_por_marca"
on public.stage_meta_business_analytics
for insert
to authenticated
with check (public.gto_tem_acesso_marca(marca));

create policy "stage_meta_update_por_marca"
on public.stage_meta_business_analytics
for update
to authenticated
using (public.gto_tem_acesso_marca(marca))
with check (public.gto_tem_acesso_marca(marca));

create policy "stage_meta_delete_por_marca"
on public.stage_meta_business_analytics
for delete
to authenticated
using (public.gto_tem_acesso_marca(marca));

drop policy if exists "stage_google_select_por_marca" on public.stage_google_business_profile;
drop policy if exists "stage_google_insert_por_marca" on public.stage_google_business_profile;
drop policy if exists "stage_google_update_por_marca" on public.stage_google_business_profile;
drop policy if exists "stage_google_delete_por_marca" on public.stage_google_business_profile;
drop policy if exists "stage_google_delete_admin_gestor" on public.stage_google_business_profile;

create policy "stage_google_select_por_marca"
on public.stage_google_business_profile
for select
to authenticated
using (public.gto_tem_acesso_marca(marca));

create policy "stage_google_insert_por_marca"
on public.stage_google_business_profile
for insert
to authenticated
with check (public.gto_tem_acesso_marca(marca));

create policy "stage_google_update_por_marca"
on public.stage_google_business_profile
for update
to authenticated
using (public.gto_tem_acesso_marca(marca))
with check (public.gto_tem_acesso_marca(marca));

create policy "stage_google_delete_por_marca"
on public.stage_google_business_profile
for delete
to authenticated
using (public.gto_tem_acesso_marca(marca));

grant select, insert, update, delete on public.dados_cartoes_credsystem to authenticated;
grant select, insert, update, delete on public.stage_rd_station_marketing to authenticated;
grant select, insert, update, delete on public.stage_meta_business_analytics to authenticated;
grant select, insert, update, delete on public.stage_google_business_profile to authenticated;

revoke all on public.dados_cartoes_credsystem from anon;
revoke all on public.stage_rd_station_marketing from anon;
revoke all on public.stage_meta_business_analytics from anon;
revoke all on public.stage_google_business_profile from anon;

commit;
