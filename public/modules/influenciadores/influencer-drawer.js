import { escapeHtml } from "./html.js";
import { avatarHtml } from "./avatar.js";
import { growthChartHtml, crescimentoBadgeHtml } from "./growth-chart.js";
import { formatBRLInteiro, formatInt, formatSincronizadoEm } from "./calculos.js";

const CLASSE_STATUS = { Ativo: "ativo", Pausado: "pausado", Encerrado: "encerrado" };
const CORES_CAMPANHA = ["#2563eb", "#f59e0b", "#10b981", "#ec4899", "#8b5cf6", "#06b6d4"];
const COR_PLATAFORMA = { Instagram: "#ec4899", TikTok: "#0f172a", YouTube: "#dc2626" };

function urlSegura(url) {
  return String(url ?? "").startsWith("https://") ? url : "#";
}

function urlCurta(url) {
  return String(url ?? "").replace(/^https?:\/\/(www\.)?/, "");
}

function topoHtml(m) {
  const i = m.influenciador;
  return `<div class="inf-drawer-topo"><div class="inf-drawer-id">
      ${avatarHtml({ nome: i.nome, url: m.avatarUrl, tamanho: "lg", destaque: true })}
      <div><div class="inf-drawer-nome"><h3>${escapeHtml(i.nome)}</h3>${i.verificado ? `<span class="material-symbols-outlined inf-verificado">verified</span>` : ""}</div>
        <div class="inf-criador-handle">${escapeHtml(i.handle)}</div>
        ${i.publicacoes_total !== null && i.publicacoes_total !== undefined ? `<div class="inf-publicacoes">${formatInt(i.publicacoes_total)} publicações</div>` : ""}
        <div class="inf-tags">${i.nicho ? `<span class="inf-tag roxo">${escapeHtml(i.nicho)}</span>` : ""}<span class="inf-tag azul">${escapeHtml(i.marca)}</span></div></div></div>
    <div class="inf-drawer-acoes">
      ${m.podeEditar ? `<button type="button" class="inf-icone" data-acao="editar" title="Editar influenciador"><span class="material-symbols-outlined">edit</span></button>` : ""}
      <button type="button" class="inf-icone" data-acao="fechar" title="Fechar painel"><span class="material-symbols-outlined">close</span></button></div></div>`;
}

function sincronizacaoHtml(m) {
  const i = m.influenciador;
  if (i.rede_social !== "Instagram" || !m.podeEditar) return "";
  const status = i.instagram_sync_erro
    ? `<span class="inf-sync-erro">${escapeHtml(i.instagram_sync_erro)}</span>`
    : `<span class="inf-sync-status">${escapeHtml(formatSincronizadoEm(i.instagram_sincronizado_em))}</span>`;
  return `<div class="inf-sync-linha">
      <button type="button" class="inf-btn-mini" data-acao="sincronizar-instagram"${m.sincronizando ? " disabled" : ""}>${m.sincronizando ? "Sincronizando…" : "Sincronizar com Instagram"}</button>
      ${status}
    </div>`;
}

function acordosHtml(m) {
  const i = m.influenciador;
  const a = m.agregado;
  const cupom = i.cupom_codigo
    ? `<button type="button" class="inf-cupom-codigo" data-cupom="${escapeHtml(i.cupom_codigo)}" title="Copiar cupom"><span>${escapeHtml(i.cupom_codigo)}</span><span class="material-symbols-outlined">content_copy</span></button>`
    : "";
  return `<section class="inf-bloco">
      <div class="inf-bloco-topo"><span class="inf-bloco-titulo"><span class="material-symbols-outlined azul">handshake</span>Investimento &amp; Acordos</span>
        <span class="inf-status ${CLASSE_STATUS[i.status] ?? "ativo"}">${escapeHtml(i.status)}</span></div>
      <div class="inf-valores">
        <div class="inf-valor"><div class="rotulo">Cachê</div><div class="num">${formatBRLInteiro(a.cacheTotal)}</div></div>
        <div class="inf-valor"><div class="rotulo">Voucher / Permuta</div><div class="num">${formatBRLInteiro(a.voucherTotal)}</div></div>
        <div class="inf-valor destaque"><div class="rotulo">Invest. Total</div><div class="num">${formatBRLInteiro(a.investimentoTotal)}</div></div>
      </div>
      <div class="inf-cupom-linha"><div class="inf-cupom-status"><span class="inf-ponto ${i.cupom_exclusivo ? "on" : "off"}"></span>
        <span>Cupom Exclusivo: <strong class="${i.cupom_exclusivo ? "sim" : "nao"}">${i.cupom_exclusivo ? "SIM" : "NÃO"}</strong></span></div>${cupom}</div>
    </section>`;
}

function campanhasHtml(campanhas) {
  const chips = campanhas.length > 0
    ? campanhas.map((c, n) => `<span class="inf-chip"><span class="inf-ponto" style="background:${CORES_CAMPANHA[n % CORES_CAMPANHA.length]}"></span>${escapeHtml(c.nome)}</span>`).join("")
    : `<span class="muted">Nenhuma campanha cadastrada.</span>`;
  return `<section><div class="inf-bloco-titulo"><span class="material-symbols-outlined">campaign</span>Campanhas Realizadas</div><div class="inf-chips">${chips}</div></section>`;
}

function crescimentoHtml(m) {
  const abs = m.agregado.crescimentoAbs;
  const texto = abs === null
    ? "Sem base de 7 dias"
    : abs >= 0 ? `+${formatInt(abs)} novos seguidores` : `${formatInt(abs)} seguidores`;
  const form = m.podeEditar
    ? `<form id="infSnapForm" class="inf-snap-form">
        <input type="date" name="data" value="${escapeHtml(m.hoje)}" max="${escapeHtml(m.hoje)}" required aria-label="Data do registro" />
        <input type="text" name="seguidores" inputmode="numeric" placeholder="Total de seguidores" required aria-label="Total de seguidores" />
        <button type="submit" class="inf-btn-mini">Registrar</button></form>`
    : "";
  return `<section class="inf-bloco">
      <div class="inf-cresc-topo"><div><div class="inf-bloco-titulo">Crescimento Semanal</div><div class="inf-cresc-valor">${texto}</div></div>${crescimentoBadgeHtml(m.agregado.crescimentoPct)}</div>
      ${growthChartHtml(m.pontos)}${form}</section>`;
}

function midiaHtml(midia, podeEditar) {
  const id = escapeHtml(midia.id);
  return `<article class="inf-midia">
      <div class="inf-midia-topo"><div class="inf-midia-titulo"><span class="inf-ponto" style="background:${COR_PLATAFORMA[midia.plataforma] ?? "#94a3b8"}"></span><span>${escapeHtml(midia.titulo)}</span></div>
        <div class="inf-midia-acoes"><a href="${escapeHtml(urlSegura(midia.url))}" target="_blank" rel="noopener noreferrer" title="Abrir post"><span class="material-symbols-outlined">open_in_new</span></a>
        ${podeEditar ? `<button type="button" data-editar-midia="${id}" title="Editar mídia"><span class="material-symbols-outlined">edit</span></button><button type="button" data-excluir-midia="${id}" title="Excluir mídia"><span class="material-symbols-outlined">delete</span></button>` : ""}</div></div>
      <div class="inf-midia-url">${escapeHtml(urlCurta(midia.url))}</div>
      <div class="inf-midia-metricas">
        <div><div class="rotulo">Views</div><div class="num">${formatInt(midia.views)}</div></div>
        <div><div class="rotulo">Curtidas</div><div class="num">${formatInt(midia.curtidas)}</div></div>
        <div><div class="rotulo">Salvos</div><div class="num verde">${formatInt(midia.salvos)}</div></div></div>
    </article>`;
}

function midiasHtml(m) {
  const lista = m.midias.length > 0
    ? m.midias.map((x) => midiaHtml(x, m.podeEditar)).join("")
    : `<p class="muted">Nenhuma mídia vinculada.</p>`;
  return `<section class="inf-midias"><div class="inf-midias-topo"><span class="inf-bloco-titulo"><span class="material-symbols-outlined rosa">video_library</span>Mídias Vinculadas (Meta API)</span>
      <span class="muted">${m.midias.length} posts</span></div>${lista}</section>`;
}

export function influencerDrawerHtml(m) {
  if (!m.influenciador) {
    return `<div class="inf-drawer-vazio"><span class="material-symbols-outlined">person_search</span><strong>Selecione um influenciador</strong><p>Clique em uma linha da tabela para ver acordos, campanhas, crescimento e mídias vinculadas.</p></div>`;
  }
  return `${topoHtml(m)}${sincronizacaoHtml(m)}${acordosHtml(m)}${campanhasHtml(m.campanhas)}${crescimentoHtml(m)}${midiasHtml(m)}
    ${m.podeEditar ? `<button type="button" class="inf-btn-cta" data-acao="nova-midia"><span class="material-symbols-outlined">add_link</span><span>+ Vincular Nova URL</span></button>` : ""}`;
}

export function bindInfluencerDrawer(raiz, cb) {
  const acao = (nome, funcao) => {
    const botao = raiz.querySelector(`[data-acao="${nome}"]`);
    if (botao) botao.onclick = funcao;
  };
  acao("fechar", () => cb.aoFechar());
  acao("editar", () => cb.aoEditar());
  acao("nova-midia", () => cb.aoNovaMidia());
  acao("sincronizar-instagram", () => cb.aoSincronizarInstagram());

  raiz.querySelectorAll("[data-editar-midia]").forEach((b) => { b.onclick = () => cb.aoEditarMidia(b.dataset.editarMidia); });
  raiz.querySelectorAll("[data-excluir-midia]").forEach((b) => { b.onclick = () => cb.aoExcluirMidia(b.dataset.excluirMidia); });
  raiz.querySelectorAll("[data-cupom]").forEach((b) => { b.onclick = () => cb.aoCopiarCupom(b.dataset.cupom, b); });

  const form = raiz.querySelector("#infSnapForm");
  if (form) {
    form.onsubmit = (evento) => {
      evento.preventDefault();
      cb.aoRegistrarSeguidores({ data: form.elements.data.value, seguidores: form.elements.seguidores.value });
    };
  }
}
