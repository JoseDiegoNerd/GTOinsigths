-- GTO Insights - Corrige timeout do Dashboard Geral causado por avaliacao de RLS linha a linha
--
-- Incidente (14/08/2026): Dashboard Geral falhando com "canceling statement due to statement
-- timeout" (Postgres 57014, statement_timeout=20s do role authenticated). EXPLAIN ANALYZE apontou
-- a policy dados_cartoes_select_por_marca como causa: para um usuario Admin/Gestor,
-- gto_tem_acesso_marca(marca) ja retorna true de imediato (via gto_eh_admin_ou_gestor() interno),
-- mas por ser SECURITY DEFINER e receber `marca` (que varia linha a linha) como argumento, o
-- planner do Postgres nao consegue isolar essa chamada do loop de filtro - ela e reexecutada uma
-- vez por linha. Numa consulta que bateu em 13.027 linhas isso levou 7,26s sozinha; com o
-- Dashboard disparando varias consultas assim em paralelo (Promise.all), estourava os 20s.
--
-- Fix: expor gto_eh_admin_ou_gestor() (sem argumentos, nao depende da linha) envolvida em
-- `(select ...)` na propria policy. Isso e o padrao oficial recomendado pelo Supabase pra RLS -
-- o `(select ...)` da ao planner um sinal explicito pra tratar a chamada como InitPlan (calculada
-- uma unica vez por consulta, nao por linha). Resultado medido: 7.260ms -> 19ms pra essa mesma
-- consulta, mesmas 13.027 linhas retornadas.
--
-- Sem mudanca de permissao: gto_tem_acesso_marca(marca) sempre checou "e admin/gestor?" como seu
-- primeiro branch e retornava true ali mesmo - este fix so da ao Postgres um jeito barato de
-- chegar nesse mesmo resultado sem precisar rodar a cadeia inteira de funcoes por linha.
--
-- Escopo desta migration: so a policy de SELECT de dados_cartoes_credsystem, a que causou o
-- incidente. As demais ~20 tabelas com o mesmo padrao gto_tem_acesso_marca(marca) em suas
-- policies (auditadas na migration 025) devem ter o mesmo problema latente e ficam para uma
-- migration de otimizacao mais ampla, fora do escopo deste fix pontual.

begin;

alter policy dados_cartoes_select_por_marca on public.dados_cartoes_credsystem
  using ((select public.gto_eh_admin_ou_gestor()) or public.gto_tem_acesso_marca(marca));

commit;
