import { formatVariacao } from "./calculos.js";

const LARGURA = 320;
const DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const arredondar = (n) => Math.round(n * 10) / 10;

export function rotuloDiaSemana(dataISO) {
  const [ano, mes, dia] = dataISO.split("-").map(Number);
  return DIAS[new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay()];
}

// Mapeia seguidores para coordenadas do SVG (viewBox 0 0 320 100): minimo em yMax, maximo em yMin.
export function calcularPontosSvg(pontos, largura = LARGURA, yMin = 15, yMax = 85) {
  const valores = pontos.map((p) => p.seguidores);
  const min = Math.min(...valores);
  const max = Math.max(...valores);
  return pontos.map((p, i) => ({
    x: pontos.length === 1 ? largura : (i / (pontos.length - 1)) * largura,
    y: max === min ? 50 : yMax - ((p.seguidores - min) / (max - min)) * (yMax - yMin)
  }));
}

export function growthChartHtml(pontos) {
  if (pontos.length < 2) {
    return `<div class="inf-vazio-pequeno">Registre ao menos 2 dias de seguidores para ver o gráfico.</div>`;
  }
  const xy = calcularPontosSvg(pontos);
  const linha = xy.map((p) => `${arredondar(p.x)},${arredondar(p.y)}`).join(" ");
  const ultimo = xy[xy.length - 1];
  const dias = pontos
    .map((p, i) => `<span${i === pontos.length - 1 ? ' class="ultimo"' : ""}>${rotuloDiaSemana(p.data)}</span>`)
    .join("");
  return `<div class="inf-grafico"><svg class="inf-grafico-svg" viewBox="0 0 320 100" role="img" aria-label="Crescimento de seguidores nos últimos registros">
      <defs><linearGradient id="infGradCresc" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="#1D4ED8" stop-opacity="0.25"/><stop offset="100%" stop-color="#1D4ED8" stop-opacity="0"/></linearGradient></defs>
      <line stroke="#E2E8F0" stroke-dasharray="3 3" x1="0" x2="320" y1="20" y2="20"/>
      <line stroke="#E2E8F0" stroke-dasharray="3 3" x1="0" x2="320" y1="50" y2="50"/>
      <line stroke="#E2E8F0" stroke-dasharray="3 3" x1="0" x2="320" y1="80" y2="80"/>
      <polygon fill="url(#infGradCresc)" points="${linha} 320,100 0,100"/>
      <polyline fill="none" points="${linha}" stroke="#1D4ED8" stroke-linecap="round" stroke-linejoin="round" stroke-width="3"/>
      <circle cx="${arredondar(ultimo.x)}" cy="${arredondar(ultimo.y)}" r="4.5" fill="#FFFFFF" stroke="#1D4ED8" stroke-width="3"/>
    </svg></div><div class="inf-grafico-dias">${dias}</div>`;
}

// Selo de crescimento (tabela e drawer): verde quando sobe, vermelho quando desce.
export function crescimentoBadgeHtml(pct) {
  if (pct === null || pct === undefined) return `<span class="inf-cresc neutro">—</span>`;
  const classe = pct > 0 ? "sobe" : pct < 0 ? "desce" : "neutro";
  const seta = pct > 0 ? "▲ " : pct < 0 ? "▼ " : "";
  return `<span class="inf-cresc ${classe}">${seta}${formatVariacao(pct)}</span>`;
}
