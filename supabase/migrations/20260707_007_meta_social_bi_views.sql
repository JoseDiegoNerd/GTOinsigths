-- GTO Insights - Meta Social BI views
-- Scope: Instagram/Facebook social performance and content recommendations.
-- Safe to run multiple times. It does not delete or mutate imported data.

begin;

create or replace view public.vw_meta_social_periodos
with (security_invoker = true)
as
select
  id,
  marca,
  data_referencia,
  seguidores_instagram,
  alcance_facebook,
  engajamento_total,
  case
    when coalesce(alcance_facebook, 0) = 0 then 0::numeric(8,2)
    else round((engajamento_total::numeric / alcance_facebook::numeric) * 100, 2)
  end as taxa_engajamento,
  post_destaque_semana_url,
  case
    when coalesce(alcance_facebook, 0) >= 50000
      and coalesce(engajamento_total, 0) >= 4000 then 'Forte'
    when coalesce(alcance_facebook, 0) >= 15000
      and coalesce(engajamento_total, 0) >= 1000 then 'Saudavel'
    when coalesce(alcance_facebook, 0) = 0
      and coalesce(engajamento_total, 0) = 0 then 'Sem dados'
    else 'Atencao'
  end as diagnostico_conteudo,
  case
    when coalesce(alcance_facebook, 0) >= 50000
      and coalesce(engajamento_total, 0) >= 4000
      then 'Manter formato do destaque e testar variacoes por marca.'
    when coalesce(alcance_facebook, 0) >= 15000
      and coalesce(engajamento_total, 0) >= 1000
      then 'Reforcar CTA e replicar tema em novos criativos.'
    when post_destaque_semana_url is null
      then 'Importar URL do post destaque para facilitar leitura editorial.'
    else 'Revisar gancho, formato do criativo e chamada para interacao.'
  end as recomendacao_conteudo,
  payload_bruto,
  origem_api,
  criado_em,
  atualizado_em
from public.stage_meta_business_analytics;

create or replace view public.vw_meta_social_resumo_marca
with (security_invoker = true)
as
select
  marca,
  count(*)::integer as total_periodos,
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

create or replace view public.vw_meta_social_ranking_conteudo
with (security_invoker = true)
as
select
  marca,
  data_referencia,
  post_destaque_semana_url,
  alcance_facebook,
  engajamento_total,
  taxa_engajamento,
  diagnostico_conteudo,
  recomendacao_conteudo,
  dense_rank() over (
    partition by marca
    order by engajamento_total desc, alcance_facebook desc, data_referencia desc
  )::integer as ranking_marca
from public.vw_meta_social_periodos;

comment on view public.vw_meta_social_periodos is
  'Periodos importados do Meta Business com diagnostico e recomendacao de conteudo.';
comment on view public.vw_meta_social_resumo_marca is
  'Resumo de redes sociais por marca.';
comment on view public.vw_meta_social_ranking_conteudo is
  'Ranking de conteudos/periodos por engajamento e alcance.';

grant select on
  public.vw_meta_social_periodos,
  public.vw_meta_social_resumo_marca,
  public.vw_meta_social_ranking_conteudo
to authenticated;

revoke all on
  public.vw_meta_social_periodos,
  public.vw_meta_social_resumo_marca,
  public.vw_meta_social_ranking_conteudo
from anon;

commit;
