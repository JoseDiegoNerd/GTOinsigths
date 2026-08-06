-- GTO Insights - Schedule daily Meta Ads sync for all brands
-- Scope: calls the meta-ads-sync Edge Function once a day for every confirmed Meta Ads
-- account, across all brands, without needing an Admin/Gestor logged into the UI.
-- Mirrors 20260802_014_schedule_meta_sync_daily.sql, which only scheduled page/Instagram
-- insights sync (meta-sync-insights) and left ad account sync (meta-ads-sync) manual-only.
-- The Edge Function accepts a scheduled call when the x-cron-secret header matches
-- META_SYNC_CRON_SECRET (Edge Function secret) - the actual secret value lives only in
-- Supabase Vault (supabase_vault) and in the Edge Function secrets, never in this file or
-- in git history.
-- Runs at 09:15 UTC = 06:15 America/Sao_Paulo daily (offset from the insights sync at 09:00
-- so the two jobs don't compete for the same accounts/rate limits at the same instant).
-- Safe to run multiple times (cron.schedule upserts by job name).

begin;

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'meta-ads-sync-daily',
  '15 9 * * *',
  $$
  select net.http_post(
    url := 'https://ysreenjwihmwzockyrls.supabase.co/functions/v1/meta-ads-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'meta_sync_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);

commit;
