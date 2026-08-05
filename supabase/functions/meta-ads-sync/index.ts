import {
  assertAdminOrGestor,
  corsHeaders,
  errorMessage,
  getAdminClient,
  getAuthenticatedUser,
  jsonResponse,
  logMetaEvent,
  metaGet,
} from "../_shared/meta.ts";

type AdAccountIntegration = {
  id: string;
  marca: string;
  ad_account_id: string;
  ad_account_name: string | null;
  access_token: string;
};

type SyncResult = {
  id: string;
  marca: string;
  adAccountName: string | null;
  campaignsImported: number;
  warnings: string[];
  error?: string;
};

function numberValue(value: unknown) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function daysAgoDate(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
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

async function fetchCampaignStatuses(integration: AdAccountIntegration, warnings: string[]) {
  const statusByCampaignId = new Map<string, string>();
  const result = await tryMetaGet(`/${integration.ad_account_id}/campaigns`, {
    fields: "id,effective_status",
    limit: 200,
    access_token: integration.access_token,
  }, warnings);

  for (const campaign of result?.data || []) {
    if (campaign.id) statusByCampaignId.set(campaign.id, campaign.effective_status || "UNKNOWN");
  }

  return statusByCampaignId;
}

async function fetchDailyInsights(integration: AdAccountIntegration, warnings: string[]) {
  const rows: Record<string, unknown>[] = [];
  const baseParams = {
    level: "campaign",
    fields: "campaign_id,campaign_name,objective,impressions,reach,clicks,inline_link_clicks,spend,cpm,cpc,ctr,frequency,date_start,date_stop",
    time_increment: 1,
    since: daysAgoDate(30),
    until: new Date().toISOString().slice(0, 10),
    limit: 200,
    access_token: integration.access_token,
  };

  let after: string | undefined;
  for (let page = 0; page < 20; page += 1) {
    const result = await tryMetaGet(`/${integration.ad_account_id}/insights`, {
      ...baseParams,
      after,
    }, warnings);

    if (!result?.data?.length) break;
    rows.push(...result.data);

    after = result?.paging?.cursors?.after;
    if (!after) break;
  }

  return rows;
}

async function syncAdAccount(integration: AdAccountIntegration, warnings: string[]) {
  const statusByCampaignId = await fetchCampaignStatuses(integration, warnings);
  const insightRows = await fetchDailyInsights(integration, warnings);

  if (!insightRows.length) return 0;

  const supabase = getAdminClient();
  let imported = 0;

  for (const row of insightRows) {
    const dataReferencia = String(row.date_start || new Date().toISOString().slice(0, 10));
    const { error } = await supabase
      .from("stage_meta_ads_metrics")
      .upsert({
        marca: integration.marca,
        ad_account_id: integration.ad_account_id,
        campaign_id: row.campaign_id,
        campaign_name: row.campaign_name || null,
        objetivo: row.objective || null,
        status: statusByCampaignId.get(String(row.campaign_id)) || null,
        data_referencia: dataReferencia,
        periodo_inicio: dataReferencia,
        periodo_fim: dataReferencia,
        investimento: numberValue(row.spend),
        impressoes: numberValue(row.impressions),
        alcance: numberValue(row.reach),
        cliques: numberValue(row.clicks),
        cliques_link: numberValue(row.inline_link_clicks),
        cpm: numberValue(row.cpm),
        cpc: numberValue(row.cpc),
        ctr: numberValue(row.ctr),
        frequencia: numberValue(row.frequency),
        payload_bruto: { insights: row },
        origem_arquivo: "meta_marketing_api",
      }, { onConflict: "marca,ad_account_id,campaign_id,data_referencia" });

    if (error) throw error;
    imported += 1;
  }

  return imported;
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
      .from("integracao_meta_ads_contas")
      .select("id,marca,ad_account_id,ad_account_name,access_token")
      .eq("ativo", true)
      .eq("conta_confirmada", true)
      .eq("ignorada", false);

    if (body.integracao_id) query = query.eq("id", body.integracao_id);
    if (body.marca && body.marca !== "Todas") query = query.eq("marca", body.marca);

    const { data: integrations, error } = await query;
    if (error) throw error;

    if (!integrations?.length) {
      return jsonResponse({ ok: true, results: [], message: "Nenhuma conta de anuncios confirmada para sincronizacao." });
    }

    const results: SyncResult[] = [];

    for (const integration of (integrations || []) as AdAccountIntegration[]) {
      await logMetaEvent({
        integracao_id: integration.id,
        marca: integration.marca,
        tipo_evento: "ads_sync",
        status: "iniciado",
        mensagem: "Sincronizacao de anuncios Meta iniciada.",
      });

      const warnings: string[] = [];
      const result: SyncResult = {
        id: integration.id,
        marca: integration.marca,
        adAccountName: integration.ad_account_name,
        campaignsImported: 0,
        warnings,
      };

      try {
        result.campaignsImported = await syncAdAccount(integration, warnings);

        await supabase
          .from("integracao_meta_ads_contas")
          .update({ ultima_sincronizacao_em: new Date().toISOString() })
          .eq("id", integration.id);

        await logMetaEvent({
          integracao_id: integration.id,
          marca: integration.marca,
          tipo_evento: "ads_sync",
          status: "sucesso",
          mensagem: "Sincronizacao de anuncios Meta concluida.",
          payload_resumo: { campaignsImported: result.campaignsImported, warnings: warnings.slice(0, 5) },
        });
      } catch (syncError) {
        result.error = errorMessage(syncError);
        await logMetaEvent({
          integracao_id: integration.id,
          marca: integration.marca,
          tipo_evento: "ads_sync",
          status: "erro",
          mensagem: result.error,
          payload_resumo: { warnings: warnings.slice(0, 5) },
        });
      }

      results.push(result);
    }

    const totalCampaigns = results.reduce((sum, row) => sum + row.campaignsImported, 0);
    const totalWarnings = results.reduce((sum, row) => sum + row.warnings.length, 0);

    return jsonResponse({
      ok: true,
      results,
      totals: { campaignsImported: totalCampaigns, warnings: totalWarnings },
      message: `Sincronizacao concluida: ${totalCampaigns} campanhas, ${totalWarnings} avisos.`,
    });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Could not sync Meta ads." }, 400);
  }
});
