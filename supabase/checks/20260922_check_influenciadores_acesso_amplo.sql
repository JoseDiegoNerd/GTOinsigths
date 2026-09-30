-- GTO Insights - Verificacao da migration 040 (visao ampla entre marcas + Analista escreve).
-- Rode no SQL Editor (role postgres), DEPOIS de aplicar 20260922_040_influenciadores_acesso_amplo.sql.
--
-- SECAO A (estatica): rode sozinha. Toda linha deve terminar em 'ok'.
-- SECAO B (funcional): rode sozinha. Ela TERMINA PROPOSITALMENTE COM UM ERRO cujo texto e o
--   relatorio; esse erro e o rollback dos dados de teste (nada fica gravado). Leia as linhas
--   'ok'/'FALHA' dentro da mensagem.

-- ==================================== SECAO A ====================================
select 'select liberado para qualquer autenticado' as teste, p.tablename::text as objeto,
  case when lower(regexp_replace(p.qual, '[()\s]', '', 'g')) = 'true' then 'ok' else 'FALHA: ' || coalesce(p.qual, 'null') end as resultado
from pg_policies p
where p.schemaname = 'public'
  and p.tablename in ('influenciadores', 'influenciador_campanhas', 'influenciador_midias', 'influenciador_seguidores_historico')
  and p.policyname = p.tablename || '_select_por_marca'
union all
select 'insert exige Analista na condicao', p.tablename::text,
  case when p.with_check like '%Analista%' then 'ok' else 'FALHA' end
from pg_policies p
where p.schemaname = 'public'
  and p.tablename in ('influenciadores', 'influenciador_campanhas', 'influenciador_midias', 'influenciador_seguidores_historico')
  and p.policyname = p.tablename || '_insert_editores'
union all
select 'update exige Analista na condicao', p.tablename::text,
  case when p.qual like '%Analista%' and p.with_check like '%Analista%' then 'ok' else 'FALHA' end
from pg_policies p
where p.schemaname = 'public'
  and p.tablename in ('influenciadores', 'influenciador_campanhas', 'influenciador_midias', 'influenciador_seguidores_historico')
  and p.policyname = p.tablename || '_update_editores'
union all
select 'delete exige Analista na condicao', p.tablename::text,
  case when p.qual like '%Analista%' then 'ok' else 'FALHA' end
from pg_policies p
where p.schemaname = 'public'
  and p.tablename in ('influenciadores', 'influenciador_campanhas', 'influenciador_midias', 'influenciador_seguidores_historico')
  and p.policyname = p.tablename || '_delete_editores'
union all
select 'storage select liberado para qualquer autenticado', 'influenciadores-avatares',
  case when p.qual like '%bucket_id%' and p.qual not like '%exists%' then 'ok' else 'FALHA: ' || coalesce(p.qual, 'null') end
from pg_policies p
where p.schemaname = 'storage' and p.tablename = 'objects' and p.policyname = 'influenciadores_avatares_select'
union all
select 'storage insert exige Analista na condicao', 'influenciadores-avatares',
  case when p.with_check like '%Analista%' then 'ok' else 'FALHA' end
from pg_policies p
where p.schemaname = 'storage' and p.tablename = 'objects' and p.policyname = 'influenciadores_avatares_insert'
union all
select 'quatro policies de storage (inalterado)', 'influenciadores-avatares',
  case when count(*) = 4 then 'ok' else 'FALHA: ' || count(*) end
from pg_policies
where schemaname = 'storage' and tablename = 'objects' and policyname like 'influenciadores_avatares_%'
order by 1, 2;

-- ==================================== SECAO B ====================================
-- Simula sessoes de um Coordenador e de um Analista existentes, cada um vinculado a uma marca.
-- Prova: (1) leitura agora enxerga QUALQUER marca para os dois cargos; (2) escrita continua
-- restrita a propria marca vinculada, mas agora vale para Analista tambem, nao so Coordenador.
do $$
declare
  v_coord uuid;
  v_analista uuid;
  v_marca_a public.bandeira_marca;
  v_marca_b public.bandeira_marca;
  v_inf_a uuid;
  v_inf_b uuid;
  v_res text[] := array[]::text[];
  v_n int;
begin
  -- IMPORTANTE: gto_tem_acesso_marca() consulta public.perfis_marcas (relacao N:N) desde a
  -- migration 20260807_021, nao mais a coluna legada marca_vinculada. Selecionar aqui so por
  -- marca_vinculada arriscaria pegar um perfil com marca_vinculada desatualizada ou com mais de
  -- uma marca em perfis_marcas (o que quebraria a premissa "marca B e inacessivel a este
  -- usuario"). Por isso a selecao abaixo consulta perfis_marcas diretamente e exige exatamente
  -- UMA marca atribuida, eliminando essa ambiguidade.
  select v.id, v.marca into v_coord, v_marca_a
  from (
    select p.id, pm.marca, count(*) over (partition by p.id) as qtd_marcas
    from public.perfis p
    join public.perfis_marcas pm on pm.perfil_id = p.id
    where p.cargo = 'Coordenador' and p.ativo
  ) v
  where v.qtd_marcas = 1
  limit 1;

  if v_coord is null then
    v_res := v_res || 'PULADO: nao ha Coordenador ativo com exatamente uma marca em perfis_marcas para simular sessao'::text;
    raise exception E'RELATORIO\n%', array_to_string(v_res, E'\n');
  end if;

  select m into v_marca_b
  from unnest(enum_range(null::public.bandeira_marca)) m
  where m <> v_marca_a
  limit 1;

  select v.id into v_analista
  from (
    select p.id, pm.marca, count(*) over (partition by p.id) as qtd_marcas
    from public.perfis p
    join public.perfis_marcas pm on pm.perfil_id = p.id
    where p.cargo = 'Analista' and p.ativo
  ) v
  where v.qtd_marcas = 1 and v.marca = v_marca_a
  limit 1;

  -- Fixtures (role postgres, ignora RLS). Tudo some com o erro final.
  insert into public.influenciadores (marca, nome, handle, rede_social)
  values (v_marca_a, 'Fixture A Amplo', '@fixture_a_amplo_rls', 'Instagram') returning id into v_inf_a;
  insert into public.influenciadores (marca, nome, handle, rede_social)
  values (v_marca_b, 'Fixture B Amplo', '@fixture_b_amplo_rls', 'Instagram') returning id into v_inf_b;

  -- Sessao do Coordenador da marca A --------------------------------------------------------------
  perform set_config('request.jwt.claim.sub', v_coord::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_coord, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  set local role authenticated;

  select count(*) into v_n from public.influenciadores where id = v_inf_b;
  v_res := v_res || (case when v_n = 1 then 'ok'::text else 'FALHA'::text end) || ' T1: coordenador AGORA le influenciador de outra marca (visao ampla)'::text;

  begin
    insert into public.influenciadores (marca, nome, handle, rede_social)
    values (v_marca_b, 'Invasor Amplo', '@invasor_amplo_rls', 'Instagram');
    v_res := v_res || 'FALHA T2: coordenador inseriu em outra marca (escrita deveria continuar restrita)'::text;
  exception
    when insufficient_privilege then v_res := v_res || 'ok T2: escrita em outra marca continua bloqueada'::text;
    when others then v_res := v_res || 'FALHA T2: erro inesperado '::text || sqlstate::text;
  end;

  begin
    insert into public.influenciadores (marca, nome, handle, rede_social)
    values (v_marca_a, 'Legitimo Amplo', '@legitimo_amplo_rls', 'TikTok');
    v_res := v_res || 'ok T3: coordenador ainda insere na propria marca'::text;
  exception when others then
    v_res := v_res || 'FALHA T3: coordenador nao conseguiu inserir na propria marca ('::text || sqlstate::text || ')'::text;
  end;

  reset role;

  -- Sessao do Analista da marca A (agora tambem escreve) ------------------------------------------
  if v_analista is null then
    v_res := v_res || 'PULADO T4-T6: nao ha Analista ativo na marca '::text || v_marca_a::text;
  else
    perform set_config('request.jwt.claim.sub', v_analista::text, true);
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_analista, 'role', 'authenticated', 'aal', 'aal2')::text, true);
    set local role authenticated;

    select count(*) into v_n from public.influenciadores where id = v_inf_b;
    v_res := v_res || (case when v_n = 1 then 'ok'::text else 'FALHA'::text end) || ' T4: analista AGORA le influenciador de outra marca (visao ampla)'::text;

    begin
      insert into public.influenciadores (marca, nome, handle, rede_social)
      values (v_marca_a, 'Analista Escreve Amplo', '@analista_escreve_amplo_rls', 'Instagram');
      v_res := v_res || 'ok T5: analista AGORA escreve na propria marca (antes era so leitura)'::text;
    exception
      when insufficient_privilege then v_res := v_res || 'FALHA T5: analista deveria poder escrever na propria marca'::text;
      when others then v_res := v_res || 'FALHA T5: erro inesperado '::text || sqlstate::text;
    end;

    begin
      insert into public.influenciadores (marca, nome, handle, rede_social)
      values (v_marca_b, 'Analista Invasor Amplo', '@analista_invasor_amplo_rls', 'Instagram');
      v_res := v_res || 'FALHA T6: analista inseriu em outra marca (deveria continuar restrito a propria marca)'::text;
    exception
      when insufficient_privilege then v_res := v_res || 'ok T6: analista continua bloqueado de escrever em outra marca'::text;
      when others then v_res := v_res || 'FALHA T6: erro inesperado '::text || sqlstate::text;
    end;

    reset role;
  end if;

  -- O erro abaixo desfaz TODAS as fixtures (a instrucao DO e atomica).
  raise exception E'RELATORIO (este erro e o rollback dos dados de teste)\n%', array_to_string(v_res, E'\n');
end
$$;
