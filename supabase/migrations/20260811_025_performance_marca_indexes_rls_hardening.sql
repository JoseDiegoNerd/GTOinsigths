-- GTO Insights - Auditoria e reforco de performance: indices por marca + RLS
-- Scope:
--   1. Indices B-Tree com `marca` como coluna lider, para todo filtro/agrupamento por marca
--      usado no Dashboard Geral, Cartao Proprio, E-mail, Anuncios e Redes Sociais.
--   2. Reforco explicito de STABLE nas funcoes auxiliares de RLS (gto_meu_cargo,
--      gto_minha_marca, gto_eh_admin_ou_gestor, gto_tem_acesso_marca), para o planner
--      poder cachear o resultado por instrucao em vez de reavaliar linha por linha.
-- Safe to run multiple times (todo CREATE INDEX usa IF NOT EXISTS e todo ALTER FUNCTION
-- so reafirma a volatilidade ja esperada - nao muda nenhuma coluna, policy ou grant).
--
-- IMPORTANTE sobre o item 1: a maioria das tabelas do projeto ja tem `marca` como primeira
-- coluna de um indice composto (ex.: `(marca, data_referencia desc)`), criado nas migrations
-- originais de cada modulo. Pela regra de prefixo esquerdo de indices B-Tree, esse indice
-- composto ja atende filtro/agrupamento por `marca` sozinha - criar um segundo indice so com
-- `marca` nesses casos seria puramente redundante (mais espaco em disco e mais custo de
-- escrita a cada insert/update, sem ganho nenhum de leitura). Este script audita as duas
-- dezenas de tabelas com coluna `marca` do projeto e so cria indice novo onde realmente falta
-- um indice liderado por `marca` - o restante fica documentado abaixo como "ja coberto".
--
-- Ja cobertos por indice composto (marca, <coluna>) ou indice simples (marca) existente -
-- nenhuma acao necessaria:
--   dados_cartoes_credsystem, stage_rd_station_marketing, stage_meta_business_analytics,
--   stage_google_business_profile, stage_credsystem_propostas, stage_social_format_metrics,
--   stage_meta_audience_demographics, stage_meta_ads_metrics, integracao_meta_contas,
--   integracao_meta_ads_contas, integracao_google_contas, integracao_google_locais,
--   integracao_google_avaliacoes, integracao_google_metricas_diarias,
--   integracao_google_fotos, logs_integracao_meta, logs_integracao_google, perfis
--   (marca_vinculada, coluna legada desde a migration 021).
--
-- Gap real encontrado: perfis_marcas tem PK composta (perfil_id, marca) - cobre buscas por
-- perfil_id, mas nao ha nenhum indice liderado por `marca` (ex.: "quais perfis tem acesso a
-- marca X"). E o unico indice adicionado por este script.

begin;

-- 1. Indice B-Tree faltante liderado por marca ------------------------------------------

create index if not exists idx_perfis_marcas_marca
  on public.perfis_marcas (marca);

comment on index public.idx_perfis_marcas_marca is
  'Suporta consultas "quais perfis tem acesso a marca X" - a PK (perfil_id, marca) so cobre o sentido inverso.';

analyze public.perfis_marcas;

-- 2. STABLE explicito nas funcoes auxiliares de RLS --------------------------------------

-- Todas ja sao STABLE desde a criacao (ver migrations 001 e 021); os ALTER FUNCTION abaixo
-- so reafirmam isso de forma idempotente, para o caso de alguma reaplicacao manual futura
-- ter derrubado o modificador sem querer. STABLE aqui significa: "para os mesmos argumentos,
-- dentro da mesma instrucao SQL, sempre retorna o mesmo resultado" - isso deixa o planner
-- reaproveitar o resultado em vez de reexecutar a funcao para cada linha da tabela.
--
-- gto_eh_admin_ou_gestor() nao recebe nenhum argumento: por ser STABLE, o Postgres avalia
-- ela UMA vez por instrucao (nao uma vez por linha), mesmo estando embutida dentro de
-- gto_tem_acesso_marca(marca), que por sua vez e chamada em toda policy USING/WITH CHECK
-- de toda tabela de dados do projeto - esse e o ganho real de performance do RLS aqui.
--
-- NUNCA use IMMUTABLE nessas funcoes. IMMUTABLE promete que o resultado depende so dos
-- argumentos recebidos - mas gto_meu_cargo(), gto_minha_marca(), gto_eh_admin_ou_gestor() e
-- gto_tem_acesso_marca() dependem de auth.uid() (o usuario da sessao) e do conteudo de
-- public.perfis/perfis_marcas, nao so dos argumentos. Marcar como IMMUTABLE autorizaria o
-- planner a cachear/reutilizar o resultado entre usuarios ou apos um UPDATE em perfis_marcas,
-- o que vazaria dados entre marcas - e uma falha de seguranca, nao uma otimizacao valida.

alter function public.gto_meu_cargo() stable;
alter function public.gto_minha_marca() stable;
alter function public.gto_eh_admin_ou_gestor() stable;
alter function public.gto_tem_acesso_marca(public.bandeira_marca) stable;

commit;
