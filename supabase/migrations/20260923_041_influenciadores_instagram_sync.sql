-- GTO Insights - Sincronizacao automatica de perfil via Instagram Business Discovery.
-- Scope: 3 colunas novas em influenciadores (foto/seguidores continuam em avatar_path e
-- influenciador_seguidores_historico, ja existentes - aqui so o que faltava: total de posts e
-- status da ultima sincronizacao) + agendamento da rotina diaria.
--
-- publicacoes_total: media_count devolvido pela Business Discovery.
-- instagram_sincronizado_em: quando a ultima sincronizacao deu certo (null = nunca sincronizou).
-- instagram_sync_erro: mensagem do ultimo erro; null quando a ultima tentativa deu certo.
--
-- Safe to run multiple times.

begin;

alter table public.influenciadores
  add column if not exists publicacoes_total bigint,
  add column if not exists instagram_sincronizado_em timestamptz,
  add column if not exists instagram_sync_erro text;

alter table public.influenciadores
  drop constraint if exists influenciadores_publicacoes_total_chk;
alter table public.influenciadores
  add constraint influenciadores_publicacoes_total_chk check (publicacoes_total is null or publicacoes_total >= 0);

comment on column public.influenciadores.publicacoes_total is 'Total de posts do perfil (media_count da Business Discovery). Null se nunca sincronizado.';
comment on column public.influenciadores.instagram_sincronizado_em is 'Timestamp da ultima sincronizacao com sucesso via influenciador-instagram-sync.';
comment on column public.influenciadores.instagram_sync_erro is 'Mensagem do ultimo erro de sincronizacao (null quando a ultima tentativa deu certo).';

-- Rotina diaria: chama a Edge Function em modo lote (sem influenciador_id no corpo), autenticada
-- pelo segredo em x-cron-secret. O valor do segredo NUNCA fica neste arquivo nem em git - precisa
-- ser inserido manualmente no Vault (supabase_vault) com o nome exato abaixo, e o mesmo valor
-- configurado como Edge Function secret (INSTAGRAM_SYNC_CRON_SECRET). Ver Task 5 do plano de
-- implementacao para o passo a passo exato.
-- Roda as 10:00 UTC = 07:00 America/Sao_Paulo diariamente (1h depois do sync de Meta da marca,
-- para nao competir por rate limit do mesmo App Meta no mesmo minuto).
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

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
    body := '{}'::jsonb
  );
  $$
);

commit;
