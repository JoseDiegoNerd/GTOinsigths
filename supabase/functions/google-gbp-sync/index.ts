import {
  assertAdminOrGestor,
  corsHeaders,
  getAdminClient,
  getAuthenticatedUser,
  getValidAccessToken,
  GOOGLE_BUSINESS_INFO_API,
  GOOGLE_MYBUSINESS_LEGACY_API,
  GOOGLE_PERFORMANCE_API,
  googleFetch,
  jsonResponse,
  logGoogleEvent,
} from "../_shared/google.ts";

type Integracao = {
  id: string;
  marca: string;
  google_account_id: string;
  access_token: string;
  refresh_token: string | null;
  token_expires_at: string | null;
};

type Local = {
  id: string;
  location_id: string;
};

const STAR_RATING: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

// Metricas de performance pedidas — conferir nomes contra a documentacao viva da
// Business Profile Performance API antes do primeiro teste real.
const DAILY_METRICS = [
  "WEBSITE_CLICKS",
  "CALL_CLICKS",
  "BUSINESS_DIRECTION_REQUESTS",
  "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH",
  "BUSINESS_IMPRESSIONS_MOBILE_SEARCH",
  "BUSINESS_IMPRESSIONS_DESKTOP_MAPS",
  "BUSINESS_IMPRESSIONS_MOBILE_MAPS",
];

function isoDateParts(date: Date) {
  return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() };
}

function daysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}

async function tryFetch<T>(label: string, fn: () => Promise<T>, warnings: string[]): Promise<T | null> {
  try {
    return await fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnings.push(`${label}: ${message}`);
    return null;
  }
}

async function syncLocais(integracao: Integracao, accessToken: string, warnings: string[]) {
  const supabase = getAdminClient();
  const { data: locais } = await supabase
    .from("integracao_google_locais")
    .select("id,location_id")
    .eq("integracao_id", integracao.id);

  return (locais || []) as Local[];
}

async function syncReviews(integracao: Integracao, local: Local, accessToken: string, warnings: string[]) {
  const parent = `${integracao.google_account_id}/${local.location_id}`;
  const response = await tryFetch(
    `Reviews ${local.location_id}`,
    () => googleFetch(`${GOOGLE_MYBUSINESS_LEGACY_API}/${parent}/reviews`, accessToken),
    warnings,
  );

  if (!response?.reviews?.length) return 0;

  const supabase = getAdminClient();
  let imported = 0;

  for (const review of response.reviews) {
    const reviewId = String(review.reviewId || "");
    if (!reviewId) continue;

    const temResposta = Boolean(review.reviewReply?.comment);

    const { error } = await supabase
      .from("integracao_google_avaliacoes")
      .upsert({
        integracao_id: integracao.id,
        local_id: local.id,
        marca: integracao.marca,
        review_id: reviewId,
        autor_nome: review.reviewer?.displayName || null,
        autor_foto_url: review.reviewer?.profilePhotoUrl || null,
        rating: STAR_RATING[String(review.starRating)] || null,
        comentario: review.comment || null,
        avaliado_em: review.createTime || null,
        status_resposta: temResposta ? "respondida" : "pendente",
        resposta_texto: review.reviewReply?.comment || null,
        resposta_em: review.reviewReply?.updateTime || null,
        payload_bruto: review,
      }, { onConflict: "marca,review_id" });

    if (error) throw error;
    imported += 1;
  }

  return imported;
}

async function syncMetricas(integracao: Integracao, local: Local, accessToken: string, warnings: string[]) {
  const start = isoDateParts(daysAgo(30));
  const end = isoDateParts(new Date());

  const params = new URLSearchParams();
  DAILY_METRICS.forEach((metric) => params.append("dailyMetrics", metric));
  params.set("dailyRange.start_date.year", String(start.year));
  params.set("dailyRange.start_date.month", String(start.month));
  params.set("dailyRange.start_date.day", String(start.day));
  params.set("dailyRange.end_date.year", String(end.year));
  params.set("dailyRange.end_date.month", String(end.month));
  params.set("dailyRange.end_date.day", String(end.day));

  const response = await tryFetch(
    `Metricas ${local.location_id}`,
    () => googleFetch(`${GOOGLE_PERFORMANCE_API}/${local.location_id}:fetchMultiDailyMetricsTimeSeries?${params}`, accessToken),
    warnings,
  );

  if (!response?.multiDailyMetricTimeSeries?.length) return 0;

  const porData = new Map<string, Record<string, number>>();
  const campoPorMetrica: Record<string, string> = {
    WEBSITE_CLICKS: "cliques_website",
    CALL_CLICKS: "chamadas_telefone",
    BUSINESS_DIRECTION_REQUESTS: "solicitacoes_rota",
    BUSINESS_IMPRESSIONS_DESKTOP_SEARCH: "impressoes_busca",
    BUSINESS_IMPRESSIONS_MOBILE_SEARCH: "impressoes_busca",
    BUSINESS_IMPRESSIONS_DESKTOP_MAPS: "impressoes_descoberta",
    BUSINESS_IMPRESSIONS_MOBILE_MAPS: "impressoes_descoberta",
  };

  for (const serie of response.multiDailyMetricTimeSeries || []) {
    const metricName = String(serie.dailyMetric || "");
    const campo = campoPorMetrica[metricName];
    if (!campo) continue;

    for (const item of serie.timeSeries?.datedValues || []) {
      const date = item.date;
      if (!date) continue;
      const dataRef = `${date.year}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
      const valor = Number(item.value || 0);

      const atual = porData.get(dataRef) || {
        cliques_website: 0,
        chamadas_telefone: 0,
        solicitacoes_rota: 0,
        impressoes_busca: 0,
        impressoes_descoberta: 0,
      };
      atual[campo] = (atual[campo] || 0) + (Number.isFinite(valor) ? valor : 0);
      porData.set(dataRef, atual);
    }
  }

  if (!porData.size) return 0;

  const supabase = getAdminClient();
  let imported = 0;

  for (const [dataReferencia, valores] of porData.entries()) {
    const { error } = await supabase
      .from("integracao_google_metricas_diarias")
      .upsert({
        local_id: local.id,
        marca: integracao.marca,
        data_referencia: dataReferencia,
        ...valores,
        payload_bruto: { origem: "businessprofileperformance", metrics: DAILY_METRICS },
      }, { onConflict: "local_id,data_referencia" });

    if (error) throw error;
    imported += 1;
  }

  return imported;
}

async function syncFotos(integracao: Integracao, local: Local, accessToken: string, warnings: string[]) {
  const response = await tryFetch(
    `Fotos ${local.location_id}`,
    () => googleFetch(`${GOOGLE_BUSINESS_INFO_API}/${local.location_id}/media`, accessToken),
    warnings,
  );

  if (!response?.mediaItems?.length) return 0;

  const supabase = getAdminClient();
  let imported = 0;

  for (const item of response.mediaItems) {
    const mediaId = String(item.name || "");
    if (!mediaId) continue;

    // Distincao proprietario/cliente nao e exposta de forma direta e confiavel por
    // este endpoint para todo tipo de item — assume "proprietario" como padrao e
    // marca "cliente" apenas quando o atributo vier explicito. Conferir depois.
    const origem = item.attribution ? "cliente" : "proprietario";

    const { error } = await supabase
      .from("integracao_google_fotos")
      .upsert({
        local_id: local.id,
        marca: integracao.marca,
        media_id: mediaId,
        url: item.googleUrl || item.sourceUrl || null,
        origem,
        categoria: item.locationAssociation?.category || item.category || null,
        criado_em_google: item.createTime || null,
        payload_bruto: item,
      }, { onConflict: "local_id,media_id" });

    if (error) throw error;
    imported += 1;
  }

  return imported;
}

async function refreshStageResumo(marcas: string[]) {
  const supabase = getAdminClient();
  const uniqueMarcas = [...new Set(marcas)].filter(Boolean);
  const today = new Date().toISOString().slice(0, 10);

  for (const marca of uniqueMarcas) {
    const { data: locais, error } = await supabase
      .from("integracao_google_locais")
      .select("id,location_id,nome_loja")
      .eq("marca", marca);

    if (error) throw error;
    if (!locais?.length) continue;

    for (const local of locais) {
      const { data: avaliacoes } = await supabase
        .from("integracao_google_avaliacoes")
        .select("rating,status_resposta")
        .eq("local_id", local.id);

      const notas = (avaliacoes || []).map((row: any) => Number(row.rating)).filter((n: number) => Number.isFinite(n));
      const ratingMedio = notas.length ? notas.reduce((sum: number, n: number) => sum + n, 0) / notas.length : null;
      const pendentes = (avaliacoes || []).some((row: any) => row.status_resposta === "pendente");

      await supabase.from("stage_google_business_profile").upsert({
        marca,
        id_loja_gmb: local.location_id,
        nome_loja: local.nome_loja,
        rating_medio: ratingMedio,
        status_resposta: pendentes ? "Pendente" : "Respondida",
        data_referencia: today,
        origem_api: "google_business_profile_api",
      }, { onConflict: "marca,id_loja_gmb,data_referencia" });
    }
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const user = await getAuthenticatedUser(req);
    await assertAdminOrGestor(user.id);

    const body = await req.json().catch(() => ({}));
    const supabase = getAdminClient();

    let query = supabase
      .from("integracao_google_contas")
      .select("id,marca,google_account_id,access_token,refresh_token,token_expires_at")
      .eq("ativo", true)
      .eq("conta_confirmada", true)
      .eq("ignorada", false);

    if (body.integracao_id) query = query.eq("id", body.integracao_id);
    if (body.marca && body.marca !== "Todas") query = query.eq("marca", body.marca);

    const { data: integracoes, error } = await query;
    if (error) throw error;

    if (!integracoes?.length) {
      return jsonResponse({ ok: true, results: [], message: "Nenhuma conta Google confirmada para sincronizacao." });
    }

    const results = [];
    const syncedMarcas: string[] = [];

    for (const integracao of integracoes as Integracao[]) {
      await logGoogleEvent({
        integracao_id: integracao.id,
        marca: integracao.marca,
        tipo_evento: "sync_gbp",
        status: "iniciado",
        mensagem: "Sincronizacao Google Business Profile iniciada.",
      });

      const warnings: string[] = [];
      const result = {
        id: integracao.id,
        marca: integracao.marca,
        reviewsImported: 0,
        metricasImportadas: 0,
        fotosImportadas: 0,
        warnings,
        error: undefined as string | undefined,
      };

      try {
        const accessToken = await getValidAccessToken(integracao);
        const locais = await syncLocais(integracao, accessToken, warnings);

        if (!locais.length) {
          warnings.push("Nenhum local sincronizado ainda para esta conta — rode a conexao novamente se lojas foram adicionadas.");
        }

        for (const local of locais) {
          result.reviewsImported += await syncReviews(integracao, local, accessToken, warnings);
          result.metricasImportadas += await syncMetricas(integracao, local, accessToken, warnings);
          result.fotosImportadas += await syncFotos(integracao, local, accessToken, warnings);
        }

        await supabase
          .from("integracao_google_contas")
          .update({ ultima_sincronizacao_em: new Date().toISOString() })
          .eq("id", integracao.id);

        syncedMarcas.push(integracao.marca);

        await logGoogleEvent({
          integracao_id: integracao.id,
          marca: integracao.marca,
          tipo_evento: "sync_gbp",
          status: "sucesso",
          mensagem: "Sincronizacao Google Business Profile concluida.",
          payload_resumo: {
            reviewsImported: result.reviewsImported,
            metricasImportadas: result.metricasImportadas,
            fotosImportadas: result.fotosImportadas,
            warnings: warnings.slice(0, 5),
          },
        });
      } catch (syncError) {
        result.error = syncError instanceof Error ? syncError.message : String(syncError);
        await logGoogleEvent({
          integracao_id: integracao.id,
          marca: integracao.marca,
          tipo_evento: "sync_gbp",
          status: "erro",
          mensagem: result.error,
          payload_resumo: { warnings: warnings.slice(0, 5) },
        });
      }

      results.push(result);
    }

    await refreshStageResumo(syncedMarcas);

    return jsonResponse({
      ok: true,
      results,
      message: `Sincronizacao concluida para ${results.length} conta(s).`,
    });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Could not sync Google Business Profile." }, 400);
  }
});
