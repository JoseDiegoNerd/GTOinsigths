import {
  assertAdminOrGestor,
  corsHeaders,
  getAdminClient,
  getAuthenticatedUser,
  jsonResponse,
  logMetaEvent,
  metaGet,
} from "../_shared/meta.ts";

type Integration = {
  id: string;
  marca: string;
  page_id: string;
  page_name: string | null;
  instagram_business_account_id: string | null;
  instagram_username: string | null;
  access_token: string;
};

type SyncResult = {
  id: string;
  marca: string;
  pageName: string | null;
  instagramImported: number;
  facebookImported: number;
  warnings: string[];
  error?: string;
};

function numberValue(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function insightValue(insights: any, name: string) {
  const metric = insights?.data?.find((item: any) => item.name === name);
  const value = metric?.values?.[0]?.value;
  if (typeof value === "number") return value;
  if (typeof value === "object" && value !== null) {
    return Object.values(value).reduce((sum: number, current: any) => sum + numberValue(current), 0);
  }
  return numberValue(value);
}

function summaryCount(value: any) {
  return numberValue(value?.summary?.total_count);
}

function textSnippet(value: unknown, fallback: string) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return fallback;
  return text.length > 90 ? `${text.slice(0, 87)}...` : text;
}

function mapInstagramFormat(mediaType: string) {
  if (/REELS|VIDEO/i.test(mediaType)) return "instagram_reels";
  if (/STORY/i.test(mediaType)) return "instagram_stories";
  return "instagram_feed";
}

function mapFacebookFormat(post: any) {
  const attachment = post.attachments?.data?.[0] || {};
  const signal = `${attachment.media_type || ""} ${attachment.type || ""} ${post.message || ""}`;
  if (/video|reel/i.test(signal)) return "facebook_reels";
  if (/story/i.test(signal)) return "facebook_stories";
  return "facebook_feed";
}

function metricDate(value: unknown) {
  return value ? String(value).slice(0, 10) : new Date().toISOString().slice(0, 10);
}

function daysAgoDate(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

function insightTotal(insights: any, name: string) {
  const metric = insights?.data?.find((item: any) => item.name === name);
  if (!metric?.values?.length) return 0;
  return metric.values.reduce((sum: number, item: any) => sum + numberValue(item.value), 0);
}

async function replaceMetricRow(match: { marca: string; rede_social: string; conta_id: string; post_id: string }, row: Record<string, unknown>) {
  const supabase = getAdminClient();
  // Upsert (nao delete+insert): duas sincronizacoes quase simultaneas faziam ambas passar pelo
  // delete antes de qualquer insert, gerando linhas duplicadas para o mesmo post. O upsert e
  // atomico no banco e depende da constraint unica stage_social_format_metrics_meta_post_uk.
  const { error } = await supabase
    .from("stage_social_format_metrics")
    .upsert(row, { onConflict: "marca,rede_social,conta_id,post_id" });
  if (error) throw error;
}

async function tryMetaGet(path: string, params: Record<string, string | number | boolean | undefined | null>, warnings: string[]) {
  try {
    return await metaGet(path, params);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnings.push(message);
    return null;
  }
}

async function fetchInsightsMetricByMetric(
  path: string,
  metricNames: string[],
  baseParams: Record<string, string | number | boolean | undefined | null>,
  warnings: string[],
  warningContext: string,
) {
  const data: any[] = [];

  for (const metric of metricNames) {
    const metricWarnings: string[] = [];
    const result = await tryMetaGet(path, { ...baseParams, metric }, metricWarnings);

    if (result?.data?.length) {
      data.push(...result.data);
      continue;
    }

    for (const warning of metricWarnings) {
      warnings.push(`${warningContext}: ${metric}: ${warning}`);
    }
  }

  return { data };
}

async function fetchInstagramFollowers(integration: Integration, warnings: string[]) {
  if (!integration.instagram_business_account_id) return 0;

  const result = await tryMetaGet(`/${integration.instagram_business_account_id}`, {
    fields: "followers_count",
    access_token: integration.access_token,
  }, warnings);

  return numberValue(result?.followers_count);
}

async function fetchFacebookFollowers(integration: Integration, warnings: string[]) {
  const result = await tryMetaGet(`/${integration.page_id}`, {
    fields: "fan_count",
    access_token: integration.access_token,
  }, warnings);

  return numberValue(result?.fan_count);
}

async function syncInstagram(integration: Integration, warnings: string[]) {
  if (!integration.instagram_business_account_id) {
    warnings.push(`Pagina ${integration.page_name || integration.page_id} sem Instagram Business vinculado.`);
    return 0;
  }

  const media = await tryMetaGet(`/${integration.instagram_business_account_id}/media`, {
    fields: "id,permalink,media_type,timestamp,caption",
    limit: 50,
    access_token: integration.access_token,
  }, warnings);

  if (!media?.data?.length) return 0;

  let imported = 0;

  for (const item of media.data || []) {
    const itemWarnings: string[] = [];
    const formato = mapInstagramFormat(item.media_type || "");
    const isReels = formato === "instagram_reels";
    // "engagement" e "plays" nao sao mais nomes de metrica validos na Instagram Insights API
    // (erro #100); os equivalentes atuais sao total_interactions e views. "impressions" foi removida
    // da lista: nao e suportada para Reels desde a v22.0 (erro #100 em praticamente todo post),
    // o que forcava o fallback lento metrica-por-metrica pra quase tudo e estourava o timeout da
    // function. O campo nao e exibido na UI hoje, entao nao ha perda em tira-la.
    // ig_reels_avg_watch_time e reels_skip_rate so existem para Reels - pedir para outros formatos
    // sempre falha e derruba a chamada combinada, entao ficam de fora da lista pros demais formatos.
    // profile_visits/follows medem quando o proprio post levou alguem a visitar o perfil ou
    // seguir a conta - o sinal de "descoberta" que o app ja rotula nos Reels mas nunca mediu.
    const instagramMetrics = isReels
      ? ["reach", "saved", "comments", "likes", "shares", "views", "total_interactions", "profile_visits", "follows", "ig_reels_avg_watch_time", "reels_skip_rate"]
      : ["reach", "saved", "comments", "likes", "shares", "views", "total_interactions", "profile_visits", "follows"];
    const combinedWarnings: string[] = [];
    const combined = await tryMetaGet(`/${item.id}/insights`, {
      metric: instagramMetrics.join(","),
      access_token: integration.access_token,
    }, combinedWarnings);

    const insights = combined?.data?.length
      ? combined
      : await fetchInsightsMetricByMetric(
        `/${item.id}/insights`,
        instagramMetrics,
        { access_token: integration.access_token },
        itemWarnings,
        `Instagram media insights ${item.id}`,
      );

    for (const warning of itemWarnings) {
      await logMetaEvent({
        integracao_id: integration.id,
        marca: integration.marca,
        tipo_evento: "instagram_media_insights",
        status: "aviso",
        mensagem: warning,
        payload_resumo: { media_id: item.id },
      });
      warnings.push(warning);
    }

    const visualizacoes = insightValue(insights, "views");
    const salvamentos = insightValue(insights, "saved");
    const comentarios = insightValue(insights, "comments");
    const alcance = insightValue(insights, "reach");
    const engajamento = insightValue(insights, "total_interactions");
    // ig_reels_avg_watch_time vem em milissegundos; convertida pra segundos pra bater com o
    // formato ja usado na coluna (renderizada como "Xs" na UI).
    const tempoMedioVisualizacao = isReels ? insightValue(insights, "ig_reels_avg_watch_time") / 1000 : 0;
    const taxaRejeicaoInicial = isReels ? Math.min(100, insightValue(insights, "reels_skip_rate")) : 0;
    const visitasPerfil = insightValue(insights, "profile_visits");
    const seguidoresConquistados = insightValue(insights, "follows");

    await replaceMetricRow(
      { marca: integration.marca, rede_social: "Instagram", conta_id: integration.instagram_business_account_id, post_id: item.id },
      {
        marca: integration.marca,
        rede_social: "Instagram",
        conta_id: integration.instagram_business_account_id,
        conta_nome: integration.instagram_username || integration.page_name,
        post_id: item.id,
        post_url: item.permalink || null,
        formato,
        tipo_conteudo: item.media_type || null,
        objetivo: formato === "instagram_reels" ? "Descoberta e retencao" : "Autoridade e consideracao",
        tema: textSnippet(item.caption, item.media_type || "Conteudo Instagram"),
        data_referencia: metricDate(item.timestamp),
        data_publicacao: item.timestamp || null,
        periodo_inicio: metricDate(item.timestamp),
        periodo_fim: new Date().toISOString().slice(0, 10),
        alcance,
        impressoes: insightValue(insights, "impressions"),
        engajamento,
        curtidas: insightValue(insights, "likes"),
        comentarios,
        compartilhamentos: insightValue(insights, "shares"),
        salvos: salvamentos,
        salvamentos,
        visualizacoes,
        total_visualizacoes: visualizacoes,
        comentarios_qualificados: comentarios,
        tempo_medio_visualizacao: tempoMedioVisualizacao,
        taxa_rejeicao_inicial: taxaRejeicaoInicial,
        visitas_perfil: visitasPerfil,
        seguidores_conquistados: seguidoresConquistados,
        taxa_compartilhamento_feed: alcance > 0 ? Math.min(100, (insightValue(insights, "shares") / alcance) * 100) : 0,
        payload_bruto: { media: item, insights },
        origem_arquivo: "meta_graph_api",
      },
    );

    imported += 1;
  }

  return imported;
}

async function fetchFacebookPosts(integration: Integration, warnings: string[]) {
  const baseFields = [
    "id",
    "permalink_url",
    "created_time",
    "message",
    "story",
    "attachments{media_type,type}",
    "reactions.limit(0).summary(true)",
    "comments.limit(0).summary(true)",
    "shares",
  ].join(",");
  const safeFields = "id,permalink_url,created_time,message,story,attachments{media_type,type}";

  const attempts = [
    { path: `/${integration.page_id}/published_posts`, fields: baseFields },
    { path: `/${integration.page_id}/feed`, fields: baseFields },
    { path: `/${integration.page_id}/posts`, fields: baseFields },
    { path: `/${integration.page_id}/published_posts`, fields: safeFields },
    { path: `/${integration.page_id}/feed`, fields: safeFields },
    { path: `/${integration.page_id}/posts`, fields: safeFields },
  ];

  for (const attempt of attempts) {
    const result = await tryMetaGet(attempt.path, {
      fields: attempt.fields,
      limit: 50,
      access_token: integration.access_token,
    }, warnings);

    if (result?.data?.length) return result;
  }

  return null;
}

async function syncFacebookPageSummary(integration: Integration, warnings: string[]) {
  // page_impressions, page_impressions_unique e page_consumptions foram descontinuadas pela Meta
  // (erro #100 "not a valid insights metric"). Em 15/jun/2026 a Meta tambem descontinuou o Page
  // Reach classico em todas as versoes da API, substituindo por "Page Viewer" / media views
  // (page_total_media_view_unique). Pedimos a metrica nova primeiro; page_views_total fica como
  // fallback caso a conta ainda a suporte.
  const insights = await fetchInsightsMetricByMetric(
    `/${integration.page_id}/insights`,
    ["page_total_media_view_unique", "page_views_total", "page_post_engagements", "page_total_actions"],
    {
      period: "day",
      since: daysAgoDate(30),
      until: new Date().toISOString().slice(0, 10),
      access_token: integration.access_token,
    },
    warnings,
    `Page insights ${integration.page_name || integration.page_id}`,
  );

  if (!insights?.data?.length) return 0;

  const alcance = insightTotal(insights, "page_total_media_view_unique") || insightTotal(insights, "page_views_total");
  const impressoes = insightTotal(insights, "page_total_actions");
  const engajamento = insightTotal(insights, "page_post_engagements");
  const cliques = 0;

  if (!alcance && !impressoes && !engajamento && !cliques) return 0;

  const today = new Date().toISOString().slice(0, 10);
  await replaceMetricRow(
    { marca: integration.marca, rede_social: "Facebook", conta_id: integration.page_id, post_id: `page-summary:${integration.page_id}:${today}` },
    {
      marca: integration.marca,
      rede_social: "Facebook",
      conta_id: integration.page_id,
      conta_nome: integration.page_name,
      post_id: `page-summary:${integration.page_id}:${today}`,
      post_url: `https://www.facebook.com/${integration.page_id}`,
      formato: "facebook_feed",
      tipo_conteudo: "page_summary",
      objetivo: "Resumo agregado da pagina",
      tema: `Resumo agregado: ${integration.page_name || integration.page_id}`,
      data_referencia: today,
      data_publicacao: null,
      periodo_inicio: daysAgoDate(30),
      periodo_fim: today,
      alcance,
      impressoes,
      engajamento,
      curtidas: 0,
      comentarios: 0,
      compartilhamentos: 0,
      visualizacoes: alcance || impressoes,
      visualizacoes_unicas_midia: alcance || impressoes,
      retencao_qualificada_5s: 0,
      compartilhamentos_publicos_timeline: 0,
      cliques,
      cliques_link: cliques,
      cliques_ver_mais: 0,
      compartilhamentos_grupos: 0,
      payload_bruto: { origem: "page_insights", insights },
      origem_arquivo: "meta_graph_api",
    },
  );

  await logMetaEvent({
    integracao_id: integration.id,
    marca: integration.marca,
    tipo_evento: "facebook_page_insights",
    status: "sucesso",
    mensagem: "Resumo agregado da pagina Facebook sincronizado.",
    payload_resumo: { alcance, impressoes, engajamento, cliques },
  });

  return 1;
}

async function syncFacebook(integration: Integration, warnings: string[]) {
  const posts = await fetchFacebookPosts(integration, warnings);

  if (!posts?.data?.length) {
    warnings.push(`Pagina ${integration.page_name || integration.page_id} nao retornou posts recentes ou a Meta bloqueou a leitura de publicacoes.`);
    return 0;
  }

  let imported = 0;

  for (const post of posts.data || []) {
    // post_impressions, post_impressions_unique, post_engaged_users e post_clicks foram
    // descontinuadas pela Meta (erro #100) e nao tem substituto para cliques/impressoes.
    // Desde 15/jun/2026 o Post Reach classico tambem saiu de todas as versoes da API; o
    // substituto e post_total_media_view_unique (familia "media views" / Page Viewer).
    // Engajamento continua calculado a partir de reactions/comments/shares do proprio post.
    const formato = mapFacebookFormat(post);
    const tipoConteudo = post.attachments?.data?.[0]?.media_type || null;
    const reactions = summaryCount(post.reactions);
    const comentarios = summaryCount(post.comments);
    const shares = numberValue(post.shares?.count);

    const postInsightWarnings: string[] = [];
    const postInsights = await fetchInsightsMetricByMetric(
      `/${post.id}/insights`,
      ["post_total_media_view_unique"],
      { access_token: integration.access_token },
      postInsightWarnings,
      `Post insights ${post.id}`,
    );
    warnings.push(...postInsightWarnings);

    const alcance = insightTotal(postInsights, "post_total_media_view_unique");
    const impressoes = 0;
    const cliques = 0;
    const engajamento = reactions + comentarios + shares;

    await replaceMetricRow(
      { marca: integration.marca, rede_social: "Facebook", conta_id: integration.page_id, post_id: post.id },
      {
        marca: integration.marca,
        rede_social: "Facebook",
        conta_id: integration.page_id,
        conta_nome: integration.page_name,
        post_id: post.id,
        post_url: post.permalink_url || null,
        formato,
        tipo_conteudo: tipoConteudo,
        objetivo: formato === "facebook_reels" ? "Distribuicao aberta" : "Comunidade e trafego externo",
        tema: textSnippet(post.message, tipoConteudo || "Post Facebook"),
        data_referencia: metricDate(post.created_time),
        data_publicacao: post.created_time || null,
        periodo_inicio: metricDate(post.created_time),
        periodo_fim: new Date().toISOString().slice(0, 10),
        alcance,
        impressoes,
        engajamento,
        curtidas: reactions,
        comentarios,
        compartilhamentos: shares,
        visualizacoes: alcance || impressoes,
        visualizacoes_unicas_midia: alcance || impressoes,
        retencao_qualificada_5s: 0,
        compartilhamentos_publicos_timeline: shares,
        cliques,
        cliques_link: cliques,
        cliques_ver_mais: 0,
        compartilhamentos_grupos: 0,
        payload_bruto: { post },
        origem_arquivo: "meta_graph_api",
      },
    );

    imported += 1;
  }

  const pageSummaryImported = await syncFacebookPageSummary(integration, warnings);
  return imported + pageSummaryImported;
}

async function refreshMetaOverview(marcas: string[], followersByMarca: Map<string, number>, facebookFollowersByMarca: Map<string, number>) {
  const supabase = getAdminClient();
  const uniqueMarcas = [...new Set(marcas)].filter(Boolean);
  const today = new Date().toISOString().slice(0, 10);

  for (const marca of uniqueMarcas) {
    const { data, error } = await supabase
      .from("stage_social_format_metrics")
      .select("marca,rede_social,alcance,engajamento,post_url,criado_em")
      .eq("marca", marca)
      .eq("origem_arquivo", "meta_graph_api")
      .order("criado_em", { ascending: false })
      .limit(500);

    if (error) throw error;
    if (!data?.length) continue;

    const facebookRows = data.filter((row: any) => row.rede_social === "Facebook");
    const alcanceFacebook = facebookRows.reduce((sum: number, row: any) => sum + numberValue(row.alcance), 0);
    // engajamento_total fica pareado com alcance_facebook (mesma rede): a coluna
    // "stage_meta_business_analytics.alcance_facebook" so cobre Facebook, entao somar
    // engajamento de todas as redes (Facebook + Instagram) contra esse denominador
    // produzia taxas de engajamento acima de 100% (numerador e denominador de escopos
    // diferentes). Sem uma coluna alcance_instagram na tabela, o par coerente e Facebook-Facebook.
    const engajamentoTotal = facebookRows.reduce((sum: number, row: any) => sum + numberValue(row.engajamento), 0);
    const destaque = data.find((row: any) => row.post_url)?.post_url || null;

    await supabase.from("stage_meta_business_analytics").upsert({
      marca,
      data_referencia: today,
      seguidores_instagram: followersByMarca.get(marca) || 0,
      seguidores_facebook: facebookFollowersByMarca.get(marca) || 0,
      alcance_facebook: alcanceFacebook,
      engajamento_total: engajamentoTotal,
      post_destaque_semana_url: destaque,
      payload_bruto: { origem: "meta_graph_api", registros_agregados: data.length },
      origem_api: "meta_graph_api",
    }, { onConflict: "marca,data_referencia" });
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const cronSecret = Deno.env.get("META_SYNC_CRON_SECRET");
    const isScheduledCall = Boolean(cronSecret) && req.headers.get("x-cron-secret") === cronSecret;

    if (!isScheduledCall) {
      const user = await getAuthenticatedUser(req);
      await assertAdminOrGestor(user.id);
    }

    const body = await req.json().catch(() => ({}));
    const supabase = getAdminClient();

    let query = supabase
      .from("integracao_meta_contas")
      .select("id,marca,page_id,page_name,instagram_business_account_id,instagram_username,access_token")
      .eq("ativo", true)
      .eq("conta_confirmada", true)
      .eq("ignorada", false);

    if (body.integracao_id) query = query.eq("id", body.integracao_id);
    if (body.marca && body.marca !== "Todas") query = query.eq("marca", body.marca);

    const { data: integrations, error } = await query;
    if (error) throw error;

    if (!integrations?.length) {
      return jsonResponse({ ok: true, results: [], message: "Nenhuma conta Meta confirmada para sincronizacao." });
    }

    const results: SyncResult[] = [];
    const syncedMarcas: string[] = [];
    const followersByMarca = new Map<string, number>();
    const facebookFollowersByMarca = new Map<string, number>();

    for (const integration of (integrations || []) as Integration[]) {
      await logMetaEvent({
        integracao_id: integration.id,
        marca: integration.marca,
        tipo_evento: "sync_insights",
        status: "iniciado",
        mensagem: "Sincronizacao Meta iniciada.",
      });

      const warnings: string[] = [];
      const result: SyncResult = {
        id: integration.id,
        marca: integration.marca,
        pageName: integration.page_name,
        instagramImported: 0,
        facebookImported: 0,
        warnings,
      };

      try {
        result.instagramImported = await syncInstagram(integration, warnings);
        result.facebookImported = await syncFacebook(integration, warnings);

        const followers = await fetchInstagramFollowers(integration, warnings);
        followersByMarca.set(integration.marca, (followersByMarca.get(integration.marca) || 0) + followers);

        const facebookFollowers = await fetchFacebookFollowers(integration, warnings);
        facebookFollowersByMarca.set(integration.marca, (facebookFollowersByMarca.get(integration.marca) || 0) + facebookFollowers);

        await supabase
          .from("integracao_meta_contas")
          .update({ ultima_sincronizacao_em: new Date().toISOString() })
          .eq("id", integration.id);

        syncedMarcas.push(integration.marca);

        await logMetaEvent({
          integracao_id: integration.id,
          marca: integration.marca,
          tipo_evento: "sync_insights",
          status: "sucesso",
          mensagem: "Sincronizacao Meta concluida.",
          payload_resumo: {
            instagramImported: result.instagramImported,
            facebookImported: result.facebookImported,
            warnings: warnings.slice(0, 5),
          },
        });
      } catch (syncError) {
        result.error = syncError instanceof Error ? syncError.message : String(syncError);
        await logMetaEvent({
          integracao_id: integration.id,
          marca: integration.marca,
          tipo_evento: "sync_insights",
          status: "erro",
          mensagem: result.error,
          payload_resumo: { warnings: warnings.slice(0, 5) },
        });
      }

      results.push(result);
    }

    await refreshMetaOverview(syncedMarcas, followersByMarca, facebookFollowersByMarca);

    const totalInstagram = results.reduce((sum, row) => sum + row.instagramImported, 0);
    const totalFacebook = results.reduce((sum, row) => sum + row.facebookImported, 0);
    const totalWarnings = results.reduce((sum, row) => sum + row.warnings.length, 0);

    return jsonResponse({
      ok: true,
      results,
      totals: { instagramImported: totalInstagram, facebookImported: totalFacebook, warnings: totalWarnings },
      message: `Sincronizacao concluida: ${totalInstagram} Instagram, ${totalFacebook} Facebook, ${totalWarnings} avisos.`,
    });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Could not sync Meta insights." }, 400);
  }
});


