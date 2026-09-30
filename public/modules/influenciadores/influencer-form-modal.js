import { escapeHtml } from "./html.js";
import { avatarHtml } from "./avatar.js";
import { REDES, STATUS, MARCAS_VALIDAS, validarInfluenciador, validarCampanha, validarAvatar } from "./validacao.js";

export function campanhaVazia(hoje) {
  return { id: null, nome: "", data_inicio: hoje, data_fim: "", cache_valor: "0", voucher_valor: "0" };
}

function textoBR(numero) {
  return String(numero ?? 0).replace(".", ",");
}

export function estadoInicialInfluenciador({ influenciador, campanhas = [], marcaPadrao, avatarUrl = null }) {
  return {
    id: influenciador?.id ?? null,
    marca: influenciador?.marca ?? marcaPadrao,
    nome: influenciador?.nome ?? "",
    handle: influenciador?.handle ?? "",
    rede_social: influenciador?.rede_social ?? "Instagram",
    verificado: influenciador?.verificado ?? false,
    nicho: influenciador?.nicho ?? "",
    cupom_codigo: influenciador?.cupom_codigo ?? "",
    cupom_exclusivo: influenciador?.cupom_exclusivo ?? false,
    status: influenciador?.status ?? "Ativo",
    avatarUrl,
    avatarFile: null,
    campanhas: campanhas.map((c) => ({
      id: c.id,
      nome: c.nome,
      data_inicio: c.data_inicio,
      data_fim: c.data_fim ?? "",
      cache_valor: textoBR(c.cache_valor),
      voucher_valor: textoBR(c.voucher_valor)
    })),
    removidas: [],
    erros: {},
    erroGeral: "",
    salvando: false,
    confirmandoExclusao: false
  };
}

const erroDe = (erros, campo) => (erros[campo] ? `<small class="inf-erro">${escapeHtml(erros[campo])}</small>` : "");
const opcoes = (lista, atual) => lista.map((o) => `<option value="${escapeHtml(o)}"${o === atual ? " selected" : ""}>${escapeHtml(o)}</option>`).join("");

function campanhaLinhaHtml(c, i, erros = {}) {
  return `<div class="inf-camp-linha" data-camp="${i}">
      <div class="inf-camp-cabecalho">
        <label class="inf-camp-nome">Campanha<input id="infFCampNome${i}" type="text" value="${escapeHtml(c.nome)}" maxlength="120" placeholder="Ex: Campanha dos Pais 2026" />${erroDe(erros, "nome")}</label>
        <button type="button" class="inf-icone escuro" data-remover-camp="${i}" title="Remover campanha"><span class="material-symbols-outlined">delete</span></button>
      </div>
      <div class="inf-camp-detalhes">
        <label>Início<input id="infFCampInicio${i}" type="date" value="${escapeHtml(c.data_inicio)}" />${erroDe(erros, "data_inicio")}</label>
        <label>Fim (opcional)<input id="infFCampFim${i}" type="date" value="${escapeHtml(c.data_fim)}" />${erroDe(erros, "data_fim")}</label>
        <label>Cachê (R$)<input id="infFCampCache${i}" type="text" inputmode="decimal" value="${escapeHtml(c.cache_valor)}" />${erroDe(erros, "cache_valor")}</label>
        <label>Voucher (R$)<input id="infFCampVoucher${i}" type="text" inputmode="decimal" value="${escapeHtml(c.voucher_valor)}" />${erroDe(erros, "voucher_valor")}</label>
      </div>
    </div>`;
}

export function influencerFormHtml(e, { marcasEditaveis, podeExcluir }) {
  const novo = !e.id;
  const marca = novo && marcasEditaveis.length > 1
    ? `<label>Bandeira<select id="infFMarca">${opcoes(marcasEditaveis, e.marca)}</select>${erroDe(e.erros, "marca")}</label>`
    : `<label>Bandeira<div class="inf-fixo">${escapeHtml(e.marca)}</div></label>`;
  const campanhas = e.erros.campanhas ?? {};
  const exclusao = !podeExcluir || novo
    ? ""
    : e.confirmandoExclusao
      ? `<span class="inf-confirma">Excluir também campanhas, mídias e histórico?</span><button type="button" class="danger" data-confirmar-exclusao>Confirmar exclusão</button><button type="button" class="secondary" data-cancelar-exclusao>Voltar</button>`
      : `<button type="button" class="danger" data-excluir-influenciador>Excluir influenciador</button>`;

  return `<div class="modal-header"><div><h3>${novo ? "Novo influenciador" : "Editar influenciador"}</h3>
      <p class="muted">${novo ? "Cadastre o criador e, se já houver, o acordo de cada campanha." : "Atualize os dados, acordos e campanhas."}</p></div>
      <button type="button" class="modal-close" data-fechar-modal aria-label="Fechar"><span class="material-symbols-outlined">close</span></button></div>
    <form id="infForm" class="modal-body" novalidate>
      <div class="inf-form-scroll">
        ${e.erroGeral ? `<div class="alert error">${escapeHtml(e.erroGeral)}</div>` : ""}
        <div class="inf-form-avatar">${avatarHtml({ nome: e.nome || "?", url: e.avatarUrl, tamanho: "lg" })}
          <div class="inf-avatar-campo">
            <span class="inf-avatar-rotulo">Foto (JPG, PNG ou WebP, até 1 MB)</span>
            <div class="inf-avatar-linha">
              <label for="infFAvatar" class="inf-btn-arquivo">Escolher imagem</label>
              <span class="inf-arquivo-nome">${e.avatarFile ? escapeHtml(e.avatarFile.name) : "Nenhuma imagem selecionada"}</span>
            </div>
            <input id="infFAvatar" type="file" accept="image/jpeg,image/png,image/webp" class="inf-input-oculto" />
            ${erroDe(e.erros, "avatar")}
          </div>
        </div>
        <div class="inf-form-grid">
          <label>Nome<input id="infFNome" type="text" value="${escapeHtml(e.nome)}" maxlength="120" />${erroDe(e.erros, "nome")}</label>
          <label>@ do perfil<input id="infFHandle" type="text" value="${escapeHtml(e.handle)}" maxlength="51" placeholder="@usuario" />${erroDe(e.erros, "handle")}</label>
          <label>Rede social<select id="infFRede">${opcoes(REDES, e.rede_social)}</select>${erroDe(e.erros, "rede_social")}</label>
          ${marca}
          <label>Nicho (opcional)<input id="infFNicho" type="text" value="${escapeHtml(e.nicho)}" maxlength="60" placeholder="Ex: Moda &amp; Varejo" />${erroDe(e.erros, "nicho")}</label>
          <label>Status<select id="infFStatus">${opcoes(STATUS, e.status)}</select>${erroDe(e.erros, "status")}</label>
          <label>Cupom (opcional)<input id="infFCupom" type="text" value="${escapeHtml(e.cupom_codigo)}" maxlength="30" placeholder="TESOURA10" />${erroDe(e.erros, "cupom_codigo")}</label>
          <div class="inf-form-checks">
            <label class="inf-check"><input id="infFVerificado" type="checkbox"${e.verificado ? " checked" : ""} /> Perfil verificado</label>
            <label class="inf-check"><input id="infFCupomExclusivo" type="checkbox"${e.cupom_exclusivo ? " checked" : ""} /> Cupom exclusivo</label>
          </div>
        </div>
        <div class="inf-form-campanhas"><div class="inf-form-campanhas-topo"><strong>Campanhas e acordos</strong>
          <button type="button" class="secondary" data-adicionar-camp><span class="material-symbols-outlined" style="font-size:16px">add</span> Adicionar campanha</button></div>
          ${e.campanhas.length === 0 ? `<p class="muted">Nenhuma campanha. Adicione uma para registrar cachê e voucher.</p>` : e.campanhas.map((c, i) => campanhaLinhaHtml(c, i, campanhas[i])).join("")}
        </div>
      </div>
      <div class="inf-form-rodape"><div class="inf-form-exclusao">${exclusao}</div>
        <div class="inf-form-botoes"><button type="button" class="secondary" data-fechar-modal>Cancelar</button>
        <button type="submit"${e.salvando ? " disabled" : ""}>${e.salvando ? "Salvando…" : "Salvar"}</button></div></div>
    </form>`;
}

// Le o DOM do modal para o estado (preserva id, removidas, foto e URL do avatar).
export function lerInfluencerForm(raiz, estado) {
  const valor = (id) => raiz.querySelector(`#${id}`)?.value ?? "";
  const marcado = (id) => Boolean(raiz.querySelector(`#${id}`)?.checked);
  return {
    ...estado,
    marca: raiz.querySelector("#infFMarca")?.value ?? estado.marca,
    nome: valor("infFNome"),
    handle: valor("infFHandle"),
    rede_social: valor("infFRede"),
    nicho: valor("infFNicho"),
    status: valor("infFStatus"),
    cupom_codigo: valor("infFCupom"),
    verificado: marcado("infFVerificado"),
    cupom_exclusivo: marcado("infFCupomExclusivo"),
    campanhas: estado.campanhas.map((c, i) => ({
      ...c,
      nome: valor(`infFCampNome${i}`),
      data_inicio: valor(`infFCampInicio${i}`),
      data_fim: valor(`infFCampFim${i}`),
      cache_valor: valor(`infFCampCache${i}`),
      voucher_valor: valor(`infFCampVoucher${i}`)
    }))
  };
}

export function validarFormularioInfluenciador(estado, marcasValidas = MARCAS_VALIDAS) {
  const base = validarInfluenciador(estado, marcasValidas);
  const erros = { ...base.erros };

  const errosCampanhas = {};
  const campanhas = estado.campanhas.map((c, i) => {
    const r = validarCampanha(c);
    if (!r.ok) errosCampanhas[i] = r.erros;
    return { id: c.id, valor: r.valor };
  });
  if (Object.keys(errosCampanhas).length > 0) erros.campanhas = errosCampanhas;

  if (estado.avatarFile) {
    const avatar = validarAvatar(estado.avatarFile);
    if (!avatar.ok) erros.avatar = avatar.erro;
  }
  return { ok: Object.keys(erros).length === 0, erros, valor: base.valor, campanhas };
}
