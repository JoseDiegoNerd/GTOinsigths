// Tela "Cartao Proprio CredSystem": 6 abas alimentadas por fontes independentes.
//   Operacional (propostas/emissoes) -> rpc_credsystem_operacional_resumo (agregado no servidor, RLS)
//   CRM (planilha de campanhas)       -> credsystem_campanhas_crm (linhas, consolidadas por somas ponderadas)
//   Retencao (transacoes)             -> rpc_credsystem_retencao_resumo
// Uma fonte com erro/sem dados nao zera as outras: cada indicador mostra seu proprio estado.

import { CORES_MARCA, COR_NEUTRA, MARCAS } from "./constantes.js";
import { criarService } from "./service.js";
import {
  agruparPor, consolidarCRM, estadoIndicador, fmtBRL, fmtData, fmtInt, fmtMes, fmtPct, fmtPp, funilOperacional,
  MENSAGENS_ESTADO, mesDe, somarOperacional, taxa
} from "./metricas.js";
import { barrasAgrupadas, barrasHorizontais, esc, funil, linhas as graficoLinhas } from "./graficos.js";
import { baixarArquivo, exportarExcel, gerarCsv } from "./exportacao.js";

const ABAS = [
  ["visao", "Visão Geral"],
  ["funil", "Funil de Cartões"],
  ["lojas", "Ranking por Loja"],
  ["motivos", "Motivos"],
  ["crm", "Campanhas CRM"],
  ["retencao", "Retenção e Comportamento"]
];
const STALE_MS = 5 * 60 * 1000;
const AGUARDANDO_OP = "Aguardando importação de dados operacionais";
const AGUARDANDO_CRM = "Aguardando importação da planilha de campanhas CRM";

let deps = null;
let service = null;
let ui = null;
const cache = new Map();

export function initDashboard(dependencias) {
  deps = dependencias;
  service = criarService(deps.supabase);
  ui = { aba: "visao", lojaBusca: "", lojaOrdem: { campo: "propostas", dir: "desc" }, ultimoModelo: null };
  cache.clear();
}

export function invalidarCacheDashboard() {
  cache.clear();
}

export function definirAba(aba) {
  if (ABAS.some(([k]) => k === aba)) ui.aba = aba;
}

const periodoAtual = () => ({ marca: deps.state.marca, de: deps.fromDate(), ate: deps.toDate() });
const chaveCache = () => { const p = periodoAtual(); return [p.marca, p.de, p.ate].join("|"); };
const corMarca = (m) => CORES_MARCA[m] || COR_NEUTRA;
const corUnica = () => (deps.state.marca === "Todas" ? COR_NEUTRA : corMarca(deps.state.marca));

// ---- carga --------------------------------------------------------------------------------------
async function carregar() {
  const p = periodoAtual();
  const [op, crm, baseCrm, status, ret] = await Promise.allSettled([
    service.operacional(p), service.campanhasCRM(p), service.baseCRM(p), service.statusImportacoes(p), service.retencao(p)
  ]);
  const val = (r) => (r.status === "fulfilled" ? r.value : null);
  const err = (r) => (r.status === "rejected" ? r.reason : null);
  [op, crm, baseCrm, status, ret].forEach((r) => { if (r.status === "rejected") console.error(r.reason); });
  return {
    ...p,
    op: val(op), opErro: err(op),
    crm: val(crm) || [], crmErro: err(crm),
    baseCrm: val(baseCrm), baseCrmErro: err(baseCrm),
    status: val(status) || {}, statusErro: err(status),
    ret: val(ret), retErro: err(ret),
    carregadoEm: Date.now()
  };
}

export async function renderCredsystem({ force = false } = {}) {
  const content = document.querySelector("#content");
  const chave = chaveCache();
  const emCache = cache.get(chave);
  if (emCache) pintar(emCache.modelo);
  else content.innerHTML = cabecalhoHtml(null) + `<div class="grid kpis cs-kpis">${Array.from({ length: 8 }, () => `<article class="card kpi"><span class="skel skel-text" style="width:60%"></span><div class="skel skel-block" style="height:28px;margin-top:10px"></div></article>`).join("")}</div>`;
  if (!emCache) ligarFiltros();
  if (!force && emCache && Date.now() - emCache.modelo.carregadoEm < STALE_MS) return;
  try {
    const modelo = await carregar();
    cache.set(chave, { modelo });
    if (deps.state.page === "credsystem" && chaveCache() === chave) pintar(modelo);
  } catch (error) {
    if (deps.state.page === "credsystem" && !emCache) content.innerHTML = cabecalhoHtml(null) + `<div class="alert error">${esc(deps.safeErrorMessage(error))}</div>`;
  }
}

// ---- derivados ----------------------------------------------------------------------------------
function derivar(m) {
  const porMarca = m.op?.por_marca || [];
  const tot = somarOperacional(porMarca);
  const fun = funilOperacional(tot);
  const basePropostas = (m.op?.base?.propostas || []).reduce((s, b) => s + Number(b.n || 0), 0);
  const baseCartoes = (m.op?.base?.cartoes || []).reduce((s, b) => s + Number(b.n || 0), 0);
  const crmCons = consolidarCRM(m.crm);
  const marcasOp = porMarca.filter((r) => Number(r.propostas) > 0 || Number(r.emitidos_periodo) > 0).map((r) => r.marca);
  const marcasCrm = [...new Set(m.crm.map((r) => r.marca))];
  return {
    tot, fun, basePropostas, baseCartoes, crmCons,
    temBaseOp: basePropostas + baseCartoes > 0,
    temBaseCrm: (m.baseCrm?.total || 0) > 0,
    marcasComDados: [...new Set([...marcasOp, ...marcasCrm])].sort((a, b) => MARCAS.indexOf(a) - MARCAS.indexOf(b))
  };
}

function coberturaOperacional(m) {
  const datas = [...(m.op?.base?.propostas || []), ...(m.op?.base?.cartoes || [])];
  const ini = datas.map((b) => b.ini).filter(Boolean).sort()[0] || null;
  const fim = datas.map((b) => b.fim).filter(Boolean).sort().pop() || null;
  return { ini, fim };
}

function ultimaImportacao(m) {
  const datas = Object.values(m.status || {}).map((s) => s.ultima_importacao).filter(Boolean);
  const legado = deps.lastImportTimestamp?.(["dados_cartoes_credsystem", "stage_credsystem_propostas"]);
  if (legado) datas.push(legado);
  return datas.sort().pop() || null;
}

// ---- componentes --------------------------------------------------------------------------------
function kpiHtml({ rotulo, icone, estado, texto, nota = "", titulo = "" }) {
  const conteudo = estado === "valor" ? `<strong>${esc(texto)}</strong>`
    : estado === "nd" ? `<strong class="cs-nd" title="Denominador zero ou dado não informado">N/D</strong>`
      : `<span class="cs-estado cs-estado-${esc(estado)}">${esc(texto && estado === "sem_dados_importados" ? texto : MENSAGENS_ESTADO[estado] || texto)}</span>`;
  return `<article class="card kpi cs-kpi" ${titulo ? `title="${esc(titulo)}"` : ""}><div class="kpi-top"><span>${esc(rotulo)}</span><span class="material-symbols-outlined">${esc(icone)}</span></div>${conteudo}${nota ? `<small class="cs-kpi-nota">${esc(nota)}</small>` : ""}</article>`;
}

function kpiOp(d, m, { rotulo, icone, valor, formato, nota, titulo, base = d.temBaseOp, periodo = d.tot.propostas + d.tot.emitidos_periodo + d.tot.ativados_periodo > 0 }) {
  const estado = estadoIndicador({ erro: m.opErro, temBase: base, temPeriodo: periodo, valor });
  return kpiHtml({ rotulo, icone, estado, texto: estado === "valor" ? formato(valor) : AGUARDANDO_OP, nota, titulo });
}

function kpiCrm(d, m, { rotulo, icone, valor, formato, nota, titulo }) {
  const estado = estadoIndicador({ erro: m.crmErro, temBase: d.temBaseCrm, temPeriodo: m.crm.length > 0, valor });
  return kpiHtml({ rotulo, icone, estado, texto: estado === "valor" ? formato(valor) : AGUARDANDO_CRM, nota, titulo });
}

function estadoSecaoHtml(estado, mensagemSemDados) {
  const textos = {
    sem_dados_importados: mensagemSemDados,
    sem_registros_periodo: "Há dados importados, mas nenhum registro no período e marca selecionados.",
    erro: "Não foi possível carregar esta fonte agora. Tente atualizar.",
    sem_permissao: "Você não tem permissão para ver estes dados."
  };
  return `<div class="cs-vazio"><span class="material-symbols-outlined">${estado === "erro" ? "error" : estado === "sem_permissao" ? "lock" : "hourglass_empty"}</span><p>${esc(textos[estado] || mensagemSemDados)}</p></div>`;
}

function estadoOp(m, d) {
  return estadoIndicador({ erro: m.opErro, temBase: d.temBaseOp, temPeriodo: d.tot.propostas + d.tot.emitidos_periodo > 0, valor: 1 });
}
function estadoCrm(m, d) {
  return estadoIndicador({ erro: m.crmErro, temBase: d.temBaseCrm, temPeriodo: m.crm.length > 0, valor: 1 });
}

function fonteHtml(texto) {
  return `<span class="cs-fonte"><span class="material-symbols-outlined">database</span>${esc(texto)}</span>`;
}

function chipMarca(marca) {
  return `<span class="cs-chip" style="--cs-cor:${esc(corMarca(marca))}">${esc(marca)}</span>`;
}

// ---- cabecalho e filtros ------------------------------------------------------------------------
function anosDisponiveis(m) {
  const anos = new Set([new Date().getFullYear()]);
  if (m) {
    const cob = coberturaOperacional(m);
    [cob.ini, cob.fim, m.baseCrm?.inicio, m.baseCrm?.fim].filter(Boolean).forEach((d) => anos.add(Number(String(d).slice(0, 4))));
    const a = [...anos].sort();
    for (let y = a[0]; y <= a[a.length - 1]; y++) anos.add(y);
  }
  return [...anos].sort((a, b) => b - a);
}

function selecaoAnoMes() {
  const s = deps.state;
  if (s.periodo !== "custom" || !s.periodoDe || !s.periodoAte) return { ano: "", mes: "" };
  const [a1, m1, d1] = s.periodoDe.split("-");
  const [a2, m2] = s.periodoAte.split("-");
  if (a1 !== a2) return { ano: "", mes: "" };
  if (m1 === "01" && d1 === "01" && s.periodoAte === `${a1}-12-31`) return { ano: a1, mes: "" };
  const ultimo = new Date(Date.UTC(Number(a1), Number(m1), 0)).getUTCDate();
  if (m1 === m2 && d1 === "01" && s.periodoAte === `${a1}-${m1}-${String(ultimo).padStart(2, "0")}`) return { ano: a1, mes: m1 };
  return { ano: "", mes: "" };
}

function cabecalhoHtml(m) {
  const d = m ? derivar(m) : null;
  const sel = selecaoAnoMes();
  const meses = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"];
  const de = deps.fromDate(), ate = deps.toDate();
  const cob = m ? coberturaOperacional(m) : null;
  const ult = m ? ultimaImportacao(m) : null;
  const isAdmin = deps.state.perfil?.cargo === "Admin";
  return `
    <div class="page-head">
      <div><div class="eyebrow">Inteligência comercial</div><h2>Cartão Próprio CredSystem</h2>
        <p class="muted">${deps.state.marca === "Todas" ? "Consolidado das marcas autorizadas para o seu usuário (taxas recalculadas pelos totais, nunca pela média das marcas)." : `Somente registros de <strong>${esc(deps.state.marca)}</strong>.`}</p></div>
      <div class="filters">
        ${deps.marcaPillsHtml()}
        ${deps.periodoDropdownHtml()}
        <select id="csAno" aria-label="Ano"><option value="">Ano</option>${anosDisponiveis(m).map((a) => `<option ${String(a) === sel.ano ? "selected" : ""}>${a}</option>`).join("")}</select>
        <select id="csMes" aria-label="Mês" ${sel.ano ? "" : "disabled"}><option value="">Mês</option>${meses.map((mm) => `<option value="${mm}" ${mm === sel.mes ? "selected" : ""}>${fmtMes(`2000-${mm}`).split("/")[0]}</option>`).join("")}</select>
        <button type="button" class="secondary" id="csTudo" ${deps.state.periodo === "all" ? "disabled" : ""}>Todo o período</button>
        <button type="button" id="csAtualizar">Atualizar</button>
      </div>
    </div>
    <div class="cs-faixa">
      <span><b>Filtro:</b> ${de || ate ? `${esc(fmtData(de) || "início")} a ${esc(ate ? fmtData(ate) : "hoje")}` : "todo o período"}</span>
      ${m ? `<span><b>Operação importada:</b> ${cob.ini ? `${esc(fmtData(cob.ini))} a ${esc(fmtData(cob.fim))}` : "nenhuma"}</span>
      <span><b>Campanhas CRM importadas:</b> ${m.baseCrm?.inicio ? `${esc(fmtData(m.baseCrm.inicio))} a ${esc(fmtData(m.baseCrm.fim))}` : "nenhuma"}</span>
      <span><b>Última importação:</b> ${ult ? esc(new Date(ult).toLocaleString("pt-BR")) : "—"}</span>` : `<span class="muted">Carregando…</span>`}
      ${isAdmin ? `<button type="button" class="secondary cs-link" id="csIrImportar"><span class="material-symbols-outlined">upload_file</span>Importar planilhas</button>` : ""}
    </div>
    ${d && (d.temBaseOp || d.temBaseCrm) && d.tot.propostas + d.tot.emitidos_periodo === 0 && m.crm.length === 0 ? `<div class="alert">Há dados importados, mas nada no período selecionado. Use <b>Todo o período</b> ou escolha um ano/mês dentro da cobertura acima.</div>` : ""}`;
}

function abasHtml() {
  return `<div class="subtabs cs-abas" role="tablist">${ABAS.map(([k, r]) => `<button type="button" role="tab" data-cs-aba="${k}" class="${ui.aba === k ? "active" : ""}">${esc(r)}</button>`).join("")}</div>`;
}

// ---- ABA 1: visao geral -------------------------------------------------------------------------
function mesesUniao(...listas) {
  return [...new Set(listas.flat().filter(Boolean))].sort();
}

function visaoHtml(m, d) {
  const f = d.fun;
  const ret = m.ret?.tem_dados ? m.ret : null;
  const recompra = ret ? taxa(ret.clientes_recorrentes, ret.clientes_unicos) : null;
  const notaAtiv = f.modo === "coorte" ? "Coorte: ativados ÷ emitidos das propostas do período" : "Taxa de período (eventos no período)";
  const opKpis = [
    kpiOp(d, m, { rotulo: "Propostas realizadas", icone: "assignment", valor: d.tot.propostas, formato: fmtInt, base: d.basePropostas > 0, periodo: d.tot.propostas > 0 }),
    kpiOp(d, m, { rotulo: "Propostas aprovadas", icone: "check_circle", valor: d.tot.aprovadas, formato: fmtInt, base: d.basePropostas > 0, periodo: d.tot.propostas > 0 }),
    kpiOp(d, m, { rotulo: "Propostas rejeitadas", icone: "cancel", valor: d.tot.rejeitadas, formato: fmtInt, base: d.basePropostas > 0, periodo: d.tot.propostas > 0 }),
    kpiOp(d, m, { rotulo: "Taxa de aprovação", icone: "percent", valor: f.taxaAprovacao, formato: fmtPct, base: d.basePropostas > 0, periodo: d.tot.propostas > 0, nota: "Aprovadas ÷ propostas" }),
    kpiOp(d, m, { rotulo: "Cartões emitidos", icone: "credit_card", valor: d.tot.emitidos_periodo, formato: fmtInt, base: d.baseCartoes > 0, periodo: d.tot.emitidos_periodo + d.tot.ativados_periodo > 0, nota: "Emissões com data no período" }),
    kpiOp(d, m, { rotulo: "Cartões ativados", icone: "verified", valor: d.tot.ativados_periodo, formato: fmtInt, base: d.baseCartoes > 0, periodo: d.tot.emitidos_periodo + d.tot.ativados_periodo > 0, nota: "Ativações com data no período" }),
    kpiOp(d, m, { rotulo: "Taxa de ativação", icone: "trending_up", valor: f.taxaAtivacao, formato: fmtPct, base: d.baseCartoes > 0, nota: notaAtiv }),
    kpiHtml({ rotulo: "Marcas com dados", icone: "storefront", estado: "valor", texto: String(d.marcasComDados.length), nota: d.marcasComDados.join(" · ") || "Nenhuma no período" })
  ];
  const crmKpis = [
    kpiCrm(d, m, { rotulo: "Abordagens realizadas", icone: "campaign", valor: d.crmCons.abordagens, formato: fmtInt, nota: "Contatos, não clientes únicos" }),
    kpiCrm(d, m, { rotulo: "Adesões nas campanhas", icone: "how_to_reg", valor: d.crmCons.adesoes, formato: fmtInt, nota: "Não equivale a ativação de cartão" }),
    kpiCrm(d, m, { rotulo: "Conversão das campanhas", icone: "percent", valor: d.crmCons.conversao, formato: fmtPct, nota: "Σ adesões ÷ Σ abordagens" }),
    kpiCrm(d, m, { rotulo: "Vendas associadas", icone: "payments", valor: d.crmCons.valorAbordados, formato: fmtBRL, nota: "Associadas, sem causalidade" }),
    kpiCrm(d, m, { rotulo: "Ticket médio das adesões", icone: "receipt_long", valor: d.crmCons.ticketAbordados, formato: fmtBRL, nota: "Σ valor ÷ Σ adesões" }),
    kpiCrm(d, m, { rotulo: "Vendas incrementais informadas", icone: "insights", valor: d.crmCons.vendasIncrementais, formato: fmtBRL, nota: "Soma do informado pela CredSystem" }),
    ret ? kpiHtml({ rotulo: "Clientes únicos", icone: "group", estado: "valor", texto: fmtInt(ret.clientes_unicos), nota: "Base transacional pseudonimizada" })
      : kpiHtml({ rotulo: "Clientes únicos", icone: "group", estado: "indisponivel", texto: "", nota: "Requer base transacional com identificador individual", titulo: "A planilha de campanhas é agregada: abordagens não são clientes únicos." }),
    ret ? kpiHtml({ rotulo: "Taxa de recompra", icone: "autorenew", estado: recompra === null ? "nd" : "valor", texto: fmtPct(recompra), nota: "Clientes com 2+ compras ÷ clientes" })
      : kpiHtml({ rotulo: "Taxa de recompra", icone: "autorenew", estado: "indisponivel", texto: "", nota: "Requer histórico transacional" })
  ];

  // evolucao mensal
  const opMensal = agruparPor(m.op?.mensal || [], (r) => String(r.mes).slice(0, 7));
  const crmMensal = agruparPor(m.crm, (r) => mesDe(r.dt_disparo));
  const mesesOp = [...opMensal.keys()].sort();
  const mesesCrm = [...crmMensal.keys()].sort();
  const soma = (rows, c) => rows.reduce((s, r) => s + Number(r[c] || 0), 0);
  const graficoOp = estadoOp(m, d) === "valor" ? graficoLinhas(mesesOp.map(fmtMes), [
    { nome: "Propostas", cor: "#64748b", valores: mesesOp.map((k) => soma(opMensal.get(k), "propostas")) },
    { nome: "Aprovadas", cor: "#16a34a", valores: mesesOp.map((k) => soma(opMensal.get(k), "aprovadas")) },
    { nome: "Cartões emitidos", cor: corUnica(), valores: mesesOp.map((k) => soma(opMensal.get(k), "emitidos_periodo")) }
  ], { formatar: fmtInt }) : estadoSecaoHtml(estadoOp(m, d), AGUARDANDO_OP);
  const graficoCrm = estadoCrm(m, d) === "valor" ? graficoLinhas(mesesCrm.map(fmtMes), [
    { nome: "Abordagens", cor: "#64748b", valores: mesesCrm.map((k) => consolidarCRM(crmMensal.get(k)).abordagens) },
    { nome: "Adesões", cor: corUnica(), valores: mesesCrm.map((k) => consolidarCRM(crmMensal.get(k)).adesoes) }
  ], { formatar: fmtInt }) : estadoSecaoHtml(estadoCrm(m, d), AGUARDANDO_CRM);

  // comparativo entre bandeiras (sempre recalculado por totais da marca)
  const marcasTabela = deps.state.marca === "Todas" ? MARCAS : [deps.state.marca];
  const linhasComp = marcasTabela.map((marca) => {
    const o = (m.op?.por_marca || []).find((r) => r.marca === marca);
    const fo = o ? funilOperacional(somarOperacional([o])) : null;
    const c = consolidarCRM(m.crm.filter((r) => r.marca === marca));
    return { marca, o, fo, c };
  });
  const comp = `<div class="table-wrap"><table class="cs-tabela"><thead><tr><th>Bandeira</th><th>Propostas</th><th>Aprovação</th><th>Emitidos</th><th>Ativação</th><th>Abordagens</th><th>Conversão CRM</th><th>Ticket adesões</th><th>Vendas incr. informadas</th></tr></thead><tbody>
    ${linhasComp.map(({ marca, o, fo, c }) => `<tr><td>${chipMarca(marca)}</td>
      <td>${o ? fmtInt(o.propostas) : "—"}</td><td>${fo ? fmtPct(fo.taxaAprovacao) : "—"}</td><td>${o ? fmtInt(o.emitidos_periodo) : "—"}</td><td>${fo ? fmtPct(fo.taxaAtivacao) : "—"}</td>
      <td>${c.disparos ? fmtInt(c.abordagens) : "—"}</td><td>${c.disparos ? fmtPct(c.conversao) : "—"}</td><td>${c.disparos ? fmtBRL(c.ticketAbordados) : "—"}</td><td>${c.disparos ? fmtBRL(c.vendasIncrementais) : "—"}</td></tr>`).join("")}
    </tbody></table></div><p class="muted">"—" = sem registros dessa fonte para a marca no período. N/D = denominador zero ou não informado.</p>`;

  // evolucao por canal
  const canais = [...agruparPor(m.crm, (r) => r.canal_normalizado || r.ds_canal || "Não informado").entries()];
  const paleta = ["#2563eb", "#16a34a", "#f59e0b", "#db2777", "#7c3aed", "#0891b2", "#64748b"];
  const graficoCanal = canais.length ? graficoLinhas(mesesCrm.map(fmtMes), canais.slice(0, 7).map(([canal, rows], i) => {
    const porMes = agruparPor(rows, (r) => mesDe(r.dt_disparo));
    return { nome: canal, cor: paleta[i % paleta.length], valores: mesesCrm.map((k) => (porMes.has(k) ? consolidarCRM(porMes.get(k)).abordagens : null)) };
  }), { formatar: fmtInt }) : estadoSecaoHtml(estadoCrm(m, d), AGUARDANDO_CRM);

  return `
    <section class="card cs-secao"><div class="cs-secao-topo"><h3>Indicadores operacionais</h3>${fonteHtml("Fonte: propostas e emissões CredSystem")}</div>
      <div class="grid kpis cs-kpis">${opKpis.join("")}</div></section>
    <section class="card cs-secao"><div class="cs-secao-topo"><h3>Indicadores comerciais e de CRM</h3>${fonteHtml("Fonte: planilha de campanhas CRM CredSystem")}</div>
      <div class="grid kpis cs-kpis">${crmKpis.join("")}</div>
      <p class="muted">Valores comerciais são <b>associados às campanhas</b> (sem atribuição causal). A soma entre campanhas não é faturamento deduplicado: um cliente pode aparecer em mais de uma campanha.</p></section>
    <div class="grid cs-duas">
      <section class="card"><h3>Evolução mensal · operação</h3>${graficoOp}</section>
      <section class="card"><h3>Evolução mensal · campanhas CRM</h3>${graficoCrm}</section>
    </div>
    <section class="card"><h3>Comparativo entre bandeiras</h3>${comp}</section>
    <section class="card"><h3>Evolução das abordagens por canal</h3>${graficoCanal}</section>`;
}

// ---- ABA 2: funil -------------------------------------------------------------------------------
function funilHtml(m, d) {
  const est = estadoOp(m, d);
  if (est !== "valor" || d.tot.propostas === 0) {
    return `<section class="card">${estadoSecaoHtml(est === "valor" ? (d.basePropostas ? "sem_registros_periodo" : "sem_dados_importados") : est, AGUARDANDO_OP)}</section>`;
  }
  const f = d.fun;
  const aviso = f.modo === "coorte"
    ? `<div class="alert success"><b>Coorte:</b> as propostas do período são acompanhadas até o cartão (pelo identificador do cartão) e a ativação — todas as taxas usam a mesma população.</div>`
    : `<div class="alert"><b>Taxas de período:</b> não há vínculo proposta↔cartão nos dados; emissões e ativações são contadas pela data do evento no período e <b>não</b> representam a conversão de uma mesma coorte.</div>`;
  const etapas = [
    { rotulo: "Propostas", valor: f.propostas },
    { rotulo: "Aprovadas", valor: f.aprovadas, taxa: { rotulo: "Aprovação", valor: f.taxaAprovacao } },
    { rotulo: "Emitidas", valor: f.emitidas, taxa: { rotulo: "Emissão após aprovação", valor: f.taxaEmissao } },
    { rotulo: "Ativadas", valor: f.ativadas, taxa: { rotulo: "Ativação após emissão", valor: f.taxaAtivacao } }
  ];
  const kpis = [
    kpiHtml({ rotulo: "Taxa de aprovação", icone: "check_circle", estado: f.taxaAprovacao === null ? "nd" : "valor", texto: fmtPct(f.taxaAprovacao), nota: "Aprovadas ÷ propostas" }),
    kpiHtml({ rotulo: "Taxa de rejeição", icone: "cancel", estado: f.taxaRejeicao === null ? "nd" : "valor", texto: fmtPct(f.taxaRejeicao), nota: "Rejeitadas ÷ propostas" }),
    kpiHtml({ rotulo: "Taxa de emissão", icone: "credit_card", estado: f.taxaEmissao === null ? "nd" : "valor", texto: fmtPct(f.taxaEmissao), nota: "Emitidas ÷ aprovadas" }),
    kpiHtml({ rotulo: "Taxa de ativação", icone: "verified", estado: f.taxaAtivacao === null ? "nd" : "valor", texto: fmtPct(f.taxaAtivacao), nota: "Ativadas ÷ emitidas" })
  ];
  const mensal = [...agruparPor(m.op?.mensal || [], (r) => String(r.mes).slice(0, 7)).entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([mes, rows]) => ({ mes, ...funilOperacional(somarOperacional(rows)) }));
  const tabMensal = `<div class="table-wrap"><table class="cs-tabela"><thead><tr><th>Mês</th><th>Propostas</th><th>Aprovadas</th><th>Rejeitadas</th><th>Emitidas</th><th>Ativadas</th><th>Aprovação</th><th>Emissão</th><th>Ativação</th></tr></thead><tbody>
    ${mensal.map((r) => `<tr><td>${esc(fmtMes(r.mes))}</td><td>${fmtInt(r.propostas)}</td><td>${fmtInt(r.aprovadas)}</td><td>${fmtInt(r.rejeitadas)}</td><td>${fmtInt(r.emitidas)}</td><td>${fmtInt(r.ativadas)}</td><td>${fmtPct(r.taxaAprovacao)}</td><td>${fmtPct(r.taxaEmissao)}</td><td>${fmtPct(r.taxaAtivacao)}</td></tr>`).join("")}
  </tbody></table></div>`;
  const porMarca = (m.op?.por_marca || []).map((r) => ({ marca: r.marca, ...funilOperacional(somarOperacional([r])) }));
  const tabMarca = `<div class="table-wrap"><table class="cs-tabela"><thead><tr><th>Bandeira</th><th>Propostas</th><th>Aprovadas</th><th>Emitidas</th><th>Ativadas</th><th>Aprovação</th><th>Rejeição</th><th>Emissão</th><th>Ativação</th></tr></thead><tbody>
    ${porMarca.map((r) => `<tr><td>${chipMarca(r.marca)}</td><td>${fmtInt(r.propostas)}</td><td>${fmtInt(r.aprovadas)}</td><td>${fmtInt(r.emitidas)}</td><td>${fmtInt(r.ativadas)}</td><td>${fmtPct(r.taxaAprovacao)}</td><td>${fmtPct(r.taxaRejeicao)}</td><td>${fmtPct(r.taxaEmissao)}</td><td>${fmtPct(r.taxaAtivacao)}</td></tr>`).join("")}
  </tbody></table></div>`;
  return `${aviso}
    <div class="grid cs-duas">
      <section class="card"><h3>Funil de cartões</h3>${funil(etapas, { formatar: fmtInt, formatarTaxa: fmtPct, cor: corUnica() })}</section>
      <section class="card"><h3>Taxas do funil</h3><div class="grid cs-kpis-2">${kpis.join("")}</div>
        <p class="muted" style="margin-top:12px">Eventos no período (independente da coorte): ${fmtInt(f.emitidosPeriodo)} emissões e ${fmtInt(f.ativadosPeriodo)} ativações · ativação dos emitidos no período: ${fmtPct(f.taxaAtivacaoPeriodo)}.</p></section>
    </div>
    <section class="card"><h3>Evolução mensal do funil</h3>${graficoLinhas(mensal.map((r) => fmtMes(r.mes)), [
      { nome: "Aprovação", cor: "#16a34a", valores: mensal.map((r) => r.taxaAprovacao) },
      { nome: "Emissão", cor: corUnica(), valores: mensal.map((r) => r.taxaEmissao) },
      { nome: "Ativação", cor: "#f59e0b", valores: mensal.map((r) => r.taxaAtivacao) }
    ], { formatar: fmtPct })}${tabMensal}</section>
    <section class="card"><h3>Comparativo entre marcas</h3>${tabMarca}</section>`;
}

// ---- ABA 3: ranking por loja --------------------------------------------------------------------
const COLUNAS_LOJA = [
  { campo: "cd_loja", rotulo: "Código da loja" },
  { campo: "nm_loja", rotulo: "Nome da loja" },
  { campo: "marca", rotulo: "Bandeira" },
  { campo: "propostas", rotulo: "Propostas", num: true },
  { campo: "aprovadas", rotulo: "Aprovadas", num: true },
  { campo: "rejeitadas", rotulo: "Rejeitadas", num: true },
  { campo: "emitidas", rotulo: "Cartões emitidos", num: true },
  { campo: "ativadas", rotulo: "Cartões ativados", num: true },
  { campo: "taxa_aprovacao", rotulo: "Taxa de aprovação (%)", num: true, pct: true },
  { campo: "taxa_ativacao", rotulo: "Taxa de ativação (%)", num: true, pct: true }
];

function linhasLoja(m) {
  return (m.op?.lojas || []).map((l) => ({
    ...l,
    propostas: Number(l.propostas), aprovadas: Number(l.aprovadas), rejeitadas: Number(l.rejeitadas), emitidas: Number(l.emitidas), ativadas: Number(l.ativadas),
    taxa_aprovacao: taxa(l.aprovadas, l.propostas), taxa_ativacao: taxa(l.ativadas, l.emitidas)
  }));
}

function lojasFiltradas(m) {
  const busca = ui.lojaBusca.trim().toLowerCase();
  const { campo, dir } = ui.lojaOrdem;
  return linhasLoja(m)
    .filter((l) => !busca || `${l.cd_loja} ${l.nm_loja}`.toLowerCase().includes(busca))
    .sort((a, b) => {
      const va = a[campo], vb = b[campo];
      if (va === null && vb === null) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      const r = typeof va === "number" ? va - vb : String(va).localeCompare(String(vb), "pt-BR");
      return dir === "asc" ? r : -r;
    });
}

function corpoLojasHtml(m) {
  const rows = lojasFiltradas(m);
  if (!rows.length) return `<tr><td colspan="${COLUNAS_LOJA.length}">Nenhuma loja encontrada.</td></tr>`;
  return rows.map((l) => `<tr><td>${esc(l.cd_loja)}</td><td>${esc(l.nm_loja)}</td><td>${chipMarca(l.marca)}</td><td>${fmtInt(l.propostas)}</td><td>${fmtInt(l.aprovadas)}</td><td>${fmtInt(l.rejeitadas)}</td><td>${fmtInt(l.emitidas)}</td><td>${fmtInt(l.ativadas)}</td><td>${fmtPct(l.taxa_aprovacao)}</td><td>${fmtPct(l.taxa_ativacao)}</td></tr>`).join("");
}

function lojasHtml(m, d) {
  const est = estadoOp(m, d);
  if (est !== "valor" || !(m.op?.lojas || []).length) return `<section class="card">${estadoSecaoHtml(est === "valor" ? "sem_registros_periodo" : est, AGUARDANDO_OP)}</section>`;
  const { campo, dir } = ui.lojaOrdem;
  return `<section class="card">
    <div class="cs-secao-topo"><h3>Ranking por loja</h3>
      <div class="cs-acoes"><input type="search" id="csLojaBusca" placeholder="Pesquisar loja ou código" value="${esc(ui.lojaBusca)}" aria-label="Pesquisar loja">
      <button type="button" class="secondary" data-cs-export="lojas-csv">CSV</button><button type="button" class="secondary" data-cs-export="lojas-xlsx">Excel</button></div></div>
    <p class="muted">Lojas como vêm nos arquivos da CredSystem (sem nomes ou códigos criados). Emitidos/ativados por loja seguem a coorte das propostas da loja. Clique no cabeçalho para ordenar.</p>
    <div class="table-wrap"><table class="cs-tabela cs-ordenavel"><thead><tr>${COLUNAS_LOJA.map((c) => `<th data-cs-ordem="${c.campo}" class="${c.campo === campo ? `ativo ${dir}` : ""}">${esc(c.rotulo.replace(" (%)", ""))}</th>`).join("")}</tr></thead>
    <tbody id="csLojasCorpo">${corpoLojasHtml(m)}</tbody></table></div></section>`;
}

// ---- ABA 4: motivos -----------------------------------------------------------------------------
function motivosHtml(m, d) {
  const est = estadoOp(m, d);
  const motivos = m.op?.motivos || [];
  if (est !== "valor") return `<section class="card">${estadoSecaoHtml(est, AGUARDANDO_OP)}</section>`;
  if (!motivos.length) {
    return `<section class="card">${d.tot.propostas
      ? estadoSecaoHtml("sem_dados_importados", "As propostas deste período não trazem motivos. O módulo está pronto para exibi-los assim que vierem na base importada.")
      : estadoSecaoHtml("sem_registros_periodo", AGUARDANDO_OP)}</section>`;
  }
  const agg = [...agruparPor(motivos, (r) => r.motivo).entries()].map(([motivo, rows]) => {
    const total = rows.reduce((s, r) => s + Number(r.total), 0);
    const aprovadas = rows.reduce((s, r) => s + Number(r.aprovadas), 0);
    const rejeitadas = rows.reduce((s, r) => s + Number(r.rejeitadas), 0);
    return { motivo, total, aprovadas, rejeitadas, porMarca: Object.fromEntries(rows.map((r) => [r.marca, Number(r.total)])) };
  }).sort((a, b) => b.total - a.total);
  const totalGeral = agg.reduce((s, r) => s + r.total, 0);
  const marcasPresentes = MARCAS.filter((mm) => motivos.some((r) => r.marca === mm));
  const tabela = `<div class="table-wrap"><table class="cs-tabela"><thead><tr><th>Motivo</th><th>Quantidade</th><th>Participação</th><th>Aprovadas</th><th>Rejeitadas</th><th>Taxa de aprovação</th>${marcasPresentes.length > 1 ? marcasPresentes.map((mm) => `<th>${esc(mm)}</th>`).join("") : ""}</tr></thead><tbody>
    ${agg.map((r) => `<tr><td>${esc(r.motivo)}</td><td>${fmtInt(r.total)}</td><td>${fmtPct(taxa(r.total, totalGeral))}</td><td>${fmtInt(r.aprovadas)}</td><td>${fmtInt(r.rejeitadas)}</td><td>${fmtPct(taxa(r.aprovadas, r.total))}</td>${marcasPresentes.length > 1 ? marcasPresentes.map((mm) => `<td>${fmtInt(r.porMarca[mm] || 0)}</td>`).join("") : ""}</tr>`).join("")}
  </tbody></table></div>`;
  const mm = m.op?.motivos_mensal || [];
  const meses = [...new Set(mm.map((r) => String(r.mes).slice(0, 7)))].sort();
  const top = agg.slice(0, 6).map((r) => r.motivo);
  const paleta = ["#2563eb", "#dc2626", "#f59e0b", "#16a34a", "#7c3aed", "#0891b2"];
  const evol = graficoLinhas(meses.map(fmtMes), top.map((motivo, i) => ({
    nome: motivo, cor: paleta[i], valores: meses.map((k) => mm.filter((r) => r.motivo === motivo && String(r.mes).slice(0, 7) === k).reduce((s, r) => s + Number(r.total), 0))
  })), { formatar: fmtInt });
  return `<div class="grid cs-duas">
      <section class="card"><h3>Propostas por motivo</h3>${barrasHorizontais(agg.map((r) => ({ rotulo: r.motivo, valor: r.total, cor: corUnica(), detalhe: fmtPct(taxa(r.total, totalGeral)) })), { formatar: fmtInt })}</section>
      <section class="card"><h3>Rejeições por motivo</h3>${barrasHorizontais(agg.filter((r) => r.rejeitadas > 0).sort((a, b) => b.rejeitadas - a.rejeitadas).map((r) => ({ rotulo: r.motivo, valor: r.rejeitadas, cor: "#dc2626" })), { formatar: fmtInt, vazio: "Nenhuma rejeição com motivo no período." })}</section>
    </div>
    <section class="card"><h3>Detalhamento por motivo</h3>${tabela}</section>
    <section class="card"><h3>Evolução mensal dos principais motivos</h3>${evol}</section>`;
}

// ---- ABA 5: CRM ---------------------------------------------------------------------------------
const COLUNAS_CRM_EXPORT = [
  { campo: "marca", rotulo: "Bandeira" }, { campo: "dt_disparo", rotulo: "Data de disparo" }, { campo: "ds_campanha", rotulo: "Campanha" },
  { campo: "canal_normalizado", rotulo: "Canal" }, { campo: "ds_step", rotulo: "Etapa" }, { campo: "cluster_normalizado", rotulo: "Tipo de campanha" },
  { campo: "qt_abordado", rotulo: "Abordagens" }, { campo: "qt_adesao_abordado", rotulo: "Adesões abordados" },
  { rotulo: "Conversão abordados (%)", valor: (l) => taxa(l.qt_adesao_abordado, l.qt_abordado) },
  { campo: "vl_gasto_abordado", rotulo: "Valor gasto abordados" }, { rotulo: "Ticket abordados", valor: (l) => (l.qt_adesao_abordado ? l.vl_gasto_abordado / l.qt_adesao_abordado : null) },
  { campo: "qt_controle", rotulo: "Grupo de controle" }, { campo: "qt_adesao_controle", rotulo: "Adesões controle" },
  { rotulo: "Conversão controle (%)", valor: (l) => taxa(l.qt_adesao_controle, l.qt_controle) },
  { campo: "vl_gasto_controle", rotulo: "Valor gasto controle" }, { campo: "vl_vendas_incrementais", rotulo: "Vendas incrementais informadas" }
];

function crmHtml(m, d) {
  const est = estadoCrm(m, d);
  if (est !== "valor") return `<section class="card">${estadoSecaoHtml(est, AGUARDANDO_CRM)}</section>`;
  const c = d.crmCons;
  const kpis = [
    kpiHtml({ rotulo: "Campanhas realizadas", icone: "campaign", estado: "valor", texto: fmtInt(c.campanhas), nota: `${fmtInt(c.disparos)} disparos/etapas` }),
    kpiHtml({ rotulo: "Abordagens", icone: "send", estado: "valor", texto: fmtInt(c.abordagens) }),
    kpiHtml({ rotulo: "Adesões entre abordados", icone: "how_to_reg", estado: c.adesoes === null ? "nd" : "valor", texto: fmtInt(c.adesoes) }),
    kpiHtml({ rotulo: "Conversão dos abordados", icone: "percent", estado: c.conversao === null ? "nd" : "valor", texto: fmtPct(c.conversao), nota: "Σ adesões ÷ Σ abordagens" }),
    kpiHtml({ rotulo: "Valor gasto pelos abordados", icone: "payments", estado: c.valorAbordados === null ? "nd" : "valor", texto: fmtBRL(c.valorAbordados) }),
    kpiHtml({ rotulo: "Ticket médio", icone: "receipt_long", estado: c.ticketAbordados === null ? "nd" : "valor", texto: fmtBRL(c.ticketAbordados), nota: "Σ valor ÷ Σ adesões" }),
    kpiHtml({ rotulo: "Conversão do controle", icone: "science", estado: c.conversaoControle === null ? "nd" : "valor", texto: fmtPct(c.conversaoControle), nota: `Diferença: ${fmtPp(c.liftPp)}` }),
    kpiHtml({ rotulo: "Vendas incrementais informadas", icone: "insights", estado: c.vendasIncrementais === null ? "nd" : "valor", texto: fmtBRL(c.vendasIncrementais), nota: "Metodologia CredSystem" })
  ];
  const porMes = agruparPor(m.crm, (r) => mesDe(r.dt_disparo));
  const meses = [...porMes.keys()].sort();
  const marcasCrm = MARCAS.filter((mm) => m.crm.some((r) => r.marca === mm));
  const evolucao = graficoLinhas(meses.map(fmtMes), (deps.state.marca === "Todas" ? marcasCrm : [deps.state.marca]).map((marca) => {
    const pm = agruparPor(m.crm.filter((r) => r.marca === marca), (r) => mesDe(r.dt_disparo));
    return { nome: marca, cor: corMarca(marca), valores: meses.map((k) => (pm.has(k) ? consolidarCRM(pm.get(k)).abordagens : null)) };
  }), { formatar: fmtInt });
  const porCanal = [...agruparPor(m.crm, (r) => r.canal_normalizado || r.ds_canal || "Não informado").entries()].map(([k, rows]) => ({ k, c: consolidarCRM(rows) }));
  const porCategoria = [...agruparPor(m.crm, (r) => r.cluster_normalizado || r.ds_cluster_campanha || "Não informado").entries()].map(([k, rows]) => ({ k, c: consolidarCRM(rows) })).sort((a, b) => (b.c.abordagens || 0) - (a.c.abordagens || 0));
  const porMarca = marcasCrm.map((marca) => ({ marca, c: consolidarCRM(m.crm.filter((r) => r.marca === marca)) }));
  const porCampanha = [...agruparPor(m.crm, (r) => `${r.marca}|${r.ds_campanha}`).entries()].map(([k, rows]) => ({ marca: k.split("|")[0], campanha: k.split("|").slice(1).join("|"), c: consolidarCRM(rows) }));
  const tabCategoria = `<div class="table-wrap"><table class="cs-tabela"><thead><tr><th>Tipo de campanha</th><th>Disparos</th><th>Abordagens</th><th>Adesões</th><th>Conversão</th><th>Conversão controle</th><th>Diferença</th><th>Ticket</th><th>Vendas incr. informadas</th></tr></thead><tbody>
    ${porCategoria.map(({ k, c: x }) => `<tr><td>${esc(k)}</td><td>${fmtInt(x.disparos)}</td><td>${fmtInt(x.abordagens)}</td><td>${fmtInt(x.adesoes)}</td><td>${fmtPct(x.conversao)}</td><td>${fmtPct(x.conversaoControle)}</td><td>${fmtPp(x.liftPp)}</td><td>${fmtBRL(x.ticketAbordados)}</td><td>${fmtBRL(x.vendasIncrementais)}</td></tr>`).join("")}
  </tbody></table></div>`;
  const tabCampanhas = `<div class="table-wrap cs-tabela-alta"><table class="cs-tabela"><thead><tr><th>Bandeira</th><th>Data</th><th>Campanha</th><th>Canal</th><th>Etapa</th><th>Tipo</th><th>Abordagens</th><th>Adesões</th><th>Conversão</th><th>Valor gasto</th><th>Ticket</th><th>Controle</th><th>Adesões ctrl.</th><th>Conv. ctrl.</th><th>Valor ctrl.</th><th>Vendas incr.</th></tr></thead><tbody>
    ${[...m.crm].reverse().slice(0, 300).map((l) => `<tr><td>${chipMarca(l.marca)}</td><td>${esc(fmtData(l.dt_disparo))}</td><td>${esc(l.ds_campanha)}</td><td>${esc(l.canal_normalizado || l.ds_canal || "—")}</td><td>${esc(l.ds_step || "—")}</td><td>${esc(l.cluster_normalizado || "—")}</td>
      <td>${fmtInt(l.qt_abordado)}</td><td>${fmtInt(l.qt_adesao_abordado)}</td><td>${fmtPct(taxa(l.qt_adesao_abordado, l.qt_abordado))}</td><td>${fmtBRL(l.vl_gasto_abordado)}</td><td>${fmtBRL(l.qt_adesao_abordado ? l.vl_gasto_abordado / l.qt_adesao_abordado : null)}</td>
      <td>${fmtInt(l.qt_controle)}</td><td>${fmtInt(l.qt_adesao_controle)}</td><td>${fmtPct(taxa(l.qt_adesao_controle, l.qt_controle))}</td><td>${fmtBRL(l.vl_gasto_controle)}</td><td>${fmtBRL(l.vl_vendas_incrementais)}</td></tr>`).join("")}
  </tbody></table></div>${m.crm.length > 300 ? `<p class="muted">Mostrando os 300 disparos mais recentes de ${fmtInt(m.crm.length)}. A exportação traz todos.</p>` : ""}`;
  return `<div class="alert">Valores <b>associados às campanhas</b>, sem atribuição causal automática. Taxas e tickets consolidados usam somas ponderadas. Adesões repetidas entre campanhas não equivalem a clientes únicos.</div>
    <section class="card"><div class="grid kpis cs-kpis">${kpis.join("")}</div></section>
    <div class="grid cs-duas">
      <section class="card"><h3>Evolução mensal das abordagens</h3>${evolucao}</section>
      <section class="card"><h3>Valor gasto pelos abordados por mês</h3>${barrasAgrupadas(meses.map(fmtMes), [{ nome: "Valor gasto", cor: corUnica(), valores: meses.map((k) => consolidarCRM(porMes.get(k)).valorAbordados) }], { formatar: (v) => fmtBRL(v).replace(",00", "") })}</section>
      <section class="card"><h3>Conversão por canal</h3>${barrasHorizontais(porCanal.sort((a, b) => (b.c.conversao ?? -1) - (a.c.conversao ?? -1)).map(({ k, c: x }) => ({ rotulo: k, valor: x.conversao, cor: corUnica(), detalhe: `${fmtInt(x.abordagens)} abordagens` })), { formatar: fmtPct })}</section>
      <section class="card"><h3>Ticket médio por marca</h3>${barrasHorizontais(porMarca.map(({ marca, c: x }) => ({ rotulo: marca, valor: x.ticketAbordados, cor: corMarca(marca), detalhe: `${fmtInt(x.adesoes)} adesões` })), { formatar: fmtBRL })}</section>
      <section class="card"><h3>Abordados × controle por tipo de campanha</h3>${barrasAgrupadas(porCategoria.map((x) => x.k), [
        { nome: "Conversão abordados", cor: corUnica(), valores: porCategoria.map((x) => x.c.conversao) },
        { nome: "Conversão controle", cor: "#94a3b8", valores: porCategoria.map((x) => x.c.conversaoControle) }
      ], { formatar: fmtPct })}</section>
      <section class="card"><h3>Vendas incrementais informadas por campanha</h3>${barrasHorizontais(porCampanha.filter((x) => x.c.vendasIncrementais !== null).sort((a, b) => b.c.vendasIncrementais - a.c.vendasIncrementais).map((x) => ({ rotulo: x.campanha, valor: x.c.vendasIncrementais, cor: corMarca(x.marca), detalhe: x.marca })), { formatar: fmtBRL, vazio: "A planilha não informa vendas incrementais no período." })}</section>
    </div>
    <section class="card"><h3>Desempenho por tipo de campanha (ativação, reativação, aniversário e demais)</h3>${tabCategoria}</section>
    <section class="card"><div class="cs-secao-topo"><h3>Campanhas detalhadas</h3><div class="cs-acoes"><button type="button" class="secondary" data-cs-export="crm-csv">CSV</button><button type="button" class="secondary" data-cs-export="crm-xlsx">Excel</button></div></div>${tabCampanhas}</section>`;
}

// ---- ABA 6: retencao ----------------------------------------------------------------------------
function retencaoHtml(m) {
  const r = m.ret;
  if (m.retErro) return `<section class="card">${estadoSecaoHtml(estadoIndicador({ erro: m.retErro }), "")}</section>`;
  if (!r?.tem_dados) {
    return `<section class="card"><div class="cs-vazio"><span class="material-symbols-outlined">hourglass_empty</span>
      <p><b>Aguardando importação de dados transacionais (Tipo C).</b></p>
      <p class="muted">A planilha de campanhas é agregada por disparo e não identifica clientes individualmente, por isso não permite calcular retenção. Ao importar compras com identificador de cliente (pseudonimizado), esta aba passa a mostrar:</p>
      <ul class="cs-lista">${["Clientes novos e recorrentes", "Tempo médio entre compras", "Frequência de compra", "Ticket médio por cliente", "Recência da última compra", "Clientes inativos e reativados (90 dias)", "Segmentação RFM", "Retenção por coorte de primeira compra", "Evolução do valor gasto por cliente"].map((t) => `<li>${esc(t)}</li>`).join("")}</ul></div></section>`;
  }
  const kpis = [
    ["Clientes únicos", "group", fmtInt(r.clientes_unicos)], ["Clientes novos", "person_add", fmtInt(r.clientes_novos)],
    ["Clientes recorrentes", "autorenew", fmtInt(r.clientes_recorrentes)], ["Taxa de recompra", "percent", fmtPct(taxa(r.clientes_recorrentes, r.clientes_unicos))],
    ["Tempo médio entre compras", "schedule", r.dias_medios_entre_compras === null ? "N/D" : `${String(r.dias_medios_entre_compras).replace(".", ",")} dias`],
    ["Frequência média", "repeat", r.frequencia_media === null ? "N/D" : `${String(r.frequencia_media).replace(".", ",")} compras`],
    ["Valor médio por cliente", "payments", fmtBRL(r.valor_medio_por_cliente)], ["Recência média", "history", r.recencia_media_dias === null ? "N/D" : `${String(r.recencia_media_dias).replace(".", ",")} dias`],
    ["Clientes inativos (>90 dias)", "bedtime", fmtInt(r.clientes_inativos)], ["Clientes reativados", "restart_alt", fmtInt(r.clientes_reativados)]
  ].map(([rotulo, icone, texto]) => kpiHtml({ rotulo, icone, estado: texto === "N/D" ? "nd" : "valor", texto }));
  const coortes = agruparPor(r.coortes || [], (c) => String(c.coorte).slice(0, 7));
  const maxRel = Math.max(0, ...(r.coortes || []).map((c) => c.mes_relativo));
  const tabCoorte = `<div class="table-wrap"><table class="cs-tabela"><thead><tr><th>Coorte (1ª compra)</th>${Array.from({ length: Math.min(maxRel, 11) + 1 }, (_, i) => `<th>M+${i}</th>`).join("")}</tr></thead><tbody>
    ${[...coortes.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, rows]) => {
      const base = rows.find((x) => x.mes_relativo === 0)?.clientes || 0;
      return `<tr><td>${esc(fmtMes(k))} (${fmtInt(base)})</td>${Array.from({ length: Math.min(maxRel, 11) + 1 }, (_, i) => { const v = rows.find((x) => x.mes_relativo === i)?.clientes; return `<td>${v === undefined ? "—" : fmtPct(taxa(v, base))}</td>`; }).join("")}</tr>`;
    }).join("")}</tbody></table></div>`;
  const vm = r.valor_mensal || [];
  return `<section class="card"><div class="grid kpis cs-kpis">${kpis.join("")}</div>
      <p class="muted">Tempo até a primeira compra após a emissão do cartão requer vínculo cartão↔compra nos dados transacionais (campo de cartão) e será exibido quando disponível.</p></section>
    <div class="grid cs-duas">
      <section class="card"><h3>Segmentação RFM</h3>${barrasHorizontais((r.rfm || []).map((x) => ({ rotulo: x.segmento, valor: x.clientes, cor: corUnica() })), { formatar: fmtInt })}</section>
      <section class="card"><h3>Valor gasto por cliente (mensal)</h3>${graficoLinhas(vm.map((x) => fmtMes(String(x.mes).slice(0, 7))), [{ nome: "Valor por cliente", cor: corUnica(), valores: vm.map((x) => (x.clientes ? Number(x.valor) / x.clientes : null)) }], { formatar: fmtBRL })}</section>
    </div>
    <section class="card"><h3>Retenção por coorte</h3>${tabCoorte}</section>`;
}

// ---- pintura e eventos --------------------------------------------------------------------------
function pintar(m) {
  ui.ultimoModelo = m;
  const d = derivar(m);
  const corpo = { visao: visaoHtml, funil: funilHtml, lojas: lojasHtml, motivos: motivosHtml, crm: crmHtml, retencao: retencaoHtml }[ui.aba](m, d);
  document.querySelector("#content").innerHTML = `${cabecalhoHtml(m)}${abasHtml()}<div class="cs-corpo">${corpo}</div>`;
  ligarFiltros();
  ligarCorpo(m);
}

function definirPeriodoCustom(de, ate) {
  Object.assign(deps.state, { periodo: "custom", periodoDe: de, periodoAte: ate, periodoMenuOpen: false });
  renderCredsystem();
}

function ligarFiltros() {
  deps.wireMarcaPills(() => renderCredsystem());
  deps.wirePeriodoDropdown(() => renderCredsystem());
  const ano = document.querySelector("#csAno");
  const mes = document.querySelector("#csMes");
  if (ano) ano.onchange = () => {
    if (!ano.value) { Object.assign(deps.state, { periodo: "all", periodoDe: "", periodoAte: "" }); renderCredsystem(); return; }
    definirPeriodoCustom(`${ano.value}-01-01`, `${ano.value}-12-31`);
  };
  if (mes) mes.onchange = () => {
    const a = ano?.value;
    if (!a) return;
    if (!mes.value) { definirPeriodoCustom(`${a}-01-01`, `${a}-12-31`); return; }
    const ultimo = new Date(Date.UTC(Number(a), Number(mes.value), 0)).getUTCDate();
    definirPeriodoCustom(`${a}-${mes.value}-01`, `${a}-${mes.value}-${String(ultimo).padStart(2, "0")}`);
  };
  const tudo = document.querySelector("#csTudo");
  if (tudo) tudo.onclick = () => { Object.assign(deps.state, { periodo: "all", periodoDe: "", periodoAte: "", periodoMenuOpen: false }); renderCredsystem(); };
  const atualizar = document.querySelector("#csAtualizar");
  if (atualizar) atualizar.onclick = () => renderCredsystem({ force: true });
  const importar = document.querySelector("#csIrImportar");
  if (importar) importar.onclick = () => deps.irParaImportacao();
}

function ligarCorpo(m) {
  document.querySelectorAll("[data-cs-aba]").forEach((b) => {
    b.onclick = () => { ui.aba = b.dataset.csAba; pintar(ui.ultimoModelo); };
  });
  const busca = document.querySelector("#csLojaBusca");
  if (busca) busca.oninput = () => { ui.lojaBusca = busca.value; document.querySelector("#csLojasCorpo").innerHTML = corpoLojasHtml(m); };
  document.querySelectorAll("[data-cs-ordem]").forEach((th) => {
    th.onclick = () => {
      const campo = th.dataset.csOrdem;
      ui.lojaOrdem = { campo, dir: ui.lojaOrdem.campo === campo && ui.lojaOrdem.dir === "desc" ? "asc" : "desc" };
      pintar(ui.ultimoModelo);
    };
  });
  document.querySelectorAll("[data-cs-export]").forEach((b) => {
    b.onclick = async () => {
      const [qual, formato] = b.dataset.csExport.split("-");
      const sufixo = `${deps.state.marca === "Todas" ? "todas" : deps.state.marca.split(" ")[0].toLowerCase()}_${new Date().toISOString().slice(0, 10)}`;
      const colunas = qual === "lojas" ? COLUNAS_LOJA : COLUNAS_CRM_EXPORT;
      const linhas = qual === "lojas" ? lojasFiltradas(m) : m.crm;
      const nome = `credsystem_${qual}_${sufixo}`;
      try {
        if (formato === "csv") baixarArquivo(`${nome}.csv`, gerarCsv(colunas, linhas), "text/csv;charset=utf-8");
        else await exportarExcel(`${nome}.xlsx`, colunas, linhas, deps.carregarXLSX);
      } catch (error) {
        alert(deps.safeErrorMessage(error, "Não foi possível exportar."));
      }
    };
  });
}
