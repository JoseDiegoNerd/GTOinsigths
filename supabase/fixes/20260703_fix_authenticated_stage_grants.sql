-- GTO Insights - Safe permissions fix for data/stage tables
-- Purpose: reinforce Supabase role permissions without recreating tables or changing data.

begin;

grant usage on schema public to authenticated;

grant usage on type public.cargo_usuario to authenticated;
grant usage on type public.bandeira_marca to authenticated;

grant select, insert, update, delete on public.dados_cartoes_credsystem to authenticated;
grant select, insert, update, delete on public.stage_rd_station_marketing to authenticated;
grant select, insert, update, delete on public.stage_meta_business_analytics to authenticated;
grant select, insert, update, delete on public.stage_google_business_profile to authenticated;

grant execute on function public.gto_meu_cargo() to authenticated;
grant execute on function public.gto_minha_marca() to authenticated;
grant execute on function public.gto_eh_admin_ou_gestor() to authenticated;
grant execute on function public.gto_tem_acesso_marca(public.bandeira_marca) to authenticated;

revoke all on public.dados_cartoes_credsystem from anon;
revoke all on public.stage_rd_station_marketing from anon;
revoke all on public.stage_meta_business_analytics from anon;
revoke all on public.stage_google_business_profile from anon;

revoke execute on function public.gto_meu_cargo() from anon;
revoke execute on function public.gto_minha_marca() from anon;
revoke execute on function public.gto_eh_admin_ou_gestor() from anon;
revoke execute on function public.gto_tem_acesso_marca(public.bandeira_marca) from anon;

commit;
