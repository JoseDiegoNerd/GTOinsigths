-- RPC de exclusao de campanha de email marketing, usada pela secao "Historico e Gerenciamento de
-- Uploads" da tela Importar Planilhas (public/index.html). A policy "campanhas_email_delete_admin_gestor"
-- (migration 20260818_033) ja autoriza Admin/Gestor a deletar linhas de campanhas_email, e as FKs
-- campanha_disparos.campanha_id / campanha_analise_estrategica.campanha_id ja tem "on delete cascade" -
-- entao um DELETE simples ja apagaria tudo em cascata. Esta funcao existe so para devolver um retorno
-- estruturado (nome da campanha + quantos disparos foram removidos) pro front exibir na confirmacao,
-- em vez de um .delete() cru sem feedback. SECURITY INVOKER: roda com privilegios de quem chama, entao
-- a policy de DELETE continua sendo a autoridade real de quem pode excluir.
create or replace function public.rpc_excluir_campanha_email(p_campanha_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_nome_campanha text;
  v_disparos_removidos int;
begin
  select nome_campanha into v_nome_campanha
  from public.campanhas_email
  where id = p_campanha_id;

  if v_nome_campanha is null then
    raise exception 'Campanha não encontrada, ou você não tem permissão para excluí-la.' using errcode = 'P0002';
  end if;

  select count(*) into v_disparos_removidos
  from public.campanha_disparos
  where campanha_id = p_campanha_id;

  delete from public.campanhas_email where id = p_campanha_id;

  return jsonb_build_object(
    'campanha_id', p_campanha_id,
    'nome_campanha', v_nome_campanha,
    'disparos_removidos', v_disparos_removidos
  );
end;
$$;

revoke all on function public.rpc_excluir_campanha_email(uuid) from public;
grant execute on function public.rpc_excluir_campanha_email(uuid) to authenticated;

notify pgrst, 'reload schema';
