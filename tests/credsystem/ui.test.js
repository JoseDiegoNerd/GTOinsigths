// Testes de integracao da UI (happy-dom) contra o banco real em PGlite: dashboard das 6 abas,
// estados vazios, filtros e o importador ponta a ponta (arquivo -> RPC -> resultado -> dashboard).
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { criarBanco, USERS } from './pglite-harness.js';
import { criarSupabaseFake } from './supabase-pglite.js';
import { arquivoCRMTresMarcas } from './fixtures.js';

let janela;
const espera = (ms = 0) => new Promise((r) => setTimeout(r, ms));

async function ate(cond, rotulo, limiteMs = 15000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > limiteMs) throw new Error(`Tempo esgotado esperando: ${rotulo}\n${document.querySelector('#content')?.textContent?.slice(0, 600)}`);
    await espera(20);
  }
}

before(() => {
  janela = new Window({ url: 'http://localhost/' });
  for (const k of ['document', 'HTMLElement', 'Event', 'CustomEvent', 'Node']) globalThis[k] = janela[k];
  globalThis.window = janela;
  globalThis.alert = (m) => { throw new Error('alert: ' + m); };
});
after(() => janela.close());

async function montarApp(db, { marca = 'Todas', periodo = 'all', userId = USERS.admin } = {}) {
  document.body.innerHTML = '<div id="content"></div><div id="imp"></div>';
  const supabase = criarSupabaseFake(db, userId);
  const state = { page: 'credsystem', marca, periodo, periodoDe: '', periodoAte: '', perfil: { cargo: 'Admin' } };
  // import novo a cada app (modulos tem estado interno)
  const v = `?v=${Math.random()}`;
  const mod = await import(`../../public/modules/credsystem/index.js${v}`);
  let paginaPedida = null;
  mod.initCredsystem({
    supabase, state,
    safeErrorMessage: (e, f) => e?.message || f || 'erro',
    marcaPillsHtml: () => `<div class="pills">${['Todas', 'Tesoura de Ouro'].map((m) => `<button class="marca-pill" data-marca="${m}">${m}</button>`).join('')}</div>`,
    wireMarcaPills: (cb) => document.querySelectorAll('.marca-pill').forEach((b) => { b.onclick = () => { state.marca = b.dataset.marca; cb(); }; }),
    periodoDropdownHtml: () => '', wirePeriodoDropdown: () => {},
    fromDate: () => (state.periodo === 'custom' ? state.periodoDe || null : null),
    toDate: () => (state.periodo === 'custom' ? state.periodoAte || null : null),
    lastImportTimestamp: () => null,
    navegar: (p) => { paginaPedida = p; state.page = p; },
    invalidarCachesApp: () => {}
  });
  return { mod, supabase, state, pagina: () => paginaPedida };
}

const texto = () => document.querySelector('#content').textContent.replace(/\s+/g, ' ');
const clicarAba = (aba) => document.querySelector(`[data-cs-aba="${aba}"]`).click();
// valor exibido num KPI (numero, "N/D" ou mensagem de estado), localizado pelo rotulo
function kpi(rotulo) {
  const card = [...document.querySelectorAll('.cs-kpi')].find((c) => c.querySelector('.kpi-top span')?.textContent.trim() === rotulo);
  if (!card) throw new Error(`KPI nao encontrado: ${rotulo}`);
  return (card.querySelector('strong') || card.querySelector('.cs-estado'))?.textContent.trim();
}

test('sem dados: indicadores mostram estado de espera, nunca zero', async () => {
  const db = await criarBanco();
  const { mod } = await montarApp(db);
  await mod.renderCredsystem({ force: true });
  await ate(() => texto().includes('Indicadores operacionais'), 'visao geral');
  const t = texto();
  assert.match(t, /Aguardando importação de dados operacionais/);
  assert.match(t, /Aguardando importação da planilha de campanhas CRM/);
  assert.match(t, /Requer base transacional/);
  for (const r of ['Propostas realizadas', 'Propostas aprovadas', 'Taxa de aprovação', 'Cartões emitidos', 'Cartões ativados', 'Taxa de ativação']) {
    assert.equal(kpi(r), 'Aguardando importação de dados operacionais', r);
  }
  for (const r of ['Abordagens realizadas', 'Conversão das campanhas', 'Ticket médio das adesões']) {
    assert.equal(kpi(r), 'Aguardando importação da planilha de campanhas CRM', r);
  }
  assert.equal(kpi('Marcas com dados'), '0', 'contagem de marcas: zero real');
  for (const aba of ['funil', 'lojas', 'motivos', 'crm', 'retencao']) {
    clicarAba(aba);
    assert.match(texto(), /Aguardando importação/, `aba ${aba} com estado vazio`);
  }
});

test('importador ponta a ponta: 3 marcas -> lote concluido -> reimportacao ignorada -> dashboard atualizado', async () => {
  const db = await criarBanco();
  const app = await montarApp(db);
  app.mod.montarImportador(document.querySelector('#imp'));
  const imp = () => document.querySelector('#imp');
  const clicar = async (sel) => { await ate(() => imp().querySelector(sel) && !imp().querySelector(sel).disabled, sel); imp().querySelector(sel).click(); };

  async function importarArquivo() {
    const file = new File([arquivoCRMTresMarcas()], 'CAMPANHAS_CREDSYSTEM.xlsx');
    const ev = new janela.Event('drop');
    ev.dataTransfer = { files: [file] };
    ev.preventDefault = () => {};
    imp().querySelector('#csDrop').ondrop(ev);
    await ate(() => /Campanhas CRM · 4 linhas/.test(imp().textContent), 'arquivo analisado');
    await clicar('#csAvancar'); // -> identificacao
    const t2 = imp().textContent;
    assert.match(t2, /Alta/);
    assert.match(t2, /Tesoura de Ouro \(2\)/);
    assert.match(t2, /Free Center Calçados \(1\)/);
    assert.match(t2, /Magazine da Economia \(1\)/);
    assert.match(t2, /10\/03\/2026 a 02\/04\/2026/);
    await clicar('#csAvancar'); // -> mapeamento
    assert.match(imp().textContent, /Todos os campos obrigatórios estão mapeados/);
    await clicar('#csAvancar'); // -> validacao
    assert.match(imp().textContent, /Registros válidos/);
    await clicar('#csAvancar'); // -> confirmacao
    await clicar('#csConfirmar');
    await ate(() => /Nova importação/.test(imp().textContent), 'resultado');
    // colunas: Status, Importadas, Atualizadas, Ignoradas, Rejeitadas
    return [...imp().querySelectorAll('tbody tr')[0].querySelectorAll('td')].map((td) => td.textContent.trim()).slice(1, 6).join(' ');
  }

  const primeira = await importarArquivo();
  assert.match(primeira, /Concluído 4 0 0 0/, primeira);
  imp().querySelector('#csNovo').click();
  const segunda = await importarArquivo();
  assert.match(segunda, /Concluído 0 0 4 0/, 'reimportacao: 4 ignoradas, nada duplicado');
  assert.ok(app.supabase.chamadas.some((c) => c.rpc === 'rpc_credsystem_crm_importar'));

  // "Ver no modulo" leva para a aba CRM com o periodo importado
  imp().querySelector('[data-cs-ver="0"]').click();
  assert.equal(app.pagina(), 'credsystem');
  assert.equal(app.state.periodoDe, '2026-03-10');
  await app.mod.renderCredsystem({ force: true });
  await ate(() => texto().includes('Campanhas detalhadas'), 'aba CRM');
  assert.equal(kpi('Conversão dos abordados'), '5,9%', 'Σ113 ÷ Σ1900 (ponderado)');
  assert.equal(kpi('Ticket médio'), 'R$ 76,11', 'Σ8600 ÷ Σ113');
  assert.match(texto(), /Valores associados às campanhas/);

  // operacional continua aguardando (CRM nao vira proposta)
  clicarAba('visao');
  assert.equal(kpi('Propostas realizadas'), 'Aguardando importação de dados operacionais');
  assert.equal(kpi('Abordagens realizadas'), '1.900');
});

test('dashboard com dados operacionais: funil de coorte, ranking com busca/ordenacao e filtro de marca', async () => {
  const db = await criarBanco();
  await db.exec(`
    insert into stage_credsystem_propostas (marca, dt_proposta, cd_loja_cs, nm_loja, id_cod_proposta, id_cod_cartao, proposta_aprov, proposta_rejei, motivo) values
      ('Tesoura de Ouro','2026-06-01','30501','0025 TO PLANALTINA','P1','K1',1,0,'APROVADA'),
      ('Tesoura de Ouro','2026-06-02','30501','0025 TO PLANALTINA','P2','K2',1,0,'APROVADA'),
      ('Tesoura de Ouro','2026-06-02','25510','0002 TO CEILANDIA','P3',null,0,1,'RESTRITIVO EXTERNO'),
      ('Magazine da Economia','2026-06-03','99','LOJA ME','P4',null,0,1,'RECUSA POLÍTICA');
    insert into dados_cartoes_credsystem (marca, data_emissao, data_ativacao, loja_operacao, id_cod_cartao, chave_natural) values
      ('Tesoura de Ouro','2026-06-02','2026-06-04','0025 TO PLANALTINA','K1','id:K1'),
      ('Tesoura de Ouro','2026-06-03',null,'0025 TO PLANALTINA','K2','id:K2');
  `);
  const { mod, state } = await montarApp(db);
  await mod.renderCredsystem({ force: true });
  await ate(() => texto().includes('Indicadores operacionais'), 'visao');
  assert.equal(kpi('Propostas realizadas'), '4');
  assert.equal(kpi('Taxa de aprovação'), '50,0%');
  assert.equal(kpi('Cartões emitidos'), '2');
  assert.equal(kpi('Taxa de ativação'), '50,0%');
  assert.equal(kpi('Marcas com dados'), '2');

  clicarAba('funil');
  const f = texto();
  assert.match(f, /Coorte:/);
  assert.match(f, /Ativação após emissão: 50,0%/);
  assert.match(f, /Emissão após aprovação: 100,0%/);

  clicarAba('lojas');
  assert.equal(document.querySelectorAll('#csLojasCorpo tr').length, 3);
  const busca = document.querySelector('#csLojaBusca');
  busca.value = 'ceil';
  busca.oninput();
  assert.equal(document.querySelectorAll('#csLojasCorpo tr').length, 1);
  assert.match(document.querySelector('#csLojasCorpo').textContent, /CEILANDIA/);

  clicarAba('motivos');
  assert.match(texto(), /RESTRITIVO EXTERNO/);

  // filtro de marca: so Tesoura
  document.querySelector('.marca-pill[data-marca="Tesoura de Ouro"]').click();
  await ate(() => state.marca === 'Tesoura de Ouro' && document.querySelector('[data-cs-aba]') && /Somente registros de/.test(texto()), 'filtro de marca');
  clicarAba('visao');
  assert.equal(kpi('Propostas realizadas'), '3');
  assert.doesNotMatch(texto(), /LOJA ME/);

  // filtro de periodo sem registros: estado especifico (nao zero)
  Object.assign(state, { periodo: 'custom', periodoDe: '2027-01-01', periodoAte: '2027-01-31' });
  await mod.renderCredsystem({ force: true });
  await ate(() => /nada no período selecionado/.test(texto()), 'periodo vazio');
  assert.equal(kpi('Propostas realizadas'), 'Sem registros no período');
});

test('configuracao de BINs: Admin adiciona BIN novo; Analista e barrado pela RLS', async () => {
  const db = await criarBanco();
  for (const [userId, esperado, marcaTentada] of [[USERS.admin, /BIN 960999 salvo/, 'Magazine da Economia'], [USERS.ouro, /Não foi possível|row-level/i, 'Tesoura de Ouro']]) {
    const app = await montarApp(db, { userId });
    app.state.perfil = { cargo: 'Admin' }; // a UI mostra o painel; quem decide e o banco
    app.mod.montarImportador(document.querySelector('#imp'));
    const imp = document.querySelector('#imp');
    const det = imp.querySelector('#csBins');
    det.open = true; det.ontoggle();
    await ate(() => imp.querySelector('#csBins tbody tr'), 'lista de BINs');
    assert.equal(imp.querySelectorAll('#csBins tbody tr').length, userId === USERS.admin ? 3 : 4, 'analista le a configuracao (inclusive o BIN que o admin acabou de criar)');
    imp.querySelector('#csBinNovo').value = '960999';
    imp.querySelector('#csBinMarca').value = marcaTentada;
    imp.querySelector('#csBinSalvar').click();
    await ate(() => esperado.test(imp.querySelector('#csBins').textContent), `resposta ao salvar (${marcaTentada})`);
  }
  const { rows } = await db.query(`select marca from credsystem_bin_marca where bin = '960999'`);
  assert.deepEqual(rows, [{ marca: 'Magazine da Economia' }], 'tentativa do analista nao alterou o BIN');
});
