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

// Exclui a conta em auth.users (auth.admin.deleteUser exige service_role). public.perfis e
// public.perfis_marcas nao precisam de limpeza manual aqui: perfis.id referencia auth.users(id)
// on delete cascade (migration 20260702_001) e perfis_marcas.perfil_id referencia perfis(id) on
// delete cascade (migration 20260807_021) - o Postgres remove as duas linhas sozinho.
Deno.serve(withCors(async (req) => {
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const admin = await getAuthenticatedUser(req);
    await assertAal2(req, admin.id);
    await assertCargoPermitido(admin.id, CARGOS_PERMITIDOS);

    const body = await req.json().catch(() => ({}));
    const usuarioId = String(body.usuario_id || "").trim();
    if (!usuarioId) return jsonResponse({ error: "Informe usuario_id." }, 400);

    if (usuarioId === admin.id) {
      return jsonResponse({ error: "Você não pode excluir a própria conta." }, 400);
    }

    const supabase = getAdminClient();
    const { error: deleteError } = await supabase.auth.admin.deleteUser(usuarioId);
    if (deleteError) throw deleteError;

    return jsonResponse({ ok: true });
  } catch (error) {
    return jsonResponse({ error: safeErrorMessage(error, "Nao foi possivel excluir este usuario.") }, 400);
  }
}));
