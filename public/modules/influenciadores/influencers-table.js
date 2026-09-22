import { escapeHtml } from "./html.js";
import { avatarHtml } from "./avatar.js";
import { crescimentoBadgeHtml } from "./growth-chart.js";
import { formatBRL, formatInt, pluralCampanhas } from "./calculos.js";

const CLASSE_REDE = { Instagram: "ig", TikTok: "tt", YouTube: "yt" };

function redeHtml(rede) {
  return `<span class="inf-rede ${CLASSE_REDE[rede] ?? "ig"}">${escapeHtml(rede)}</span>`;
}

function linhaHtml({ influenciador: i, agregado: a, avatarUrl }, { abertoId, selecionados }) {
  const aberta = i.id === abertoId;
  const id = escapeHtml(i.id);
  return `<tr class="inf-linha${aberta ? " aberta" : ""}" data-id="${id}">
    <td class="inf-col-check"><input type="checkbox" data-check="${id}" ${selecionados.has(i.id) ? "checked" : ""} aria-label="Selecionar ${escapeHtml(i.nome)}" /></td>
    <td><div class="inf-criador">${avatarHtml({ nome: i.nome, url: avatarUrl, tamanho: "md", destaque: aberta })}<div>
      <div class="inf-criador-nome">${escapeHtml(i.nome)}${i.verificado ? `<span class="material-symbols-outlined inf-verificado">verified</span>` : ""}${redeHtml(i.rede_social)}</div>
      <div class="inf-criador-handle">${escapeHtml(i.handle)}</div></div></div></td>
    <td class="inf-num">${formatInt(a.seguidores)}</td>
    <td>${crescimentoBadgeHtml(a.crescimentoPct)}</td>
    <td><span class="inf-chip-campanhas">${pluralCampanhas(a.campanhasAtivas)}</span></td>
    <td class="inf-num forte">${formatBRL(a.investimentoTotal)}</td>
    <td class="inf-num azul">${formatInt(a.alcanceTotal)}</td>
    <td class="inf-col-acoes"><button type="button" class="inf-btn-detalhes${aberta ? " primario" : ""}" data-detalhes="${id}">Ver Detalhes<span class="material-symbols-outlined">chevron_right</span></button></td>
  </tr>`;
}

function paginacaoHtml(pagina, totalPaginas) {
  const janela = 5;
  let inicio = Math.max(1, pagina - 2);
  const fim = Math.min(totalPaginas, inicio + janela - 1);
  inicio = Math.max(1, fim - janela + 1);
  const numeros = [];
  for (let n = inicio; n <= fim; n += 1) {
    numeros.push(`<button type="button"${n === pagina ? ' class="ativa"' : ""} data-pagina="${n}">${n}</button>`);
  }
  const anterior = pagina > 1
    ? `<button type="button" data-pagina="${pagina - 1}">Anterior</button>`
    : `<button type="button" disabled>Anterior</button>`;
  const proximo = pagina < totalPaginas
    ? `<button type="button" data-pagina="${pagina + 1}">Próximo</button>`
    : `<button type="button" disabled>Próximo</button>`;
  return `<div class="inf-paginacao">${anterior}${numeros.join("")}${proximo}</div>`;
}

export function influencersTableHtml(m) {
  const { linhas, cadastrados, total, pagina, totalPaginas, busca, abertoId, selecionados, podeEditar } = m;
  const todosMarcados = linhas.length > 0 && linhas.every((l) => selecionados.has(l.influenciador.id));
  const corpo = linhas.length > 0
    ? linhas.map((l) => linhaHtml(l, { abertoId, selecionados })).join("")
    : `<tr><td colspan="8" class="inf-vazio-linha">${cadastrados === 0
      ? "Nenhum influenciador cadastrado nesta bandeira."
      : "Nenhum resultado para a busca."}</td></tr>`;
  return `<div class="inf-tabela-topo">
      <div><div class="inf-tabela-titulo"><h3>Influenciadores Ativos</h3><span class="inf-badge-contagem">${cadastrados} cadastrados</span></div>
      <p class="muted">Gestão de criadores, métricas de crescimento e acompanhamento de entregas</p></div>
      <div class="inf-tabela-ferramentas">
        <div class="inf-busca"><span class="material-symbols-outlined">search</span><input id="infBusca" type="text" value="${escapeHtml(busca)}" placeholder="Buscar por nome, @ ou tag" autocomplete="off" /></div>
        ${podeEditar ? `<button type="button" id="infNovo" class="inf-btn-primario"><span class="material-symbols-outlined">person_add</span><span>Novo Influenciador</span></button>` : ""}
      </div>
    </div>
    <div class="table-wrap"><table class="inf-table"><thead><tr>
      <th class="inf-col-check"><input id="infMarcarTodos" type="checkbox" ${todosMarcados ? "checked" : ""} aria-label="Selecionar todos da página" /></th>
      <th>Criador</th><th>Seguidores</th><th>Crescimento Semanal</th><th>Campanhas Ativas</th><th>Investimento Total</th><th>Alcance</th><th class="inf-col-acoes">Ações</th>
    </tr></thead><tbody>${corpo}</tbody></table></div>
    <div class="inf-tabela-rodape"><div>Mostrando <strong>${linhas.length}</strong> de <strong>${total}</strong> criadores contratados</div>${paginacaoHtml(pagina, totalPaginas)}</div>`;
}

export function bindInfluencersTable(raiz, cb) {
  const busca = raiz.querySelector("#infBusca");
  if (busca) busca.oninput = () => cb.aoBuscar(busca.value);

  raiz.querySelectorAll("tr[data-id]").forEach((tr) => {
    tr.onclick = () => cb.aoSelecionar(tr.dataset.id);
  });
  raiz.querySelectorAll("[data-check]").forEach((caixa) => {
    caixa.onclick = (evento) => evento.stopPropagation();
    caixa.onchange = () => cb.aoMarcar(caixa.dataset.check, caixa.checked);
  });
  const todos = raiz.querySelector("#infMarcarTodos");
  if (todos) todos.onchange = () => cb.aoMarcarTodos(todos.checked);

  raiz.querySelectorAll("[data-detalhes]").forEach((botao) => {
    botao.onclick = (evento) => {
      evento.stopPropagation();
      cb.aoSelecionar(botao.dataset.detalhes);
    };
  });
  raiz.querySelectorAll("[data-pagina]").forEach((botao) => {
    botao.onclick = () => cb.aoPaginar(Number(botao.dataset.pagina));
  });
  const novo = raiz.querySelector("#infNovo");
  if (novo) novo.onclick = () => cb.aoNovo();
}
