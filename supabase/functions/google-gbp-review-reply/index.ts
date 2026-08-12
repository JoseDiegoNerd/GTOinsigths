import {
  assertAcessoMarca,
  assertCargoPermitido,
  corsHeaders,
  getAdminClient,
  getAuthenticatedUser,
  getValidAccessToken,
  GOOGLE_MYBUSINESS_LEGACY_API,
  googleFetch,
  jsonResponse,
  logGoogleEvent,
  safeErrorMessage,
} from "../_shared/google.ts";

const CARGOS_PERMITIDOS = ["Admin", "Gestor", "Coordenador", "Analista"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const user = await getAuthenticatedUser(req);
    await assertCargoPermitido(user.id, CARGOS_PERMITIDOS);

    const body = await req.json().catch(() => ({}));
    const reviewId = String(body.review_id || "").trim();
    const action = String(body.action || "reply");
    const texto = String(body.texto || "").trim();

    if (!reviewId) return jsonResponse({ error: "Informe review_id." }, 400);
    if (!["reply", "delete"].includes(action)) return jsonResponse({ error: "action deve ser 'reply' ou 'delete'." }, 400);
    if (action === "reply" && !texto) return jsonResponse({ error: "Informe o texto da resposta." }, 400);

    const supabase = getAdminClient();

    const { data: avaliacao, error: avaliacaoError } = await supabase
      .from("integracao_google_avaliacoes")
      .select("id,marca,review_id,integracao_id,local_id")
      .eq("review_id", reviewId)
      .maybeSingle();

    if (avaliacaoError) throw avaliacaoError;
    if (!avaliacao) return jsonResponse({ error: "Avaliacao nao encontrada." }, 404);

    await assertAcessoMarca(user.id, avaliacao.marca);

    const { data: integracao, error: integracaoError } = await supabase
      .from("integracao_google_contas")
      .select("id,google_account_id,access_token,refresh_token,token_expires_at")
      .eq("id", avaliacao.integracao_id)
      .maybeSingle();

    if (integracaoError) throw integracaoError;
    if (!integracao) return jsonResponse({ error: "Conta Google nao encontrada para esta avaliacao." }, 404);

    const { data: local, error: localError } = await supabase
      .from("integracao_google_locais")
      .select("location_id")
      .eq("id", avaliacao.local_id)
      .maybeSingle();

    if (localError) throw localError;
    if (!local) return jsonResponse({ error: "Local nao encontrado para esta avaliacao." }, 404);

    const accessToken = await getValidAccessToken(integracao);
    const replyUrl = `${GOOGLE_MYBUSINESS_LEGACY_API}/${integracao.google_account_id}/${local.location_id}/reviews/${reviewId}/reply`;

    if (action === "reply") {
      // Google so tem PUT para responder — funciona como upsert (cria ou substitui a resposta existente).
      await googleFetch(replyUrl, accessToken, {
        method: "PUT",
        body: JSON.stringify({ comment: texto }),
      });

      const { error: updateError } = await supabase
        .from("integracao_google_avaliacoes")
        .update({
          resposta_texto: texto,
          status_resposta: "respondida",
          resposta_em: new Date().toISOString(),
          respondido_por: user.id,
        })
        .eq("id", avaliacao.id);

      if (updateError) throw updateError;

      await logGoogleEvent({
        integracao_id: integracao.id,
        marca: avaliacao.marca,
        tipo_evento: "resposta_avaliacao_gmb",
        status: "sucesso",
        mensagem: "Resposta enviada para avaliacao no Google Business Profile.",
        payload_resumo: { review_id: reviewId, usuario_id: user.id, texto },
      });

      return jsonResponse({ ok: true, action: "reply" });
    }

    await googleFetch(replyUrl, accessToken, { method: "DELETE" });

    const { error: deleteUpdateError } = await supabase
      .from("integracao_google_avaliacoes")
      .update({
        resposta_texto: null,
        status_resposta: "pendente",
        resposta_em: null,
        respondido_por: null,
      })
      .eq("id", avaliacao.id);

    if (deleteUpdateError) throw deleteUpdateError;

    await logGoogleEvent({
      integracao_id: integracao.id,
      marca: avaliacao.marca,
      tipo_evento: "exclusao_resposta_gmb",
      status: "sucesso",
      mensagem: "Resposta removida da avaliacao no Google Business Profile.",
      payload_resumo: { review_id: reviewId, usuario_id: user.id },
    });

    return jsonResponse({ ok: true, action: "delete" });
  } catch (error) {
    return jsonResponse({ error: safeErrorMessage(error, "Nao foi possivel processar a resposta da avaliacao.") }, 400);
  }
});
