// Transforma as linhas lidas em registros prontos para as RPCs de importacao, com validacao de
// pre-visualizacao. O servidor REVALIDA tudo (marca, permissao, tipos, faixas) - esta camada existe
// para o usuario ver os problemas antes de confirmar e para nao enviar linhas sabidamente ruins.

import { TIPOS_ARQUIVO } from "./constantes.js";
import {
  binEmbutido, canalNormalizado, categoriaNormalizada, chaveNaturalCRM, decimalParaServidor,
  marcaPorTexto, normalizarTexto, pareceFormula, parseAno, parseBin, parseData, parseFlag,
  parseMes, parseNumero, textoLimpo, vazio
} from "./normalizacao.js";

const MAX_ORIGINAL = 500;

function valorOriginalTexto(v) {
  if (v === null || v === undefined) return null;
  return String(v).slice(0, MAX_ORIGINAL);
}

// Colunas com dado pessoal direto nunca saem do navegador dentro de dados_originais (o CPF, quando
// mapeado, vai em campo proprio so para o servidor pseudonimizar - nao e armazenado).
export const COLUNA_SENSIVEL = /(cpf|tel|fone|celular|nr_cartao|numero_cartao|num_cartao|^pan$|nome_cliente|nm_cliente|e_?mail_cliente)/;

// Preserva as colunas da linha com o nome original do cabecalho (rastreabilidade).
function dadosOriginais(aba, linha) {
  const out = {};
  aba.cabecalho.forEach((k, i) => {
    if (COLUNA_SENSIVEL.test(k)) return;
    const v = linha.valores[k];
    if (!vazio(v)) out[aba.cabecalhoOriginal[i] || k] = typeof v === "number" ? v : valorOriginalTexto(v);
  });
  return out;
}

function criarColetor() {
  const erros = [];
  return {
    erros,
    add(aba, linha, campo, codigo, mensagem, valor, severidade = "erro") {
      erros.push({ aba: aba.nome, linha: linha.numero, campo, codigo, mensagem, valor_original: valorOriginalTexto(valor), severidade });
    }
  };
}

// ---- marca --------------------------------------------------------------------------------------
// Mesma prioridade do servidor: BIN validado > codigo de loja cadastrado > aba/coluna > selecao.
export function resolverMarcaLinha({ bin, cdLoja, marcaAba, marcaColuna, marcaSelecionada, mapaBins, mapaLojas = {} }) {
  if (bin && !mapaBins[bin]) return { erro: "BIN_DESCONHECIDO", mensagem: `BIN ${bin} não cadastrado.` };
  const marcaBin = bin ? mapaBins[bin] : null;
  const marcaLoja = cdLoja ? mapaLojas[String(cdLoja).trim()] || null : null;
  const explicita = marcaBin || marcaLoja;
  if (marcaBin && marcaLoja && marcaBin !== marcaLoja) return { erro: "CONFLITO_MARCA", mensagem: `BIN indica ${marcaBin}, loja indica ${marcaLoja}.` };
  if (marcaAba && marcaColuna && marcaAba !== marcaColuna) return { erro: "CONFLITO_MARCA", mensagem: `Aba indica ${marcaAba}, coluna de marca indica ${marcaColuna}.` };
  const informada = marcaColuna || marcaAba;
  if (explicita && informada && explicita !== informada) {
    return { erro: "CONFLITO_MARCA", mensagem: `${marcaBin ? `BIN ${bin}` : "Loja"} indica ${explicita}, mas ${marcaColuna ? "a coluna de marca" : "a aba"} indica ${informada}.` };
  }
  if (explicita) return { marca: explicita, origem: marcaBin ? "bin" : "loja", hint: informada || null };
  if (informada) return { marca: informada, origem: marcaColuna ? "coluna" : "aba", hint: informada };
  if (marcaSelecionada) return { marca: marcaSelecionada, origem: "selecao", hint: marcaSelecionada };
  return { erro: "MARCA_NAO_IDENTIFICADA", mensagem: "Linha sem BIN, sem loja cadastrada, sem aba/coluna de marca e sem marca selecionada." };
}

// ---- helpers de campo ---------------------------------------------------------------------------
function campoBruto(linha, mapa, campo) {
  const k = mapa[campo];
  return k ? linha.valores[k] : undefined;
}

function lerNumero(ctx, campo, { inteiro = false, naoNegativo = true } = {}) {
  const bruto = campoBruto(ctx.linha, ctx.mapa, campo);
  const r = parseNumero(bruto);
  if (r.erro) { ctx.col.add(ctx.aba, ctx.linha, campo.toUpperCase(), "VALOR_NUMERICO_INVALIDO", `Valor numérico inválido em ${campo.toUpperCase()}.`, bruto); ctx.invalida = true; return null; }
  if (r.valor === null) return null;
  if (naoNegativo && r.valor < 0) { ctx.col.add(ctx.aba, ctx.linha, campo.toUpperCase(), "VALOR_NEGATIVO", `${campo.toUpperCase()} não pode ser negativo.`, bruto); ctx.invalida = true; return null; }
  if (inteiro && !Number.isInteger(r.valor)) { ctx.col.add(ctx.aba, ctx.linha, campo.toUpperCase(), "QUANTIDADE_INVALIDA", `${campo.toUpperCase()} deve ser inteiro.`, bruto); ctx.invalida = true; return null; }
  if (typeof bruto === "string" && bruto.trim() !== String(r.valor)) ctx.transf.push({ campo: campo.toUpperCase(), de: valorOriginalTexto(bruto), para: r.valor, regra: "texto numérico convertido" });
  return r.valor;
}

function lerTexto(ctx, campo, max = 500) {
  const bruto = campoBruto(ctx.linha, ctx.mapa, campo);
  const t = textoLimpo(bruto, max);
  if (t && pareceFormula(t)) ctx.col.add(ctx.aba, ctx.linha, campo.toUpperCase(), "TEXTO_COM_FORMULA", `${campo.toUpperCase()} começa com caractere de fórmula; será armazenado como texto literal.`, t, "alerta");
  if (typeof bruto === "number") return String(bruto);
  return t;
}

function lerData(ctx, campo, { obrigatoria = false } = {}) {
  const bruto = campoBruto(ctx.linha, ctx.mapa, campo);
  const r = parseData(bruto);
  if (r.erro) { ctx.col.add(ctx.aba, ctx.linha, campo.toUpperCase(), "DATA_INVALIDA", `Data inválida em ${campo.toUpperCase()}.`, bruto); ctx.invalida = true; return { data: null, hora: null }; }
  if (!r.data && obrigatoria) { ctx.col.add(ctx.aba, ctx.linha, campo.toUpperCase(), "CAMPO_OBRIGATORIO", `${campo.toUpperCase()} vazio.`, bruto); ctx.invalida = true; }
  if (r.formato === "serial_excel") ctx.transf.push({ campo: campo.toUpperCase(), de: bruto, para: r.hora ? `${r.data}T${r.hora}` : r.data, regra: "serial do Excel convertido em data" });
  else if (r.formato === "dd/mm/aaaa" || r.formato === "aaaammdd") ctx.transf.push({ campo: campo.toUpperCase(), de: valorOriginalTexto(bruto), para: r.data, regra: `data ${r.formato} convertida para ISO` });
  return r;
}

// ---- escala das taxas de conversao --------------------------------------------------------------
// TX_CONV pode vir em 0-100 (12,5) ou fracao (0,125). Decide por linha comparando com a razao
// adesoes/abordados quando possivel; senao usa a escala dominante do arquivo.
export function escalaTaxas(linhasNumericas) {
  let fracao = 0, percentual = 0, maiorQueUm = false;
  for (const { tx, num, den, percentualExplicito } of linhasNumericas) {
    if (tx === null || tx === undefined) continue;
    if (percentualExplicito || tx > 1) { maiorQueUm = maiorQueUm || tx > 1; percentual++; continue; }
    if (num !== null && den) {
      const razao = (num / den) * 100;
      const tol = Math.max(0.05, razao * 0.02);
      if (Math.abs(tx - razao) <= tol) percentual++;
      else if (Math.abs(tx * 100 - razao) <= tol) fracao++;
    }
  }
  if (maiorQueUm || percentual > fracao) return "percentual";
  if (fracao > 0) return "fracao";
  return "indefinida";
}

export function normalizarTaxa({ tx, num, den, percentualExplicito }, escalaArquivo) {
  if (tx === null || tx === undefined) return { valor: null, regra: null, alerta: null };
  if (percentualExplicito) return { valor: tx, regra: null, alerta: null };
  if (num !== null && den) {
    const razao = (num / den) * 100;
    const tol = Math.max(0.05, razao * 0.02);
    if (Math.abs(tx - razao) <= tol) return { valor: tx, regra: null, alerta: null };
    if (Math.abs(tx * 100 - razao) <= tol) return { valor: tx * 100, regra: "taxa em fração (0-1) convertida para 0-100", alerta: null };
  }
  if (escalaArquivo === "fracao" && tx <= 1) return { valor: tx * 100, regra: "taxa em fração (0-1) convertida para 0-100 (escala do arquivo)", alerta: null };
  if (escalaArquivo === "indefinida" && tx <= 1) return { valor: tx, regra: null, alerta: "Escala da taxa ambígua (valor ≤ 1 sem adesões/abordados para conferir); mantida como 0-100." };
  return { valor: tx, regra: null, alerta: null };
}

// ---- preparacao por tipo ------------------------------------------------------------------------
function iterarLinhas(leitura, fn) {
  for (const aba of leitura.abas) for (const linha of aba.linhas) fn(aba, linha);
}

function marcaContexto(ctx, { bin, cdLoja, marcaColunaBruta, abaOrigemBruta }, opcoes) {
  let marcaColuna = null;
  if (!vazio(marcaColunaBruta)) {
    marcaColuna = marcaPorTexto(marcaColunaBruta);
    if (!marcaColuna) {
      ctx.col.add(ctx.aba, ctx.linha, "MARCA", "MARCA_INVALIDA", `Marca "${String(marcaColunaBruta).slice(0, 60)}" não reconhecida.`, marcaColunaBruta);
      ctx.invalida = true;
      return null;
    }
  }
  // Planilha consolidada: a coluna aba_origem (aba da planilha de origem) vale como a aba.
  let marcaAba = opcoes.marcasAba[ctx.aba.nome] || null;
  if (!vazio(abaOrigemBruta)) {
    const m = marcaPorTexto(abaOrigemBruta);
    if (!m) {
      ctx.col.add(ctx.aba, ctx.linha, "ABA_ORIGEM", "MARCA_INVALIDA", `Aba de origem "${String(abaOrigemBruta).slice(0, 60)}" não corresponde a uma marca.`, abaOrigemBruta);
      ctx.invalida = true;
      return null;
    }
    marcaAba = m;
  }
  const r = resolverMarcaLinha({
    bin, cdLoja, marcaAba, marcaColuna,
    marcaSelecionada: opcoes.marcaSelecionada || null, mapaBins: opcoes.mapaBins, mapaLojas: opcoes.mapaLojas
  });
  if (r.erro) { ctx.col.add(ctx.aba, ctx.linha, "MARCA", r.erro, r.mensagem, bin || marcaColunaBruta || ctx.aba.nome); ctx.invalida = true; ctx.conflitoMarca = r.erro === "CONFLITO_MARCA"; return null; }
  return r;
}

function prepararCRM(leitura, mapa, opcoes, col) {
  // 1a passada: escala das taxas no arquivo
  const amostrasA = [], amostrasC = [];
  iterarLinhas(leitura, (aba, linha) => {
    const g = (c) => parseNumero(campoBruto(linha, mapa, c));
    const txa = g("tx_conv_abordado"), txc = g("tx_conv_controle");
    amostrasA.push({ tx: txa.valor, num: g("qt_adesao_abordado").valor, den: g("qt_abordado").valor, percentualExplicito: txa.percentual });
    amostrasC.push({ tx: txc.valor, num: g("qt_adesao_controle").valor, den: g("qt_controle").valor, percentualExplicito: txc.percentual });
  });
  const escalaA = escalaTaxas(amostrasA), escalaC = escalaTaxas(amostrasC);

  const registros = [];
  iterarLinhas(leitura, (aba, linha) => {
    const ctx = { aba, linha, mapa, col, transf: [], invalida: false };
    const bin = parseBin(campoBruto(linha, mapa, "nr_bin"));
    const marca = marcaContexto(ctx, {
      bin, cdLoja: null, marcaColunaBruta: campoBruto(linha, mapa, "marca"), abaOrigemBruta: campoBruto(linha, mapa, "aba_origem")
    }, opcoes);
    const idRegistro = lerTexto(ctx, "id_registro", 120);

    const dh = lerData(ctx, "dh_disparo");
    const mes = parseMes(campoBruto(linha, mapa, "mes"));
    const ano = parseAno(campoBruto(linha, mapa, "ano"));
    if (!dh.data && !ctx.invalida) {
      if (mes && ano) col.add(aba, linha, "DH_DISPARO", "DATA_DERIVADA_MES_ANO", "Sem DH_DISPARO: data derivada de MES/ANO (dia 1).", null, "alerta");
      else { col.add(aba, linha, "DH_DISPARO", "DATA_INVALIDA", "DH_DISPARO ausente e MES/ANO insuficientes.", campoBruto(linha, mapa, "dh_disparo")); ctx.invalida = true; }
    }
    if (dh.data && mes && ano && (Number(dh.data.slice(5, 7)) !== mes || Number(dh.data.slice(0, 4)) !== ano)) {
      col.add(aba, linha, "MES", "MES_ANO_DIVERGENTE", `MES/ANO (${mes}/${ano}) diferente da data de disparo (${dh.data}); será usada a data.`, null, "alerta");
    }
    const campanha = lerTexto(ctx, "ds_campanha", 300);
    if (!campanha) { col.add(aba, linha, "DS_CAMPANHA", "CAMPO_OBRIGATORIO", "DS_CAMPANHA vazio.", null); ctx.invalida = true; }
    // O nome da campanha costuma carregar o BIN (B2B_960358_...). A coluna BIN prevalece; a
    // divergencia vira alerta para revisao, sem bloquear a linha.
    const binCampanha = campanha ? binEmbutido(campanha, opcoes.mapaBins) : null;
    if (bin && binCampanha && binCampanha !== bin) {
      col.add(aba, linha, "DS_CAMPANHA", "BIN_CAMPANHA_DIVERGENTE", `Nome da campanha cita o BIN ${binCampanha}, mas a coluna BIN é ${bin}; mantida a marca do BIN ${bin}.`, campanha, "alerta");
    }

    const qa = lerNumero(ctx, "qt_abordado", { inteiro: true });
    const qaa = lerNumero(ctx, "qt_adesao_abordado", { inteiro: true });
    const vga = lerNumero(ctx, "vl_gasto_abordado");
    const tka = lerNumero(ctx, "tkm_abordado");
    const qc = lerNumero(ctx, "qt_controle", { inteiro: true });
    const qac = lerNumero(ctx, "qt_adesao_controle", { inteiro: true });
    const vgc = lerNumero(ctx, "vl_gasto_controle");
    const tkc = lerNumero(ctx, "tkm_controle");
    const vvi = lerNumero(ctx, "vl_vendas_incrementais", { naoNegativo: false });

    const taxa = (campo, num, den, escala) => {
      const bruto = campoBruto(linha, mapa, campo);
      const p = parseNumero(bruto);
      if (p.erro) { col.add(aba, linha, campo.toUpperCase(), "VALOR_NUMERICO_INVALIDO", `Valor inválido em ${campo.toUpperCase()}.`, bruto); ctx.invalida = true; return null; }
      const n = normalizarTaxa({ tx: p.valor, num, den, percentualExplicito: p.percentual }, escala);
      if (n.regra) ctx.transf.push({ campo: campo.toUpperCase(), de: valorOriginalTexto(bruto), para: n.valor, regra: n.regra });
      if (n.alerta) col.add(aba, linha, campo.toUpperCase(), "ESCALA_TAXA_AMBIGUA", n.alerta, bruto, "alerta");
      if (n.valor !== null && (n.valor < 0 || n.valor > 100)) { col.add(aba, linha, campo.toUpperCase(), "TAXA_FORA_DA_FAIXA", `${campo.toUpperCase()} fora de 0-100 após normalização.`, bruto); ctx.invalida = true; }
      return n.valor;
    };
    const txa = taxa("tx_conv_abordado", qaa, qa, escalaA);
    const txc = taxa("tx_conv_controle", qac, qc, escalaC);

    if (qa !== null && qaa !== null && qaa > qa) col.add(aba, linha, "QT_ADESAO_ABORDADO", "ADESOES_MAIOR_QUE_ABORDADOS", "Adesões maiores que abordagens (importado com alerta).", qaa, "alerta");
    if (qc !== null && qac !== null && qac > qc) col.add(aba, linha, "QT_ADESAO_CONTROLE", "ADESOES_MAIOR_QUE_CONTROLE", "Adesões do controle maiores que o grupo de controle (importado com alerta).", qac, "alerta");
    if (vga !== null && qaa && tka !== null && Math.abs(vga / qaa - tka) > Math.max(0.05, tka * 0.02)) {
      col.add(aba, linha, "TKM_ABORDADO", "TICKET_DIVERGENTE", `TKM_ABORDADO (${tka}) difere de VL_GASTO/QT_ADESAO (${(vga / qaa).toFixed(2)}).`, tka, "alerta");
    }

    const canal = lerTexto(ctx, "ds_canal", 120);
    const categoria = lerTexto(ctx, "ds_cluster_campanha", 200);
    if (canal && canalNormalizado(canal) !== canal) ctx.transf.push({ campo: "DS_CANAL", de: canal, para: canalNormalizado(canal), regra: "canal normalizado (original preservado)" });
    if (categoria && categoriaNormalizada(categoria) !== categoria) ctx.transf.push({ campo: "DS_CLUSTER_CAMPANHA", de: categoria, para: categoriaNormalizada(categoria), regra: "categoria normalizada (original preservada)" });

    if (ctx.invalida || !marca) { registros.push({ invalida: true, conflitoMarca: !!ctx.conflitoMarca, aba: aba.nome, linha: linha.numero }); return; }
    const dataIso = dh.data || `${ano}-${String(mes).padStart(2, "0")}-01`;
    registros.push({
      aba: aba.nome, linha: linha.numero, marca: marca.marca, marca_origem: marca.origem,
      payload: {
        aba: aba.nome, linha: linha.numero, marca_aba: marca.hint, nr_bin: bin, id_registro: idRegistro,
        dh_disparo: dh.data ? (dh.hora ? `${dh.data}T${dh.hora}` : dh.data) : null,
        mes, ano, ds_campanha: campanha, ds_canal: canal, ds_step: lerTexto(ctx, "ds_step", 200),
        ds_cluster_campanha: categoria, fl_regua: lerTexto(ctx, "fl_regua", 40),
        qt_abordado: qa, qt_adesao_abordado: qaa, vl_gasto_abordado: decimalParaServidor(vga), tkm_abordado: decimalParaServidor(tka),
        qt_controle: qc, qt_adesao_controle: qac, vl_gasto_controle: decimalParaServidor(vgc), tkm_controle: decimalParaServidor(tkc),
        tx_conv_abordado: decimalParaServidor(txa, 4), tx_conv_controle: decimalParaServidor(txc, 4),
        vl_vendas_incrementais: decimalParaServidor(vvi),
        ds_frase: lerTexto(ctx, "ds_frase", 2000), ds_titulo_push: lerTexto(ctx, "ds_titulo_push", 300),
        dados_originais: dadosOriginais(aba, linha), transformacoes: ctx.transf
      },
      data: dataIso
    });
  });
  return registros;
}

function prepararPropostas(leitura, mapa, opcoes, col, nomeArquivo) {
  const registros = [];
  iterarLinhas(leitura, (aba, linha) => {
    const ctx = { aba, linha, mapa, col, transf: [], invalida: false };
    const cdLoja = lerTexto(ctx, "cd_loja_cs", 40);
    const origem = lerTexto(ctx, "origem_prop", 200);
    const bin = parseBin(campoBruto(linha, mapa, "nr_bin")) || binEmbutido(origem, opcoes.mapaBins) || (cdLoja && opcoes.mapaBins[cdLoja] ? cdLoja : null);
    const marca = marcaContexto(ctx, { bin, cdLoja, marcaColunaBruta: campoBruto(linha, mapa, "marca") }, opcoes);
    const id = lerTexto(ctx, "id_cod_proposta", 80);
    if (!id) { col.add(aba, linha, "ID_COD_PROPOSTA", "SEM_IDENTIFICADOR", "Proposta sem identificador: não é possível deduplicar.", null); ctx.invalida = true; }
    const dt = lerData(ctx, "dt_proposta", { obrigatoria: true });
    const aprov = parseFlag(campoBruto(linha, mapa, "proposta_aprov"));
    const rejei = parseFlag(campoBruto(linha, mapa, "proposta_rejei"));
    const status = lerTexto(ctx, "status", 80);
    if (aprov === null && rejei === null && !status) { col.add(aba, linha, "STATUS", "STATUS_AUSENTE", "Proposta sem status (aprovada/rejeitada).", null); ctx.invalida = true; }
    if (aprov === 1 && rejei === 1) { col.add(aba, linha, "STATUS", "STATUS_CONFLITANTE", "Proposta aprovada e rejeitada ao mesmo tempo.", null); ctx.invalida = true; }
    const dtAprov = lerData(ctx, "dt_aprovacao");
    const dtEmi = lerData(ctx, "dt_emissao");
    const dtAtiv = lerData(ctx, "dt_ativacao");
    if (dtEmi.data && dtAtiv.data && dtAtiv.data < dtEmi.data) col.add(aba, linha, "DT_ATIVACAO", "ATIVACAO_ANTES_DA_EMISSAO", "Ativação anterior à emissão: a ativação será ignorada.", dtAtiv.data, "alerta");
    const horaCampo = lerTexto(ctx, "hr_proposta", 20);
    if (ctx.invalida || !marca) { registros.push({ invalida: true, conflitoMarca: !!ctx.conflitoMarca, aba: aba.nome, linha: linha.numero }); return; }
    registros.push({
      aba: aba.nome, linha: linha.numero, marca: marca.marca, marca_origem: marca.origem, data: dt.data,
      chave: `id:${id}|${marca.marca}`,
      payload: {
        aba: aba.nome, linha: linha.numero, marca_hint: marca.hint, nr_bin: bin,
        id_cod_proposta: id, dt_proposta: dt.data, hr_proposta: (horaCampo && /^\d{1,2}:\d{2}/.test(horaCampo) ? horaCampo.padStart(5, "0").slice(0, 8) : dt.hora),
        cd_loja_cs: cdLoja, nm_loja: lerTexto(ctx, "nm_loja", 200),
        status, proposta_aprov: aprov === null ? null : String(aprov), proposta_rejei: rejei === null ? null : String(rejei),
        motivo: lerTexto(ctx, "motivo", 200), motivo_rejeicao: lerTexto(ctx, "motivo_rejeicao", 200),
        dt_aprovacao: dtAprov.data, dt_emissao: dtEmi.data, dt_ativacao: dtAtiv.data,
        id_cod_cartao: lerTexto(ctx, "id_cod_cartao", 80),
        cpf_cliente: vazio(campoBruto(linha, mapa, "cpf_cliente")) ? null : String(campoBruto(linha, mapa, "cpf_cliente")).replace(/\D/g, "") || null,
        cliente_pseudo_id: lerTexto(ctx, "cliente_pseudo_id", 120), cd_cliente: lerTexto(ctx, "cd_cliente", 80),
        campanha: lerTexto(ctx, "campanha", 200), origem_prop: origem, nivel_2: lerTexto(ctx, "nivel_2", 200),
        origem_arquivo: nomeArquivo, dados_originais: dadosOriginais(aba, linha)
      }
    });
  });
  return registros;
}

function prepararEmissoes(leitura, mapa, opcoes, col, nomeArquivo) {
  const registros = [];
  iterarLinhas(leitura, (aba, linha) => {
    const ctx = { aba, linha, mapa, col, transf: [], invalida: false };
    const cdLoja = lerTexto(ctx, "cd_loja_cs", 40);
    const bin = parseBin(campoBruto(linha, mapa, "nr_bin"));
    const marca = marcaContexto(ctx, { bin, cdLoja, marcaColunaBruta: campoBruto(linha, mapa, "marca") }, opcoes);
    const emi = lerData(ctx, "dt_emissao", { obrigatoria: true });
    const ativ = lerData(ctx, "dt_ativacao");
    if (emi.data && ativ.data && ativ.data < emi.data) { col.add(aba, linha, "DT_ATIVACAO", "ATIVACAO_ANTES_DA_EMISSAO", "Data de ativação anterior à emissão.", ativ.data); ctx.invalida = true; }
    const cartao = lerTexto(ctx, "id_cod_cartao", 80);
    const cpf = vazio(campoBruto(linha, mapa, "cpf_cliente")) ? null : String(campoBruto(linha, mapa, "cpf_cliente")).replace(/\D/g, "") || null;
    const pseudo = lerTexto(ctx, "cliente_pseudo_id", 120);
    if (!cartao && !cpf && !pseudo) { col.add(aba, linha, "ID_COD_CARTAO", "SEM_IDENTIFICADOR", "Emissão sem ID do cartão e sem cliente: não é possível deduplicar.", null); ctx.invalida = true; }
    if (ctx.invalida || !marca) { registros.push({ invalida: true, conflitoMarca: !!ctx.conflitoMarca, aba: aba.nome, linha: linha.numero }); return; }
    const loja = lerTexto(ctx, "nm_loja", 200);
    registros.push({
      aba: aba.nome, linha: linha.numero, marca: marca.marca, marca_origem: marca.origem, data: emi.data,
      chave: cartao ? `id:${cartao}|${marca.marca}` : `nk:${marca.marca}|${emi.data}|${normalizarTexto(loja || cdLoja)}|${cpf || pseudo}|${normalizarTexto(campoBruto(linha, mapa, "tipo_cartao"))}|${normalizarTexto(campoBruto(linha, mapa, "canal"))}`,
      payload: {
        aba: aba.nome, linha: linha.numero, marca_hint: marca.hint, nr_bin: bin, cd_loja_cs: cdLoja, nm_loja: loja,
        dt_emissao: emi.data, dt_ativacao: ativ.data, id_cod_cartao: cartao, cpf_cliente: cpf, cliente_pseudo_id: pseudo,
        canal: lerTexto(ctx, "canal", 120), sub_canal: lerTexto(ctx, "sub_canal", 120), tipo_cartao: lerTexto(ctx, "tipo_cartao", 60),
        origem_arquivo: nomeArquivo
      }
    });
  });
  return registros;
}

function prepararTransacoes(leitura, mapa, opcoes, col) {
  const registros = [];
  iterarLinhas(leitura, (aba, linha) => {
    const ctx = { aba, linha, mapa, col, transf: [], invalida: false };
    const cdLoja = lerTexto(ctx, "cd_loja", 40);
    const bin = parseBin(campoBruto(linha, mapa, "nr_bin"));
    const marca = marcaContexto(ctx, { bin, cdLoja, marcaColunaBruta: campoBruto(linha, mapa, "marca") }, opcoes);
    const dt = lerData(ctx, "dt_transacao", { obrigatoria: true });
    const valor = lerNumero(ctx, "vl_transacao", { naoNegativo: false });
    if (valor === null && !ctx.invalida) { col.add(aba, linha, "VL_TRANSACAO", "CAMPO_OBRIGATORIO", "Valor da compra vazio.", null); ctx.invalida = true; }
    const id = lerTexto(ctx, "id_transacao", 120);
    const cpf = vazio(campoBruto(linha, mapa, "cpf_cliente")) ? null : String(campoBruto(linha, mapa, "cpf_cliente")).replace(/\D/g, "") || null;
    const pseudo = lerTexto(ctx, "cliente_pseudo_id", 120);
    if (!id && !cpf && !pseudo) { col.add(aba, linha, "ID_TRANSACAO", "SEM_IDENTIFICADOR", "Compra sem identificador e sem cliente.", null); ctx.invalida = true; }
    const qt = lerNumero(ctx, "qt_itens", { inteiro: true });
    if (ctx.invalida || !marca) { registros.push({ invalida: true, conflitoMarca: !!ctx.conflitoMarca, aba: aba.nome, linha: linha.numero }); return; }
    const hora = lerTexto(ctx, "hr_transacao", 20) || dt.hora;
    registros.push({
      aba: aba.nome, linha: linha.numero, marca: marca.marca, marca_origem: marca.origem, data: dt.data,
      chave: id ? `id:${id}|${marca.marca}` : `nk:${marca.marca}|${dt.data}|${cpf || pseudo}|${normalizarTexto(cdLoja)}|${valor}|${hora || ""}`,
      payload: {
        aba: aba.nome, linha: linha.numero, marca_hint: marca.hint, nr_bin: bin, id_transacao: id,
        dt_transacao: dt.data, hr_transacao: hora, vl_transacao: decimalParaServidor(valor), qt_itens: qt,
        cd_loja: cdLoja, nm_loja: lerTexto(ctx, "nm_loja", 200), cpf_cliente: cpf, cliente_pseudo_id: pseudo,
        id_cod_cartao: lerTexto(ctx, "id_cod_cartao", 80), forma_pagamento: lerTexto(ctx, "forma_pagamento", 60),
        dados_originais: dadosOriginais(aba, linha)
      }
    });
  });
  return registros;
}

function semRastreio(payload) {
  const { aba, linha, dados_originais, transformacoes, ...resto } = payload;
  return JSON.stringify(resto);
}

// Ponto de entrada. opcoes: { mapaBins, mapaLojas, marcasAba, marcaSelecionada, nomeArquivo }
export function prepararImportacao(tipo, leitura, mapa, opcoes) {
  if (!TIPOS_ARQUIVO[tipo]) throw new Error("Tipo de arquivo desconhecido.");
  const col = criarColetor();
  const preparadores = {
    credsystem_crm_campanhas: prepararCRM,
    credsystem_propostas: prepararPropostas,
    credsystem_emissoes: prepararEmissoes,
    credsystem_transacoes: prepararTransacoes
  };
  const brutos = preparadores[tipo](leitura, mapa, opcoes, col, opcoes.nomeArquivo || "");

  // duplicidades dentro do proprio arquivo
  const vistos = new Map();
  const validos = [];
  let duplicadasIdenticas = 0, duplicadasDivergentes = 0, invalidas = 0, conflitosMarca = 0;
  for (const r of brutos) {
    if (r.invalida) { invalidas++; if (r.conflitoMarca) conflitosMarca++; continue; }
    const chave = tipo === "credsystem_crm_campanhas" ? chaveNaturalCRM({ ...r.payload, marca: r.marca }) : r.chave;
    const anterior = vistos.get(chave);
    if (anterior) {
      if (semRastreio(anterior.payload) === semRastreio(r.payload)) {
        duplicadasIdenticas++;
        col.erros.push({ aba: r.aba, linha: r.linha, campo: null, codigo: "DUPLICADA_NO_ARQUIVO", mensagem: `Linha idêntica à linha ${anterior.linha} (${anterior.aba}); ignorada.`, valor_original: null, severidade: "alerta" });
      } else {
        duplicadasDivergentes++;
        invalidas++;
        col.erros.push({ aba: r.aba, linha: r.linha, campo: null, codigo: "DUPLICADA_DIVERGENTE", mensagem: `Mesma chave da linha ${anterior.linha} (${anterior.aba}) com valores diferentes; revise antes de importar.`, valor_original: null, severidade: "erro" });
      }
      continue;
    }
    vistos.set(chave, r);
    validos.push(r);
  }

  const marcas = {};
  let inicio = null, fim = null;
  for (const r of validos) {
    marcas[r.marca] = (marcas[r.marca] || 0) + 1;
    if (r.data && (!inicio || r.data < inicio)) inicio = r.data;
    if (r.data && (!fim || r.data > fim)) fim = r.data;
  }
  const errosDeLinha = col.erros.filter((e) => e.severidade === "erro");
  const alertas = col.erros.filter((e) => e.severidade === "alerta");
  const linhasLidas = leitura.abas.reduce((s, a) => s + a.linhas.length, 0);

  return {
    registros: validos.map((r) => r.payload),
    erros: errosDeLinha,
    alertas,
    resumo: {
      linhasLidas,
      linhasVazias: leitura.abas.reduce((s, a) => s + a.vazias, 0),
      validas: validos.length,
      invalidas,
      duplicadasIdenticas,
      duplicadasDivergentes,
      conflitosMarca,
      inconsistencias: alertas.filter((a) => /DIVERGENTE|MAIOR_QUE|ATIVACAO_ANTES|AMBIGUA/.test(a.codigo)).length,
      marcas,
      periodo: { inicio, fim },
      abas: leitura.abas.map((a) => ({ nome: a.nome, linhas: a.linhas.length, marca: opcoes.marcasAba[a.nome] || null }))
    }
  };
}
