-- GTO Insights - Modulo Influenciadores: visao ampla entre marcas.
-- Scope: decisao de produto (2026-09-22) - qualquer usuario autenticado passa a VER
-- influenciadores/campanhas/midias/seguidores de TODAS as marcas, nao so a marca vinculada.
-- Analista, que antes so lia, passa a poder ESCREVER tambem - mas so na propria marca vinculada
-- (mesma regra que ja valia so para Coordenador). Admin/Gestor continuam podendo escrever em
-- qualquer marca.
--
-- Substitui apenas as policies de select/insert/update/delete das 4 tabelas e das policies de
-- storage do bucket influenciadores-avatares criadas em 20260921_039_influenciadores.sql. Nao
-- recria tabelas, indices, triggers nem o bucket - tudo isso continua como estava.
--
-- Safe to run multiple times.

begin;

do $$
declare
  t text;
  cond_editor constant text :=
    '(select public.gto_meu_cargo()) in (''Admin'', ''Gestor'')'
    || ' or ((select public.gto_meu_cargo()) in (''Coordenador'', ''Analista'') and public.gto_tem_acesso_marca(marca))';
begin
  foreach t in array array[
    'influenciadores',
    'influenciador_campanhas',
    'influenciador_midias',
    'influenciador_seguidores_historico'
  ]
  loop
    -- Leitura liberada para qualquer autenticado - RLS continua ativo (bloqueia anon via
    -- "to authenticated" e via o revoke da migration anterior), so a marca deixa de restringir.
    execute format('drop policy if exists %I on public.%I', t || '_select_por_marca', t);
    execute format('create policy %I on public.%I for select to authenticated using (true)',
      t || '_select_por_marca', t);

    -- Escrita: Admin/Gestor em qualquer marca; Coordenador/Analista so na propria marca vinculada.
    execute format('drop policy if exists %I on public.%I', t || '_insert_editores', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (%s)',
      t || '_insert_editores', t, cond_editor);

    execute format('drop policy if exists %I on public.%I', t || '_update_editores', t);
    execute format('create policy %I on public.%I for update to authenticated using (%s) with check (%s)',
      t || '_update_editores', t, cond_editor, cond_editor);

    execute format('drop policy if exists %I on public.%I', t || '_delete_editores', t);
    execute format('create policy %I on public.%I for delete to authenticated using (%s)',
      t || '_delete_editores', t, cond_editor);
  end loop;
end
$$;

-- Storage: mesma logica - leitura liberada para qualquer autenticado, escrita restrita a
-- Admin/Gestor (qualquer marca) ou Coordenador/Analista (so a marca do influenciador dono da pasta).
drop policy if exists "influenciadores_avatares_select" on storage.objects;
create policy "influenciadores_avatares_select" on storage.objects
for select to authenticated
using (bucket_id = 'influenciadores-avatares');

drop policy if exists "influenciadores_avatares_insert" on storage.objects;
create policy "influenciadores_avatares_insert" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'influenciadores-avatares'
  and exists (
    select 1 from public.influenciadores i
    where i.id::text = (storage.foldername(name))[1]
      and (
        (select public.gto_meu_cargo()) in ('Admin', 'Gestor')
        or ((select public.gto_meu_cargo()) in ('Coordenador', 'Analista') and public.gto_tem_acesso_marca(i.marca))
      )
  )
);

drop policy if exists "influenciadores_avatares_update" on storage.objects;
create policy "influenciadores_avatares_update" on storage.objects
for update to authenticated
using (
  bucket_id = 'influenciadores-avatares'
  and exists (
    select 1 from public.influenciadores i
    where i.id::text = (storage.foldername(name))[1]
      and (
        (select public.gto_meu_cargo()) in ('Admin', 'Gestor')
        or ((select public.gto_meu_cargo()) in ('Coordenador', 'Analista') and public.gto_tem_acesso_marca(i.marca))
      )
  )
)
with check (
  bucket_id = 'influenciadores-avatares'
  and exists (
    select 1 from public.influenciadores i
    where i.id::text = (storage.foldername(name))[1]
      and (
        (select public.gto_meu_cargo()) in ('Admin', 'Gestor')
        or ((select public.gto_meu_cargo()) in ('Coordenador', 'Analista') and public.gto_tem_acesso_marca(i.marca))
      )
  )
);

drop policy if exists "influenciadores_avatares_delete" on storage.objects;
create policy "influenciadores_avatares_delete" on storage.objects
for delete to authenticated
using (
  bucket_id = 'influenciadores-avatares'
  and exists (
    select 1 from public.influenciadores i
    where i.id::text = (storage.foldername(name))[1]
      and (
        (select public.gto_meu_cargo()) in ('Admin', 'Gestor')
        or ((select public.gto_meu_cargo()) in ('Coordenador', 'Analista') and public.gto_tem_acesso_marca(i.marca))
      )
  )
);

notify pgrst, 'reload schema';

commit;
