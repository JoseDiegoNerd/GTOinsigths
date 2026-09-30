-- GTO Insights - Aumenta o timeout do cron diario de sincronizacao com Instagram.
-- Scope: a Edge Function ficou mais lenta apos passar a buscar tambem a lista de posts recentes
-- do perfil (para curtidas/comentarios automaticos - ver migration da feature de automacao das
-- midias). O net.http_post do job agendado usava o timeout padrao do pg_net (5000ms), que passou
-- a estourar antes da funcao terminar - confirmado em teste manual (Postgres desiste de esperar,
-- mas a funcao continua rodando do lado do Supabase e ainda termina com sucesso; so a resposta
-- nunca chega de volta pro cron, entao o resultado real da rotina fica sem confirmacao).
--
-- Reagenda o mesmo job (cron.schedule upserta por nome) com timeout_milliseconds := 30000 (30s),
-- folga confortavel pro tamanho atual do lote.
--
-- Safe to run multiple times.

begin;

select cron.schedule(
  'influenciador-instagram-sync-daily',
  '0 10 * * *',
  $$
  select net.http_post(
    url := 'https://ysreenjwihmwzockyrls.supabase.co/functions/v1/influenciador-instagram-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'influenciador_instagram_sync_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);

commit;
