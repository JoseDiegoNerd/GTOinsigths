import {
  assertAdminOrGestor,
  getAuthenticatedUser,
  getGraphVersion,
  getRequiredEnv,
  jsonResponse,
  resolveAppReturnUrl,
  safeErrorMessage,
  signState,
  withCors,
} from "../_shared/meta.ts";

const DEFAULT_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "business_management",
  "read_insights",
  "instagram_basic",
  "instagram_manage_insights",
  "ads_read",
];

Deno.serve(withCors(async (req) => {
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const user = await getAuthenticatedUser(req);
    await assertAdminOrGestor(user.id);

    const body = await req.json().catch(() => ({}));
    const marca = String(body.marca || "").trim();
    if (!marca || marca === "Todas") {
      return jsonResponse({ error: "Informe uma marca para conectar ao Meta Business." }, 400);
    }

    const appReturnUrl = resolveAppReturnUrl(req, body.app_return_url);
    const state = await signState({
      uid: user.id,
      marca,
      app_return_url: appReturnUrl,
      nonce: crypto.randomUUID(),
      ts: Date.now(),
    });

    const url = new URL(`https://www.facebook.com/${getGraphVersion()}/dialog/oauth`);
    url.searchParams.set("client_id", getRequiredEnv("META_APP_ID"));
    url.searchParams.set("redirect_uri", getRequiredEnv("META_REDIRECT_URI"));
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", DEFAULT_SCOPES.join(","));
    url.searchParams.set("state", state);

    return jsonResponse({ authorizeUrl: url.toString(), scopes: DEFAULT_SCOPES });
  } catch (error) {
    return jsonResponse({ error: safeErrorMessage(error, "Nao foi possivel iniciar a conexao com o Meta.") }, 400);
  }
}));




