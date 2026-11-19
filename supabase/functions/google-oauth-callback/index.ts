import {
  errorMessage,
  getAdminClient,
  GOOGLE_ACCOUNTS_API,
  getRequiredEnv,
  GoogleApiError,
  googleFetch,
  jsonResponse,
  listarTodosLocais,
  logGoogleEvent,
  safeErrorMessage,
  salvarLocais,
  verifyGoogleState,
  withCors,
} from "../_shared/google.ts";

// Locais sincronizados ha menos que isso nao sao rebuscados no Google ao reconectar a conta:
// a listagem conta na cota por minuto e os dados cadastrais quase nao mudam.
const LOCATIONS_CACHE_TTL_MS = 10 * 60 * 1000;

function redirectTo(appReturnUrl: string, params: Record<string, string | number>) {
  const url = new URL(appReturnUrl || "http://127.0.0.1:5173");
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)));
  return Response.redirect(url.toString(), 302);
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

Deno.serve(withCors(async (req) => {

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
    return jsonResponse({ error: safeErrorMessage(stateError, "OAuth state invalido.") }, 400);
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

    const supabase = getAdminClient();

    // accounts.list tambem e paginado pelo Google (20 por pagina): percorre todas as paginas.
    // deno-lint-ignore no-explicit-any
    const accounts: any[] = [];
    try {
      let pageToken = "";
      for (let pagina = 0; pagina < 50; pagina++) {
        const params = new URLSearchParams({ pageSize: "20" });
        if (pageToken) params.set("pageToken", pageToken);
        const accountsResponse = await googleFetch(`${GOOGLE_ACCOUNTS_API}/accounts?${params}`, accessToken);
        accounts.push(...(accountsResponse.accounts || []));
        const proximo = String(accountsResponse.nextPageToken || "");
        if (!proximo || proximo === pageToken) break;
        pageToken = proximo;
      }
    } catch (accountsError) {
      if (!(accountsError instanceof GoogleApiError) || !accountsError.isQuota) throw accountsError;

      // Cota estourada mesmo apos o backoff: se a marca ja tem contas salvas, mantem o que esta no
      // banco e avisa em vez de tratar como falha de conexao.
      const { count } = await supabase
        .from("integracao_google_contas")
        .select("id", { count: "exact", head: true })
        .eq("marca", marca);

      await logGoogleEvent({
        marca,
        tipo_evento: "oauth_callback",
        status: "aviso",
        mensagem: accountsError.message,
      });

      if (count) {
        return redirectTo(appReturnUrl, {
          google_connected: count,
          google_warning: "Cota da API do Google excedida ao atualizar a lista de contas. Mantivemos as contas ja salvas; tente reconectar em alguns minutos.",
        });
      }
      throw accountsError;
    }

    let contasSalvas = 0;

    for (const account of accounts) {
      const googleAccountId = String(account.name || "");
      if (!googleAccountId) continue;

      const dadosToken = {
        email_conta: account.accountName || account.name || null,
        access_token: accessToken,
        token_type: tokens.token_type || "Bearer",
        token_expires_at: tokenExpiresAt,
        scopes,
      };

      // A marca de cada conta e definida no menu Conexoes. Se esta conta Google ja existe (em
      // qualquer marca), so renova os tokens e mantem a marca/confirmacao escolhidas la; a marca
      // selecionada no momento da conexao vale apenas para contas novas.
      const { data: contasExistentes, error: existentesError } = await supabase
        .from("integracao_google_contas")
        .select("id,marca,refresh_token")
        .eq("google_account_id", googleAccountId);
      if (existentesError) throw existentesError;

      const contasDestino: { id: string; marca: string }[] = [];

      if (contasExistentes?.length) {
        for (const existente of contasExistentes) {
          const { error: updateError } = await supabase
            .from("integracao_google_contas")
            .update({
              ...dadosToken,
              // Google so devolve refresh_token no primeiro consentimento; preserva o anterior se nao vier um novo.
              refresh_token: refreshToken || existente.refresh_token || null,
            })
            .eq("id", existente.id);
          if (updateError) throw updateError;
          contasDestino.push({ id: existente.id, marca: existente.marca });
        }
      } else {
        const { data: nova, error: insertError } = await supabase
          .from("integracao_google_contas")
          .insert({
            ...dadosToken,
            marca,
            google_account_id: googleAccountId,
            refresh_token: refreshToken,
            ativo: true,
            conta_confirmada: false,
            ignorada: false,
            observacao: "Conta recebida via OAuth. Vincule a marca correta em Conexoes.",
          })
          .select("id")
          .single();
        if (insertError) throw insertError;
        contasDestino.push({ id: nova.id, marca });
      }

      contasSalvas += 1;

      for (const conta of contasDestino) {
        const { data: ultimoLocal } = await supabase
          .from("integracao_google_locais")
          .select("atualizado_em")
          .eq("integracao_id", conta.id)
          .order("atualizado_em", { ascending: false })
          .limit(1)
          .maybeSingle();

        const locaisEmCache = ultimoLocal?.atualizado_em
          && Date.now() - new Date(ultimoLocal.atualizado_em).getTime() < LOCATIONS_CACHE_TTL_MS;

        // Lista todas as paginas (pageSize=100 + nextPageToken). Falha aqui nao derruba a conexao:
        // a sincronizacao das contas confirmadas busca os locais de novo.
        const listagem = locaisEmCache
          ? { locations: [], completo: true }
          : await listarTodosLocais(googleAccountId, accessToken).catch(() => ({ locations: [], completo: false }));

        await salvarLocais(conta, listagem.locations);

        await logGoogleEvent({
          integracao_id: conta.id,
          marca: conta.marca,
          tipo_evento: "oauth_callback",
          status: "sucesso",
          mensagem: "Conta Google Business Profile conectada com sucesso.",
          payload_resumo: {
            google_account_id: googleAccountId,
            locais_recebidos: listagem.locations.length,
            listagem_completa: listagem.completo,
          },
        });
      }
    }

    return redirectTo(appReturnUrl, { google_connected: contasSalvas });
  } catch (callbackError) {
    await logGoogleEvent({
      marca: String(parsedState.marca || "") || null,
      tipo_evento: "oauth_callback",
      status: "erro",
      mensagem: errorMessage(callbackError),
    });

    return redirectTo(appReturnUrl, { google_error: safeErrorMessage(callbackError, "Falha no callback OAuth Google.") });
  }
}));
