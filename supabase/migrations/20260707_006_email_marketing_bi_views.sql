-- GTO Insights - Email Marketing BI views
-- Scope: RD Station campaigns and copy analysis.
-- Safe to run multiple times. It does not delete or mutate imported data.

begin;

create or replace view public.vw_email_marketing_campanhas
with (security_invoker = true)
as
select
  id,
  marca,
  id_campanha,
  nome_campanha,
  enviados,
  entregues,
  round((coalesce(entregues, 0)::numeric * coalesce(taxa_abertura, 0)::numeric / 100), 0)::integer as abertos_estimados,
  round((coalesce(entregues, 0)::numeric * coalesce(taxa_clique, 0)::numeric / 100), 0)::integer as cliques_estimados,
  coalesce(taxa_abertura, 0)::numeric(8,2) as taxa_abertura,
  coalesce(taxa_clique, 0)::numeric(8,2) as taxa_clique,
  descadastros,
  assunto_email,
  preheader,
  corpo_copy,
  case
    when coalesce(nullif(trim(assunto_email), ''), '') = ''
      and coalesce(nullif(trim(preheader), ''), '') = ''
      and coalesce(nullif(trim(corpo_copy), ''), '') = ''
      then 35
    else
      least(
        100,
        greatest(
          0,
          45
          + case
              when length(coalesce(assunto_email, '')) between 25 and 70 then 20
              when length(coalesce(assunto_email, '')) between 10 and 90 then 10
              else 0
            end
          + case when coalesce(nullif(trim(preheader), ''), '') <> '' then 15 else 0 end
          + case
              when coalesce(corpo_copy, '') ~* '(compre|confira|acesse|garanta|aproveite|clique|venha|saiba)' then 10
              else 0
            end
          + case when coalesce(taxa_abertura, 0) >= 20 then 5 else 0 end
          + case when coalesce(taxa_clique, 0) >= 2 then 5 else 0 end
        )
      )
  end::integer as score_copy,
  case
    when coalesce(nullif(trim(assunto_email), ''), '') = ''
      and coalesce(nullif(trim(preheader), ''), '') = ''
      and coalesce(nullif(trim(corpo_copy), ''), '') = ''
      then 'Copy nao informada'
    when length(coalesce(assunto_email, '')) not between 10 and 90
      then 'Revisar assunto'
    when coalesce(nullif(trim(preheader), ''), '') = ''
      then 'Adicionar preheader'
    when coalesce(corpo_copy, '') !~* '(compre|confira|acesse|garanta|aproveite|clique|venha|saiba)'
      then 'Fortalecer chamada para acao'
    when coalesce(taxa_abertura, 0) < 15
      then 'Melhorar gancho de abertura'
    when coalesce(taxa_clique, 0) < 1
      then 'Melhorar oferta e CTA'
    else 'Boa'
  end as diagnostico_copy,
  case
    when coalesce(nullif(trim(assunto_email), ''), '') = ''
      and coalesce(nullif(trim(preheader), ''), '') = ''
      and coalesce(nullif(trim(corpo_copy), ''), '') = ''
      then 'Importe assunto, preheader e corpo da campanha para uma analise melhor.'
    when length(coalesce(assunto_email, '')) not between 10 and 90
      then 'Use um assunto mais direto, com beneficio claro e tamanho equilibrado.'
    when coalesce(nullif(trim(preheader), ''), '') = ''
      then 'Inclua um preheader que complemente o assunto e antecipe a oferta.'
    when coalesce(corpo_copy, '') !~* '(compre|confira|acesse|garanta|aproveite|clique|venha|saiba)'
      then 'Inclua uma chamada para acao clara, com verbo de acao e proximo passo.'
    when coalesce(taxa_abertura, 0) < 15
      then 'Teste assuntos com mais urgencia, personalizacao ou promessa de valor.'
    when coalesce(taxa_clique, 0) < 1
      then 'Reforce a oferta principal e deixe o link/CTA mais evidente.'
    else 'Manter estrutura e testar variacoes para ganho incremental.'
  end as recomendacao_copy,
  data_referencia,
  origem_api,
  origem_api as origem_dado,
  criado_em,
  atualizado_em
from public.stage_rd_station_marketing;

create or replace view public.vw_email_marketing_resumo_marca
with (security_invoker = true)
as
select
  marca,
  count(*)::integer as total_campanhas,
  coalesce(sum(enviados), 0)::integer as total_enviados,
  coalesce(sum(entregues), 0)::integer as total_entregues,
  coalesce(sum(abertos_estimados), 0)::integer as total_abertos_estimados,
  coalesce(sum(cliques_estimados), 0)::integer as total_cliques_estimados,
  coalesce(avg(taxa_abertura), 0)::numeric(8,2) as taxa_abertura_media,
  coalesce(avg(taxa_clique), 0)::numeric(8,2) as taxa_clique_media,
  coalesce(avg(score_copy), 0)::numeric(8,2) as score_copy_medio,
  max(data_referencia) as ultima_referencia
from public.vw_email_marketing_campanhas
group by marca;

comment on view public.vw_email_marketing_campanhas is
  'Campanhas de email marketing com estimativas de abertura/clique e diagnostico de copy.';
comment on view public.vw_email_marketing_resumo_marca is
  'Resumo de email marketing por marca para dashboards.';

grant select on
  public.vw_email_marketing_campanhas,
  public.vw_email_marketing_resumo_marca
to authenticated;

revoke all on
  public.vw_email_marketing_campanhas,
  public.vw_email_marketing_resumo_marca
from anon;

commit;
