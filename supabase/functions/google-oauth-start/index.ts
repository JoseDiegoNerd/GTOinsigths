import {
  assertAdminOrGestor,
  corsHeaders,
  getAuthenticatedUser,
  getGoogleOAuthScopes,
  getRequiredEnv,
  jsonResponse,
  resolveAppReturnUrl,
  safeErrorMessage,
  signGoogleState,
} from "../_shared/google.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const user = await getAuthenticatedUser(req);
    await assertAdminOrGestor(user.id);

    const body = await req.json().catch(() => ({}));
    const marca = String(body.marca || "").trim();
    if (!marca || marca === "Todas") {
      return jsonResponse({ error: "Informe uma marca para conectar ao Google Business Profile." }, 400);
    }

    const appReturnUrl = resolveAppReturnUrl(req, body.app_return_url);
    const scopes = getGoogleOAuthScopes();
    const state = await signGoogleState({
      uid: user.id,
      marca,
      app_return_url: appReturnUrl,
      nonce: crypto.randomUUID(),
      ts: Date.now(),
    });

    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", getRequiredEnv("GOOGLE_CLIENT_ID"));
    url.searchParams.set("redirect_uri", getRequiredEnv("GOOGLE_REDIRECT_URI"));
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", scopes.join(" "));
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("state", state);

    return jsonResponse({ authorizeUrl: url.toString(), scopes });
  } catch (error) {
    return jsonResponse({ error: safeErrorMessage(error, "Nao foi possivel iniciar a conexao com o Google.") }, 400);
  }
});
