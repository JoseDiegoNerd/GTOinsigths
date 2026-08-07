-- GTO Insights - Meta Ads: thumbnail e formato do criativo por campanha
-- Complementa destino_url (20260807_022): agora tambem guarda uma miniatura e o formato do
-- criativo (Imagem/Video/Carrossel) do anuncio mais representativo da campanha, pra tabela de
-- Campanhas mostrar uma thumbnail em vez de so texto. Populado pelo meta-ads-sync.
-- Safe to run multiple times.

begin;

alter table public.stage_meta_ads_metrics
  add column if not exists criativo_thumbnail_url text,
  add column if not exists criativo_formato text;

comment on column public.stage_meta_ads_metrics.criativo_thumbnail_url is
  'URL da miniatura (thumbnail) do criativo do anuncio, quando disponivel via Marketing API.';
comment on column public.stage_meta_ads_metrics.criativo_formato is
  'Formato do criativo do anuncio: Imagem, Vídeo ou Carrossel.';

commit;
