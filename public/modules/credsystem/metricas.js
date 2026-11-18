// Calculos de indicadores. Regras:
//   - taxa/ticket = soma(numerador) / soma(denominador), considerando so as linhas em que AMBOS
//     foram informados (linha sem adesao informada nao entra no denominador da conversao).
//   - nunca media simples de percentuais/tickets, nunca soma de percentuais.
//   - denominador zero/ausente => null (a UI mostra "N/D"), nunca 0 artificial.
//   - soma de campo totalmente ausente => null (nao "0").

export function taxa(numerador, denominador) {
  if (numerador === null || numerador === undefined || denominador === null || denominador === undefined) return null;
  const n = Number(numerador), d = Number(denominador);
  if (!Number.isFinite(n) || !Number.isFinite(d) || d <= 0) return null;
  return (n / d) * 100;
}

export function razao(numerador, denominador) {
  const t = taxa(numerador, denominador);
  return t === null ? null : t / 100;
}

export function somaInformada(linhas, campo) {
  let soma = 0, informadas = 0;
  for (const l of linhas) {
    const v = l[campo];
    if (v === null || v === undefined || v === "") continue;
    const n = Number(v);
    if (!Number.isFinite(n)) continue;
    soma += n; informadas++;
  }
  return informadas ? soma : null;
}

// Par numerador/denominador somado so nas linhas com os dois valores.
export function somaPareada(linhas, campoNum, campoDen) {
  let num = 0, den = 0, n = 0;
  for (const l of linhas) {
    const a = l[campoNum], b = l[campoDen];
    if (a === null || a === undefined || a === "" || b === null || b === undefined || b === "") continue;
    const x = Number(a), y = Number(b);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    num += x; den += y; n++;
  }
  return n ? { num, den, linhas: n } : { num: null, den: null, linhas: 0 };
}

// Consolidado CRM de um conjunto de linhas de credsystem_campanhas_crm.
export function consolidarCRM(linhas) {
  const conv = somaPareada(linhas, "qt_adesao_abordado", "qt_abordado");
  const tick = somaPareada(linhas, "vl_gasto_abordado", "qt_adesao_abordado");
  const convC = somaPareada(linhas, "qt_adesao_controle", "qt_controle");
  const tickC = somaPareada(linhas, "vl_gasto_controle", "qt_adesao_controle");
  const conversao = taxa(conv.num, conv.den);
  const conversaoControle = taxa(convC.num, convC.den);
  return {
    disparos: linhas.length,
    campanhas: new Set(linhas.map((l) => `${l.marca}|${(l.ds_campanha || "").trim().toLowerCase()}`)).size,
    abordagens: somaInformada(linhas, "qt_abordado"),
    adesoes: somaInformada(linhas, "qt_adesao_abordado"),
    conversao,
    valorAbordados: somaInformada(linhas, "vl_gasto_abordado"),
    ticketAbordados: tick.den ? tick.num / tick.den : null,
    controle: somaInformada(linhas, "qt_controle"),
    adesoesControle: somaInformada(linhas, "qt_adesao_controle"),
    conversaoControle,
    valorControle: somaInformada(linhas, "vl_gasto_controle"),
    ticketControle: tickC.den ? tickC.num / tickC.den : null,
    vendasIncrementais: somaInformada(linhas, "vl_vendas_incrementais"),
    // diferenca em pontos percentuais entre abordados e controle (so quando ambos existem)
    liftPp: conversao !== null && conversaoControle !== null ? conversao - conversaoControle : null,
    coberturaConversao: conv.linhas,
    coberturaControle: convC.linhas
  };
}

export function agruparPor(linhas, chaveFn) {
  const mapa = new Map();
  for (const l of linhas) {
    const k = chaveFn(l);
    if (!mapa.has(k)) mapa.set(k, []);
    mapa.get(k).push(l);
  }
  return mapa;
}

export function mesDe(data) {
  return data ? String(data).slice(0, 7) : null;
}

// ---- operacional (saida de rpc_credsystem_operacional_resumo) ------------------------------------
const CAMPOS_OP = ["propostas", "aprovadas", "rejeitadas", "propostas_com_vinculo", "emitidas_coorte", "ativadas_coorte", "emitidos_periodo", "ativados_periodo", "ativados_dos_emitidos_periodo"];

export function somarOperacional(linhas) {
  const t = Object.fromEntries(CAMPOS_OP.map((c) => [c, 0]));
  for (const l of linhas) for (const c of CAMPOS_OP) t[c] += Number(l[c] || 0);
  return t;
}

// Funil: usa coorte (proposta -> cartao -> ativacao, mesma populacao) quando ha vinculo
// proposta-cartao; senao cai para taxas de periodo (eventos no periodo) e sinaliza.
export function funilOperacional(t) {
  const coorte = t.propostas_com_vinculo > 0;
  return {
    modo: coorte ? "coorte" : "periodo",
    propostas: t.propostas,
    aprovadas: t.aprovadas,
    rejeitadas: t.rejeitadas,
    emitidas: coorte ? t.emitidas_coorte : t.emitidos_periodo,
    ativadas: coorte ? t.ativadas_coorte : t.ativados_periodo,
    taxaAprovacao: taxa(t.aprovadas, t.propostas),
    taxaRejeicao: taxa(t.rejeitadas, t.propostas),
    taxaEmissao: coorte ? taxa(t.emitidas_coorte, t.aprovadas) : taxa(t.emitidos_periodo, t.aprovadas),
    taxaAtivacao: coorte ? taxa(t.ativadas_coorte, t.emitidas_coorte) : taxa(t.ativados_dos_emitidos_periodo, t.emitidos_periodo),
    // eventos de periodo (sempre disponiveis quando ha cartoes)
    emitidosPeriodo: t.emitidos_periodo,
    ativadosPeriodo: t.ativados_periodo,
    taxaAtivacaoPeriodo: taxa(t.ativados_dos_emitidos_periodo, t.emitidos_periodo)
  };
}

// ---- estados de indicador -----------------------------------------------------------------------
// sem_permissao | erro | sem_dados_importados | sem_registros_periodo | nd | valor
export function estadoIndicador({ erro = null, temBase, temPeriodo, valor }) {
  if (erro) return /permiss|42501|jwt|aal/i.test(String(erro.code || erro.message || erro)) ? "sem_permissao" : "erro";
  if (!temBase) return "sem_dados_importados";
  if (!temPeriodo) return "sem_registros_periodo";
  if (valor === null || valor === undefined || Number.isNaN(valor)) return "nd";
  return "valor";
}

export const MENSAGENS_ESTADO = {
  sem_permissao: "Sem permissão",
  erro: "Erro ao carregar",
  sem_dados_importados: "Sem dados importados",
  sem_registros_periodo: "Sem registros no período",
  nd: "N/D",
  indisponivel: "Fonte indisponível"
};

// ---- formatacao pt-BR ---------------------------------------------------------------------------
const nf0 = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export const fmtInt = (v) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? "N/D" : nf0.format(Number(v)));
export const fmtPct = (v) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? "N/D" : `${nf1.format(Number(v))}%`);
export const fmtPp = (v) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? "N/D" : `${v > 0 ? "+" : ""}${nf1.format(Number(v))} p.p.`);
export const fmtBRL = (v) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? "N/D" : brl.format(Number(v)));

export function fmtData(iso) {
  if (!iso) return "—";
  const s = String(iso);
  const [a, m, d] = s.slice(0, 10).split("-");
  return d ? `${d}/${m}/${a}` : s;
}

export function fmtMes(chave) {
  if (!chave) return "—";
  const [a, m] = String(chave).split("-");
  const nomes = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  return `${nomes[Number(m) - 1] || m}/${String(a).slice(2)}`;
}
