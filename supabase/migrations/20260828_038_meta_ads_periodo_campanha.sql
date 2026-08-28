-- GTO Insights - Meta Ads: periodo real da campanha (start_time / stop_time)
-- Guarda o inicio e o termino programado de cada campanha vindos da Marketing API
-- (/{ad_account_id}/campaigns?fields=id,effective_status,start_time,stop_time), para:
--   1) a tela de Anuncios exibir "Data de Inicio" e "Data de Termino" ("Continuo" quando nao ha stop_time);
--   2) o filtro "Ativas" so contar campanha com effective_status = ACTIVE E a data de hoje dentro de
--      [campanha_inicio, campanha_fim] (quando ha data de termino) E com entrega (impressoes/gasto) na
--      janela de data selecionada;
--   3) o meta-ads-sync restampar status/periodo das linhas historicas a cada rodada, evitando que uma
--      campanha encerrada fique congelada como "Ativa" no banco (dado obsoleto).
-- Populado pelo meta-ads-sync. Safe to run multiple times.

begin;

alter table public.stage_meta_ads_metrics
  add column if not exists campanha_inicio timestamptz,
  add column if not exists campanha_fim timestamptz,
  add column if not exists campanha_status_atualizado_em timestamptz;

comment on column public.stage_meta_ads_metrics.campanha_inicio is
  'start_time da campanha na Marketing API (inicio real da veiculacao).';
comment on column public.stage_meta_ads_metrics.campanha_fim is
  'stop_time da campanha na Marketing API (termino programado). NULL = veiculacao continua, sem data limite.';
comment on column public.stage_meta_ads_metrics.campanha_status_atualizado_em is
  'Quando o meta-ads-sync verificou effective_status/periodo desta campanha pela ultima vez - ajuda a detectar dado obsoleto.';

notify pgrst, 'reload schema';

commit;
