-- GTO Insights - Split daily Meta sync into one Edge Function call per integration
-- Scope: 20260802_014 and 20260806_018 scheduled ONE http_post per day that made
-- meta-sync-insights/meta-ads-sync loop over every confirmed brand inside a single
-- invocation. In production this hit the Edge Function platform's own execution time
-- limit partway through the second brand (observed: "Magazine da Economia" started
-- logging at 13:02:25 UTC on 2026-08-06 and never logged again - no error, no
-- completion, the invocation was killed outright), so every brand after the first
-- in the loop silently never synced. Both functions already accept an
-- `integracao_id` body param to scope the run to one row (see index.ts's
-- `if (body.integracao_id) query = query.eq("id", body.integracao_id)`), so instead
-- of asking each function to process every confirmed brand in one shot, the cron
-- jobs now loop in SQL and fire one independent net.http_post per confirmed
-- integration. A slow or failing brand can no longer starve the rest, and each
-- invocation finishes well inside the platform's execution limit.
-- cron.schedule upserts by job name, so this replaces the two single-call jobs.

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
    body := jsonb_build_object('integracao_id', integracao.id),
    timeout_milliseconds := 90000
  )
  from public.integracao_meta_contas integracao
  where integracao.ativo = true
    and integracao.conta_confirmada = true
    and integracao.ignorada = false;
  $$
);

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
    body := jsonb_build_object('integracao_id', integracao.id),
    timeout_milliseconds := 90000
  )
  from public.integracao_meta_ads_contas integracao
  where integracao.ativo = true
    and integracao.conta_confirmada = true
    and integracao.ignorada = false;
  $$
);

commit;
