import {
  corsHeaders,
  getAdminClient,
  GOOGLE_ACCOUNTS_API,
  GOOGLE_BUSINESS_INFO_API,
  getRequiredEnv,
  googleFetch,
  jsonResponse,
  logGoogleEvent,
  verifyGoogleState,
} from "../_shared/google.ts";

// Campos pedidos via readMask na Business Information API. Conferir contra a
// documentacao viva do Google antes do primeiro teste real (nomes de campo mudam
// entre versoes da API).
const LOCATION_READ_MASK = [
  "name",
  "title",
  "phoneNumbers",
  "storefrontAddress",
  "websiteUri",
  "regularHours",
  "specialHours",
  "latlng",
  "profile",
  "openInfo",
].join(",");

function redirectTo(appReturnUrl: string, params: Record<string, string | number>) {
  const url = new URL(appReturnUrl || "http://127.0.0.1:5173");
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)));
  return Response.redirect(url.toString(), 302);
}

function formatEndereco(address: Record<string, unknown> | undefined) {
  if (!address) return null;
  const linhas = Array.isArray(address.addressLines) ? address.addressLines.join(", ") : "";
  const partes = [
    linhas,
    address.locality,
    address.administrativeArea,
    address.postalCode,
  ].filter(Boolean);
  return partes.length ? partes.join(", ") : null;
}

async function exchangeCodeForTokens(code: string) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: getRequiredEnv("GOOGLE_CLIENT_ID"),
      client_secret: getRequiredEnv("GOOGLE_CLIENT_SECRET"),
      redirect_uri: getRequiredEnv("GOOGLE_REDIRECT_URI"),
    }),
  });

  const body = await response.json();
  if (!response.ok) {
    throw new Error(body?.error_description || body?.error || "Falha ao trocar code por tokens do Google.");
  }
  return body;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const requestUrl = new URL(req.url);
  const code = requestUrl.searchParams.get("code");
  const state = requestUrl.searchParams.get("state");
  const oauthError = requestUrl.searchParams.get("error_description") || requestUrl.searchParams.get("error");

  if (!state) return jsonResponse({ error: "Missing state." }, 400);

  let parsedState: Record<string, unknown> = {};
  let appReturnUrl = "http://127.0.0.1:5173";

  try {
    parsedState = await verifyGoogleState(state);
    appReturnUrl = String(parsedState.app_return_url || appReturnUrl);
  } catch (stateError) {
    return jsonResponse({ error: stateError.message || "Invalid OAuth state." }, 400);
  }

  if (oauthError) {
    return redirectTo(appReturnUrl, { google_error: oauthError });
  }

  if (!code) {
    return redirectTo(appReturnUrl, { google_error: "Missing authorization code." });
  }

  try {
    const marca = String(parsedState.marca || "");
    if (!marca) throw new Error("Missing marca in OAuth state.");

    const tokens = await exchangeCodeForTokens(code);
    const accessToken = String(tokens.access_token);
    const refreshToken = tokens.refresh_token ? String(tokens.refresh_token) : null;
    const expiresIn = Number(tokens.expires_in || 3600);
    const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
    const scopes = String(tokens.scope || "").split(" ").filter(Boolean);

    const accountsResponse = await googleFetch(`${GOOGLE_ACCOUNTS_API}/accounts`, accessToken);
    const accounts = accountsResponse.accounts || [];

    const supabase = getAdminClient();
    let contasSalvas = 0;

    for (const account of accounts) {
      const googleAccountId = String(account.name || "");
      if (!googleAccountId) continue;

      const { data: existingConta } = await supabase
        .from("integracao_google_contas")
        .select("id,conta_confirmada,ignorada,observacao,refresh_token")
        .eq("marca", marca)
        .eq("google_account_id", googleAccountId)
        .maybeSingle();

      const { data: conta, error: contaError } = await supabase
        .from("integracao_google_contas")
        .upsert({
          marca,
          google_account_id: googleAccountId,
          email_conta: account.accountName || account.name || null,
          access_token: accessToken,
          // Google so devolve refresh_token no primeiro consentimento; preserva o anterior se nao vier um novo.
          refresh_token: refreshToken || existingConta?.refresh_token || null,
          token_type: tokens.token_type || "Bearer",
          token_expires_at: tokenExpiresAt,
          scopes,
          ativo: existingConta?.ignorada ? false : true,
          conta_confirmada: existingConta?.conta_confirmada ?? false,
          ignorada: existingConta?.ignorada ?? false,
          observacao: existingConta?.observacao || "Conta recebida via OAuth. Aguardando revisao no GTO Insights.",
        }, { onConflict: "marca,google_account_id" })
        .select("id")
        .single();

      if (contaError) throw contaError;
      contasSalvas += 1;

      const locationsResponse = await googleFetch(
        `${GOOGLE_BUSINESS_INFO_API}/${googleAccountId}/locations?readMask=${LOCATION_READ_MASK}`,
        accessToken,
      ).catch(() => ({ locations: [] }));

      for (const location of locationsResponse.locations || []) {
        const locationId = String(location.name || "");
        if (!locationId) continue;

        const { error: localError } = await supabase
          .from("integracao_google_locais")
          .upsert({
            integracao_id: conta.id,
            marca,
            location_id: locationId,
            nome_loja: location.title || null,
            endereco_completo: formatEndereco(location.storefrontAddress),
            latitude: location.latlng?.latitude ?? null,
            longitude: location.latlng?.longitude ?? null,
            telefone: location.phoneNumbers?.primaryPhone || null,
            descricao: location.profile?.description || null,
            website: location.websiteUri || null,
            horario_funcionamento: location.regularHours || {},
            horario_especial: location.specialHours || {},
            status: location.openInfo?.status || null,
            payload_bruto: location,
          }, { onConflict: "marca,location_id" });

        if (localError) throw localError;
      }

      await logGoogleEvent({
        integracao_id: conta.id,
        marca,
        tipo_evento: "oauth_callback",
        status: "sucesso",
        mensagem: "Conta Google Business Profile conectada com sucesso.",
        payload_resumo: {
          google_account_id: googleAccountId,
          locais_recebidos: (locationsResponse.locations || []).length,
        },
      });
    }

    return redirectTo(appReturnUrl, { google_connected: contasSalvas });
  } catch (callbackError) {
    await logGoogleEvent({
      marca: String(parsedState.marca || "") || null,
      tipo_evento: "oauth_callback",
      status: "erro",
      mensagem: callbackError.message || "Falha no callback OAuth Google.",
    });

    return redirectTo(appReturnUrl, { google_error: callbackError.message || "Google OAuth error" });
  }
});
