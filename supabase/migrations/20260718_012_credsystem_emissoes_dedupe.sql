-- GTO Insights - CredSystem Emissoes: novos campos do arquivo real + trava de duplicidade
-- Scope: captura id_cod_cartao, cpf_cliente, canal, sub_canal, tipo_cartao (existem no CSV
-- da CredSystem mas nao eram salvos), e impede que reenviar o mesmo relatorio duplique linhas.
-- Safe to run multiple times. Nao apaga nem altera dados ja importados.

begin;

alter table public.dados_cartoes_credsystem
  add column if not exists id_cod_cartao text,
  add column if not exists cpf_cliente text,
  add column if not exists canal text,
  add column if not exists sub_canal text,
  add column if not exists tipo_cartao text;

comment on column public.dados_cartoes_credsystem.id_cod_cartao is
  'ID do cartao no arquivo de Emissoes da CredSystem. Pode ser nulo em registros de re-emissao. Usado para deduplicar reimportacoes.';

-- Indice unico normal (nao parcial): o upsert do PostgREST/supabase-js gera um
-- "ON CONFLICT (marca, id_cod_cartao)" simples, que so reconhece constraint/indice nao
-- parcial como alvo. Nao precisa de WHERE — SQL trata NULL <> NULL por padrao, entao
-- registros sem id_cod_cartao (re-emissoes) nunca conflitam entre si, exatamente como
-- ja acontece em stage_credsystem_propostas_marca_proposta_uk. Indice (nao constraint)
-- para poder usar "if not exists" e manter a migration idempotente.
create unique index if not exists dados_cartoes_credsystem_marca_cartao_uk
  on public.dados_cartoes_credsystem (marca, id_cod_cartao);

commit;
