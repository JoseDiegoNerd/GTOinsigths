import { useCallback, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  atualizarCargoEMarcas,
  convidarUsuario,
  definirStatusUsuario,
  dispararRedefinicaoSenha,
  listUsuariosAdmin,
  resetarMfaUsuario
} from '../services/adminUsersService';
import { toSafeErrorMessage } from '../lib/errorHandling';
import type { CargoUsuario, ConviteUsuarioInput, Marca, UsuarioAdmin } from '../types/gto';

const QUERY_KEY = ['usuarios-admin'];

export function useUsuariosAdmin() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: listUsuariosAdmin,
    staleTime: 1000 * 30
  });

  const [pendingActionId, setPendingActionId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const runAction = useCallback(
    async (actionId: string, action: () => Promise<void>, successMessage: string, fallbackError: string) => {
      setPendingActionId(actionId);
      setActionError(null);
      setActionSuccess(null);
      try {
        await action();
        setActionSuccess(successMessage);
        await queryClient.invalidateQueries({ queryKey: QUERY_KEY });
        return true;
      } catch (err) {
        setActionError(toSafeErrorMessage(err, fallbackError));
        return false;
      } finally {
        setPendingActionId(null);
      }
    },
    [queryClient]
  );

  function convidar(input: ConviteUsuarioInput) {
    return runAction(
      'convite',
      () => convidarUsuario(input).then(() => undefined),
      `Convite enviado para ${input.email}.`,
      'Não foi possível enviar o convite.'
    );
  }

  function alterarCargoMarcas(usuario: UsuarioAdmin, cargo: CargoUsuario, marcas: Marca[]) {
    return runAction(
      `cargo-${usuario.id}`,
      () => atualizarCargoEMarcas(usuario.id, cargo, usuario.marcas, marcas),
      'Cargo e marcas atualizados.',
      'Não foi possível atualizar cargo e marcas.'
    );
  }

  function alternarStatus(usuario: UsuarioAdmin) {
    return runAction(
      `status-${usuario.id}`,
      () => definirStatusUsuario(usuario.id, !usuario.ativo),
      usuario.ativo ? `${usuario.nome ?? usuario.email} foi bloqueado.` : `${usuario.nome ?? usuario.email} foi ativado.`,
      'Não foi possível alterar o status do usuário.'
    );
  }

  function enviarRedefinicaoSenha(usuario: UsuarioAdmin) {
    return runAction(
      `senha-${usuario.id}`,
      () => dispararRedefinicaoSenha(usuario.email),
      `E-mail de redefinição de senha enviado para ${usuario.email}.`,
      'Não foi possível enviar o e-mail de redefinição de senha.'
    );
  }

  function resetarMfa(usuario: UsuarioAdmin) {
    return runAction(
      `mfa-${usuario.id}`,
      () => resetarMfaUsuario(usuario.id),
      'Autenticação em duas etapas reiniciada para o usuário.',
      'Não foi possível resetar o MFA deste usuário.'
    );
  }

  return {
    usuarios: query.data ?? [],
    loading: query.isLoading,
    refreshing: query.isFetching && !query.isLoading,
    loadError: query.isError ? toSafeErrorMessage(query.error, 'Erro ao carregar usuários.') : null,
    reload: () => query.refetch(),
    convidar,
    alterarCargoMarcas,
    alternarStatus,
    enviarRedefinicaoSenha,
    resetarMfa,
    pendingActionId,
    actionError,
    actionSuccess,
    clearActionMessages: () => {
      setActionError(null);
      setActionSuccess(null);
    }
  };
}
