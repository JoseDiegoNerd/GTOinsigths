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

// A tabela public.perfis (via RLS) ja daria pra Admin/Gestor listar nome/cargo/marcas direto do
// client, sem Edge Function nenhuma. O que forca isto a existir e last_sign_in_at/mfa_enrolled:
// esses campos vivem em auth.users/auth.mfa_factors, que o schema `auth` nao expoe via
// PostgREST - so a Admin API (supabase.auth.admin.listUsers, exige service_role) enxerga.
Deno.serve(withCors(async (req) => {
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const user = await getAuthenticatedUser(req);
    await assertAal2(req, user.id);
    await assertCargoPermitido(user.id, CARGOS_PERMITIDOS);

    const supabase = getAdminClient();

    const [{ data: perfis, error: perfisError }, { data: marcasRows, error: marcasError }] = await Promise.all([
      supabase
        .from("perfis")
        .select("id,email,nome,cargo,ativo,avatar_url,cargo_oficial,origem_convite,telefone,criado_em,atualizado_em")
        .order("criado_em", { ascending: false }),
      supabase.from("perfis_marcas").select("perfil_id,marca"),
    ]);

    if (perfisError) throw perfisError;
    if (marcasError) throw marcasError;

    const marcasPorPerfil = new Map<string, string[]>();
    for (const row of marcasRows ?? []) {
      const lista = marcasPorPerfil.get(row.perfil_id) ?? [];
      lista.push(row.marca);
      marcasPorPerfil.set(row.perfil_id, lista);
    }

    // listUsers pagina 50 por padrao - varre ate a ultima pagina (trava em 25 paginas /
    // ~5000 usuarios como limite de seguranca contra loop infinito se a API mudar contrato).
    const authPorId = new Map<
      string,
      { last_sign_in_at: string | null; email_confirmed_at: string | null; mfa_enrolled: boolean }
    >();
    const perPage = 200;
    for (let page = 1; page <= 25; page += 1) {
      const { data: pageData, error: listError } = await supabase.auth.admin.listUsers({ page, perPage });
      if (listError) throw listError;

      for (const authUser of pageData.users) {
        authPorId.set(authUser.id, {
          last_sign_in_at: authUser.last_sign_in_at ?? null,
          email_confirmed_at: authUser.email_confirmed_at ?? null,
          mfa_enrolled: Array.isArray(authUser.factors)
            ? authUser.factors.some((factor) => factor.status === "verified")
            : false,
        });
      }

      if (pageData.users.length < perPage) break;
    }

    const usuarios = (perfis ?? []).map((perfil) => ({
      ...perfil,
      marcas: marcasPorPerfil.get(perfil.id) ?? [],
      last_sign_in_at: authPorId.get(perfil.id)?.last_sign_in_at ?? null,
      email_confirmed_at: authPorId.get(perfil.id)?.email_confirmed_at ?? null,
      mfa_enrolled: authPorId.get(perfil.id)?.mfa_enrolled ?? false,
    }));

    return jsonResponse({ usuarios });
  } catch (error) {
    return jsonResponse({ error: safeErrorMessage(error, "Nao foi possivel carregar os usuarios.") }, 400);
  }
}));
