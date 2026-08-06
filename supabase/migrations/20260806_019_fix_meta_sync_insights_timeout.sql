-- GTO Insights - Fix meta-sync-insights-daily cron timeout
-- Scope: the original job (20260802_014) called net.http_post without a timeout_milliseconds
-- override, so it used pg_net's 5000ms default. The meta-sync-insights Edge Function loops over
-- every confirmed brand's Facebook/Instagram integrations and routinely takes longer than 5s to
-- finish, so the daily run was timing out client-side (visible in net._http_response.error_msg)
-- while the function kept running server-side to completion - explaining why some brands'
-- "ultima_sincronizacao_em" updated and others didn't, depending on processing order.
-- cron.schedule upserts by job name, so re-running it here updates the existing job in place.

begin;

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
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);

commit;
