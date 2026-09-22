-- GTO Insights - Verificacao do modulo Influenciadores.
-- Rode no SQL Editor (role postgres), DEPOIS de aplicar a migration 039.
--
-- SECAO A (estatica): rode sozinha. Toda linha deve terminar em 'ok'.
-- SECAO B (funcional): rode sozinha. Ela TERMINA PROPOSITALMENTE COM UM ERRO cujo texto e o
--   relatorio; esse erro e o rollback dos dados de teste (nada fica gravado). Leia as linhas
--   'ok'/'FALHA' dentro da mensagem.

-- ==================================== SECAO A ====================================
select 'rls habilitado e forcado' as teste, c.relname::text as objeto,
  case when c.relrowsecurity and c.relforcerowsecurity then 'ok' else 'FALHA' end as resultado
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('influenciadores', 'influenciador_campanhas', 'influenciador_midias', 'influenciador_seguidores_historico')
union all
select 'quatro policies por tabela', p.tablename::text,
  case when count(*) = 4 then 'ok' else 'FALHA: ' || count(*) end
from pg_policies p
where p.schemaname = 'public'
  and p.tablename in ('influenciadores', 'influenciador_campanhas', 'influenciador_midias', 'influenciador_seguidores_historico')
group by p.tablename
union all
select 'sem grant para anon', g.table_name::text, 'FALHA: ' || g.privilege_type
from information_schema.role_table_grants g
where g.table_schema = 'public' and g.grantee = 'anon'
  and g.table_name in ('influenciadores', 'influenciador_campanhas', 'influenciador_midias', 'influenciador_seguidores_historico')
union all
select 'bucket privado com limite de 1 MB', b.id::text,
  case when b.public = false and b.file_size_limit = 1048576
        and b.allowed_mime_types @> array['image/jpeg', 'image/png', 'image/webp']::text[]
       then 'ok' else 'FALHA' end
from storage.buckets b
where b.id = 'influenciadores-avatares'
union all
select 'quatro policies de storage', 'influenciadores-avatares',
  case when count(*) = 4 then 'ok' else 'FALHA: ' || count(*) end
from pg_policies
where schemaname = 'storage' and tablename = 'objects' and policyname like 'influenciadores_avatares_%'
union all
select 'trigger de auditoria', c.relname::text,
  case when exists (select 1 from pg_trigger tg where tg.tgrelid = c.oid and tg.tgname = 'trg_' || c.relname || '_auditoria') then 'ok' else 'FALHA' end
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('influenciadores', 'influenciador_campanhas', 'influenciador_midias', 'influenciador_seguidores_historico')
order by 1, 2;

-- ==================================== SECAO B ====================================
-- Simula sessoes reais (role authenticated + JWT com aal2) de um Coordenador e de um Analista
-- existentes. Se nao houver Coordenador com marca vinculada, os testes que dependem dele saem
-- como 'PULADO'.
do $$
declare
  v_editor uuid;
  v_marca_a public.bandeira_marca;
  v_marca_b public.bandeira_marca;
  v_leitor uuid;
  v_inf_a uuid;
  v_inf_b uuid;
  v_res text[] := array[]::text[];
  v_n int;
begin
  select id, marca_vinculada into v_editor, v_marca_a
  from public.perfis
  where cargo = 'Coordenador' and ativo and marca_vinculada is not null
  limit 1;

  if v_editor is null then
    v_res := v_res || 'PULADO: nao ha Coordenador ativo com marca vinculada para simular escrita'::text;
    raise exception E'RELATORIO\n%', array_to_string(v_res, E'\n');
  end if;

  select m into v_marca_b
  from unnest(enum_range(null::public.bandeira_marca)) m
  where m <> v_marca_a
  limit 1;

  select id into v_leitor
  from public.perfis
  where cargo = 'Analista' and ativo and marca_vinculada = v_marca_a
  limit 1;

  -- Fixtures (role postgres, ignora RLS). Tudo some com o erro final.
  insert into public.influenciadores (marca, nome, handle, rede_social)
  values (v_marca_a, 'Fixture A', '@fixture_a_rls', 'Instagram') returning id into v_inf_a;
  insert into public.influenciadores (marca, nome, handle, rede_social)
  values (v_marca_b, 'Fixture B', '@fixture_b_rls', 'Instagram') returning id into v_inf_b;

  -- Sessao do Coordenador da marca A
  perform set_config('request.jwt.claim.sub', v_editor::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_editor, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  set local role authenticated;

  select count(*) into v_n from public.influenciadores where id = v_inf_b;
  v_res := v_res || (case when v_n = 0 then 'ok' else 'FALHA' end) || ' T1: coordenador da marca A nao le influenciador da marca B'::text;

  select count(*) into v_n from public.influenciadores where id = v_inf_a;
  v_res := v_res || (case when v_n = 1 then 'ok' else 'FALHA' end) || ' T2: coordenador le influenciador da propria marca'::text;

  begin
    insert into public.influenciadores (marca, nome, handle, rede_social)
    values (v_marca_b, 'Invasor', '@invasor_rls', 'Instagram');
    v_res := v_res || 'FALHA T3: coordenador inseriu em outra marca'::text;
  exception
    when insufficient_privilege then v_res := v_res || 'ok T3: insert em outra marca bloqueado'::text;
    when others then v_res := v_res || 'FALHA T3: erro inesperado '::text || sqlstate;
  end;

  begin
    insert into public.influenciadores (marca, nome, handle, rede_social)
    values (v_marca_a, 'Legitimo', '@legitimo_rls', 'TikTok');
    v_res := v_res || 'ok T4: coordenador insere na propria marca'::text;
  exception when others then
    v_res := v_res || 'FALHA T4: coordenador nao conseguiu inserir na propria marca ('::text || sqlstate || ')';
  end;

  begin
    update public.influenciadores set nome = 'Hackeado' where id = v_inf_b;
    get diagnostics v_n = row_count;
    v_res := v_res || (case when v_n = 0 then 'ok' else 'FALHA' end) || ' T5: update em outra marca nao afeta linhas'::text;
  exception when others then
    v_res := v_res || 'ok T5: update em outra marca bloqueado'::text;
  end;

  reset role;

  -- Sessao do Analista da marca A (somente leitura)
  if v_leitor is null then
    v_res := v_res || 'PULADO T6/T7: nao ha Analista ativo na marca '::text || v_marca_a;
  else
    perform set_config('request.jwt.claim.sub', v_leitor::text, true);
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_leitor, 'role', 'authenticated', 'aal', 'aal2')::text, true);
    set local role authenticated;

    select count(*) into v_n from public.influenciadores where id = v_inf_a;
    v_res := v_res || (case when v_n = 1 then 'ok' else 'FALHA' end) || ' T6: analista le a propria marca'::text;

    begin
      insert into public.influenciadores (marca, nome, handle, rede_social)
      values (v_marca_a, 'Analista Escreve', '@analista_rls', 'Instagram');
      v_res := v_res || 'FALHA T7: analista conseguiu escrever'::text;
    exception
      when insufficient_privilege then v_res := v_res || 'ok T7: analista nao escreve'::text;
      when others then v_res := v_res || 'FALHA T7: erro inesperado '::text || sqlstate;
    end;

    reset role;
  end if;

  -- Integridade (role postgres)
  begin
    insert into public.influenciador_campanhas (influenciador_id, marca, nome, data_inicio)
    values (v_inf_a, v_marca_b, 'Marca divergente', current_date);
    v_res := v_res || 'FALHA T8: campanha com marca diferente do pai foi aceita'::text;
  exception
    when foreign_key_violation then v_res := v_res || 'ok T8: FK composta rejeita marca divergente'::text;
    when others then v_res := v_res || 'FALHA T8: erro inesperado '::text || sqlstate;
  end;

  begin
    insert into public.influenciador_midias (influenciador_id, marca, titulo, url, publicada_em)
    values (v_inf_a, v_marca_a, 'Post http', 'http://instagram.com/reel/x', current_date);
    v_res := v_res || 'FALHA T9: url http foi aceita'::text;
  exception
    when check_violation then v_res := v_res || 'ok T9: url http rejeitada'::text;
    when others then v_res := v_res || 'FALHA T9: erro inesperado '::text || sqlstate;
  end;

  begin
    insert into public.influenciador_campanhas (influenciador_id, marca, nome, data_inicio, cache_valor)
    values (v_inf_a, v_marca_a, 'Negativa', current_date, -1);
    v_res := v_res || 'FALHA T10: cache negativo foi aceito'::text;
  exception
    when check_violation then v_res := v_res || 'ok T10: cache negativo rejeitado'::text;
    when others then v_res := v_res || 'FALHA T10: erro inesperado '::text || sqlstate;
  end;

  begin
    update public.influenciadores set cupom_exclusivo = true, cupom_codigo = null where id = v_inf_a;
    v_res := v_res || 'FALHA T11: cupom exclusivo sem codigo foi aceito'::text;
  exception
    when check_violation then v_res := v_res || 'ok T11: cupom exclusivo exige codigo'::text;
    when others then v_res := v_res || 'FALHA T11: erro inesperado '::text || sqlstate;
  end;

  begin
    insert into public.influenciador_campanhas (influenciador_id, marca, nome, data_inicio, cache_valor, voucher_valor)
    values (v_inf_a, v_marca_a, 'Soma', current_date, 10000, 5000);
    select investimento_total into v_n from public.influenciador_campanhas where nome = 'Soma' and influenciador_id = v_inf_a;
    v_res := v_res || (case when v_n = 15000 then 'ok' else 'FALHA' end) || ' T12: investimento_total = cache + voucher'::text;
  exception when others then
    v_res := v_res || 'FALHA T12: '::text || sqlstate;
  end;

  -- O erro abaixo desfaz TODAS as fixtures (a instrucao DO e atomica).
  raise exception E'RELATORIO (este erro e o rollback dos dados de teste)\n%', array_to_string(v_res, E'\n');
end
$$;
