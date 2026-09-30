-- GTO Insights - Verificacao da migration 042 (funcao gto_pode_editar_influenciador).
-- Rode no SQL Editor (role postgres), DEPOIS de aplicar 20260924_042_influenciador_permissao_probe.sql.
--
-- SECAO A (estatica): rode sozinha. Toda linha deve terminar em 'ok'.
-- SECAO B (funcional): rode sozinha. Ela TERMINA PROPOSITALMENTE COM UM ERRO cujo texto e o
--   relatorio; esse erro e o rollback dos dados de teste (nada fica gravado). Confirma que a
--   funcao E READ-ONLY: nenhuma linha nova em logs_atividades para public.influenciadores.

-- ==================================== SECAO A ====================================
select 'funcao existe' as teste, 'gto_pode_editar_influenciador'::text as objeto,
  case when count(*) = 1 then 'ok' else 'FALHA' end as resultado
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'gto_pode_editar_influenciador'
union all
select 'funcao e stable', 'gto_pode_editar_influenciador',
  case when count(*) = 1 then 'ok' else 'FALHA' end
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'gto_pode_editar_influenciador' and p.provolatile = 's'
order by 1, 2;

-- ==================================== SECAO B ====================================
do $$
declare
  v_marca public.bandeira_marca;
  v_inf uuid;
  v_logs_antes bigint;
  v_logs_depois bigint;
  v_res text[] := array[]::text[];
begin
  select m into v_marca from unnest(enum_range(null::public.bandeira_marca)) m limit 1;

  insert into public.influenciadores (marca, nome, handle, rede_social)
  values (v_marca, 'Fixture Probe', '@fixture_probe_042', 'Instagram') returning id into v_inf;

  select count(*) into v_logs_antes
  from public.logs_atividades
  where tabela_afetada = 'public.influenciadores' and registro_id = v_inf::text;

  -- Chama a funcao varias vezes - se ela gravasse algo, o count abaixo teria mudado.
  perform public.gto_pode_editar_influenciador(v_marca);
  perform public.gto_pode_editar_influenciador(v_marca);

  select count(*) into v_logs_depois
  from public.logs_atividades
  where tabela_afetada = 'public.influenciadores' and registro_id = v_inf::text;

  if v_logs_depois = v_logs_antes then
    v_res := v_res || 'ok T0: chamar a funcao nao gera linha de auditoria'::text;
  else
    v_res := v_res || 'FALHA T0: funcao gerou auditoria (antes='::text || v_logs_antes::text || ', depois=' || v_logs_depois::text || ')';
  end if;

  -- postgres (role usada pelo SQL Editor) nao tem cargo em public.perfis - gto_meu_cargo() deve
  -- devolver null e a funcao deve devolver false (nao true por engano), sem lancar erro.
  if public.gto_pode_editar_influenciador(v_marca) is false then
    v_res := v_res || 'ok T1: sem perfil/cargo, funcao devolve false (nao lanca erro)'::text;
  else
    v_res := v_res || 'FALHA T1: esperava false para role sem cargo'::text;
  end if;

  -- O erro abaixo desfaz a fixture (a instrucao DO e atomica).
  raise exception E'RELATORIO (este erro e o rollback dos dados de teste)\n%', array_to_string(v_res, E'\n');
end
$$;
