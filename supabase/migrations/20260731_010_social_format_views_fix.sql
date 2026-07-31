-- GTO Insights - Fix social format views
-- Scope: vw_instagram_metricas_formato and vw_facebook_metricas_formato were never updated
-- after migration 20260709_009_meta_business_integration.sql added conta_nome, post_id,
-- post_url, data_publicacao, alcance and engajamento to stage_social_format_metrics.
-- The views kept grouping by marca/formato/objetivo/tema without selecting those columns,
-- so the frontend always rendered them as "-" (undefined), even after real Meta data landed.
-- Safe to run multiple times.

begin;

create or replace view public.vw_instagram_metricas_formato
with (security_invoker = true)
as
select
  marca,
  formato,
  objetivo,
  tema,
  count(*)::integer as total_registros,
  coalesce(sum(total_visualizacoes), 0)::integer as total_visualizacoes,
  coalesce(avg(tempo_medio_visualizacao), 0)::numeric(10,2) as tempo_medio_visualizacao,
  coalesce(avg(taxa_rejeicao_inicial), 0)::numeric(7,2) as taxa_rejeicao_inicial,
  coalesce(avg(percentual_assistido_final), 0)::numeric(7,2) as percentual_assistido_final,
  coalesce(avg(alcance_seguidores_pct), 0)::numeric(7,2) as alcance_seguidores_pct,
  coalesce(avg(alcance_nao_seguidores_pct), 0)::numeric(7,2) as alcance_nao_seguidores_pct,
  coalesce(sum(compartilhamentos), 0)::integer as compartilhamentos,
  coalesce(sum(salvamentos), 0)::integer as salvamentos,
  coalesce(avg(media_visualizacoes_unicas_story), 0)::numeric(10,2) as media_visualizacoes_unicas_story,
  coalesce(avg(taxa_retencao_diaria), 0)::numeric(7,2) as taxa_retencao_diaria,
  coalesce(sum(melhor_sticker_interacoes), 0)::integer as melhor_sticker_interacoes,
  max(melhor_sticker_tema) as melhor_sticker_tema,
  coalesce(sum(respostas_dm), 0)::integer as respostas_dm,
  coalesce(sum(cliques_sticker_link), 0)::integer as cliques_sticker_link,
  coalesce(sum(alcance_segunda_visualizacao), 0)::integer as alcance_segunda_visualizacao,
  coalesce(sum(comentarios_qualificados), 0)::integer as comentarios_qualificados,
  coalesce(avg(taxa_compartilhamento_feed), 0)::numeric(7,2) as taxa_compartilhamento_feed,
  max(data_referencia) as ultima_referencia,
  case
    when formato = 'instagram_reels' and coalesce(avg(taxa_rejeicao_inicial), 0) < 30
      and coalesce(avg(alcance_nao_seguidores_pct), 0) >= 60 then 'Reels com bom potencial de descoberta.'
    when formato = 'instagram_stories' and coalesce(avg(taxa_retencao_diaria), 0) >= 60
      then 'Stories com relacionamento sustentado.'
    when formato = 'instagram_feed' and coalesce(sum(salvamentos), 0) > 0
      then 'Feed com sinais de autoridade e consideracao.'
    else 'Ajustar gancho, retencao ou chamada de interacao.'
  end as insight_social,
  max(conta_nome) as conta_nome,
  max(post_id) as post_id,
  max(post_url) as post_url,
  max(data_publicacao) as data_publicacao,
  coalesce(sum(alcance), 0)::integer as alcance,
  coalesce(sum(engajamento), 0)::integer as engajamento
from public.stage_social_format_metrics
where rede_social = 'Instagram'
group by marca, formato, objetivo, tema;

create or replace view public.vw_facebook_metricas_formato
with (security_invoker = true)
as
select
  marca,
  formato,
  objetivo,
  tema,
  count(*)::integer as total_registros,
  coalesce(sum(visualizacoes_unicas_midia), 0)::integer as visualizacoes_unicas_midia,
  coalesce(avg(retencao_qualificada_5s), 0)::numeric(7,2) as retencao_qualificada_5s,
  coalesce(sum(compartilhamentos_publicos_timeline), 0)::integer as compartilhamentos_publicos_timeline,
  coalesce(sum(cliques_link), 0)::integer as cliques_link,
  coalesce(sum(cliques_ver_mais), 0)::integer as cliques_ver_mais,
  coalesce(sum(compartilhamentos_grupos), 0)::integer as compartilhamentos_grupos,
  coalesce(avg(tempo_resposta_comentarios_horas), 0)::numeric(10,2) as tempo_resposta_comentarios_horas,
  coalesce(sum(visualizacoes_unicas), 0)::integer as visualizacoes_unicas,
  coalesce(sum(toques_avancar), 0)::integer as toques_avancar,
  coalesce(sum(toques_voltar), 0)::integer as toques_voltar,
  max(data_referencia) as ultima_referencia,
  case
    when formato = 'facebook_reels' and coalesce(avg(retencao_qualificada_5s), 0) >= 50
      then 'Reels com distribuicao aberta saudavel.'
    when formato = 'facebook_feed' and coalesce(sum(cliques_link), 0) > 0
      then 'Feed contribuindo para trafego externo.'
    when formato = 'facebook_stories' and coalesce(sum(visualizacoes_unicas), 0) > 0
      then 'Stories sustentando lembranca de marca.'
    else 'Revisar distribuicao, trafego ou resposta da comunidade.'
  end as insight_social,
  max(conta_nome) as conta_nome,
  max(post_id) as post_id,
  max(post_url) as post_url,
  max(data_publicacao) as data_publicacao,
  coalesce(sum(alcance), 0)::integer as alcance,
  coalesce(sum(engajamento), 0)::integer as engajamento
from public.stage_social_format_metrics
where rede_social = 'Facebook'
group by marca, formato, objetivo, tema;

grant select on
  public.vw_instagram_metricas_formato,
  public.vw_facebook_metricas_formato
to authenticated;

revoke all on
  public.vw_instagram_metricas_formato,
  public.vw_facebook_metricas_formato
from anon;

commit;
