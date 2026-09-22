import { escapeHtml } from "./html.js";

// Visao ampla: todo cargo enxerga influenciadores de todas as marcas (RLS de leitura liberado para
// qualquer autenticado). A opcao "Todas" aparece para todos; a marca vinculada de Coordenador/
// Analista so restringe ESCRITA (ver marcasEditaveisPara em index.js), nao leitura.
export function opcoesMarca(_cargo, marcas) {
  return marcas;
}

function rotulo(marca) {
  return marca === "Todas" ? "Todas as Lojas" : marca;
}

export function brandFilterPillsHtml({ opcoes, marcaAtual }) {
  const botoes = opcoes
    .map((m) => `<button type="button" class="inf-pill${m === marcaAtual ? " ativa" : ""}" data-marca="${escapeHtml(m)}">${escapeHtml(rotulo(m))}</button>`)
    .join("");
  return `<div class="inf-bandeira"><span class="inf-bandeira-rotulo"><span class="material-symbols-outlined" style="font-size:14px">store</span> Bandeira:</span>${botoes}</div>`;
}

export function bindBrandFilterPills(raiz, aoSelecionar) {
  raiz.querySelectorAll("[data-marca]").forEach((botao) => {
    botao.onclick = () => aoSelecionar(botao.dataset.marca);
  });
}
