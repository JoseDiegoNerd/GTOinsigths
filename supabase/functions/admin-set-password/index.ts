import {
  assertAal2,
  assertCargoPermitido,
  getAdminClient,
  getAuthenticatedUser,
  jsonResponse,
  safeErrorMessage,
  withCors,
} from "../_shared/users.ts";

const CARGOS_PERMITIDOS = ["Admin"];
const SENHA_MIN_LENGTH = 8;

// Redefinicao manual de senha pelo painel "Controle de acessos" (opcao 2 do modal "Redefinir
// senha", ao lado do envio de e-mail via resetPasswordForEmail). auth.admin.updateUserById exige
// service_role - por isso so pode rodar aqui, nunca no client, mesmo sendo um Admin autenticado
// chamando. A senha chega do front ja gerada aleatoria (crypto.getRandomValues) e editavel pelo
// Admin; validamos so o tamanho aqui, o valor em si e escolha do Admin.
Deno.serve(withCors(async (req) => {
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const admin = await getAuthenticatedUser(req);
    await assertAal2(req, admin.id);
    await assertCargoPermitido(admin.id, CARGOS_PERMITIDOS);

    const body = await req.json().catch(() => ({}));
    const usuarioId = String(body.usuario_id || "").trim();
    const novaSenha = String(body.nova_senha || "");

    if (!usuarioId) return jsonResponse({ error: "Informe usuario_id." }, 400);
    if (novaSenha.length < SENHA_MIN_LENGTH || novaSenha.length > 72) {
      return jsonResponse({ error: `A senha precisa ter entre ${SENHA_MIN_LENGTH} e 72 caracteres.` }, 400);
    }

    const supabase = getAdminClient();
    const { error: updateError } = await supabase.auth.admin.updateUserById(usuarioId, { password: novaSenha });
    if (updateError) throw updateError;

    return jsonResponse({ ok: true });
  } catch (error) {
    return jsonResponse({ error: safeErrorMessage(error, "Nao foi possivel redefinir a senha deste usuario.") }, 400);
  }
}));
