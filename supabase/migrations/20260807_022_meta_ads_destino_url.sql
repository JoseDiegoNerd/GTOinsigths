-- GTO Insights - Meta Ads: destination URL per campaign
-- Adds a column to store the ad creative's destination URL (final landing page, e.g. Linktree,
-- Instagram profile or campaign URL), so the Anuncios screen can link straight to what the ad
-- promotes instead of just showing metrics. Populated by the meta-ads-sync edge function, which
-- resolves it from the ad creative's object_story_spec/asset_feed_spec, falling back to the
-- creative's Facebook post permalink when no explicit link is available.
-- Safe to run multiple times.

begin;

alter table public.stage_meta_ads_metrics
  add column if not exists destino_url text;

comment on column public.stage_meta_ads_metrics.destino_url is
  'URL de destino do criativo do anuncio (link final, ex.: Linktree/Instagram/site), quando disponivel via Marketing API.';

commit;
