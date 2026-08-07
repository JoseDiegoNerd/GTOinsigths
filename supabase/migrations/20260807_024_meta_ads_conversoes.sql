-- GTO Insights - Meta Ads: conversoes (fundo de funil)
-- Soma das "actions" do Marketing API que representam uma conversao/lead (formulario de lead,
-- conversa de WhatsApp/Messenger iniciada, compra, cadastro completo) - permite calcular CPA
-- (Investimento / Conversoes) e Taxa de Conversao do Clique (Conversoes / Cliques) na tela de
-- Anuncios. Populado pelo meta-ads-sync.
-- Safe to run multiple times.

begin;

alter table public.stage_meta_ads_metrics
  add column if not exists conversoes integer not null default 0 check (conversoes >= 0);

comment on column public.stage_meta_ads_metrics.conversoes is
  'Soma das actions do Marketing API classificadas como conversao/lead (formulario, WhatsApp, compra, cadastro).';

commit;
