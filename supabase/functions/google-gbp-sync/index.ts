import {
  assertAdminOrGestor,
  errorMessage,
  getAdminClient,
  getAuthenticatedUser,
  getValidAccessToken,
  GoogleApiError,
  GOOGLE_MYBUSINESS_LEGACY_API,
  GOOGLE_PERFORMANCE_API,
  googleFetch,
  jsonResponse,
  listarTodosLocais,
  logGoogleEvent,
  safeErrorMessage,
  salvarLocais,
  sleepMs,
  withCors,
} from "../_shared/google.ts";
import { classificarPendentes } from "../_shared/reputation.ts";

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
  nome_loja: string | null;
  avaliacoes_sincronizadas_em: string | null;
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

// A cota da Business Profile API e por projeto Google Cloud (nao por loja ou marca): se uma
// chamada esgota a cota mesmo apos o backoff de googleFetch, as proximas tem a mesma certeza de
// falhar. Esse estado e compartilhado por toda a execucao da funcao para parar de insistir assim
// que a cota acaba, em vez de gastar o backoff (ate ~30s por chamada) em cada loja/conta restante.
type EstadoCota = { esgotada: boolean };

// Pausa entre lojas para espacar as chamadas dentro do limite de requisicoes por minuto do Google.
const PACING_ENTRE_LOJAS_MS = 400;

async function tryFetch<T>(label: string, fn: () => Promise<T>, warnings: string[], estadoCota: EstadoCota): Promise<T | null> {
  if (estadoCota.esgotada) return null;
  try {
    return await fn();
  } catch (error) {
    if (error instanceof GoogleApiError && error.isQuota) estadoCota.esgotada = true;
    const message = error instanceof Error ? error.message : String(error);
    warnings.push(`${label}: ${message}`);
    return null;
  }
}

// Rebusca no Google TODAS as lojas da conta/grupo (locations.list com pageSize=100 e loop de
// nextPageToken) antes de sincronizar avaliacoes/metricas/fotos. Sem isso a rede ficava limitada
// as 10 primeiras lojas (pagina padrao do Google) gravadas na conexao. Se a listagem falhar (ex.:
// cota), segue com as lojas ja gravadas no banco.
async function syncLocais(integracao: Integracao, accessToken: string, warnings: string[], estadoCota: EstadoCota) {
  const listagem = await tryFetch(
    `Locais ${integracao.google_account_id}`,
    () => listarTodosLocais(integracao.google_account_id, accessToken),
    warnings,
    estadoCota,
  );

  let locaisImportados = 0;
  if (listagem) {
    locaisImportados = await salvarLocais(integracao, listagem.locations);
    if (!listagem.completo) {
      warnings.push(`Locais ${integracao.google_account_id}: limite de paginas atingido; parte das lojas pode nao ter sido importada.`);
    }
  }

  const supabase = getAdminClient();
  const { data: locais, error } = await supabase
    .from("integracao_google_locais")
    .select("id,location_id,nome_loja,avaliacoes_sincronizadas_em")
    .eq("integracao_id", integracao.id);
  if (error) throw error;

  return { locais: (locais || []) as Local[], locaisImportados };
}

// reviews.list (v4) aceita no maximo 50 por pagina e ordena por updateTime desc por padrao.
const REVIEWS_PAGE_SIZE = 50;
// Teto por loja e por execucao (20 x 50 = 1.000 avaliacoes). Na primeira sincronizacao de uma
// loja muito avaliada o restante entra nas execucoes seguintes so se for editado depois; o
// averageRating/totalReviewCount gravado na unidade vem do Google e e sempre o da ficha inteira.
const REVIEWS_MAX_PAGES = 20;

// Busca as avaliacoes de uma loja, grava nota media/total na unidade e espelha cada avaliacao em
// integracao_google_avaliacoes e comments_reputation (Hub de Reputacao). Incremental: como a lista
// vem da mais recentemente alterada para a mais antiga, para de paginar quando chega numa
// avaliacao que nao mudou desde a ultima sincronizacao bem-sucedida desta loja.
async function syncReviews(integracao: Integracao, local: Local, accessToken: string, warnings: string[], estadoCota: EstadoCota) {
  const parent = `${integracao.google_account_id}/${local.location_id}`;
  const corte = local.avaliacoes_sincronizadas_em ? new Date(local.avaliacoes_sincronizadas_em).getTime() : 0;
  const inicioSync = new Date().toISOString();
  const supabase = getAdminClient();

  let imported = 0;
  let pageToken = "";
  let resumoGravado = false;

  for (let pagina = 0; pagina < REVIEWS_MAX_PAGES; pagina++) {
    const params = new URLSearchParams({ pageSize: String(REVIEWS_PAGE_SIZE), orderBy: "updateTime desc" });
    if (pageToken) params.set("pageToken", pageToken);

    const response = await tryFetch(
      `Reviews ${local.location_id}`,
      () => googleFetch(`${GOOGLE_MYBUSINESS_LEGACY_API}/${parent}/reviews?${params}`, accessToken),
      warnings,
      estadoCota,
    );
    // Falha (API desativada, permissao, cota): nao marca a loja como sincronizada, para a proxima
    // execucao tentar de novo desde o mesmo ponto.
    if (!response) return imported;

    if (!resumoGravado) {
      const averageRating = Number(response.averageRating);
      const { error: resumoError } = await supabase
        .from("integracao_google_locais")
        .update({
          nota_media: Number.isFinite(averageRating) && averageRating > 0 ? Math.round(averageRating * 100) / 100 : null,
          total_avaliacoes: Number(response.totalReviewCount || 0),
        })
        .eq("id", local.id);
      if (resumoError) throw resumoError;
      resumoGravado = true;
    }

    // deno-lint-ignore no-explicit-any
    const reviews = ((response.reviews || []) as any[]).filter((review) => review.reviewId);
    // deno-lint-ignore no-explicit-any
    const novas = reviews.filter((review: any) => {
      const alterada = Date.parse(review.updateTime || review.createTime || "");
      return !corte || !Number.isFinite(alterada) || alterada > corte;
    });

    if (novas.length) {
      const agora = new Date().toISOString();
      // deno-lint-ignore no-explicit-any
      const avaliacoes = novas.map((review: any) => ({
        integracao_id: integracao.id,
        local_id: local.id,
        marca: integracao.marca,
        review_id: String(review.reviewId),
        autor_nome: review.reviewer?.displayName || null,
        autor_foto_url: review.reviewer?.profilePhotoUrl || null,
        rating: STAR_RATING[String(review.starRating)] || null,
        comentario: review.comment || null,
        avaliado_em: review.createTime || null,
        status_resposta: review.reviewReply?.comment ? "respondida" : "pendente",
        resposta_texto: review.reviewReply?.comment || null,
        resposta_em: review.reviewReply?.updateTime || null,
        payload_bruto: review,
      }));
      const { error } = await supabase
        .from("integracao_google_avaliacoes")
        .upsert(avaliacoes, { onConflict: "marca,review_id" });
      if (error) throw error;

      // Espelha na tabela unificada do Hub de Reputacao (mesma chave marca+review_id). So as
      // colunas de origem sao enviadas, entao a classificacao de IA ja feita nao e apagada.
      // deno-lint-ignore no-explicit-any
      const espelho = novas.map((review: any) => ({
        source: "google_business",
        external_id: String(review.reviewId),
        marca: integracao.marca,
        local_id: local.id,
        store_id: local.location_id,
        branch_name: local.nome_loja,
        author_name: review.reviewer?.displayName || null,
        content: review.comment || null,
        rating: STAR_RATING[String(review.starRating)] || null,
        created_at: review.createTime || agora,
        atualizado_em: agora,
      }));
      const { error: espelhoError } = await supabase
        .from("comments_reputation")
        .upsert(espelho, { onConflict: "marca,source,external_id" });
      if (espelhoError) throw espelhoError;

      imported += novas.length;
    }

    const chegouNasJaImportadas = novas.length < reviews.length;
    const proximo = String(response.nextPageToken || "");
    if (chegouNasJaImportadas || !proximo || proximo === pageToken) break;
    pageToken = proximo;
  }

  const { error: marcaError } = await supabase
    .from("integracao_google_locais")
    .update({ avaliacoes_sincronizadas_em: inicioSync })
    .eq("id", local.id);
  if (marcaError) throw marcaError;

  return imported;
}

async function syncMetricas(integracao: Integracao, local: Local, accessToken: string, warnings: string[], estadoCota: EstadoCota) {
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
    estadoCota,
  );

  if (!response?.multiDailyMetricTimeSeries?.length) return 0;

  // Formato da resposta: multiDailyMetricTimeSeries[].dailyMetricTimeSeries[].{dailyMetric,
  // timeSeries.datedValues[]}. A versao anterior lia dailyMetric direto no primeiro nivel e por isso
  // nunca gravava nada. `value` vem como string (int64) e e omitido quando o dia teve zero.
  // deno-lint-ignore no-explicit-any
  const series = (response.multiDailyMetricTimeSeries as any[]).flatMap((grupo) =>
    Array.isArray(grupo?.dailyMetricTimeSeries) ? grupo.dailyMetricTimeSeries : [grupo]
  );

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

  for (const serie of series) {
    const metricName = String(serie?.dailyMetric || "");
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

  const rows = [...porData.entries()].map(([dataReferencia, valores]) => ({
    local_id: local.id,
    marca: integracao.marca,
    data_referencia: dataReferencia,
    ...valores,
    payload_bruto: { origem: "businessprofileperformance", metrics: DAILY_METRICS },
  }));

  const { error } = await getAdminClient()
    .from("integracao_google_metricas_diarias")
    .upsert(rows, { onConflict: "local_id,data_referencia" });
  if (error) throw error;

  return rows.length;
}

// Fotos nao existem na Business Information API (v1): o endpoint de midia e o da API v4
// (accounts/{a}/locations/{l}/media), a mesma "Google My Business API" das avaliacoes.
const FOTOS_PAGE_SIZE = 100;
// Teto por loja para nao gastar cota por minuto com acervos enormes (5 x 100 = 500 fotos).
const FOTOS_MAX_PAGES = 5;

// deno-lint-ignore no-explicit-any
async function listarFotos(parent: string, accessToken: string): Promise<any[]> {
  // deno-lint-ignore no-explicit-any
  const itens: any[] = [];
  let pageToken = "";
  for (let pagina = 0; pagina < FOTOS_MAX_PAGES; pagina++) {
    const params = new URLSearchParams({ pageSize: String(FOTOS_PAGE_SIZE) });
    if (pageToken) params.set("pageToken", pageToken);
    const response = await googleFetch(`${GOOGLE_MYBUSINESS_LEGACY_API}/${parent}/media?${params}`, accessToken);
    itens.push(...(response.mediaItems || []));
    const proximo = String(response.nextPageToken || "");
    if (!proximo || proximo === pageToken) break;
    pageToken = proximo;
  }
  return itens;
}

async function syncFotos(integracao: Integracao, local: Local, accessToken: string, warnings: string[], estadoCota: EstadoCota) {
  const parent = `${integracao.google_account_id}/${local.location_id}`;
  const mediaItems = await tryFetch(
    `Fotos ${local.location_id}`,
    () => listarFotos(parent, accessToken),
    warnings,
    estadoCota,
  );

  if (!mediaItems?.length) return 0;

  const rows = mediaItems
    .filter((item) => item.name)
    .map((item) => ({
      local_id: local.id,
      marca: integracao.marca,
      media_id: String(item.name),
      url: item.googleUrl || item.thumbnailUrl || item.sourceUrl || null,
      // O Google so preenche `attribution` em midia enviada por clientes.
      origem: item.attribution ? "cliente" : "proprietario",
      categoria: item.locationAssociation?.category || null,
      criado_em_google: item.createTime || null,
      payload_bruto: item,
    }));

  if (!rows.length) return 0;

  const { error } = await getAdminClient()
    .from("integracao_google_fotos")
    .upsert(rows, { onConflict: "local_id,media_id" });
  if (error) throw error;

  return rows.length;
}

async function refreshStageResumo(marcas: string[]) {
  const supabase = getAdminClient();
  const uniqueMarcas = [...new Set(marcas)].filter(Boolean);
  const today = new Date().toISOString().slice(0, 10);

  for (const marca of uniqueMarcas) {
    // So unidades de contas confirmadas entram no resumo do Dashboard (contas em revisao ou
    // ignoradas tambem tem lojas gravadas, mas nao pertencem necessariamente a marca).
    const { data: contas, error: contasError } = await supabase
      .from("integracao_google_contas")
      .select("id")
      .eq("marca", marca)
      .eq("conta_confirmada", true)
      .eq("ignorada", false)
      .eq("ativo", true);
    if (contasError) throw contasError;
    const contaIds = (contas || []).map((c: { id: string }) => c.id);
    if (!contaIds.length) continue;

    const { data: locais, error } = await supabase
      .from("integracao_google_locais")
      .select("id,location_id,nome_loja,nota_media")
      .eq("marca", marca)
      .in("integracao_id", contaIds);
    if (error) throw error;
    if (!locais?.length) continue;

    // Lojas com avaliacao sem resposta, numa unica consulta paginada (em vez de uma por loja).
    const comPendencia = new Set<string>();
    for (let from = 0; ; from += 1000) {
      const { data: pendentes, error: pendentesError } = await supabase
        .from("integracao_google_avaliacoes")
        .select("local_id")
        .eq("marca", marca)
        .eq("status_resposta", "pendente")
        .order("id")
        .range(from, from + 999);
      if (pendentesError) throw pendentesError;
      (pendentes || []).forEach((row: { local_id: string }) => comPendencia.add(row.local_id));
      if (!pendentes || pendentes.length < 1000) break;
    }

    // deno-lint-ignore no-explicit-any
    const rows = locais.map((local: any) => ({
      marca,
      id_loja_gmb: local.location_id,
      nome_loja: local.nome_loja,
      rating_medio: local.nota_media ?? null,
      status_resposta: comPendencia.has(local.id) ? "Pendente" : "Respondida",
      data_referencia: today,
      origem_api: "google_business_profile_api",
    }));

    const { error: stageError } = await supabase
      .from("stage_google_business_profile")
      .upsert(rows, { onConflict: "marca,id_loja_gmb,data_referencia" });
    if (stageError) throw stageError;
  }
}

Deno.serve(withCors(async (req) => {
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
    // Compartilhado entre todas as contas desta execucao: a cota e por projeto Google Cloud, nao
    // por conta, entao uma vez esgotada nao ha motivo pra continuar tentando as contas seguintes.
    const estadoCota: EstadoCota = { esgotada: false };

    for (const integracao of integracoes as Integracao[]) {
      if (estadoCota.esgotada) {
        results.push({
          id: integracao.id,
          marca: integracao.marca,
          reviewsImported: 0,
          metricasImportadas: 0,
          fotosImportadas: 0,
          warnings: ["Cota da API do Google esgotada nesta execucao — conta nao sincronizada. Tente novamente em alguns minutos."],
          error: undefined,
        });
        continue;
      }

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
        locaisImportados: 0,
        totalLocais: 0,
        reviewsImported: 0,
        metricasImportadas: 0,
        fotosImportadas: 0,
        warnings,
        error: undefined as string | undefined,
      };

      try {
        const accessToken = await getValidAccessToken(integracao);
        const { locais, locaisImportados } = await syncLocais(integracao, accessToken, warnings, estadoCota);
        result.locaisImportados = locaisImportados;
        result.totalLocais = locais.length;

        if (!locais.length) {
          warnings.push("Nenhuma loja encontrada para esta conta no Google.");
        }

        for (const [indice, local] of locais.entries()) {
          if (estadoCota.esgotada) {
            warnings.push("Cota da API do Google esgotada — lojas restantes desta conta nao foram sincronizadas nesta execucao.");
            break;
          }
          if (indice > 0) await sleepMs(PACING_ENTRE_LOJAS_MS);

          result.reviewsImported += await syncReviews(integracao, local, accessToken, warnings, estadoCota);
          result.metricasImportadas += await syncMetricas(integracao, local, accessToken, warnings, estadoCota);
          result.fotosImportadas += await syncFotos(integracao, local, accessToken, warnings, estadoCota);
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
            locaisImportados: result.locaisImportados,
            totalLocais: result.totalLocais,
            reviewsImported: result.reviewsImported,
            metricasImportadas: result.metricasImportadas,
            fotosImportadas: result.fotosImportadas,
            warnings: warnings.slice(0, 5),
          },
        });
      } catch (syncError) {
        result.error = safeErrorMessage(syncError, "Falha na sincronizacao Google Business Profile.");
        await logGoogleEvent({
          integracao_id: integracao.id,
          marca: integracao.marca,
          tipo_evento: "sync_gbp",
          status: "erro",
          mensagem: errorMessage(syncError),
          payload_resumo: { warnings: warnings.slice(0, 5) },
        });
      }

      results.push(result);
    }

    await refreshStageResumo(syncedMarcas);

    // Classificacao por IA em lote; falhas aqui nao derrubam a sincronizacao.
    const classificacao = await classificarPendentes(syncedMarcas).catch((erro) => {
      console.error("Falha na classificacao de reputacao", erro);
      return null;
    });

    return jsonResponse({
      ok: true,
      results,
      classificacao,
      message: `Sincronizacao concluida para ${results.length} conta(s).`,
    });
  } catch (error) {
    return jsonResponse({ error: safeErrorMessage(error, "Nao foi possivel sincronizar o Google Business Profile.") }, 400);
  }
}));
