import { escapeHtml } from "./html.js";

// "Todas" so faz sentido para quem enxerga todas as marcas (Admin/Gestor); para os demais o RLS
// ja limita a marca vinculada, entao a opcao some.
export function opcoesMarca(cargo, marcas) {
  const veTodas = cargo === "Admin" || cargo === "Gestor";
  return marcas.filter((m) => m !== "Todas" || veTodas);
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
