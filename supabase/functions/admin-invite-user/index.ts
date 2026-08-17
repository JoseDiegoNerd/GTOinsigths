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

// Cria o convite (ou reenvia, se o e-mail ja pertencer a um usuario pendente) e devolve o link
// (auth.admin.generateLink exige service_role, nunca pode rodar no client) SEM disparar nenhum
// e-mail automatico do Supabase - a entrega e 100% controlada pelo front (Etapa 2 "Editor de
// Mensagens": abre rascunho de e-mail via mailto: ou de WhatsApp via wa.me, com o link e o texto
// que o Admin editou). Por isso generateLink({type:'invite'}) no lugar de inviteUserByEmail (que
// sempre manda o template fixo do Supabase Auth na hora).
//
// Cargo/ativo/marcas/telefone do perfil convidado NAO sao gravados aqui: o trigger
// trg_auth_users_criar_perfil ja cria a linha em public.perfis (cargo "Analista", ativo=false)
// assim que o convite cria o auth.users. O front, logo em seguida, grava cargo/marcas/ativo/
// telefone definitivos usando a PROPRIA sessao do Admin (supabase.from('perfis').update(...) /
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
    const redirectTo = resolveAppReturnUrl(req, typeof body.redirect_to === "string" ? body.redirect_to : undefined);

    let generated = await supabase.auth.admin.generateLink({
      type: "invite",
      email,
      options: { data: { nome }, redirectTo },
    });

    if (generated.error) {
      // Reenvio de convite pra um e-mail que ja existe (usuario convidado antes, ainda pendente):
      // type "invite" rejeita e-mail ja cadastrado em algumas versoes do Supabase Auth. type
      // "recovery" gera um link igualmente valido pra completar cadastro/definir senha em
      // qualquer usuario ja existente, confirmado ou nao - serve como fallback pro reenvio.
      generated = await supabase.auth.admin.generateLink({ type: "recovery", email, options: { redirectTo } });
      if (generated.error) throw generated.error;
    }

    if (!generated.data.user?.id) throw new Error("Convite criado, mas o usuario nao retornou id.");

    return jsonResponse({
      ok: true,
      id: generated.data.user.id,
      email: generated.data.user.email,
      action_link: generated.data.properties?.action_link ?? null,
    });
  } catch (error) {
    return jsonResponse({ error: safeErrorMessage(error, "Nao foi possivel gerar o convite.") }, 400);
  }
}));
