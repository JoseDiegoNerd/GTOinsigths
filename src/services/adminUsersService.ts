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

export async function listUsuariosAdmin(): Promise<{ usuarios: UsuarioAdmin[]; fallback: boolean }> {
  try {
    const result = await invokeAdminFunction<{ usuarios: UsuarioAdmin[] }>('admin-users-list', { method: 'POST' });
    return { usuarios: result.usuarios, fallback: false };
  } catch (error) {
    // admin-users-list junta perfis com auth.users/auth.mfa_factors via service_role (so por isso
    // ela existe - last_sign_in_at/mfa_enrolled nao ficam expostos via PostgREST). Se ela nao
    // estiver publicada, sem permissao ou fora do ar, cai pra uma consulta direta em
    // perfis/perfis_marcas: a RLS ja libera nome/cargo/marcas/status pra Admin/Gestor sem precisar
    // de Edge Function nenhuma. Os campos que so a Auth Admin API tem ficam "desconhecidos" nesse
    // modo, em vez de quebrar a tela inteira.
    console.warn('admin-users-list indisponível, usando fallback direto em perfis:', error);
    return { usuarios: await listUsuariosFallback(), fallback: true };
  }
}

async function listUsuariosFallback(): Promise<UsuarioAdmin[]> {
  const [{ data: perfis, error: perfisError }, { data: marcasRows, error: marcasError }] = await Promise.all([
    supabase
      .from('perfis')
      .select('id,email,nome,cargo,ativo,avatar_url,cargo_oficial,criado_em,atualizado_em')
      .order('criado_em', { ascending: false }),
    supabase.from('perfis_marcas').select('perfil_id,marca')
  ]);
  if (perfisError) throw perfisError;
  if (marcasError) throw marcasError;

  const marcasPorPerfil = new Map<string, Marca[]>();
  for (const row of marcasRows ?? []) {
    const lista = marcasPorPerfil.get(row.perfil_id) ?? [];
    lista.push(row.marca as Marca);
    marcasPorPerfil.set(row.perfil_id, lista);
  }

  return (perfis ?? []).map((perfil) => ({
    ...perfil,
    marcas: marcasPorPerfil.get(perfil.id) ?? [],
    last_sign_in_at: null,
    email_confirmed_at: null,
    mfa_enrolled: false
  })) as UsuarioAdmin[];
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
