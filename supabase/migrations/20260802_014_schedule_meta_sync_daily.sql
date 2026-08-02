-- GTO Insights - Schedule daily Meta sync for all brands
-- Scope: calls the meta-sync-insights Edge Function once a day for every confirmed Meta
-- account (Facebook + Instagram), across all brands, without needing an Admin/Gestor logged
-- into the UI. The Edge Function accepts a scheduled call when the x-cron-secret header
-- matches META_SYNC_CRON_SECRET (Edge Function secret) - the actual secret value lives only
-- in Supabase Vault (supabase_vault) and in the Edge Function secrets, never in this file or
-- in git history.
-- Runs at 09:00 UTC = 06:00 America/Sao_Paulo daily.
-- Safe to run multiple times (cron.schedule upserts by job name).

begin;

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'meta-sync-insights-daily',
  '0 9 * * *',
  $$
  select net.http_post(
    url := 'https://ysreenjwihmwzockyrls.supabase.co/functions/v1/meta-sync-insights',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'meta_sync_cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);

commit;
