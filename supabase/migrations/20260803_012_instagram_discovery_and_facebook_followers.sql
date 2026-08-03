-- GTO Insights - Instagram discovery metrics and Facebook followers
-- Scope: adds profile_visits/follows per Instagram post (measures when a specific post drives a
-- profile visit or a new follow - the "descoberta" objective the app already labels Reels with,
-- but never measured) and a Facebook follower count to pair with the existing Instagram one.
-- Safe to run multiple times.

begin;

alter table public.stage_social_format_metrics
  add column if not exists visitas_perfil integer not null default 0 check (visitas_perfil >= 0),
  add column if not exists seguidores_conquistados integer not null default 0 check (seguidores_conquistados >= 0);

alter table public.stage_meta_business_analytics
  add column if not exists seguidores_facebook integer not null default 0 check (seguidores_facebook >= 0);

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
  coalesce(sum(engajamento), 0)::integer as engajamento,
  coalesce(sum(visitas_perfil), 0)::integer as visitas_perfil,
  coalesce(sum(seguidores_conquistados), 0)::integer as seguidores_conquistados
from public.stage_social_format_metrics
where rede_social = 'Instagram'
group by marca, formato, objetivo, tema;

grant select on public.vw_instagram_metricas_formato to authenticated;
revoke all on public.vw_instagram_metricas_formato from anon;

commit;
