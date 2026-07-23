-- GTO Insights - CredSystem BI views
-- Scope: read-only analytical layer for dashboards.
-- Safe to run multiple times. It does not delete or mutate imported data.

begin;

create or replace view public.vw_credsystem_resumo_geral
with (security_invoker = true)
as
with emissoes as (
  select
    marca,
    count(*)::integer as total_cartoes,
    count(*) filter (where data_ativacao is not null)::integer as cartoes_ativados,
    coalesce(avg(valor_compra_inicial), 0)::numeric(14,2) as ticket_medio,
    coalesce(avg(frequencia_recorrencia), 0)::numeric(14,2) as recorrencia_media
  from public.dados_cartoes_credsystem
  group by marca
),
propostas as (
  select
    marca,
    count(*)::integer as total_propostas,
    coalesce(sum(proposta_aprov), 0)::integer as propostas_aprovadas,
    coalesce(sum(proposta_rejei), 0)::integer as propostas_rejeitadas
  from public.stage_credsystem_propostas
  group by marca
)
select
  coalesce(e.marca, p.marca) as marca,
  coalesce(e.total_cartoes, 0)::integer as total_cartoes,
  coalesce(e.cartoes_ativados, 0)::integer as cartoes_ativados,
  coalesce(e.ticket_medio, 0)::numeric(14,2) as ticket_medio,
  coalesce(e.recorrencia_media, 0)::numeric(14,2) as recorrencia_media,
  coalesce(p.total_propostas, 0)::integer as total_propostas,
  coalesce(p.propostas_aprovadas, 0)::integer as propostas_aprovadas,
  coalesce(p.propostas_rejeitadas, 0)::integer as propostas_rejeitadas,
  case
    when coalesce(p.total_propostas, 0) = 0 then 0::numeric(8,2)
    else round((coalesce(p.propostas_aprovadas, 0)::numeric / p.total_propostas::numeric) * 100, 2)
  end as taxa_aprovacao
from emissoes e
full outer join propostas p on p.marca = e.marca;

create or replace view public.vw_credsystem_por_marca
with (security_invoker = true)
as
select
  marca,
  total_cartoes,
  cartoes_ativados,
  ticket_medio,
  recorrencia_media,
  total_propostas,
  propostas_aprovadas,
  propostas_rejeitadas,
  taxa_aprovacao
from public.vw_credsystem_resumo_geral;

create or replace view public.vw_credsystem_por_loja
with (security_invoker = true)
as
with emissoes as (
  select
    marca,
    nullif(trim(loja_operacao), '') as loja,
    count(*)::integer as total_cartoes,
    count(*) filter (where data_ativacao is not null)::integer as cartoes_ativados
  from public.dados_cartoes_credsystem
  group by marca, nullif(trim(loja_operacao), '')
),
propostas as (
  select
    marca,
    coalesce(nullif(trim(nm_loja), ''), nullif(trim(cd_loja_cs), ''), 'Nao informado') as loja,
    count(*)::integer as total_propostas,
    coalesce(sum(proposta_aprov), 0)::integer as propostas_aprovadas,
    coalesce(sum(proposta_rejei), 0)::integer as propostas_rejeitadas
  from public.stage_credsystem_propostas
  group by marca, coalesce(nullif(trim(nm_loja), ''), nullif(trim(cd_loja_cs), ''), 'Nao informado')
)
select
  coalesce(e.marca, p.marca) as marca,
  coalesce(e.loja, p.loja, 'Nao informado') as loja,
  coalesce(e.total_cartoes, 0)::integer as total_cartoes,
  coalesce(e.cartoes_ativados, 0)::integer as cartoes_ativados,
  coalesce(p.total_propostas, 0)::integer as total_propostas,
  coalesce(p.propostas_aprovadas, 0)::integer as propostas_aprovadas,
  coalesce(p.propostas_rejeitadas, 0)::integer as propostas_rejeitadas,
  case
    when coalesce(p.total_propostas, 0) = 0 then 0::numeric(8,2)
    else round((coalesce(p.propostas_aprovadas, 0)::numeric / p.total_propostas::numeric) * 100, 2)
  end as taxa_aprovacao
from emissoes e
full outer join propostas p
  on p.marca = e.marca
 and p.loja = e.loja;

create or replace view public.vw_credsystem_motivos_rejeicao
with (security_invoker = true)
as
with base as (
  select
    marca,
    coalesce(nullif(trim(motivo), ''), 'SEM MOTIVO') as motivo,
    count(*)::integer as total,
    coalesce(sum(proposta_aprov), 0)::integer as propostas_aprovadas,
    coalesce(sum(proposta_rejei), 0)::integer as propostas_rejeitadas
  from public.stage_credsystem_propostas
  group by marca, coalesce(nullif(trim(motivo), ''), 'SEM MOTIVO')
)
select
  marca,
  motivo,
  total,
  propostas_aprovadas,
  propostas_rejeitadas,
  case
    when sum(total) over (partition by marca) = 0 then 0::numeric(8,2)
    else round((total::numeric / sum(total) over (partition by marca)::numeric) * 100, 2)
  end as participacao
from base;

create or replace view public.vw_credsystem_funil_propostas_emissoes
with (security_invoker = true)
as
select
  r.marca,
  r.total_propostas,
  r.propostas_aprovadas,
  r.propostas_rejeitadas,
  r.total_cartoes as cartoes_emitidos,
  r.cartoes_ativados,
  r.taxa_aprovacao,
  case
    when r.total_propostas = 0 then 0::numeric(8,2)
    else round((r.total_cartoes::numeric / r.total_propostas::numeric) * 100, 2)
  end as taxa_emissao_sobre_propostas,
  case
    when r.total_cartoes = 0 then 0::numeric(8,2)
    else round((r.cartoes_ativados::numeric / r.total_cartoes::numeric) * 100, 2)
  end as taxa_ativacao
from public.vw_credsystem_resumo_geral r;

comment on view public.vw_credsystem_resumo_geral is
  'Resumo executivo CredSystem por marca. Respeita RLS das tabelas base via security_invoker.';
comment on view public.vw_credsystem_por_marca is
  'Indicadores CredSystem por marca para dashboards.';
comment on view public.vw_credsystem_por_loja is
  'Indicadores CredSystem por loja/unidade operacional.';
comment on view public.vw_credsystem_motivos_rejeicao is
  'Ranking de motivos das propostas CredSystem por marca.';
comment on view public.vw_credsystem_funil_propostas_emissoes is
  'Funil de propostas, emissões e ativações CredSystem por marca.';

grant select on
  public.vw_credsystem_resumo_geral,
  public.vw_credsystem_por_marca,
  public.vw_credsystem_por_loja,
  public.vw_credsystem_motivos_rejeicao,
  public.vw_credsystem_funil_propostas_emissoes
to authenticated;

revoke all on
  public.vw_credsystem_resumo_geral,
  public.vw_credsystem_por_marca,
  public.vw_credsystem_por_loja,
  public.vw_credsystem_motivos_rejeicao,
  public.vw_credsystem_funil_propostas_emissoes
from anon;

commit;
