import { supabase } from '../lib/supabaseClient';
import type { CargoUsuario, ConviteUsuarioInput, Marca, UsuarioAdmin } from '../types/gto';

// supabase.functions.invoke() nao rejeita com o corpo {error} da Edge Function direto: em
// respostas != 2xx ele devolve FunctionsHttpError com o Response bruto em error.context. Sem
// isso, toda falha de validacao vira uma mensagem generica ("Edge Function returned a non-2xx
// status code") e o usuário perde o motivo real (email já convidado, cargo inválido etc.).
async function invokeAdminFunction<T>(
  name: string,
  options: { method: 'GET' | 'POST'; body?: Record<string, unknown> }
): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>(name, {
    method: options.method,
    body: options.body
  });

  if (error) {
    const context = (error as { context?: Response }).context;
    if (context && typeof context.json === 'function') {
      try {
        const body = (await context.clone().json()) as { error?: string };
        if (body?.error) throw new Error(body.error);
      } catch {
        // corpo não veio como JSON - cai no erro genérico abaixo.
      }
    }
    throw error;
  }

  return data as T;
}

export async function listUsuariosAdmin(): Promise<UsuarioAdmin[]> {
  const result = await invokeAdminFunction<{ usuarios: UsuarioAdmin[] }>('admin-users-list', { method: 'GET' });
  return result.usuarios;
}

// Convite: só dispara o e-mail (via Edge Function, exige service_role). Cargo/marcas/ativo do
// perfil recém-criado são definidos logo em seguida com a própria sessão do Admin, porque essas
// escritas em `perfis`/`perfis_marcas` já são liberadas por RLS para Admin/Gestor - não precisam
// de service_role, e evitam depender de um client administrativo pra tocar dado sensível.
export async function convidarUsuario(input: ConviteUsuarioInput): Promise<{ id: string }> {
  const invite = await invokeAdminFunction<{ ok: true; id: string; email: string }>('admin-invite-user', {
    method: 'POST',
    body: { nome: input.nome, email: input.email }
  });

  if (input.marcas.length > 0) {
    const { error: marcasError } = await supabase
      .from('perfis_marcas')
      .insert(input.marcas.map((marca) => ({ perfil_id: invite.id, marca })));
    if (marcasError) throw marcasError;
  }

  const { error: perfilError } = await supabase
    .from('perfis')
    .update({ nome: input.nome, cargo: input.cargo, ativo: true })
    .eq('id', invite.id);
  if (perfilError) throw perfilError;

  return { id: invite.id };
}

export async function atualizarCargoEMarcas(
  usuarioId: string,
  cargo: CargoUsuario,
  marcasAtuais: Marca[],
  marcasNovas: Marca[]
): Promise<void> {
  const paraRemover = marcasAtuais.filter((marca) => !marcasNovas.includes(marca));
  const paraAdicionar = marcasNovas.filter((marca) => !marcasAtuais.includes(marca));

  if (paraAdicionar.length > 0) {
    const { error } = await supabase
      .from('perfis_marcas')
      .insert(paraAdicionar.map((marca) => ({ perfil_id: usuarioId, marca })));
    if (error) throw error;
  }

  const { error: cargoError } = await supabase.from('perfis').update({ cargo }).eq('id', usuarioId);
  if (cargoError) throw cargoError;

  if (paraRemover.length > 0) {
    const { error } = await supabase
      .from('perfis_marcas')
      .delete()
      .eq('perfil_id', usuarioId)
      .in('marca', paraRemover);
    if (error) throw error;
  }
}

export async function definirStatusUsuario(usuarioId: string, ativo: boolean): Promise<void> {
  const { error } = await supabase.from('perfis').update({ ativo }).eq('id', usuarioId);
  if (error) throw error;
}

export async function dispararRedefinicaoSenha(email: string): Promise<void> {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin
  });
  if (error) throw error;
}

export async function resetarMfaUsuario(usuarioId: string): Promise<void> {
  await invokeAdminFunction('admin-reset-mfa', { method: 'POST', body: { usuario_id: usuarioId } });
}
