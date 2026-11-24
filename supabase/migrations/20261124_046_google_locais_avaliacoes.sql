-- GTO Insights - Google Meu Negocio: nota media e total de avaliacoes por unidade.
-- O endpoint v4 accounts.locations.reviews.list devolve averageRating e totalReviewCount da
-- ficha inteira (nao so das avaliacoes baixadas); guardamos na propria unidade para o KPI
-- "Avaliacao Media" ser a media ponderada real e o drawer da unidade mostrar os numeros do Google.
-- Seguro para rodar mais de uma vez; so adiciona colunas anulaveis.

begin;

alter table public.integracao_google_locais
  add column if not exists nota_media numeric(3, 2),
  add column if not exists total_avaliacoes integer,
  add column if not exists avaliacoes_sincronizadas_em timestamptz;

comment on column public.integracao_google_locais.nota_media is
  'averageRating devolvido pelo Google (reviews.list v4) na ultima sincronizacao.';
comment on column public.integracao_google_locais.total_avaliacoes is
  'totalReviewCount devolvido pelo Google (reviews.list v4) na ultima sincronizacao.';
comment on column public.integracao_google_locais.avaliacoes_sincronizadas_em is
  'Quando as avaliacoes desta unidade foram sincronizadas com sucesso pela ultima vez. Usado para a '
  'sincronizacao incremental parar de paginar ao chegar em avaliacoes ja importadas.';

commit;
