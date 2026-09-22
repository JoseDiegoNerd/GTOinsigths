// Orquestrador do modulo Influenciadores: mantem o estado da tela, busca os dados, decide o que
// renderizar e liga os eventos dos componentes. Chamado por public/index.html via import()
// dinamico quando state.page === "influenciadores".

import {
  agruparPorInfluenciador, agregarInfluenciador, calcularKpis, filtrarInfluenciadores,
  paginar, pontosCrescimento, hojeISO
} from "./calculos.js";
import { kpiCardsHtml } from "./kpi-cards.js";
import { opcoesMarca, brandFilterPillsHtml, bindBrandFilterPills } from "./brand-filter-pills.js";
import { influencersTableHtml, bindInfluencersTable } from "./influencers-table.js";
import { influencerDrawerHtml, bindInfluencerDrawer } from "./influencer-drawer.js";
import { criarService } from "./service.js";
import {
  campanhaVazia, estadoInicialInfluenciador, influencerFormHtml, lerInfluencerForm, validarFormularioInfluenciador
} from "./influencer-form-modal.js";
import {
  estadoInicialMidia, midiaFormHtml, lerMidiaForm, validarFormularioMidia
} from "./midia-form-modal.js";
import { validarSeguidores } from "./validacao.js";

const TAMANHO_PAGINA = 5;
const SUBABAS = [
  ["geral", "Visão Geral"],
  ["parcerias", "Desempenho de Parcerias"],
  ["vincular", "Vincular Conteúdo (URL)"],
  ["comparativo", "Comparativo"]
];

let deps = null;
let service = null;
let estado = null;

function podeEditar() {
  const cargo = deps.state.perfil?.cargo;
  return cargo === "Admin" || cargo === "Gestor" || cargo === "Coordenador" || cargo === "Analista";
}

function novoEstado() {
  return {
    // "carregando" = ha uma busca em voo agora; "carregado" = ja buscamos pelo menos uma vez.
    // Sao coisas diferentes: sem essa separacao o primeiro render cai no ramo de repintura e a
    // tela fica presa no placeholder "Carregando…" para sempre.
    carregando: false,
    carregado: false,
    erro: "",
    dados: { influenciadores: [], campanhas: [], midias: [], snapshots: [], avatares: new Map() },
    busca: "",
    pagina: 1,
    abertoId: null,
    selecionados: new Set(),
    subaba: "geral",
    modal: null // { tipo: "influenciador" | "midia", ...estadoDoFormulario }
  };
}

export async function initInfluenciadores(dependencias) {
  deps = dependencias;
  service = criarService(deps.supabase);
}

async function carregar() {
  estado.carregando = true;
  estado.erro = "";
  pintar();
  try {
    estado.dados = await service.carregarTudo(deps.state.marca);
    if (estado.abertoId && !estado.dados.influenciadores.some((i) => i.id === estado.abertoId)) {
      estado.abertoId = null;
    }
  } catch (erro) {
    estado.erro = deps.safeErrorMessage(erro, "Não foi possível carregar os influenciadores.");
  } finally {
    estado.carregando = false;
    estado.carregado = true;
    pintar();
  }
}

function modeloTabela() {
  const hoje = hojeISO();
  const grupos = agruparPorInfluenciador({ influenciadores: estado.dados.influenciadores, ...estado.dados });
  const filtrados = filtrarInfluenciadores(estado.dados.influenciadores, estado.busca);
  const pagina = paginar(filtrados, estado.pagina, TAMANHO_PAGINA);
  const linhas = pagina.itens.map((influenciador) => ({
    influenciador,
    agregado: agregarInfluenciador(grupos.get(influenciador.id), hoje),
    avatarUrl: influenciador.avatar_path ? estado.dados.avatares.get(influenciador.avatar_path) ?? null : null
  }));
  return {
    linhas, cadastrados: estado.dados.influenciadores.length, total: pagina.total,
    pagina: pagina.pagina, totalPaginas: pagina.totalPaginas, busca: estado.busca,
    abertoId: estado.abertoId, selecionados: estado.selecionados, podeEditar: podeEditar()
  };
}

function modeloDrawer() {
  const influenciador = estado.dados.influenciadores.find((i) => i.id === estado.abertoId) ?? null;
  if (!influenciador) return { influenciador: null };
  const hoje = hojeISO();
  const grupos = agruparPorInfluenciador({ influenciadores: estado.dados.influenciadores, ...estado.dados });
  const grupo = grupos.get(influenciador.id);
  return {
    influenciador,
    avatarUrl: influenciador.avatar_path ? estado.dados.avatares.get(influenciador.avatar_path) ?? null : null,
    agregado: agregarInfluenciador(grupo, hoje),
    campanhas: grupo.campanhas,
    midias: grupo.midias,
    pontos: pontosCrescimento(grupo.snapshots),
    podeEditar: podeEditar(),
    hoje
  };
}

function subabasHtml() {
  return `<div class="inf-subabas">${SUBABAS.map(([chave, rotulo]) =>
    `<button type="button" class="${chave === estado.subaba ? "ativa" : ""}"${chave === "geral" ? "" : " disabled title=\"Em breve\""} data-subaba="${chave}">${rotulo}</button>`
  ).join("")}</div>`;
}

function pintar() {
  const raiz = deps.state.contentEl;
  if (estado.carregando && estado.dados.influenciadores.length === 0) {
    raiz.innerHTML = `<div class="page-head"><div><div class="eyebrow">Meta Business &amp; Creators</div><h2>Influenciadores</h2></div></div><p class="muted">Carregando…</p>`;
    return;
  }
  const kpis = calcularKpis({ campanhas: estado.dados.campanhas, midias: estado.dados.midias, mes: hojeISO().slice(0, 7) });
  raiz.innerHTML = `
    <div class="page-head"><div><div class="eyebrow">Meta Business &amp; Creators</div><h2>Influenciadores</h2></div>
      ${brandFilterPillsHtml({ opcoes: opcoesMarca(deps.state.perfil?.cargo, deps.marcas), marcaAtual: deps.state.marca })}
    </div>
    ${subabasHtml()}
    ${estado.erro ? `<div class="alert error">${deps.escapeHtml(estado.erro)}</div>` : ""}
    ${estado.subaba !== "geral" ? `<p class="muted">Esta aba estará disponível em breve.</p>` : `
      ${kpiCardsHtml(kpis)}
      <div class="inf-layout">
        <section class="card inf-tabela">${influencersTableHtml(modeloTabela())}</section>
        <section class="card inf-drawer">${influencerDrawerHtml(modeloDrawer())}</section>
      </div>`}
    <div class="modal-overlay" id="infModal" hidden></div>`;
  ligarEventos();
}

// Valida o snapshot de seguidores antes de tocar no banco. Sem isso, um campo vazio virava
// Number("") === 0 e gravava um snapshot de 0 seguidores em silencio, distorcendo o crescimento
// semanal e o grafico. Funcao pura (exportada para teste sem DOM).
export function prepararSnapshotSeguidores({ data, seguidores }, hoje) {
  const r = validarSeguidores({ data, seguidores }, hoje);
  if (!r.ok) return { ok: false, mensagem: Object.values(r.erros).join(" ") };
  return { ok: true, valor: r.valor };
}

function ligarEventos() {
  const raiz = deps.state.contentEl;
  bindBrandFilterPills(raiz, (marca) => {
    deps.state.marca = marca;
    estado.pagina = 1;
    estado.abertoId = null;
    estado.selecionados = new Set();
    carregar();
  });
  raiz.querySelectorAll("[data-subaba]").forEach((botao) => {
    if (botao.disabled) return;
    botao.onclick = () => { estado.subaba = botao.dataset.subaba; pintar(); };
  });
  if (estado.subaba !== "geral") return;

  bindInfluencersTable(raiz, {
    aoBuscar: (texto) => {
      // pintar() reescreve o innerHTML inteiro, destruindo o <input> que disparou o oninput e
      // jogando o foco no <body>. Guardamos o cursor antes da repintura e devolvemos foco e
      // posicao ao campo recriado, senao o usuario perde o teclado a cada tecla digitada.
      const cursor = deps.state.contentEl.querySelector("#infBusca")?.selectionStart ?? texto.length;
      estado.busca = texto;
      estado.pagina = 1;
      pintar();
      const campo = deps.state.contentEl.querySelector("#infBusca");
      if (campo) {
        campo.focus();
        try { campo.setSelectionRange(cursor, cursor); } catch { /* navegador pode recusar selecao neste input */ }
      }
    },
    aoSelecionar: (id) => { estado.abertoId = estado.abertoId === id ? null : id; pintar(); },
    aoMarcar: (id, marcado) => { marcado ? estado.selecionados.add(id) : estado.selecionados.delete(id); pintar(); },
    aoMarcarTodos: (marcado) => {
      const pagina = paginar(filtrarInfluenciadores(estado.dados.influenciadores, estado.busca), estado.pagina, TAMANHO_PAGINA);
      for (const i of pagina.itens) marcado ? estado.selecionados.add(i.id) : estado.selecionados.delete(i.id);
      pintar();
    },
    aoPaginar: (n) => { estado.pagina = n; pintar(); },
    aoNovo: () => abrirModalInfluenciador(null)
  });

  bindInfluencerDrawer(raiz, {
    aoFechar: () => { estado.abertoId = null; pintar(); },
    aoEditar: () => abrirModalInfluenciador(estado.dados.influenciadores.find((i) => i.id === estado.abertoId)),
    aoNovaMidia: () => abrirModalMidia(null),
    aoEditarMidia: (id) => abrirModalMidia(estado.dados.midias.find((m) => m.id === id)),
    aoExcluirMidia: async (id) => {
      if (!window.confirm("Excluir esta mídia vinculada?")) return;
      try {
        await service.excluirMidia(id);
        await carregar();
      } catch (erro) {
        estado.erro = deps.safeErrorMessage(erro, "Não foi possível excluir a mídia.");
        pintar();
      }
    },
    aoCopiarCupom: async (codigo, botao) => {
      try {
        await navigator.clipboard.writeText(codigo);
        const original = botao.innerHTML;
        botao.innerHTML = `<span>Copiado!</span>`;
        setTimeout(() => { botao.innerHTML = original; }, 1500);
      } catch {
        /* clipboard indisponivel (ex: contexto sem foco) - falha silenciosa, nao e critico */
      }
    },
    aoRegistrarSeguidores: async ({ data, seguidores }) => {
      const influenciador = estado.dados.influenciadores.find((i) => i.id === estado.abertoId);
      const preparo = prepararSnapshotSeguidores({ data, seguidores }, hojeISO());
      if (!preparo.ok) { estado.erro = preparo.mensagem; pintar(); return; }
      try {
        await service.registrarSeguidores({
          influenciadorId: influenciador.id, marca: influenciador.marca,
          data: preparo.valor.data, seguidores: preparo.valor.seguidores
        });
        await carregar();
      } catch (erro) {
        estado.erro = deps.safeErrorMessage(erro, "Não foi possível registrar os seguidores.");
        pintar();
      }
    }
  });
}

function marcasEditaveisPara(cargo) {
  if (cargo === "Admin" || cargo === "Gestor") return deps.marcas.filter((m) => m !== "Todas");
  return deps.state.perfil?.marca_vinculada ? [deps.state.perfil.marca_vinculada] : [];
}

function marcaPadrao() {
  if (deps.state.marca !== "Todas") return deps.state.marca;
  return marcasEditaveisPara(deps.state.perfil?.cargo)[0] ?? "Tesoura de Ouro";
}

function pintarModal() {
  const overlay = deps.state.contentEl.querySelector("#infModal");
  if (!overlay || !estado.modal) return;
  const html = estado.modal.tipo === "influenciador"
    ? influencerFormHtml(estado.modal, { marcasEditaveis: marcasEditaveisPara(deps.state.perfil?.cargo), podeExcluir: Boolean(estado.modal.id) })
    : midiaFormHtml(estado.modal);
  overlay.innerHTML = `<div class="modal-panel inf-modal-panel">${html}</div>`;
  overlay.hidden = false;
  ligarModal(overlay);
}

function fecharModal() {
  estado.modal = null;
  const overlay = deps.state.contentEl.querySelector("#infModal");
  if (overlay) { overlay.hidden = true; overlay.innerHTML = ""; }
}

function abrirModalInfluenciador(influenciador) {
  const grupo = influenciador
    ? agruparPorInfluenciador({ influenciadores: [influenciador], ...estado.dados }).get(influenciador.id)
    : { campanhas: [] };
  const avatarUrl = influenciador?.avatar_path ? estado.dados.avatares.get(influenciador.avatar_path) ?? null : null;
  estado.modal = { tipo: "influenciador", ...estadoInicialInfluenciador({ influenciador, campanhas: grupo.campanhas, marcaPadrao: marcaPadrao(), avatarUrl }) };
  pintarModal();
}

function abrirModalMidia(midia) {
  const influenciador = estado.dados.influenciadores.find((i) => i.id === (midia?.influenciador_id ?? estado.abertoId));
  const campanhas = agruparPorInfluenciador({ influenciadores: [influenciador], ...estado.dados }).get(influenciador.id).campanhas;
  estado.modal = { tipo: "midia", ...estadoInicialMidia({ midia, influenciador, campanhas, hoje: hojeISO() }) };
  pintarModal();
}

function ligarModal(overlay) {
  overlay.querySelectorAll("[data-fechar-modal]").forEach((b) => { b.onclick = fecharModal; });

  if (estado.modal.tipo === "influenciador") {
    overlay.querySelector("[data-adicionar-camp]")?.addEventListener("click", () => {
      estado.modal = lerInfluencerForm(overlay, estado.modal);
      estado.modal.campanhas.push(campanhaVazia(hojeISO()));
      pintarModal();
    });
    overlay.querySelectorAll("[data-remover-camp]").forEach((b) => {
      b.onclick = () => {
        estado.modal = lerInfluencerForm(overlay, estado.modal);
        const i = Number(b.dataset.removerCamp);
        const removida = estado.modal.campanhas.splice(i, 1)[0];
        if (removida.id) estado.modal.removidas.push(removida.id);
        pintarModal();
      };
    });
    overlay.querySelector("[data-excluir-influenciador]")?.addEventListener("click", () => {
      estado.modal.confirmandoExclusao = true;
      pintarModal();
    });
    overlay.querySelector("[data-cancelar-exclusao]")?.addEventListener("click", () => {
      estado.modal.confirmandoExclusao = false;
      pintarModal();
    });
    overlay.querySelector("[data-confirmar-exclusao]")?.addEventListener("click", async () => {
      try {
        await service.excluirInfluenciador(estado.modal.id);
        fecharModal();
        await carregar();
      } catch (erro) {
        estado.modal.erroGeral = deps.safeErrorMessage(erro, "Não foi possível excluir o influenciador.");
        estado.modal.confirmandoExclusao = false;
        pintarModal();
      }
    });
    const avatarInput = overlay.querySelector("#infFAvatar");
    if (avatarInput) avatarInput.onchange = () => {
      estado.modal = lerInfluencerForm(overlay, estado.modal);
      estado.modal.avatarFile = avatarInput.files[0] ?? null;
      pintarModal(); // repinta para exibir o nome do arquivo escolhido no botao customizado
    };

    overlay.querySelector("#infForm").onsubmit = async (evento) => {
      evento.preventDefault();
      estado.modal = lerInfluencerForm(overlay, estado.modal);
      const r = validarFormularioInfluenciador(estado.modal, marcasEditaveisPara(deps.state.perfil?.cargo));
      if (!r.ok) { estado.modal.erros = r.erros; pintarModal(); return; }
      estado.modal.erros = {};
      estado.modal.salvando = true;
      pintarModal();
      try {
        await service.salvarInfluenciador({
          id: estado.modal.id, valor: r.valor, campanhas: r.campanhas,
          removidas: estado.modal.removidas, avatar: estado.modal.avatarFile
        });
        fecharModal();
        await carregar();
      } catch (erro) {
        estado.modal.erroGeral = deps.safeErrorMessage(erro, "Não foi possível salvar o influenciador.");
        estado.modal.salvando = false;
        pintarModal();
      }
    };
    return;
  }

  overlay.querySelector("#infMForm").onsubmit = async (evento) => {
    evento.preventDefault();
    estado.modal = lerMidiaForm(overlay, estado.modal);
    const r = validarFormularioMidia(estado.modal);
    if (!r.ok) { estado.modal.erros = r.erros; pintarModal(); return; }
    estado.modal.erros = {};
    estado.modal.salvando = true;
    pintarModal();
    try {
      await service.salvarMidia({ id: estado.modal.id, influenciadorId: estado.modal.influenciadorId, marca: estado.modal.marca, valor: r.valor });
      fecharModal();
      await carregar();
    } catch (erro) {
      estado.modal.erroGeral = deps.safeErrorMessage(erro, "Não foi possível salvar a mídia.");
      estado.modal.salvando = false;
      pintarModal();
    }
  };
}

export async function renderInfluenciadores() {
  if (!estado) estado = novoEstado();
  if (!estado.carregado && !estado.carregando) await carregar();
  else pintar();
}
