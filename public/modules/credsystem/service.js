// Acesso a dados do modulo CredSystem. Toda leitura respeita RLS (o Supabase usa o JWT do usuario);
// toda gravacao passa pelas RPCs SECURITY DEFINER que revalidam marca e permissao no servidor.

import { BIN_MARCA_PADRAO, LIMITES } from "./constantes.js";

const COLUNAS_CRM = "id,marca,dt_disparo,dh_disparo,mes,ano,ds_campanha,ds_canal,canal_normalizado,ds_step,ds_cluster_campanha,cluster_normalizado,fl_regua,qt_abordado,qt_adesao_abordado,vl_gasto_abordado,tkm_abordado,qt_controle,qt_adesao_controle,vl_gasto_controle,tkm_controle,tx_conv_abordado,tx_conv_controle,vl_vendas_incrementais,ds_titulo_push,alertas";

const NUMERICOS_CRM = ["qt_abordado", "qt_adesao_abordado", "vl_gasto_abordado", "tkm_abordado", "qt_controle", "qt_adesao_controle", "vl_gasto_controle", "tkm_controle", "tx_conv_abordado", "tx_conv_controle", "vl_vendas_incrementais"];

export function criarService(supabase) {
  async function paginado(montar, tamanho = 1000) {
    let todas = [];
    for (let de = 0; ; de += tamanho) {
      const { data, error } = await montar().range(de, de + tamanho - 1);
      if (error) throw error;
      todas = todas.concat(data || []);
      if (!data || data.length < tamanho) break;
    }
    return todas;
  }

  return {
    async operacional({ marca, de, ate }) {
      const { data, error } = await supabase.rpc("rpc_credsystem_operacional_resumo", {
        p_marca: marca === "Todas" ? null : marca, p_de: de || null, p_ate: ate || null
      });
      if (error) throw error;
      return data;
    },

    async campanhasCRM({ marca, de, ate }) {
      const linhas = await paginado(() => {
        let q = supabase.from("credsystem_campanhas_crm").select(COLUNAS_CRM).order("dt_disparo", { ascending: true }).order("id");
        if (marca !== "Todas") q = q.eq("marca", marca);
        if (de) q = q.gte("dt_disparo", de);
        if (ate) q = q.lte("dt_disparo", ate);
        return q;
      });
      // numeric do Postgres chega como string: converte mantendo null como null
      return linhas.map((l) => {
        const o = { ...l };
        for (const c of NUMERICOS_CRM) o[c] = l[c] === null || l[c] === undefined ? null : Number(l[c]);
        return o;
      });
    },

    // Base CRM sem filtro de periodo: existe dado? qual o periodo coberto?
    async baseCRM({ marca }) {
      const montar = (asc) => {
        let q = supabase.from("credsystem_campanhas_crm").select("dt_disparo").order("dt_disparo", { ascending: asc }).limit(1);
        if (marca !== "Todas") q = q.eq("marca", marca);
        return q;
      };
      let cont = supabase.from("credsystem_campanhas_crm").select("id", { count: "exact", head: true });
      if (marca !== "Todas") cont = cont.eq("marca", marca);
      const [ini, fim, total] = await Promise.all([montar(true), montar(false), cont]);
      const erro = ini.error || fim.error || total.error;
      if (erro) throw erro;
      return { total: total.count || 0, inicio: ini.data?.[0]?.dt_disparo || null, fim: fim.data?.[0]?.dt_disparo || null };
    },

    async statusImportacoes({ marca }) {
      const { data, error } = await supabase.rpc("rpc_credsystem_status_importacoes", { p_marca: marca === "Todas" ? null : marca });
      if (error) throw error;
      return data || {};
    },

    async retencao({ marca, de, ate }) {
      const { data, error } = await supabase.rpc("rpc_credsystem_retencao_resumo", {
        p_marca: marca === "Todas" ? null : marca, p_de: de || null, p_ate: ate || null, p_dias_inatividade: 90
      });
      if (error) throw error;
      return data;
    },

    async mapaBins() {
      const { data, error } = await supabase.from("credsystem_bin_marca").select("bin,marca,ativo");
      if (error || !data?.length) return { ...BIN_MARCA_PADRAO };
      return Object.fromEntries(data.filter((b) => b.ativo).map((b) => [b.bin, b.marca]));
    },

    async listarBins() {
      const { data, error } = await supabase.from("credsystem_bin_marca").select("bin,marca,ativo,observacao,atualizado_em").order("bin");
      if (error) throw error;
      return data || [];
    },

    // RLS: so Admin grava (policy credsystem_bin_marca_admin_write).
    async salvarBin({ bin, marca, ativo, observacao }) {
      const { error } = await supabase.from("credsystem_bin_marca").upsert({ bin, marca, ativo, observacao: observacao || null }, { onConflict: "bin" });
      if (error) throw error;
    },

    async mapaLojas() {
      const { data, error } = await supabase.from("credsystem_loja_marca").select("cd_loja,marca");
      if (error) return {};
      return Object.fromEntries((data || []).map((l) => [l.cd_loja, l.marca]));
    },

    async modelosColunas(tipo) {
      let q = supabase.from("importacao_modelos_colunas").select("id,nome,tipo_arquivo,assinatura_cabecalho,mapeamento,atualizado_em").order("atualizado_em", { ascending: false });
      if (tipo) q = q.eq("tipo_arquivo", tipo);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },

    async salvarModelo({ nome, tipo, assinatura, mapeamento }) {
      const { error } = await supabase.from("importacao_modelos_colunas").upsert(
        { nome, tipo_arquivo: tipo, assinatura_cabecalho: assinatura, mapeamento },
        { onConflict: "tipo_arquivo,nome" }
      );
      if (error) throw error;
    },

    async iniciarLote({ tipo, nomeArquivo, hash, metadados }) {
      const { data, error } = await supabase.rpc("rpc_importacao_iniciar", { p_tipo_arquivo: tipo, p_nome_arquivo: nomeArquivo, p_hash: hash, p_metadados: metadados || {} });
      if (error) throw error;
      return data;
    },

    async registrarErros(loteId, erros, linhasIgnoradas = 0) {
      for (let i = 0; i < Math.max(erros.length, 1); i += 2000) {
        const fatia = erros.slice(i, i + 2000);
        const { error } = await supabase.rpc("rpc_importacao_registrar_erros", { p_lote_id: loteId, p_erros: fatia, p_linhas_ignoradas: i === 0 ? linhasIgnoradas : 0 });
        if (error) throw error;
        if (!erros.length) break;
      }
    },

    // Envia em lotes de LIMITES.linhasPorChamada; onProgresso({ enviadas, total, parcial }).
    async gravarLinhas(rpcNome, loteId, registros, onProgresso) {
      const total = { inseridas: 0, atualizadas: 0, inalteradas: 0, rejeitadas: 0 };
      for (let i = 0; i < registros.length; i += LIMITES.linhasPorChamada) {
        const fatia = registros.slice(i, i + LIMITES.linhasPorChamada);
        const { data, error } = await supabase.rpc(rpcNome, { p_lote_id: loteId, p_linhas: fatia });
        if (error) { error.parcial = { ...total, enviadas: i }; throw error; }
        for (const k of Object.keys(total)) total[k] += Number(data?.[k] || 0);
        onProgresso?.({ enviadas: Math.min(i + fatia.length, registros.length), total: registros.length, parcial: { ...total } });
      }
      return total;
    },

    async finalizarLote(loteId, { linhasLidas, abas, cancelado = false }) {
      const { data, error } = await supabase.rpc("rpc_importacao_finalizar", { p_lote_id: loteId, p_linhas_lidas: linhasLidas, p_abas: abas, p_cancelado: cancelado });
      if (error) throw error;
      return data;
    },

    async errosDoLote(loteId, limite = 500) {
      const { data, error } = await supabase.from("importacao_erros_linha")
        .select("aba,linha,campo,codigo,mensagem,valor_original,severidade").eq("lote_id", loteId).order("linha").limit(limite);
      if (error) throw error;
      return data || [];
    },

    // Importacoes anteriores com o mesmo conteudo (visiveis ao usuario via RLS).
    async lotesPorHash(hash) {
      const { data, error } = await supabase.from("importacao_lotes")
        .select("id,nome_arquivo,iniciado_em,status,tipo_arquivo").eq("hash_conteudo", hash)
        .in("status", ["concluido", "concluido_com_erros"]).order("iniciado_em", { ascending: false }).limit(5);
      if (error) return [];
      return data || [];
    },

    async historicoLotes(limite = 20) {
      const { data, error } = await supabase.from("importacao_lotes")
        .select("id,tipo_arquivo,nome_arquivo,iniciado_em,concluido_em,marcas,periodo_inicio,periodo_fim,linhas_lidas,linhas_importadas,linhas_atualizadas,linhas_ignoradas,linhas_rejeitadas,status")
        .order("iniciado_em", { ascending: false }).limit(limite);
      if (error) throw error;
      return data || [];
    }
  };
}
