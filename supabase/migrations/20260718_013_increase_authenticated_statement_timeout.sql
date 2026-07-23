-- GTO Insights - aumenta o statement_timeout do role authenticated
-- Scope: mitigar timeouts nas views BI (ex.: vw_credsystem_resumo_geral) logo apos
-- importacoes grandes, quando o cache do Postgres ainda esta frio.
-- Nao afeta o role anon nem outras configuracoes de seguranca.

begin;

alter role authenticated set statement_timeout = '20s';

commit;
