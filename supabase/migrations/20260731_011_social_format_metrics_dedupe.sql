-- GTO Insights - Dedupe stage_social_format_metrics and enforce uniqueness
-- Scope: meta-sync-insights used delete+insert (not atomic) to replace a post's metric row,
-- which let near-simultaneous syncs create duplicate rows for the same post. Also removes a
-- stale page-summary row synced before the reach-metric fix, whose metric pairing
-- (page_views_total vs page_post_engagements) produced an impossible engagement rate.
-- Safe to run multiple times.

begin;

-- Keep only the most recent row per (marca, rede_social, conta_id, post_id).
delete from public.stage_social_format_metrics a
using public.stage_social_format_metrics b
where a.marca = b.marca
  and a.rede_social = b.rede_social
  and a.conta_id = b.conta_id
  and a.post_id = b.post_id
  and a.criado_em < b.criado_em;

-- Stale pre-fix page-summary snapshot with an internally inconsistent metric pairing.
delete from public.stage_social_format_metrics
where post_id = 'page-summary:101032432938105:2026-07-29';

alter table public.stage_social_format_metrics
  drop constraint if exists stage_social_format_metrics_meta_post_uk;

alter table public.stage_social_format_metrics
  add constraint stage_social_format_metrics_meta_post_uk
  unique (marca, rede_social, conta_id, post_id);

commit;
