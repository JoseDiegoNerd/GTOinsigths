-- GTO Insights - Metricas reais de e-mail marketing (aberturas/cliques unicos, CTR, CTOR, bounces)
-- Scope: da suporte ao novo wizard de importacao (Etapa 4 "Preview & Confirmacao" extrai esses
-- campos do CSV/XLSX da RD Station) e a nova tela de E-mail Marketing, que passa a exibir numeros
-- reais em vez de estimativa (entregues * taxa_abertura / 100) sempre que disponiveis.
--
-- aberturas_unicas/cliques_unicos/bounces ficam NULLABLE de proposito: campanhas importadas antes
-- desta migration nao tem como saber esses numeros retroativamente. NULL = "nao rastreado nesta
-- importacao", 0 = "rastreado, deu zero" - usar not null default 0 faria uma campanha antiga
-- mostrar "0 aberturas / CTR 0%" (numero errado), em vez de "sem dado" (o estado real).
--
-- ctr/ctor sao generated columns (nunca escritas pelo importador, sempre consistentes com os
-- numeros brutos) - propagam NULL automaticamente quando cliques_unicos/aberturas_unicas sao NULL
-- (linha antiga), e tem guarda contra divisao por zero quando o denominador e 0.
--
-- data_referencia (date) e a unique constraint (marca, id_campanha, data_referencia) NAO mudam -
-- enviado_em e um campo novo e independente so pra exibir a hora exata do envio, sem afetar a
-- chave de deduplicacao existente nem qualquer outra tabela stage_* que ja filtra por
-- data_referencia como date em todo o app.
--
-- taxa_abertura/taxa_clique (colunas antigas) tambem NAO mudam - continuam preenchidas pelo
-- importador como sempre. Converte-las em generated columns exigiria recriar a coluna e zeraria o
-- historico de todas as campanhas ja importadas (que nao tem aberturas_unicas/cliques_unicos pra
-- recalcular a partir delas).

begin;

alter table public.stage_rd_station_marketing
  add column if not exists aberturas_unicas integer,
  add column if not exists cliques_unicos integer,
  add column if not exists bounces integer,
  add column if not exists enviado_em timestamptz;

alter table public.stage_rd_station_marketing
  drop constraint if exists stage_rd_aberturas_unicas_chk;
alter table public.stage_rd_station_marketing
  add constraint stage_rd_aberturas_unicas_chk
  check (aberturas_unicas is null or (aberturas_unicas >= 0 and aberturas_unicas <= entregues));

alter table public.stage_rd_station_marketing
  drop constraint if exists stage_rd_cliques_unicos_chk;
alter table public.stage_rd_station_marketing
  add constraint stage_rd_cliques_unicos_chk
  check (cliques_unicos is null or cliques_unicos >= 0);

alter table public.stage_rd_station_marketing
  drop constraint if exists stage_rd_bounces_chk;
alter table public.stage_rd_station_marketing
  add constraint stage_rd_bounces_chk
  check (bounces is null or (bounces >= 0 and bounces <= enviados));

alter table public.stage_rd_station_marketing
  add column if not exists ctr numeric(7, 4)
  generated always as (
    case
      when cliques_unicos is not null and entregues > 0
        then round((cliques_unicos::numeric / entregues) * 100, 4)
      else null
    end
  ) stored;

alter table public.stage_rd_station_marketing
  add column if not exists ctor numeric(7, 4)
  generated always as (
    case
      when cliques_unicos is not null and aberturas_unicas is not null and aberturas_unicas > 0
        then round((cliques_unicos::numeric / aberturas_unicas) * 100, 4)
      else null
    end
  ) stored;

comment on column public.stage_rd_station_marketing.aberturas_unicas is 'Aberturas unicas reais da campanha (NULL = nao informado nesta importacao, cai pra estimativa via taxa_abertura).';
comment on column public.stage_rd_station_marketing.cliques_unicos is 'Cliques unicos reais da campanha (NULL = nao informado nesta importacao, cai pra estimativa via taxa_clique).';
comment on column public.stage_rd_station_marketing.bounces is 'Emails que retornaram (hard+soft bounce) reportados pela origem, conforme vier no arquivo.';
comment on column public.stage_rd_station_marketing.enviado_em is 'Data/hora exata do envio, quando disponivel na origem. data_referencia continua sendo so a data, usada na chave de deduplicacao.';
comment on column public.stage_rd_station_marketing.ctr is 'Click-Through Rate = cliques_unicos / entregues * 100. Generated column - sempre consistente com os numeros brutos.';
comment on column public.stage_rd_station_marketing.ctor is 'Click-To-Open Rate = cliques_unicos / aberturas_unicas * 100. Generated column - sempre consistente com os numeros brutos.';

-- View de campanhas: expoe os novos campos e passa a preferir o numero real (quando existir) no
-- lugar da estimativa para abertos_estimados/cliques_estimados - nomes mantidos por
-- compatibilidade com o JS que ja le esses campos hoje. score_copy/diagnostico_copy/
-- recomendacao_copy (Analisador de IA) ficam identicos ao que ja estavam na migration
-- 20260707_006 - nao fazem parte deste escopo.
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
  coalesce(
    aberturas_unicas,
    round((coalesce(entregues, 0)::numeric * coalesce(taxa_abertura, 0)::numeric / 100), 0)::integer
  ) as abertos_estimados,
  coalesce(
    cliques_unicos,
    round((coalesce(entregues, 0)::numeric * coalesce(taxa_clique, 0)::numeric / 100), 0)::integer
  ) as cliques_estimados,
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
  atualizado_em,
  aberturas_unicas,
  cliques_unicos,
  bounces,
  ctr,
  ctor,
  enviado_em
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
  max(data_referencia) as ultima_referencia,
  coalesce(sum(aberturas_unicas), 0)::integer as total_aberturas_unicas,
  coalesce(sum(cliques_unicos), 0)::integer as total_cliques_unicos,
  coalesce(sum(bounces), 0)::integer as total_bounces,
  coalesce(avg(ctr), 0)::numeric(8,2) as ctr_medio,
  coalesce(avg(ctor), 0)::numeric(8,2) as ctor_medio
from public.vw_email_marketing_campanhas
group by marca;

comment on view public.vw_email_marketing_campanhas is
  'Campanhas de email marketing com numeros reais de aberturas/cliques quando disponiveis (fallback pra estimativa em campanhas antigas) e diagnostico de copy.';
comment on view public.vw_email_marketing_resumo_marca is
  'Resumo de email marketing por marca para dashboards, incluindo CTR/CTOR medios e bounces.';

grant select on
  public.vw_email_marketing_campanhas,
  public.vw_email_marketing_resumo_marca
to authenticated;

revoke all on
  public.vw_email_marketing_campanhas,
  public.vw_email_marketing_resumo_marca
from anon;

commit;
