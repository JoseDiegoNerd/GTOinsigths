import {
  corsHeaders,
  getAdminClient,
  getRequiredEnv,
  jsonResponse,
  logMetaEvent,
  metaGet,
  verifyState,
} from "../_shared/meta.ts";

const META_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "business_management",
  "read_insights",
  "instagram_basic",
  "instagram_manage_insights",
  "ads_read",
];

function redirectTo(appReturnUrl: string, params: Record<string, string | number>) {
  const url = new URL(appReturnUrl || "http://127.0.0.1:5173");
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)));
  return Response.redirect(url.toString(), 302);
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
    parsedState = await verifyState(state);
    appReturnUrl = String(parsedState.app_return_url || appReturnUrl);
  } catch (stateError) {
    return jsonResponse({ error: stateError.message || "Invalid OAuth state." }, 400);
  }

  if (oauthError) {
    return redirectTo(appReturnUrl, { meta_error: oauthError });
  }

  if (!code) {
    return redirectTo(appReturnUrl, { meta_error: "Missing authorization code." });
  }

  try {
    const marca = String(parsedState.marca || "");
    if (!marca) throw new Error("Missing marca in OAuth state.");

    const shortToken = await metaGet("/oauth/access_token", {
      client_id: getRequiredEnv("META_APP_ID"),
      client_secret: getRequiredEnv("META_APP_SECRET"),
      redirect_uri: getRequiredEnv("META_REDIRECT_URI"),
      code,
    });

    const longToken = await metaGet("/oauth/access_token", {
      grant_type: "fb_exchange_token",
      client_id: getRequiredEnv("META_APP_ID"),
      client_secret: getRequiredEnv("META_APP_SECRET"),
      fb_exchange_token: shortToken.access_token,
    });

    const userAccessToken = String(longToken.access_token || shortToken.access_token);
    const expiresIn = Number(longToken.expires_in || shortToken.expires_in || 0);
    const tokenExpiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null;

    const pages = await metaGet("/me/accounts", {
      fields: "id,name,access_token,instagram_business_account{id,username}",
      access_token: userAccessToken,
    });

    const supabase = getAdminClient();
    const saved = [];

    for (const page of pages.data || []) {
      const pageToken = page.access_token || userAccessToken;
      const instagram = page.instagram_business_account || {};

      const { data: existingAccount } = await supabase
        .from("integracao_meta_contas")
        .select("conta_confirmada,ignorada,observacao")
        .eq("marca", marca)
        .eq("page_id", page.id)
        .maybeSingle();

      const { data, error: upsertError } = await supabase
        .from("integracao_meta_contas")
        .upsert({
          marca,
          meta_business_id: null,
          page_id: page.id,
          page_name: page.name,
          instagram_business_account_id: instagram.id || null,
          instagram_username: instagram.username || null,
          access_token: pageToken,
          token_type: longToken.token_type || shortToken.token_type || "bearer",
          token_expires_at: tokenExpiresAt,
          scopes: META_SCOPES,
          ativo: existingAccount?.ignorada ? false : true,
          conta_confirmada: existingAccount?.conta_confirmada ?? false,
          ignorada: existingAccount?.ignorada ?? false,
          observacao: existingAccount?.observacao || "Conta recebida via OAuth. Aguardando revisao no GTO Insights.",
        }, { onConflict: "marca,page_id" })
        .select("id,page_id,page_name,instagram_business_account_id,instagram_username")
        .single();

      if (upsertError) throw upsertError;
      saved.push(data);

      await logMetaEvent({
        integracao_id: data.id,
        marca,
        tipo_evento: "oauth_callback",
        status: "sucesso",
        mensagem: "Conta Meta conectada com sucesso.",
        payload_resumo: {
          page_id: page.id,
          page_name: page.name,
          has_instagram: Boolean(instagram.id),
        },
      });
    }

    const adAccounts = await metaGet("/me/adaccounts", {
      fields: "id,name,account_status,currency,timezone_name",
      access_token: userAccessToken,
    }).catch((adAccountsError) => {
      // ads_read pode nao estar aprovado ainda para o usuario/app; nao falha a conexao de
      // Paginas por causa disso, so registra o aviso.
      logMetaEvent({
        marca,
        tipo_evento: "oauth_callback_ads",
        status: "aviso",
        mensagem: adAccountsError.message || "Nao foi possivel listar contas de anuncios.",
      });
      return { data: [] };
    });

    let savedAdAccounts = 0;
    for (const account of adAccounts.data || []) {
      const { data: existingAdAccount } = await supabase
        .from("integracao_meta_ads_contas")
        .select("conta_confirmada,ignorada,observacao")
        .eq("marca", marca)
        .eq("ad_account_id", account.id)
        .maybeSingle();

      const { data: savedAccount, error: adAccountError } = await supabase
        .from("integracao_meta_ads_contas")
        .upsert({
          marca,
          ad_account_id: account.id,
          ad_account_name: account.name,
          moeda: account.currency || null,
          fuso_horario: account.timezone_name || null,
          access_token: userAccessToken,
          token_type: longToken.token_type || shortToken.token_type || "bearer",
          token_expires_at: tokenExpiresAt,
          scopes: META_SCOPES,
          ativo: existingAdAccount?.ignorada ? false : true,
          conta_confirmada: existingAdAccount?.conta_confirmada ?? false,
          ignorada: existingAdAccount?.ignorada ?? false,
          observacao: existingAdAccount?.observacao || "Conta de anuncios recebida via OAuth. Aguardando revisao no GTO Insights.",
        }, { onConflict: "marca,ad_account_id" })
        .select("id")
        .single();

      if (adAccountError) throw adAccountError;
      savedAdAccounts += 1;

      await logMetaEvent({
        integracao_id: savedAccount.id,
        marca,
        tipo_evento: "oauth_callback_ads",
        status: "sucesso",
        mensagem: "Conta de anuncios Meta conectada com sucesso.",
        payload_resumo: { ad_account_id: account.id, ad_account_name: account.name },
      });
    }

    return redirectTo(appReturnUrl, { meta_connected: saved.length, meta_ads_connected: savedAdAccounts });
  } catch (callbackError) {
    await logMetaEvent({
      marca: String(parsedState.marca || "") || null,
      tipo_evento: "oauth_callback",
      status: "erro",
      mensagem: callbackError.message || "Falha no callback OAuth Meta.",
    });

    return redirectTo(appReturnUrl, { meta_error: callbackError.message || "Meta OAuth error" });
  }
});





