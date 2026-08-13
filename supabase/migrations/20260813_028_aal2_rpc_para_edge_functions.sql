-- GTO Insights - RPC de checagem de AAL2 parametrizada, para uso a partir de Edge Functions
-- Scope: 20260813_027_enforce_mfa_aal2_rls.sql fechou o enforcement de MFA (aal2) nas policies
-- RLS via gto_aal2_ok() - mas essa funcao le auth.uid()/auth.jwt(), que so resolvem dentro de
-- uma chamada autenticada via PostgREST/RLS. As Edge Functions do Google
-- (google-gbp-location-update, google-gbp-review-reply) chamam a API do Google com o
-- client de service_role (getAdminClient()); a identidade de quem fez a requisicao HTTP e
-- validada a parte, via getAuthenticatedUser(req) -> supabase.auth.getUser(token). Dentro
-- dessas funcoes, auth.uid() nunca resolve pro usuario real - mesmo gap ja resolvido para
-- gto_tem_acesso_marca(marca) na migration 20260812_026 (gto_tem_acesso_marca_para).
--
-- Esta funcao e a mesma logica/fonte de verdade de gto_aal2_ok(), parametrizada por usuario e
-- pelo claim "aal" (extraido pela Edge Function do token ja validado por getAuthenticatedUser -
-- ver assertAal2 em supabase/functions/_shared/meta.ts).
--
-- Seguranca: EXECUTE revogado de public/authenticated e concedido so a service_role, mesmo
-- padrao de gto_tem_acesso_marca_para - nenhum motivo legitimo pra um usuario comum perguntar
-- "o usuario X satisfaz aal2" sobre um uuid arbitrario.
--
-- Safe to run multiple times (create or replace + grants idempotentes).

begin;

create or replace function public.gto_aal2_ok_para(p_user_id uuid, p_aal text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_user_id is null then false
    when p_aal = 'aal2' then true
    else not exists (
      select 1
      from auth.mfa_factors
      where user_id = p_user_id
        and status = 'verified'
    )
  end;
$$;

comment on function public.gto_aal2_ok_para(uuid, text) is
  'Variante de gto_aal2_ok() parametrizada por usuario e pelo claim aal, para uso via '
  'supabase.rpc() a partir de clients de service_role (Edge Functions) - auth.jwt() nao '
  'resolve nesse contexto. Mesma logica/fonte de verdade (auth.mfa_factors), so muda de onde '
  'vem o usuario alvo e o aal.';

revoke all on function public.gto_aal2_ok_para(uuid, text) from public;
revoke all on function public.gto_aal2_ok_para(uuid, text) from authenticated;
grant execute on function public.gto_aal2_ok_para(uuid, text) to service_role;

commit;
