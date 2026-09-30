-- GTO Insights - Verificacao da migration 041 (colunas de sincronizacao Instagram + cron).
-- Rode no SQL Editor (role postgres), DEPOIS de aplicar 20260923_041_influenciadores_instagram_sync.sql.
--
-- SECAO A (estatica): rode sozinha. Toda linha deve terminar em 'ok'.
-- SECAO B (funcional): rode sozinha. Ela TERMINA PROPOSITALMENTE COM UM ERRO cujo texto e o
--   relatorio; esse erro e o rollback dos dados de teste (nada fica gravado).

-- ==================================== SECAO A ====================================
select 'coluna existe' as teste, column_name::text as objeto,
  case when count(*) = 1 then 'ok' else 'FALHA' end as resultado
from information_schema.columns
where table_schema = 'public' and table_name = 'influenciadores'
  and column_name in ('publicacoes_total', 'instagram_sincronizado_em', 'instagram_sync_erro')
group by column_name
union all
select 'cron job agendado', 'influenciador-instagram-sync-daily',
  case when count(*) = 1 then 'ok' else 'FALHA: ' || count(*) end
from cron.job
where jobname = 'influenciador-instagram-sync-daily'
order by 1, 2;

-- ==================================== SECAO B ====================================
-- Confirma que a constraint de nao-negativo funciona e que as colunas aceitam null (estado
-- inicial "nunca sincronizado"). Nao depende de nenhum usuario de teste - roda sempre.
do $$
declare
  v_marca public.bandeira_marca;
  v_inf uuid;
  v_res text[] := array[]::text[];
begin
  select m into v_marca from unnest(enum_range(null::public.bandeira_marca)) m limit 1;

  insert into public.influenciadores (marca, nome, handle, rede_social)
  values (v_marca, 'Fixture Sync', '@fixture_sync_041_rls', 'Instagram') returning id into v_inf;

  if (select publicacoes_total is null and instagram_sincronizado_em is null and instagram_sync_erro is null
      from public.influenciadores where id = v_inf) then
    v_res := v_res || 'ok T0: colunas nascem nulas (nunca sincronizado)'::text;
  else
    v_res := v_res || 'FALHA T0: colunas novas nao nasceram nulas'::text;
  end if;

  begin
    update public.influenciadores set publicacoes_total = -1 where id = v_inf;
    v_res := v_res || 'FALHA T1: publicacoes_total negativo foi aceito'::text;
  exception
    when check_violation then v_res := v_res || 'ok T1: publicacoes_total negativo rejeitado'::text;
    when others then v_res := v_res || 'FALHA T1: erro inesperado '::text || sqlstate::text;
  end;

  begin
    update public.influenciadores
    set publicacoes_total = 342, instagram_sincronizado_em = now(), instagram_sync_erro = null
    where id = v_inf;
    v_res := v_res || 'ok T2: colunas aceitam valores validos'::text;
  exception when others then
    v_res := v_res || 'FALHA T2: erro inesperado '::text || sqlstate::text;
  end;

  -- O erro abaixo desfaz a fixture (a instrucao DO e atomica).
  raise exception E'RELATORIO (este erro e o rollback dos dados de teste)\n%', array_to_string(v_res, E'\n');
end
$$;
