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

// Remove todos os fatores MFA (TOTP) verificados de um usuario, forcando-o a reconfigurar o 2FA
// no proximo login. auth.admin.mfa.* exige service_role, por isso precisa ser Edge Function.
Deno.serve(withCors(async (req) => {
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const admin = await getAuthenticatedUser(req);
    await assertAal2(req, admin.id);
    await assertCargoPermitido(admin.id, CARGOS_PERMITIDOS);

    const body = await req.json().catch(() => ({}));
    const usuarioId = String(body.usuario_id || "").trim();
    if (!usuarioId) return jsonResponse({ error: "Informe usuario_id." }, 400);

    const supabase = getAdminClient();

    const { data: factorsData, error: factorsError } = await supabase.auth.admin.mfa.listFactors({
      userId: usuarioId,
    });
    if (factorsError) throw factorsError;

    const factors = factorsData?.factors ?? [];
    for (const factor of factors) {
      const { error: deleteError } = await supabase.auth.admin.mfa.deleteFactor({
        id: factor.id,
        userId: usuarioId,
      });
      if (deleteError) throw deleteError;
    }

    return jsonResponse({ ok: true, fatores_removidos: factors.length });
  } catch (error) {
    return jsonResponse({ error: safeErrorMessage(error, "Nao foi possivel resetar o MFA deste usuario.") }, 400);
  }
}));
