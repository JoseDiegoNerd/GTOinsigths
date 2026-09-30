import { formatBRL, formatInt, formatPct, formatVariacao } from "./calculos.js";

// maiorEMelhor: para CPE a queda e o resultado favoravel (custo menor por interacao).
export const KPI_DEFINICOES = [
  { chave: "investimento", rotulo: "INVESTIMENTO TOTAL", icone: "payments", cor: "azul", formatar: formatBRL, maiorEMelhor: true },
  { chave: "alcance", rotulo: "ALCANCE TOTAL GERADO", icone: "groups", cor: "roxo", formatar: formatInt, maiorEMelhor: true },
  { chave: "engajamento", rotulo: "ENGAJAMENTO MÉDIO", icone: "favorite", cor: "ambar", formatar: (v) => formatPct(v, 2), maiorEMelhor: true },
  { chave: "cpe", rotulo: "CUSTO POR ENGAJAMENTO (CPE)", icone: "trending_down", cor: "verde", formatar: formatBRL, maiorEMelhor: false }
];

function deltaHtml(variacao, maiorEMelhor) {
  if (variacao === null || variacao === undefined) return `<span class="inf-delta neutro">—</span>`;
  const classe = variacao === 0 ? "neutro" : (variacao > 0) === maiorEMelhor ? "favoravel" : "desfavoravel";
  const seta = variacao > 0 ? "▲ " : variacao < 0 ? "▼ " : "";
  return `<span class="inf-delta ${classe}">${seta}${formatVariacao(variacao)}</span>`;
}

export function kpiCardsHtml(kpis) {
  return `<div class="inf-kpis">${KPI_DEFINICOES.map((d) => {
    const k = kpis[d.chave];
    return `<article class="inf-kpi">
      <div class="inf-kpi-topo"><span class="inf-kpi-rotulo">${d.rotulo}</span><span class="inf-kpi-icone ${d.cor}"><span class="material-symbols-outlined">${d.icone}</span></span></div>
      <div class="inf-kpi-valor">${d.formatar(k.atual)}</div>
      <div class="inf-kpi-rodape">${deltaHtml(k.variacao, d.maiorEMelhor)}<span class="inf-kpi-anterior">Mês anterior: <strong>${d.formatar(k.anterior)}</strong></span></div>
      <div class="inf-kpi-barra ${d.cor}"></div>
    </article>`;
  }).join("")}</div>`;
}
