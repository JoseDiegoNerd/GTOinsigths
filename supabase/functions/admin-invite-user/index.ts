import {
  assertAal2,
  assertCargoPermitido,
  getAdminClient,
  getAuthenticatedUser,
  jsonResponse,
  resolveAppReturnUrl,
  safeErrorMessage,
  withCors,
} from "../_shared/users.ts";

const CARGOS_PERMITIDOS = ["Admin"];
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// So dispara o convite (auth.admin.inviteUserByEmail exige service_role, nunca pode rodar no
// client). Cargo/ativo/marcas do perfil convidado NAO sao gravados aqui: o trigger
// trg_auth_users_criar_perfil ja cria a linha em public.perfis (cargo "Analista", ativo=false)
// assim que o convite cria o auth.users. O front, logo em seguida, grava cargo/marcas/ativo
// definitivos usando a PROPRIA sessao do Admin (supabase.from('perfis').update(...) /
// perfis_marcas insert) - essas chamadas passam pela RLS normal porque quem assina a requisicao
// e o Admin autenticado, nao o service_role. Fazer isso aqui (com o client admin) esbarraria no
// trigger trg_perfis_bloquear_campos_sensiveis, que so libera alterar cargo/ativo pra quem tem
// auth.uid() de Admin/Gestor - e o client de service_role nao carrega esse uid.
Deno.serve(withCors(async (req) => {
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const admin = await getAuthenticatedUser(req);
    await assertAal2(req, admin.id);
    await assertCargoPermitido(admin.id, CARGOS_PERMITIDOS);

    const body = await req.json().catch(() => ({}));
    const email = String(body.email || "").trim().toLowerCase();
    const nome = String(body.nome || "").trim();

    if (!email || !EMAIL_REGEX.test(email) || email.length > 254) {
      return jsonResponse({ error: "Informe um e-mail corporativo valido." }, 400);
    }
    if (!nome || nome.length > 120) {
      return jsonResponse({ error: "Informe o nome completo." }, 400);
    }

    const supabase = getAdminClient();
    const { data: invited, error: inviteError } = await supabase.auth.admin.inviteUserByEmail(email, {
      data: { nome },
      redirectTo: resolveAppReturnUrl(req, typeof body.redirect_to === "string" ? body.redirect_to : undefined),
    });

    if (inviteError) throw inviteError;
    if (!invited.user?.id) throw new Error("Convite enviado, mas o usuario nao retornou id.");

    return jsonResponse({ ok: true, id: invited.user.id, email: invited.user.email });
  } catch (error) {
    return jsonResponse({ error: safeErrorMessage(error, "Nao foi possivel enviar o convite.") }, 400);
  }
}));
