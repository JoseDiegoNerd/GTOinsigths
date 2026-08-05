begin;

-- stage_meta_ads_metrics passa a guardar uma linha por campanha por dia
-- (em vez de sobrescrever o acumulado rolante dos ultimos 30 dias a cada
-- sincronizacao), permitindo comparar periodos passados de trafego pago.
alter table public.stage_meta_ads_metrics
  drop constraint if exists stage_meta_ads_marca_conta_campanha_uk;

alter table public.stage_meta_ads_metrics
  add constraint stage_meta_ads_marca_conta_campanha_data_uk
  unique (marca, ad_account_id, campaign_id, data_referencia);

comment on table public.stage_meta_ads_metrics is
  'Metricas diarias de campanhas do Meta Ads (Marketing API): uma linha por campanha por dia, sincronizada via time_increment=1.';

commit;
