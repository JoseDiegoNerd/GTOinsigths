import {
  assertAdminOrGestor,
  corsHeaders,
  getAuthenticatedUser,
  getGraphVersion,
  getRequiredEnv,
  jsonResponse,
  signState,
} from "../_shared/meta.ts";

const DEFAULT_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "business_management",
  "read_insights",
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const user = await getAuthenticatedUser(req);
    await assertAdminOrGestor(user.id);

    const body = await req.json().catch(() => ({}));
    const marca = String(body.marca || "").trim();
    if (!marca || marca === "Todas") {
      return jsonResponse({ error: "Informe uma marca para conectar ao Meta Business." }, 400);
    }

    const appReturnUrl = String(body.app_return_url || req.headers.get("origin") || "http://127.0.0.1:5173");
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
    return jsonResponse({ error: error.message || "Could not start Meta OAuth." }, 400);
  }
});




