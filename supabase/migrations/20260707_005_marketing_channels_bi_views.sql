-- GTO Insights - Marketing channels BI views
-- Scope: RD Station, Meta Business and Google Business Profile dashboards.
-- Safe to run multiple times. It does not delete or mutate imported data.

begin;

create or replace view public.vw_rd_station_resumo
with (security_invoker = true)
as
select
  marca,
  count(*)::integer as total_campanhas,
  coalesce(sum(enviados), 0)::integer as total_enviados,
  coalesce(sum(entregues), 0)::integer as total_entregues,
  coalesce(avg(taxa_abertura), 0)::numeric(8,2) as taxa_abertura_media,
  coalesce(avg(taxa_clique), 0)::numeric(8,2) as taxa_clique_media,
  coalesce(sum(descadastros), 0)::integer as total_descadastros,
  max(data_referencia) as ultima_referencia
from public.stage_rd_station_marketing
group by marca;

create or replace view public.vw_meta_business_resumo
with (security_invoker = true)
as
select
  marca,
  coalesce(sum(seguidores_instagram), 0)::integer as seguidores_instagram,
  coalesce(sum(alcance_facebook), 0)::integer as alcance_facebook,
  coalesce(sum(engajamento_total), 0)::integer as engajamento_total,
  case
    when coalesce(sum(alcance_facebook), 0) = 0 then 0::numeric(8,2)
    else round((sum(engajamento_total)::numeric / sum(alcance_facebook)::numeric) * 100, 2)
  end as taxa_engajamento,
  max(data_referencia) as ultima_referencia
from public.stage_meta_business_analytics
group by marca;

create or replace view public.vw_google_business_resumo
with (security_invoker = true)
as
select
  marca,
  count(*)::integer as total_lojas,
  coalesce(avg(rating_medio), 0)::numeric(3,2) as rating_medio,
  count(*) filter (
    where coalesce(nullif(trim(status_resposta), ''), 'sem_status') !~* 'sem|pendente|nao|não'
  )::integer as lojas_com_resposta,
  count(*) filter (
    where coalesce(nullif(trim(status_resposta), ''), 'sem_status') ~* 'sem|pendente|nao|não'
  )::integer as lojas_pendentes,
  max(data_referencia) as ultima_referencia
from public.stage_google_business_profile
group by marca;

create or replace view public.vw_marketing_canais_por_marca
with (security_invoker = true)
as
select
  coalesce(rd.marca, meta.marca, google.marca) as marca,
  coalesce(rd.total_campanhas, 0)::integer as total_campanhas,
  coalesce(rd.total_enviados, 0)::integer as total_enviados,
  coalesce(rd.total_entregues, 0)::integer as total_entregues,
  coalesce(rd.taxa_abertura_media, 0)::numeric(8,2) as taxa_abertura_media,
  coalesce(rd.taxa_clique_media, 0)::numeric(8,2) as taxa_clique_media,
  coalesce(rd.total_descadastros, 0)::integer as total_descadastros,
  coalesce(meta.seguidores_instagram, 0)::integer as seguidores_instagram,
  coalesce(meta.alcance_facebook, 0)::integer as alcance_facebook,
  coalesce(meta.engajamento_total, 0)::integer as engajamento_total,
  coalesce(meta.taxa_engajamento, 0)::numeric(8,2) as taxa_engajamento,
  coalesce(google.total_lojas, 0)::integer as total_lojas_gmb,
  coalesce(google.rating_medio, 0)::numeric(3,2) as rating_medio_gmb,
  coalesce(google.lojas_com_resposta, 0)::integer as lojas_com_resposta,
  coalesce(google.lojas_pendentes, 0)::integer as lojas_pendentes
from public.vw_rd_station_resumo rd
full outer join public.vw_meta_business_resumo meta on meta.marca = rd.marca
full outer join public.vw_google_business_resumo google on google.marca = coalesce(rd.marca, meta.marca);

comment on view public.vw_rd_station_resumo is
  'Resumo RD Station por marca. Respeita RLS das tabelas base via security_invoker.';
comment on view public.vw_meta_business_resumo is
  'Resumo Meta Business por marca. Respeita RLS das tabelas base via security_invoker.';
comment on view public.vw_google_business_resumo is
  'Resumo Google Business Profile por marca. Respeita RLS das tabelas base via security_invoker.';
comment on view public.vw_marketing_canais_por_marca is
  'Visao integrada de email marketing, redes sociais e presenca local por marca.';

grant select on
  public.vw_rd_station_resumo,
  public.vw_meta_business_resumo,
  public.vw_google_business_resumo,
  public.vw_marketing_canais_por_marca
to authenticated;

revoke all on
  public.vw_rd_station_resumo,
  public.vw_meta_business_resumo,
  public.vw_google_business_resumo,
  public.vw_marketing_canais_por_marca
from anon;

commit;
