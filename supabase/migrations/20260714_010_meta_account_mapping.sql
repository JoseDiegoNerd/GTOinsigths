-- GTO Insights - Meta account mapping controls
-- Safe to run multiple times. Does not drop tables or delete data.

begin;

alter table public.integracao_meta_contas
  add column if not exists conta_confirmada boolean not null default false,
  add column if not exists ignorada boolean not null default false,
  add column if not exists observacao text;

comment on column public.integracao_meta_contas.conta_confirmada is
  'Indica que a pagina/perfil Meta foi revisado e confirmado como pertencente a marca no GTO Insights.';

comment on column public.integracao_meta_contas.ignorada is
  'Indica que a pagina/perfil Meta foi revisado e nao deve entrar em sincronizacoes ou dashboards.';

comment on column public.integracao_meta_contas.observacao is
  'Observacao operacional sobre o mapeamento da conta Meta com a marca.';

create index if not exists integracao_meta_contas_mapeamento_idx
  on public.integracao_meta_contas (marca, conta_confirmada, ignorada, ativo);

create or replace view public.vw_integracao_meta_contas_publica
with (security_invoker = true)
as
select
  id,
  marca,
  meta_business_id,
  page_id,
  page_name,
  instagram_business_account_id,
  instagram_username,
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
from public.integracao_meta_contas;

grant select on public.vw_integracao_meta_contas_publica to authenticated;
revoke all on public.vw_integracao_meta_contas_publica from anon;

notify pgrst, 'reload schema';

commit;
