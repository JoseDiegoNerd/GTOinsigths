import { escapeHtml } from "./html.js";
import { REDES, FORMATOS, validarMidia } from "./validacao.js";

const CAMPOS_METRICA = [
  ["views", "Views", "infMViews"],
  ["alcance", "Alcance", "infMAlcance"],
  ["curtidas", "Curtidas", "infMCurtidas"],
  ["comentarios", "Comentários", "infMComentarios"],
  ["salvos", "Salvos", "infMSalvos"],
  ["compartilhamentos", "Compartilhamentos", "infMCompart"]
];

export function estadoInicialMidia({ midia, influenciador, campanhas = [], hoje }) {
  const estado = {
    id: midia?.id ?? null,
    influenciadorId: influenciador.id,
    influenciadorNome: influenciador.nome,
    marca: influenciador.marca,
    titulo: midia?.titulo ?? "",
    url: midia?.url ?? "",
    plataforma: midia?.plataforma ?? "",
    formato: midia?.formato ?? "Reel",
    publicada_em: midia?.publicada_em ?? hoje,
    campanha_id: midia?.campanha_id ?? "",
    campanhas: campanhas.map((c) => ({ id: c.id, nome: c.nome })),
    erros: {},
    erroGeral: "",
    salvando: false
  };
  for (const [campo] of CAMPOS_METRICA) estado[campo] = midia ? String(midia[campo] ?? 0) : "";
  return estado;
}

const erroDe = (erros, campo) => (erros[campo] ? `<small class="inf-erro">${escapeHtml(erros[campo])}</small>` : "");

export function midiaFormHtml(e) {
  const novo = !e.id;
  const plataformas = [`<option value="">Detectar pela URL</option>`, ...REDES.map((r) => `<option value="${r}"${r === e.plataforma ? " selected" : ""}>${r}</option>`)].join("");
  const formatos = FORMATOS.map((f) => `<option value="${f}"${f === e.formato ? " selected" : ""}>${f}</option>`).join("");
  const campanhas = [`<option value="">Sem campanha</option>`, ...e.campanhas.map((c) => `<option value="${escapeHtml(c.id)}"${c.id === e.campanha_id ? " selected" : ""}>${escapeHtml(c.nome)}</option>`)].join("");
  const metricas = CAMPOS_METRICA.map(([campo, rotulo, id]) =>
    `<label>${rotulo}<input id="${id}" type="text" inputmode="numeric" value="${escapeHtml(e[campo])}" placeholder="0" />${erroDe(e.erros, campo)}</label>`).join("");

  return `<div class="modal-header"><div><h3>${novo ? "Vincular nova URL" : "Editar mídia"}</h3>
      <p class="muted">${escapeHtml(e.influenciadorNome)} · ${escapeHtml(e.marca)}</p></div>
      <button type="button" class="modal-close" data-fechar-modal aria-label="Fechar"><span class="material-symbols-outlined">close</span></button></div>
    <form id="infMForm" class="modal-body" novalidate>
      <div class="inf-form-scroll">
        ${e.erroGeral ? `<div class="alert error">${escapeHtml(e.erroGeral)}</div>` : ""}
        <label>Título<input id="infMTitulo" type="text" value="${escapeHtml(e.titulo)}" maxlength="160" placeholder="Ex: Reel: Provador Tesoura de Ouro" />${erroDe(e.erros, "titulo")}</label>
        <label>URL do post<input id="infMUrl" type="url" value="${escapeHtml(e.url)}" maxlength="500" placeholder="https://www.instagram.com/reel/..." />${erroDe(e.erros, "url")}</label>
        <div class="inf-form-grid">
          <label>Plataforma<select id="infMPlataforma">${plataformas}</select>${erroDe(e.erros, "plataforma")}</label>
          <label>Formato<select id="infMFormato">${formatos}</select>${erroDe(e.erros, "formato")}</label>
          <label>Publicado em<input id="infMData" type="date" value="${escapeHtml(e.publicada_em)}" />${erroDe(e.erros, "publicada_em")}</label>
          <label>Campanha<select id="infMCampanha">${campanhas}</select></label>
        </div>
        <p class="muted" style="margin:0">Métricas informadas manualmente (copie do print de insights que o influenciador enviou).</p>
        <div class="inf-form-grid inf-form-grid-3">${metricas}</div>
      </div>
      <div class="inf-form-rodape"><div></div><div class="inf-form-botoes"><button type="button" class="secondary" data-fechar-modal>Cancelar</button>
        <button type="submit"${e.salvando ? " disabled" : ""}>${e.salvando ? "Salvando…" : "Salvar"}</button></div></div>
    </form>`;
}

export function lerMidiaForm(raiz, estado) {
  const valor = (id) => raiz.querySelector(`#${id}`)?.value ?? "";
  const lido = {
    ...estado,
    titulo: valor("infMTitulo"),
    url: valor("infMUrl"),
    plataforma: valor("infMPlataforma"),
    formato: valor("infMFormato"),
    publicada_em: valor("infMData"),
    campanha_id: valor("infMCampanha")
  };
  for (const [campo, , id] of CAMPOS_METRICA) lido[campo] = valor(id);
  return lido;
}

export function validarFormularioMidia(estado) {
  return validarMidia(estado);
}
