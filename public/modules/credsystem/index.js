// Orquestrador do modulo Cartao Proprio CredSystem. Chamado por public/index.html via import()
// dinamico (mesmo padrao do modulo Influenciadores). Recebe do app as dependencias compartilhadas
// (cliente Supabase autenticado, estado de marca/periodo, helpers de filtro) - o modulo nao cria
// sessao propria nem conhece a chave de servico.

import { initDashboard, invalidarCacheDashboard, renderCredsystem, definirAba } from "./dashboard.js";
import { initImportador, montarImportador } from "./importador.js";
import { ESTILO_CREDSYSTEM } from "./estilo.js";

let deps = null;
let XLSXPromise = null;

// SheetJS 0.20.3 servido do proprio app (public/vendor) - versao com correcoes de seguranca
// (prototype pollution/ReDoS) que nao existem no 0.18.5 publicado no npm.
function carregarXLSX() {
  XLSXPromise ||= import("../../vendor/xlsx-0.20.3.js");
  return XLSXPromise;
}

function injetarEstilo() {
  if (document.getElementById("cs-estilo")) return;
  const s = document.createElement("style");
  s.id = "cs-estilo";
  s.textContent = ESTILO_CREDSYSTEM;
  document.head.appendChild(s);
}

export function initCredsystem(dependencias) {
  deps = { ...dependencias, carregarXLSX };
  injetarEstilo();
  initDashboard({
    ...deps,
    irParaImportacao: () => deps.navegar("import")
  });
  initImportador({
    ...deps,
    aposImportacao: () => {
      invalidarCacheDashboard();
      deps.invalidarCachesApp?.();
    },
    irParaModulo: (aba, periodo) => {
      definirAba(aba);
      // mostra o periodo recem-importado em vez do filtro padrao (que podia esconder os dados)
      if (periodo?.inicio && periodo?.fim) Object.assign(deps.state, { periodo: "custom", periodoDe: periodo.inicio, periodoAte: periodo.fim, periodoMenuOpen: false });
      deps.navegar("credsystem");
    }
  });
}

export { renderCredsystem, montarImportador, invalidarCacheDashboard };
