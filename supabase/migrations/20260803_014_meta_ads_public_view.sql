-- GTO Insights - Public view for Meta Ads account review (hides access_token)
-- Safe to run multiple times.

begin;

create or replace view public.vw_integracao_meta_ads_contas_publica
with (security_invoker = true)
as
select
  id,
  marca,
  ad_account_id,
  ad_account_name,
  moeda,
  fuso_horario,
  token_type,
  token_expires_at,
  scopes,
  ativo,
  conta_confirmada,
  ignorada,
  observacao,
  ultima_sincronizacao_em,
  criado_em,
  atualizado_em
from public.integracao_meta_ads_contas;

grant select on public.vw_integracao_meta_ads_contas_publica to authenticated;
revoke all on public.vw_integracao_meta_ads_contas_publica from anon;

notify pgrst, 'reload schema';

commit;
