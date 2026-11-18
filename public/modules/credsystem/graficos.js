// Graficos SVG leves (sem dependencia externa - a CSP do app so libera scripts de 'self' e esm.sh).
// Todo texto passa por esc(); todas as funcoes devolvem HTML pronto e um estado vazio quando nao ha
// dados, em vez de desenhar um grafico de zeros.

export const esc = (v) => String(v ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll("\"", "&quot;").replaceAll("'", "&#039;");

const vazioHtml = (msg) => `<p class="muted cs-vazio-inline">${esc(msg)}</p>`;

function escalaMax(valores) {
  const max = Math.max(0, ...valores.filter((v) => Number.isFinite(v)));
  if (max <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(max));
  return Math.ceil(max / p) * p;
}

// Barras horizontais: itens [{ rotulo, valor, cor, detalhe }]
export function barrasHorizontais(itens, { formatar = String, vazio = "Sem dados para exibir.", max = 12 } = {}) {
  const validos = itens.filter((i) => i.valor !== null && i.valor !== undefined && Number.isFinite(Number(i.valor))).slice(0, max);
  if (!validos.length) return vazioHtml(vazio);
  const topo = Math.max(...validos.map((i) => Number(i.valor)), 0) || 1;
  return `<div class="cs-hbars">${validos.map((i) => `
    <div class="cs-hbar" title="${esc(`${i.rotulo}: ${formatar(i.valor)}${i.detalhe ? ` · ${i.detalhe}` : ""}`)}">
      <span class="cs-hbar-rotulo">${esc(i.rotulo)}</span>
      <span class="cs-hbar-trilho"><span class="cs-hbar-barra" style="width:${Math.max(1.5, (Number(i.valor) / topo) * 100).toFixed(1)}%;background:${esc(i.cor || "var(--accent)")}"></span></span>
      <span class="cs-hbar-valor">${esc(formatar(i.valor))}${i.detalhe ? `<small>${esc(i.detalhe)}</small>` : ""}</span>
    </div>`).join("")}</div>`;
}

function legendaHtml(series) {
  return `<div class="cs-legenda">${series.map((s) => `<span><i style="background:${esc(s.cor)}"></i>${esc(s.nome)}</span>`).join("")}</div>`;
}

// Barras verticais agrupadas: categorias [str], series [{ nome, cor, valores: [num|null] }]
export function barrasAgrupadas(categorias, series, { formatar = String, vazio = "Sem dados para exibir.", altura = 220 } = {}) {
  const todos = series.flatMap((s) => s.valores).filter((v) => v !== null && v !== undefined && Number.isFinite(v));
  if (!categorias.length || !todos.length) return vazioHtml(vazio);
  const w = Math.max(320, categorias.length * (series.length * 18 + 22) + 60), h = altura, padL = 52, padB = 34, padT = 12;
  const maxV = escalaMax(todos);
  const larguraGrupo = (w - padL - 10) / categorias.length;
  const larguraBarra = Math.min(26, (larguraGrupo - 10) / series.length);
  const y = (v) => padT + (1 - v / maxV) * (h - padT - padB);
  const grade = [0, 0.5, 1].map((f) => `<line x1="${padL}" x2="${w - 6}" y1="${y(maxV * f).toFixed(1)}" y2="${y(maxV * f).toFixed(1)}" stroke="#e2e8f0"/><text x="${padL - 6}" y="${(y(maxV * f) + 4).toFixed(1)}" text-anchor="end" font-size="10" fill="#94a3b8">${esc(formatar(maxV * f))}</text>`).join("");
  const barras = categorias.map((c, ci) => {
    const x0 = padL + ci * larguraGrupo + (larguraGrupo - larguraBarra * series.length) / 2;
    const rects = series.map((s, si) => {
      const v = s.valores[ci];
      if (v === null || v === undefined || !Number.isFinite(v)) return "";
      return `<rect x="${(x0 + si * larguraBarra).toFixed(1)}" y="${y(v).toFixed(1)}" width="${(larguraBarra - 2).toFixed(1)}" height="${Math.max(0, h - padB - y(v)).toFixed(1)}" rx="3" fill="${esc(s.cor)}"><title>${esc(`${s.nome} · ${c}: ${formatar(v)}`)}</title></rect>`;
    }).join("");
    return `${rects}<text x="${(padL + ci * larguraGrupo + larguraGrupo / 2).toFixed(1)}" y="${h - padB + 16}" text-anchor="middle" font-size="10" fill="#64748b">${esc(c)}</text>`;
  }).join("");
  return `<div class="cs-chart-scroll"><svg viewBox="0 0 ${w} ${h}" style="min-width:${Math.min(w, 640)}px;width:100%;height:auto" role="img">${grade}${barras}</svg></div>${series.length > 1 ? legendaHtml(series) : ""}`;
}

// Linhas: categorias [str], series [{ nome, cor, valores: [num|null] }]
export function linhas(categorias, series, { formatar = String, vazio = "Sem dados para exibir.", altura = 220 } = {}) {
  const todos = series.flatMap((s) => s.valores).filter((v) => v !== null && v !== undefined && Number.isFinite(v));
  if (categorias.length < 2 || !todos.length) {
    return categorias.length === 1 && todos.length ? barrasAgrupadas(categorias, series, { formatar, vazio, altura }) : vazioHtml(categorias.length < 2 && todos.length ? "Apenas um mês no período — a evolução aparece a partir de dois meses." : vazio);
  }
  const w = 640, h = altura, padL = 52, padR = 14, padB = 34, padT = 12;
  const maxV = escalaMax(todos);
  const x = (i) => padL + (i / (categorias.length - 1)) * (w - padL - padR);
  const y = (v) => padT + (1 - v / maxV) * (h - padT - padB);
  const grade = [0, 0.5, 1].map((f) => `<line x1="${padL}" x2="${w - padR}" y1="${y(maxV * f).toFixed(1)}" y2="${y(maxV * f).toFixed(1)}" stroke="#e2e8f0"/><text x="${padL - 6}" y="${(y(maxV * f) + 4).toFixed(1)}" text-anchor="end" font-size="10" fill="#94a3b8">${esc(formatar(maxV * f))}</text>`).join("");
  const passo = Math.ceil(categorias.length / 8);
  const eixo = categorias.map((c, i) => (i % passo === 0 || i === categorias.length - 1) ? `<text x="${x(i).toFixed(1)}" y="${h - padB + 16}" text-anchor="middle" font-size="10" fill="#64748b">${esc(c)}</text>` : "").join("");
  const tracos = series.map((s) => {
    let d = "", aberto = false;
    s.valores.forEach((v, i) => {
      if (v === null || v === undefined || !Number.isFinite(v)) { aberto = false; return; }
      d += `${aberto ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
      aberto = true;
    });
    const pontos = s.valores.map((v, i) => (v === null || v === undefined || !Number.isFinite(v)) ? "" : `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="3" fill="${esc(s.cor)}"><title>${esc(`${s.nome} · ${categorias[i]}: ${formatar(v)}`)}</title></circle>`).join("");
    return `<path d="${d.trim()}" fill="none" stroke="${esc(s.cor)}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>${pontos}`;
  }).join("");
  return `<svg viewBox="0 0 ${w} ${h}" style="width:100%;height:auto" role="img">${grade}${eixo}${tracos}</svg>${series.length > 1 ? legendaHtml(series) : ""}`;
}

// Funil: etapas [{ rotulo, valor, taxa: {rotulo, valor} }]
export function funil(etapas, { formatar = String, formatarTaxa = String, cor = "var(--accent)" } = {}) {
  if (!etapas.some((e) => e.valor !== null && e.valor > 0)) return vazioHtml("Sem dados para montar o funil.");
  const topo = Math.max(...etapas.map((e) => e.valor || 0)) || 1;
  return `<div class="cs-funil">${etapas.map((e, i) => `
    ${i > 0 && e.taxa ? `<div class="cs-funil-taxa"><span class="material-symbols-outlined">south</span>${esc(e.taxa.rotulo)}: <strong>${esc(formatarTaxa(e.taxa.valor))}</strong></div>` : ""}
    <div class="cs-funil-etapa">
      <div class="cs-funil-barra" style="width:${Math.max(6, ((e.valor || 0) / topo) * 100).toFixed(1)}%;background:${esc(cor)};opacity:${(1 - i * 0.14).toFixed(2)}"></div>
      <div class="cs-funil-texto"><span>${esc(e.rotulo)}</span><strong>${esc(e.valor === null ? "N/D" : formatar(e.valor))}</strong></div>
    </div>`).join("")}</div>`;
}
