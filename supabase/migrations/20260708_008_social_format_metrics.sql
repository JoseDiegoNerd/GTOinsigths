-- GTO Insights - Social format metrics
-- Scope: granular Instagram and Facebook metrics by format.
-- Safe to run multiple times. It does not delete or mutate imported data.

begin;

create table if not exists public.stage_social_format_metrics (
  id uuid primary key default gen_random_uuid(),
  marca public.bandeira_marca not null,
  rede_social text not null check (rede_social in ('Instagram', 'Facebook')),
  formato text not null check (
    formato in (
      'instagram_reels',
      'instagram_stories',
      'instagram_feed',
      'facebook_reels',
      'facebook_feed',
      'facebook_stories'
    )
  ),
  objetivo text,
  tema text,
  data_referencia date not null default current_date,

  -- Instagram Reels
  total_visualizacoes integer not null default 0 check (total_visualizacoes >= 0),
  tempo_medio_visualizacao numeric(10,2) not null default 0 check (tempo_medio_visualizacao >= 0),
  taxa_rejeicao_inicial numeric(7,2) not null default 0 check (taxa_rejeicao_inicial >= 0 and taxa_rejeicao_inicial <= 100),
  percentual_assistido_final numeric(7,2) not null default 0 check (percentual_assistido_final >= 0 and percentual_assistido_final <= 100),
  alcance_seguidores_pct numeric(7,2) not null default 0 check (alcance_seguidores_pct >= 0 and alcance_seguidores_pct <= 100),
  alcance_nao_seguidores_pct numeric(7,2) not null default 0 check (alcance_nao_seguidores_pct >= 0 and alcance_nao_seguidores_pct <= 100),
  compartilhamentos integer not null default 0 check (compartilhamentos >= 0),
  salvamentos integer not null default 0 check (salvamentos >= 0),

  -- Instagram Stories
  media_visualizacoes_unicas_story integer not null default 0 check (media_visualizacoes_unicas_story >= 0),
  taxa_retencao_diaria numeric(7,2) not null default 0 check (taxa_retencao_diaria >= 0 and taxa_retencao_diaria <= 100),
  melhor_sticker_interacoes integer not null default 0 check (melhor_sticker_interacoes >= 0),
  melhor_sticker_tema text,
  respostas_dm integer not null default 0 check (respostas_dm >= 0),
  cliques_sticker_link integer not null default 0 check (cliques_sticker_link >= 0),

  -- Instagram Feed
  alcance_segunda_visualizacao integer not null default 0 check (alcance_segunda_visualizacao >= 0),
  comentarios_qualificados integer not null default 0 check (comentarios_qualificados >= 0),
  taxa_compartilhamento_feed numeric(7,2) not null default 0 check (taxa_compartilhamento_feed >= 0 and taxa_compartilhamento_feed <= 100),

  -- Facebook Reels
  visualizacoes_unicas_midia integer not null default 0 check (visualizacoes_unicas_midia >= 0),
  retencao_qualificada_5s numeric(7,2) not null default 0 check (retencao_qualificada_5s >= 0 and retencao_qualificada_5s <= 100),
  compartilhamentos_publicos_timeline integer not null default 0 check (compartilhamentos_publicos_timeline >= 0),

  -- Facebook Feed
  cliques_link integer not null default 0 check (cliques_link >= 0),
  cliques_ver_mais integer not null default 0 check (cliques_ver_mais >= 0),
  compartilhamentos_grupos integer not null default 0 check (compartilhamentos_grupos >= 0),
  tempo_resposta_comentarios_horas numeric(10,2) not null default 0 check (tempo_resposta_comentarios_horas >= 0),

  -- Facebook Stories
  visualizacoes_unicas integer not null default 0 check (visualizacoes_unicas >= 0),
  toques_avancar integer not null default 0 check (toques_avancar >= 0),
  toques_voltar integer not null default 0 check (toques_voltar >= 0),

  payload_bruto jsonb not null default '{}'::jsonb,
  origem_arquivo text,
  lote_importacao uuid default gen_random_uuid(),
  importado_por uuid default auth.uid() references auth.users(id) on delete set null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

comment on table public.stage_social_format_metrics is
  'Metricas granulares de Instagram e Facebook por formato de conteudo.';

create index if not exists stage_social_format_marca_data_idx
  on public.stage_social_format_metrics (marca, data_referencia desc);

create index if not exists stage_social_format_rede_formato_idx
  on public.stage_social_format_metrics (rede_social, formato);

drop trigger if exists trg_stage_social_format_set_atualizado_em
  on public.stage_social_format_metrics;
create trigger trg_stage_social_format_set_atualizado_em
before update on public.stage_social_format_metrics
for each row
execute function public.gto_set_atualizado_em();

drop trigger if exists trg_stage_social_format_auditoria
  on public.stage_social_format_metrics;
create trigger trg_stage_social_format_auditoria
after insert or update or delete on public.stage_social_format_metrics
for each row
execute function public.gto_registrar_auditoria();

alter table public.stage_social_format_metrics enable row level security;
alter table public.stage_social_format_metrics force row level security;

drop policy if exists "stage_social_format_select_por_marca"
  on public.stage_social_format_metrics;
drop policy if exists "stage_social_format_insert_por_marca"
  on public.stage_social_format_metrics;
drop policy if exists "stage_social_format_update_por_marca"
  on public.stage_social_format_metrics;
drop policy if exists "stage_social_format_delete_por_marca"
  on public.stage_social_format_metrics;

create policy "stage_social_format_select_por_marca"
on public.stage_social_format_metrics
for select
to authenticated
using (public.gto_tem_acesso_marca(marca));

create policy "stage_social_format_insert_por_marca"
on public.stage_social_format_metrics
for insert
to authenticated
with check (public.gto_tem_acesso_marca(marca));

create policy "stage_social_format_update_por_marca"
on public.stage_social_format_metrics
for update
to authenticated
using (public.gto_tem_acesso_marca(marca))
with check (public.gto_tem_acesso_marca(marca));

create policy "stage_social_format_delete_por_marca"
on public.stage_social_format_metrics
for delete
to authenticated
using (public.gto_tem_acesso_marca(marca));

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
  end as insight_social
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
  end as insight_social
from public.stage_social_format_metrics
where rede_social = 'Facebook'
group by marca, formato, objetivo, tema;

grant select, insert, update, delete on public.stage_social_format_metrics to authenticated;
revoke all on public.stage_social_format_metrics from anon;

grant select on
  public.vw_instagram_metricas_formato,
  public.vw_facebook_metricas_formato
to authenticated;

revoke all on
  public.vw_instagram_metricas_formato,
  public.vw_facebook_metricas_formato
from anon;

commit;
