-- GTO Insights - Verificacao de RLS e vazamento cruzado entre marcas
-- Rode no SQL Editor do Supabase (role: postgres/service, fora do contexto de um usuario logado).
-- Nao altera dados; e somente leitura. Qualquer linha retornada em uma secao "FALHA" e um gap
-- de seguranca que precisa ser corrigido antes do proximo deploy.

-- 1) Toda tabela em public/storage.objects precisa ter RLS habilitado E forcado (FORCE),
--    inclusive para o dono da tabela. Uma tabela nova criada sem essas duas flags e
--    invisivel para esta bateria de policies e vaza para qualquer authenticated.
select
  n.nspname as schema,
  c.relname as tabela,
  c.relrowsecurity as rls_habilitado,
  c.relforcerowsecurity as rls_forcado,
  case
    when not c.relrowsecurity then 'FALHA: RLS desabilitado'
    when not c.relforcerowsecurity then 'FALHA: RLS nao forcado (dono da tabela ignora policies)'
    else 'ok'
  end as status
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'r' -- tabelas normais, exclui views
order by status desc, tabela;

-- 2) Toda tabela em public com RLS habilitado precisa ter pelo menos uma policy.
--    RLS habilitado sem nenhuma policy bloqueia 100% do acesso (fail-closed) - nao e um
--    vazamento, mas geralmente indica uma tabela nova esquecida sem policy de SELECT.
select
  c.relname as tabela,
  count(p.polname) as qtd_policies
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policy p on p.polrelid = c.oid
where n.nspname = 'public'
  and c.relkind = 'r'
  and c.relrowsecurity = true
group by c.relname
having count(p.polname) = 0
order by tabela;

-- 3) Toda view em public precisa rodar com security_invoker = true. Sem isso, a view
--    executa com os privilegios de quem a criou (geralmente postgres/owner) e ignora
--    o RLS das tabelas base, vazando dados de todas as marcas para qualquer authenticated
--    com GRANT SELECT na view.
select
  n.nspname as schema,
  c.relname as view,
  coalesce(c.reloptions, '{}') as opcoes,
  case
    when c.reloptions is null or not ('security_invoker=true' = any(c.reloptions)) then
      'FALHA: view sem security_invoker=true'
    else 'ok'
  end as status
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind = 'v'
order by status desc, view;

-- 4) Nenhuma tabela/view sensivel (com coluna "marca") pode ter GRANT para o role anon.
--    Acesso anonimo bypassa toda a logica de auth.uid() usada pelas policies.
select
  table_schema,
  table_name,
  grantee,
  privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee = 'anon'
  and table_name in (
    select table_name
    from information_schema.columns
    where table_schema = 'public' and column_name = 'marca'
  );

-- 5) Teste funcional de isolamento por marca: compara o que gto_tem_acesso_marca() libera
--    para cada marca com o cargo/marcas atribuidas ao usuario autenticado atual.
--    Rode este bloco autenticado como cada perfil de teste (ou via `set local role
--    authenticated; set local request.jwt.claims = '{"sub": "<uuid-do-perfil>"}';`)
--    para confirmar que um Analista da marca A nunca recebe true para a marca B.
select
  marca_alvo,
  public.gto_tem_acesso_marca(marca_alvo) as tem_acesso
from unnest(enum_range(null::public.bandeira_marca)) as marca_alvo
order by marca_alvo;

-- 6) Amostra de vazamento cruzado real: para o usuario autenticado atual, cada linha
--    abaixo deve pertencer apenas a marcas as quais ele tem acesso (verificar contra o
--    resultado da secao 5). Qualquer linha de uma marca sem acesso = vazamento confirmado.
select distinct marca, 'dados_cartoes_credsystem' as tabela from public.dados_cartoes_credsystem
union all
select distinct marca, 'stage_credsystem_propostas' from public.stage_credsystem_propostas
union all
select distinct marca, 'stage_rd_station_marketing' from public.stage_rd_station_marketing
union all
select distinct marca, 'stage_meta_business_analytics' from public.stage_meta_business_analytics
union all
select distinct marca, 'stage_google_business_profile' from public.stage_google_business_profile
order by tabela, marca;
