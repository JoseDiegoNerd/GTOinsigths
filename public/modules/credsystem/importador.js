// Importador inteligente (6 etapas): Selecionar -> Identificacao -> Mapeamento -> Validacao ->
// Confirmacao -> Resultado. Suporta varios arquivos; cada arquivo vira um lote independente
// (importacao_lotes) com hash, contadores e erros por linha. Toda gravacao passa pelas RPCs do
// servidor, que revalidam marca/permissao - a pre-visualizacao aqui nunca e a palavra final.

import { EXTENSOES_ACEITAS, LIMITES, MARCAS, TIPOS_ARQUIVO } from "./constantes.js";
import { lerPlanilha } from "./leitor-planilha.js";
import { assinaturaCabecalho, detectarTipo, mapearAutomatico, marcasPorAba, requisitosAtendidos, separarAbasDeDados } from "./detector.js";
import { prepararImportacao } from "./transformacao.js";
import { sha256Hex } from "./normalizacao.js";
import { criarService } from "./service.js";
import { esc } from "./graficos.js";
import { fmtData, fmtInt } from "./metricas.js";
import { baixarArquivo, gerarCsv } from "./exportacao.js";

const ETAPAS = ["Selecionar arquivo", "Identificação", "Mapeamento", "Validação", "Confirmação", "Resultado"];
const ABA_DESTINO = { credsystem_crm_campanhas: "crm", credsystem_propostas: "funil", credsystem_emissoes: "funil", credsystem_transacoes: "retencao" };

let deps = null;
let service = null;
let imp = null;
let cacheBins = null;
let cacheLojas = null;
let containerSel = null;
let painelBins = { aberto: false, lista: null, msg: "", erro: false };

export function initImportador(dependencias) {
  deps = dependencias;
  service = criarService(deps.supabase);
  painelBins = { aberto: false, lista: null, msg: "", erro: false };
  cacheBins = null;
  cacheLojas = null;
  if (!imp) reset();
}

function reset() {
  imp = { etapa: 1, arquivos: [], atual: 0, processando: false, erro: "" };
}

const arquivoAtual = () => imp.arquivos[imp.atual] || null;

// ---- leitura e analise --------------------------------------------------------------------------
async function referencias() {
  if (!cacheBins) cacheBins = await service.mapaBins();
  if (!cacheLojas) cacheLojas = await service.mapaLojas();
  return { mapaBins: cacheBins, mapaLojas: cacheLojas };
}

function preparar(arq) {
  if (!arq.tipo) { arq.prep = null; return; }
  arq.prep = prepararImportacao(arq.tipo, arq.leitura, arq.mapa, {
    mapaBins: cacheBins, mapaLojas: cacheLojas, marcasAba: marcasPorAba(arq.leitura),
    marcaSelecionada: arq.marcaSelecionada || null, nomeArquivo: arq.nome
  });
}

async function aplicarModeloSalvo(arq) {
  try {
    const assinatura = assinaturaCabecalho(arq.deteccao.cabecalhos);
    const modelos = await service.modelosColunas(null);
    const modelo = modelos.find((m) => m.assinatura_cabecalho === assinatura);
    if (modelo) {
      arq.tipo = modelo.tipo_arquivo;
      arq.mapa = { ...modelo.mapeamento };
      arq.modeloAplicado = modelo.nome;
      return true;
    }
  } catch { /* sem modelos: segue com o automatico */ }
  return false;
}

async function analisarArquivo(arq, file) {
  try {
    const nome = file.name.toLowerCase();
    if (!EXTENSOES_ACEITAS.some((e) => nome.endsWith(e))) throw new Error(`Formato não suportado. Envie ${EXTENSOES_ACEITAS.join(", ")}.`);
    if (file.size > LIMITES.tamanhoArquivoBytes) throw new Error(`Arquivo maior que ${LIMITES.tamanhoArquivoBytes / 1024 / 1024} MB.`);
    const buffer = await file.arrayBuffer();
    arq.hash = await sha256Hex(buffer);
    const XLSX = nome.endsWith(".csv") ? null : await deps.carregarXLSX();
    const separacao = separarAbasDeDados(lerPlanilha({ nomeArquivo: file.name, buffer, XLSX }));
    arq.leitura = separacao.leitura;
    arq.abasIgnoradas = separacao.ignoradas;
    arq.deteccao = detectarTipo(arq.leitura);
    await referencias();
    const usouModelo = await aplicarModeloSalvo(arq);
    if (!usouModelo) {
      arq.tipo = arq.deteccao.tipo;
      arq.mapa = arq.tipo ? mapearAutomatico(arq.tipo, arq.deteccao.cabecalhos) : {};
    }
    arq.anteriores = await service.lotesPorHash(arq.hash);
    preparar(arq);
    arq.status = "pronto";
  } catch (error) {
    arq.status = "erro";
    arq.erro = deps.safeErrorMessage(error, "Não foi possível ler o arquivo.");
  }
}

async function selecionarArquivos(lista) {
  const files = [...(lista || [])];
  if (!files.length) return;
  imp.erro = "";
  const novos = files.map((f) => ({ id: crypto.randomUUID(), nome: f.name, tamanho: f.size, status: "lendo", tipo: null, mapa: {}, marcaSelecionada: "" }));
  imp.arquivos.push(...novos);
  pintar();
  for (let i = 0; i < novos.length; i++) {
    await analisarArquivo(novos[i], files[i]);
    pintar();
  }
}

// ---- etapas: html -------------------------------------------------------------------------------
function passosHtml() {
  return `<div class="wizard-steps cs-passos">${ETAPAS.map((e, i) => `${i ? `<span class="sep">›</span>` : ""}<span class="${imp.etapa === i + 1 ? "active" : imp.etapa > i + 1 ? "feito" : ""}">${i + 1}. ${esc(e)}</span>`).join("")}</div>`;
}

function seletorArquivoHtml() {
  if (imp.arquivos.length < 2) return "";
  return `<div class="pills cs-arquivos">${imp.arquivos.map((a, i) => `<button type="button" class="pill ${i === imp.atual ? "active" : ""}" data-cs-arquivo="${i}">${esc(a.nome)}</button>`).join("")}</div>`;
}

function etapa1Html() {
  const algumLendo = imp.arquivos.some((a) => a.status === "lendo");
  const prontos = imp.arquivos.filter((a) => a.status === "pronto");
  return `
    <div class="drop-zone" id="csDrop">
      <span class="material-symbols-outlined">upload_file</span>
      <strong>Arraste planilhas aqui ou clique para selecionar</strong>
      <p class="muted">XLSX, XLS ou CSV · vários arquivos de uma vez · até ${LIMITES.tamanhoArquivoBytes / 1024 / 1024} MB cada. O tipo de planilha e as bandeiras são identificados automaticamente.</p>
      <input id="csArquivos" type="file" accept="${EXTENSOES_ACEITAS.join(",")}" multiple />
    </div>
    ${imp.arquivos.length ? `<div class="table-wrap" style="margin-top:14px"><table class="cs-tabela"><thead><tr><th>Arquivo</th><th>Tamanho</th><th>Situação</th><th></th></tr></thead><tbody>
      ${imp.arquivos.map((a, i) => `<tr><td>${esc(a.nome)}</td><td>${(a.tamanho / 1024).toFixed(0)} KB</td><td>${a.status === "lendo" ? `<span class="cs-girando material-symbols-outlined">progress_activity</span> Lendo…` : a.status === "erro" ? `<span class="cs-erro">${esc(a.erro)}</span>` : `${esc(a.tipo ? TIPOS_ARQUIVO[a.tipo].curto : "Tipo a definir")} · ${fmtInt(a.prep?.resumo.linhasLidas ?? a.leitura?.abas.reduce((s, x) => s + x.linhas.length, 0))} linhas`}</td>
        <td><button type="button" class="secondary cs-mini" data-cs-remover="${i}" ${algumLendo ? "disabled" : ""}>Remover</button></td></tr>`).join("")}
    </tbody></table></div>` : ""}
    <div class="actions" style="justify-content:flex-end;margin-top:14px">
      <button type="button" id="csAvancar" ${!prontos.length || algumLendo ? "disabled" : ""}>Avançar →</button>
    </div>`;
}

function etapa2Html() {
  const a = arquivoAtual();
  const det = a.deteccao;
  const conf = { alta: "Alta", media: "Média — confirme o modelo", baixa: "Não identificado — escolha o modelo" }[det.confianca];
  const marcasAba = marcasPorAba(a.leitura);
  const semMarca = a.prep?.erros.some((e) => e.codigo === "MARCA_NAO_IDENTIFICADA");
  const r = a.prep?.resumo;
  return `${seletorArquivoHtml()}
    ${a.anteriores?.length ? `<div class="alert">Este mesmo conteúdo (hash idêntico) já foi importado em ${a.anteriores.map((x) => esc(new Date(x.iniciado_em).toLocaleString("pt-BR"))).join(", ")}. Reimportar não duplica registros: linhas iguais são ignoradas e linhas alteradas são atualizadas.</div>` : ""}
    ${a.modeloAplicado ? `<div class="alert success">Modelo de mapeamento salvo aplicado automaticamente: <b>${esc(a.modeloAplicado)}</b>.</div>` : ""}
    <div class="grid cs-duas">
      <div class="card cs-subcard">
        <h4>Tipo de planilha</h4>
        <p><span class="cs-badge cs-badge-${det.confianca}">${esc(conf)}</span></p>
        <label>Modelo<select id="csTipo"><option value="">— escolha o modelo —</option>${Object.entries(TIPOS_ARQUIVO).map(([k, t]) => `<option value="${k}" ${a.tipo === k ? "selected" : ""}>${esc(t.rotulo)}</option>`).join("")}</select></label>
        ${det.confianca !== "alta" ? `<p class="muted">Não classificamos por suposição: confirme o modelo correto. Sugestão pelas colunas: ${esc(TIPOS_ARQUIVO[det.tipoSugerido].curto)}.</p>` : ""}
      </div>
      <div class="card cs-subcard">
        <h4>Resumo</h4>
        ${r ? `<ul class="cs-lista-dados">
          <li><span>Registros úteis</span><b>${fmtInt(r.linhasLidas)}</b></li>
          <li><span>Linhas vazias ignoradas</span><b>${fmtInt(r.linhasVazias)}</b></li>
          <li><span>Intervalo de datas</span><b>${r.periodo.inicio ? `${esc(fmtData(r.periodo.inicio))} a ${esc(fmtData(r.periodo.fim))}` : "—"}</b></li>
          <li><span>Bandeiras identificadas</span><b>${Object.entries(r.marcas).map(([m, n]) => `${esc(m)} (${fmtInt(n)})`).join(" · ") || "—"}</b></li>
        </ul>` : `<p class="muted">Escolha o modelo para ver o resumo.</p>`}
      </div>
    </div>
    <div class="card cs-subcard" style="margin-top:14px"><h4>Abas encontradas</h4>
      <div class="table-wrap"><table class="cs-tabela"><thead><tr><th>Aba</th><th>Linhas</th><th>Cabeçalho na linha</th><th>Bandeira pelo nome da aba</th></tr></thead><tbody>
        ${a.leitura.abas.map((x) => `<tr><td>${esc(x.nome)}</td><td>${fmtInt(x.linhas.length)}</td><td>${x.linhaCabecalho || "—"}</td><td>${marcasAba[x.nome] ? esc(marcasAba[x.nome]) : `<span class="muted">não identificada</span>`}</td></tr>`).join("")}
      </tbody></table></div>
      ${a.abasIgnoradas?.length ? `<p class="muted" style="margin-top:10px"><b>Abas ignoradas</b> (não entram na importação):</p>
      <div class="table-wrap"><table class="cs-tabela"><thead><tr><th>Aba</th><th>Linhas</th><th>Motivo</th></tr></thead><tbody>
        ${a.abasIgnoradas.map((x) => `<tr><td>${esc(x.nome)}</td><td>${fmtInt(x.linhas)}</td><td>${esc(x.motivo)}</td></tr>`).join("")}
      </tbody></table></div>` : ""}
      <p class="muted">Prioridade de identificação da marca: BIN validado → código de loja cadastrado → nome da aba/coluna de marca. Divergências bloqueiam a linha para revisão. A marca é revalidada no servidor.</p>
      ${semMarca || a.marcaSelecionada ? `<label style="max-width:360px">Bandeira das linhas sem identificação<select id="csMarcaSel"><option value="">— não atribuir —</option>${MARCAS.map((m) => `<option ${a.marcaSelecionada === m ? "selected" : ""}>${esc(m)}</option>`).join("")}</select></label>
      <p class="muted">Usada somente quando a linha não traz BIN, loja cadastrada, aba ou coluna de marca. Seu acesso à marca é conferido pelo banco.</p>` : ""}
    </div>
    <div class="actions" style="justify-content:space-between;margin-top:14px">
      <button type="button" class="secondary" id="csVoltar">← Voltar</button>
      <button type="button" id="csAvancar" ${a.tipo ? "" : "disabled"}>Avançar →</button>
    </div>`;
}

function etapa3Html() {
  const a = arquivoAtual();
  const def = TIPOS_ARQUIVO[a.tipo];
  const req = requisitosAtendidos(a.tipo, a.mapa);
  const usados = new Set(Object.values(a.mapa));
  const naoReconhecidas = a.deteccao.cabecalhos.filter((c) => !usados.has(c));
  const obrigatorios = new Set(def.requisitos.flat());
  const rotuloOriginal = (k) => {
    for (const aba of a.leitura.abas) { const i = aba.cabecalho.indexOf(k); if (i >= 0) return aba.cabecalhoOriginal[i] || k; }
    return k;
  };
  return `${seletorArquivoHtml()}
    <p class="muted"><b>${esc(a.nome)}</b> · ${esc(def.rotulo)}</p>
    ${req.ok ? `<div class="alert success">Todos os campos obrigatórios estão mapeados.</div>` : `<div class="alert error">Campos obrigatórios ausentes: ${req.faltando.map(esc).join("; ")}.</div>`}
    <div class="table-wrap"><table class="cs-tabela"><thead><tr><th>Campo de destino</th><th>Coluna da planilha</th><th></th></tr></thead><tbody>
      ${def.campos.map((c) => `<tr><td>${esc(c.rotulo)} <code>${esc(c.campo)}</code>${obrigatorios.has(c.campo) ? ` <span class="cs-obrig" title="Obrigatório (ou alternativo)">*</span>` : ""}${c.sensivel ? ` <span class="cs-sensivel" title="Não é armazenado em texto: o servidor gera um pseudônimo">pseudonimizado</span>` : ""}</td>
        <td><select data-cs-mapa="${esc(c.campo)}"><option value="">— não mapeado —</option>${a.deteccao.cabecalhos.map((h) => `<option value="${esc(h)}" ${a.mapa[c.campo] === h ? "selected" : ""}>${esc(rotuloOriginal(h))}</option>`).join("")}</select></td>
        <td>${a.mapa[c.campo] ? `<span class="material-symbols-outlined cs-ok">check_circle</span>` : ""}</td></tr>`).join("")}
    </tbody></table></div>
    <p class="muted" style="margin-top:10px"><b>Colunas reconhecidas:</b> ${fmtInt(usados.size)} · <b>Não reconhecidas</b> (preservadas nos metadados quando aplicável): ${naoReconhecidas.length ? naoReconhecidas.map((c) => esc(rotuloOriginal(c))).join(", ") : "nenhuma"}</p>
    <div class="cs-salvar-modelo"><input type="text" id="csNomeModelo" placeholder="Nome do modelo (ex.: CredSystem propostas diário)" value="${esc(a.nomeModelo || "")}" maxlength="120"><button type="button" class="secondary" id="csSalvarModelo">Salvar modelo de mapeamento</button></div>
    ${a.msgModelo ? `<p class="muted">${esc(a.msgModelo)}</p>` : ""}
    <div class="actions" style="justify-content:space-between;margin-top:14px">
      <button type="button" class="secondary" id="csVoltar">← Voltar</button>
      <button type="button" id="csAvancar" ${req.ok ? "" : "disabled"}>Avançar →</button>
    </div>`;
}

function tabelaErrosHtml(erros, vazio) {
  if (!erros.length) return `<p class="muted">${esc(vazio)}</p>`;
  return `<div class="table-wrap cs-tabela-alta"><table class="cs-tabela"><thead><tr><th>Aba</th><th>Linha</th><th>Campo</th><th>Código</th><th>Mensagem</th><th>Valor</th></tr></thead><tbody>
    ${erros.slice(0, 300).map((e) => `<tr><td>${esc(e.aba || "")}</td><td>${e.linha ?? ""}</td><td>${esc(e.campo || "")}</td><td><code>${esc(e.codigo)}</code></td><td>${esc(e.mensagem)}</td><td>${esc(e.valor_original ?? "")}</td></tr>`).join("")}
  </tbody></table></div>${erros.length > 300 ? `<p class="muted">Mostrando 300 de ${fmtInt(erros.length)}. Baixe a lista completa.</p>` : ""}`;
}

function etapa4Html() {
  const a = arquivoAtual();
  const r = a.prep.resumo;
  const cards = [
    ["Registros válidos", r.validas, "check_circle", "ok"], ["Registros inválidos", r.invalidas, "error", r.invalidas ? "erro" : ""],
    ["Duplicadas no arquivo", r.duplicadasIdenticas + r.duplicadasDivergentes, "content_copy", r.duplicadasDivergentes ? "erro" : ""],
    ["Divergências de marca", r.conflitosMarca, "rule", r.conflitosMarca ? "erro" : ""], ["Inconsistências (alertas)", r.inconsistencias, "warning", r.inconsistencias ? "alerta" : ""]
  ];
  return `${seletorArquivoHtml()}
    <div class="grid cs-kpis-5">${cards.map(([rot, v, ic, cls]) => `<article class="card kpi cs-val ${cls}"><div class="kpi-top"><span>${esc(rot)}</span><span class="material-symbols-outlined">${ic}</span></div><strong>${fmtInt(v)}</strong></article>`).join("")}</div>
    ${r.duplicadasIdenticas ? `<p class="muted">${fmtInt(r.duplicadasIdenticas)} linha(s) idêntica(s) dentro do arquivo serão ignoradas. A comparação com o banco acontece no servidor ao confirmar.</p>` : ""}
    <section class="card cs-subcard"><div class="cs-secao-topo"><h4>Erros (linhas que não serão importadas)</h4>${a.prep.erros.length + a.prep.alertas.length ? `<button type="button" class="secondary cs-mini" id="csBaixarErros">Baixar erros e alertas (CSV)</button>` : ""}</div>${tabelaErrosHtml(a.prep.erros, "Nenhum erro encontrado.")}</section>
    <section class="card cs-subcard"><h4>Alertas (linhas importadas com observação)</h4>${tabelaErrosHtml(a.prep.alertas, "Nenhum alerta.")}</section>
    <div class="actions" style="justify-content:space-between;margin-top:14px">
      <button type="button" class="secondary" id="csVoltar">← Voltar</button>
      <button type="button" id="csAvancar" ${r.validas ? "" : "disabled"}>Avançar →</button>
    </div>`;
}

function etapa5Html() {
  const prontos = imp.arquivos.filter((a) => a.status === "pronto" && a.tipo && a.prep);
  return `<p class="muted">Confira o resumo. Cada arquivo vira um lote registrado com hash, responsável, marcas, período e contadores. A gravação é idempotente: reimportar não duplica nem infla indicadores.</p>
    <div class="table-wrap"><table class="cs-tabela"><thead><tr><th>Arquivo</th><th>Tipo</th><th>Bandeiras</th><th>Período</th><th>Válidas</th><th>Rejeitadas no arquivo</th><th>Já importado?</th></tr></thead><tbody>
      ${prontos.map((a) => `<tr><td>${esc(a.nome)}</td><td>${esc(TIPOS_ARQUIVO[a.tipo].curto)}</td><td>${Object.keys(a.prep.resumo.marcas).map(esc).join(", ") || "—"}</td><td>${a.prep.resumo.periodo.inicio ? `${esc(fmtData(a.prep.resumo.periodo.inicio))} a ${esc(fmtData(a.prep.resumo.periodo.fim))}` : "—"}</td><td>${fmtInt(a.prep.resumo.validas)}</td><td>${fmtInt(a.prep.resumo.invalidas)}</td><td>${a.anteriores?.length ? "Sim (sem duplicar)" : "Não"}</td></tr>`).join("")}
    </tbody></table></div>
    ${imp.processando ? `<div class="alert">${esc(imp.progresso || "Importando…")}</div>` : ""}
    ${imp.erro ? `<div class="alert error">${esc(imp.erro)}</div>` : ""}
    <div class="actions" style="justify-content:space-between;margin-top:14px">
      <div class="actions"><button type="button" class="secondary" id="csVoltar" ${imp.processando ? "disabled" : ""}>← Voltar</button><button type="button" class="secondary" id="csCancelar" ${imp.processando ? "disabled" : ""}>Cancelar</button></div>
      <button type="button" id="csConfirmar" ${imp.processando || !prontos.length ? "disabled" : ""}>${imp.processando ? "Importando…" : `Confirmar importação (${prontos.length} arquivo${prontos.length > 1 ? "s" : ""})`}</button>
    </div>`;
}

function etapa6Html() {
  const feitos = imp.arquivos.filter((a) => a.resultado);
  return `<div class="table-wrap"><table class="cs-tabela"><thead><tr><th>Arquivo</th><th>Status</th><th>Importadas</th><th>Atualizadas</th><th>Ignoradas</th><th>Rejeitadas</th><th></th></tr></thead><tbody>
      ${feitos.map((a, i) => { const r = a.resultado; return `<tr><td>${esc(a.nome)}</td><td><span class="cs-badge cs-status-${esc(r.status)}">${esc({ concluido: "Concluído", concluido_com_erros: "Concluído com erros", falhou: "Falhou", cancelado: "Interrompido" }[r.status] || r.status)}</span></td>
        <td>${fmtInt(r.linhas_importadas)}</td><td>${fmtInt(r.linhas_atualizadas)}</td><td>${fmtInt(r.linhas_ignoradas)}</td><td>${fmtInt(r.linhas_rejeitadas)}</td>
        <td><button type="button" class="secondary cs-mini" data-cs-ver="${i}">Ver no módulo</button></td></tr>`; }).join("")}
    </tbody></table></div>
    <p class="muted">Ignoradas = já existiam idênticas no banco (reimportação) ou eram duplicadas idênticas dentro do arquivo. Os indicadores do Cartão Próprio foram atualizados.</p>
    ${feitos.map((a) => a.errosServidor?.length || a.erroGravacao ? `<section class="card cs-subcard"><h4>${esc(a.nome)} · detalhamento</h4>${a.erroGravacao ? `<div class="alert error">${esc(a.erroGravacao)}</div>` : ""}${tabelaErrosHtml(a.errosServidor || [], "Sem erros registrados.")}</section>` : "").join("")}
    <div class="actions" style="justify-content:flex-end;margin-top:14px"><button type="button" id="csNovo">Nova importação</button></div>`;
}

// ---- confirmacao ---------------------------------------------------------------------------------
async function confirmar() {
  const prontos = imp.arquivos.filter((a) => a.status === "pronto" && a.tipo && a.prep);
  imp.processando = true;
  imp.erro = "";
  pintar();
  for (const a of prontos) {
    const def = TIPOS_ARQUIVO[a.tipo];
    let loteId = null;
    try {
      imp.progresso = `${a.nome}: registrando lote…`; pintar();
      const ini = await service.iniciarLote({
        tipo: a.tipo, nomeArquivo: a.nome, hash: a.hash,
        metadados: { origem: "importador_inteligente", versao: 1, abas: a.leitura.abas.map((x) => x.nome), mapeamento: a.mapa, modelo: a.modeloAplicado || null, resumo_cliente: { ...a.prep.resumo, abas: undefined } }
      });
      loteId = ini.lote_id;
      const errosCliente = [...a.prep.erros, ...a.prep.alertas];
      if (errosCliente.length || a.prep.resumo.duplicadasIdenticas) await service.registrarErros(loteId, errosCliente, a.prep.resumo.duplicadasIdenticas);
      await service.gravarLinhas(def.rpc, loteId, a.prep.registros, ({ enviadas, total }) => {
        imp.progresso = `${a.nome}: ${fmtInt(enviadas)} de ${fmtInt(total)} linhas processadas…`;
        pintar();
      });
      a.resultado = await service.finalizarLote(loteId, { linhasLidas: a.prep.resumo.linhasLidas, abas: a.leitura.abas.map((x) => x.nome) });
    } catch (error) {
      a.erroGravacao = `A importação foi interrompida: ${deps.safeErrorMessage(error)} Os lotes já gravados são preservados; reimporte o arquivo para completar (não duplica).`;
      if (loteId) {
        try { a.resultado = await service.finalizarLote(loteId, { linhasLidas: a.prep.resumo.linhasLidas, abas: a.leitura.abas.map((x) => x.nome), cancelado: true }); } catch { /* segue */ }
      }
      a.resultado ||= { status: "falhou", linhas_importadas: 0, linhas_atualizadas: 0, linhas_ignoradas: 0, linhas_rejeitadas: 0 };
    }
    if (loteId) { try { a.errosServidor = await service.errosDoLote(loteId); } catch { a.errosServidor = []; } }
  }
  imp.processando = false;
  imp.progresso = "";
  deps.aposImportacao?.();
  imp.etapa = 6;
  pintar();
}

// ---- configuracao de BINs (Admin) ---------------------------------------------------------------
function painelBinsHtml() {
  const p = painelBins;
  return `<details class="cs-subcard card" id="csBins" ${p.aberto ? "open" : ""}>
    <summary><b>Configuração de BINs</b> <span class="muted">· NR_BIN → bandeira usada na identificação automática (validada no servidor)</span></summary>
    <div style="margin-top:12px;display:grid;gap:12px">
      ${p.lista === null ? `<p class="muted">Carregando…</p>` : `<div class="table-wrap"><table class="cs-tabela"><thead><tr><th>BIN</th><th>Bandeira</th><th>Ativo</th><th>Observação</th></tr></thead><tbody>
        ${p.lista.map((b) => `<tr><td><code>${esc(b.bin)}</code></td><td>${esc(b.marca)}</td><td>${b.ativo ? "Sim" : "Não"}</td><td>${esc(b.observacao || "")}</td></tr>`).join("")}
      </tbody></table></div>`}
      <div class="cs-salvar-modelo">
        <input type="text" id="csBinNovo" inputmode="numeric" maxlength="8" placeholder="BIN (6 a 8 dígitos)" style="max-width:180px">
        <select id="csBinMarca">${MARCAS.map((m) => `<option>${esc(m)}</option>`).join("")}</select>
        <label style="display:flex;align-items:center;gap:6px;text-transform:none;font-weight:600"><input type="checkbox" id="csBinAtivo" checked> Ativo</label>
        <input type="text" id="csBinObs" placeholder="Observação (opcional)" maxlength="200">
        <button type="button" class="secondary" id="csBinSalvar">Adicionar / atualizar</button>
      </div>
      ${p.msg ? `<div class="alert ${p.erro ? "error" : "success"}">${esc(p.msg)}</div>` : ""}
      <p class="muted">Alterar o BIN de uma marca afeta as próximas importações; registros já gravados mantêm a marca validada na época.</p>
    </div>
  </details>`;
}

async function carregarBins() {
  try { painelBins.lista = await service.listarBins(); } catch (error) { painelBins.lista = []; painelBins.msg = deps.safeErrorMessage(error); painelBins.erro = true; }
  pintar();
}

function ligarPainelBins(el) {
  const det = el.querySelector("#csBins");
  if (!det) return;
  det.ontoggle = () => {
    painelBins.aberto = det.open;
    if (det.open && painelBins.lista === null) carregarBins();
  };
  const salvar = el.querySelector("#csBinSalvar");
  if (salvar) salvar.onclick = async () => {
    const bin = el.querySelector("#csBinNovo").value.replace(/D/g, "");
    if (bin.length < 6 || bin.length > 8) { painelBins.msg = "Informe um BIN com 6 a 8 dígitos."; painelBins.erro = true; pintar(); return; }
    try {
      await service.salvarBin({ bin, marca: el.querySelector("#csBinMarca").value, ativo: el.querySelector("#csBinAtivo").checked, observacao: el.querySelector("#csBinObs").value.trim() });
      painelBins.msg = `BIN ${bin} salvo.`; painelBins.erro = false;
      cacheBins = null;
      await carregarBins();
    } catch (error) {
      painelBins.msg = deps.safeErrorMessage(error, "Não foi possível salvar o BIN (apenas Admin)."); painelBins.erro = true; pintar();
    }
  };
}

// ---- pintura / eventos --------------------------------------------------------------------------
export function importadorHtml() {
  const corpo = [etapa1Html, etapa2Html, etapa3Html, etapa4Html, etapa5Html, etapa6Html][imp.etapa - 1]();
  return `<section class="card cs-importador">
    <div class="cs-secao-topo"><div><div class="eyebrow">Importação inteligente</div><h3 style="margin:4px 0 0">Cartão Próprio CredSystem</h3>
      <p class="muted">Campanhas CRM, operação de cartões (propostas/emissões) e compras. Detecta tipo, bandeiras e período; valida antes de gravar.</p></div></div>
    ${passosHtml()}
    <div class="cs-etapa">${corpo}</div>
    ${deps.state.perfil?.cargo === "Admin" ? painelBinsHtml() : ""}
  </section>`;
}

export function montarImportador(container) {
  containerSel = container;
  pintar();
}

function pintar() {
  const el = typeof containerSel === "string" ? document.querySelector(containerSel) : containerSel;
  if (!el || !el.isConnected) return;
  el.innerHTML = importadorHtml();
  ligar(el);
  ligarPainelBins(el);
}

function irPara(etapa) {
  imp.etapa = etapa;
  if (etapa >= 2 && etapa <= 4) {
    const idx = imp.arquivos.findIndex((a) => a.status === "pronto");
    if (!arquivoAtual() || arquivoAtual().status !== "pronto") imp.atual = Math.max(0, idx);
  }
  pintar();
}

function ligar(el) {
  const q = (s) => el.querySelector(s);
  const a = arquivoAtual();
  el.querySelectorAll("[data-cs-arquivo]").forEach((b) => { b.onclick = () => { imp.atual = Number(b.dataset.csArquivo); pintar(); }; });

  if (imp.etapa === 1) {
    const input = q("#csArquivos");
    const drop = q("#csDrop");
    input.onchange = (e) => selecionarArquivos(e.target.files);
    drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("dragover"); };
    drop.ondragleave = () => drop.classList.remove("dragover");
    drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove("dragover"); selecionarArquivos(e.dataTransfer.files); };
    el.querySelectorAll("[data-cs-remover]").forEach((b) => { b.onclick = () => { imp.arquivos.splice(Number(b.dataset.csRemover), 1); imp.atual = 0; pintar(); }; });
    const av = q("#csAvancar");
    if (av) av.onclick = () => irPara(2);
    return;
  }

  const voltar = q("#csVoltar");
  if (voltar) voltar.onclick = () => irPara(imp.etapa - 1);

  if (imp.etapa === 2) {
    q("#csTipo").onchange = (e) => {
      a.tipo = e.target.value || null;
      a.mapa = a.tipo ? mapearAutomatico(a.tipo, a.deteccao.cabecalhos) : {};
      a.modeloAplicado = null;
      preparar(a); pintar();
    };
    const ms = q("#csMarcaSel");
    if (ms) ms.onchange = (e) => { a.marcaSelecionada = e.target.value; preparar(a); pintar(); };
    q("#csAvancar").onclick = () => irPara(3);
  }

  if (imp.etapa === 3) {
    el.querySelectorAll("[data-cs-mapa]").forEach((s) => {
      s.onchange = () => {
        const campo = s.dataset.csMapa;
        if (s.value) { for (const [k, v] of Object.entries(a.mapa)) if (v === s.value && k !== campo) delete a.mapa[k]; a.mapa[campo] = s.value; }
        else delete a.mapa[campo];
        a.modeloAplicado = null;
        preparar(a); pintar();
      };
    });
    const nome = q("#csNomeModelo");
    nome.oninput = () => { a.nomeModelo = nome.value; };
    q("#csSalvarModelo").onclick = async () => {
      if (!a.nomeModelo?.trim()) { a.msgModelo = "Informe um nome para o modelo."; pintar(); return; }
      try {
        await service.salvarModelo({ nome: a.nomeModelo.trim(), tipo: a.tipo, assinatura: assinaturaCabecalho(a.deteccao.cabecalhos), mapeamento: a.mapa });
        a.msgModelo = `Modelo "${a.nomeModelo.trim()}" salvo. Arquivos com o mesmo cabeçalho usarão este mapeamento automaticamente.`;
      } catch (error) { a.msgModelo = deps.safeErrorMessage(error, "Não foi possível salvar o modelo."); }
      pintar();
    };
    const av = q("#csAvancar");
    if (av) av.onclick = () => irPara(4);
  }

  if (imp.etapa === 4) {
    const baixar = q("#csBaixarErros");
    if (baixar) baixar.onclick = () => baixarArquivo(`erros_${a.nome.replace(/\.[^.]+$/, "")}.csv`, gerarCsv(
      [{ campo: "severidade", rotulo: "Severidade" }, { campo: "aba", rotulo: "Aba" }, { campo: "linha", rotulo: "Linha" }, { campo: "campo", rotulo: "Campo" }, { campo: "codigo", rotulo: "Código" }, { campo: "mensagem", rotulo: "Mensagem" }, { campo: "valor_original", rotulo: "Valor original" }],
      [...a.prep.erros, ...a.prep.alertas]), "text/csv;charset=utf-8");
    const av = q("#csAvancar");
    if (av) av.onclick = () => {
      const proximo = imp.arquivos.findIndex((x, i) => i > imp.atual && x.status === "pronto");
      if (proximo >= 0) { imp.atual = proximo; irPara(2); } else irPara(5);
    };
  }

  if (imp.etapa === 5) {
    q("#csCancelar").onclick = () => { reset(); pintar(); };
    q("#csConfirmar").onclick = confirmar;
  }

  if (imp.etapa === 6) {
    el.querySelectorAll("[data-cs-ver]").forEach((b) => {
      b.onclick = () => {
        const arq = imp.arquivos.filter((x) => x.resultado)[Number(b.dataset.csVer)];
        deps.irParaModulo(ABA_DESTINO[arq.tipo] || "visao", arq.prep?.resumo?.periodo);
      };
    });
    q("#csNovo").onclick = () => { reset(); cacheBins = null; cacheLojas = null; pintar(); };
  }
}
