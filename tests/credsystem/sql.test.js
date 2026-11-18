// Testes do banco (migration 20261113_045) em Postgres real via PGlite: RPCs de importacao,
// idempotencia, RLS por marca, saneamento nao destrutivo e indicadores agregados.
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { criarBanco, comoUsuario, rpc, USERS } from './pglite-harness.js';
import { XLSX, arquivoCRMTresMarcas, arquivoModeloPadrao2026 } from './fixtures.js';
import { lerPlanilha } from '../../public/modules/credsystem/leitor-planilha.js';
import { detectarTipo, marcasPorAba, separarAbasDeDados } from '../../public/modules/credsystem/detector.js';
import { prepararImportacao } from '../../public/modules/credsystem/transformacao.js';
import { BIN_MARCA_PADRAO } from '../../public/modules/credsystem/constantes.js';
import { consolidarCRM, taxa } from '../../public/modules/credsystem/metricas.js';

const HASH = (n) => n.toString(16).padStart(64, '0');
let db;

// Dados "legados" inseridos ANTES da migration nova, reproduzindo o problema real de producao:
// arquivo de propostas gravado como emissao + reimportacao de emissoes sem id_cod_cartao.
async function seedLegado(d) {
  await d.exec(`
    insert into dados_cartoes_credsystem (marca, data_emissao, data_ativacao, loja_operacao, nome_cliente, cpf_cliente, id_cod_cartao, origem_arquivo)
    values
      ('Tesoura de Ouro', '2026-06-02', '2026-06-05', 'LOJA A', 'Cliente 1', '11111111111', 'K1', 'X_EMISSAO_20260616.CSV'),
      ('Tesoura de Ouro', '2026-06-03', null,         'LOJA A', 'Cliente 2', '22222222222', 'K2', 'X_EMISSAO_20260616.CSV'),
      ('Tesoura de Ouro', '2026-06-02', '2026-06-05', 'LOJA A', 'Cliente 1', null, null, 'X_EMISSAO_20260616.CSV'),
      ('Tesoura de Ouro', '2026-06-03', null,         'LOJA A', 'Cliente 2', null, null, 'X_EMISSAO_20260616.CSV'),
      ('Tesoura de Ouro', '2026-06-01', null,         'LOJA A', null, null, null, 'X_PROPOSTAS_20260616.CSV'),
      ('Tesoura de Ouro', '2026-06-01', null,         'LOJA A', null, null, null, 'X_PROPOSTAS_20260616.CSV'),
      ('Free Center Calçados', '2026-07-01', '2026-07-01', 'LOJA FC', 'Seed', null, null, 'seed_manual');
    insert into stage_credsystem_propostas (marca, dt_proposta, cd_loja_cs, nm_loja, id_cod_proposta, cpf_cliente, id_cod_cartao, proposta_aprov, proposta_rejei, motivo)
    values
      ('Tesoura de Ouro', '2026-06-01', '30501', 'LOJA A', 'P1', '11111111111', 'K1', 1, 0, 'APROVADA'),
      ('Tesoura de Ouro', '2026-06-01', '30501', 'LOJA A', 'P2', '22222222222', 'K2', 1, 0, 'APROVADA'),
      ('Tesoura de Ouro', '2026-06-01', '30501', 'LOJA A', 'P3', '33333333333', null, 0, 1, 'RESTRITIVO EXTERNO'),
      ('Tesoura de Ouro', '2026-06-20', '25510', 'LOJA B', 'P4', '44444444444', null, 0, 1, 'RECUSA POLÍTICA'),
      ('Tesoura de Ouro', '2026-07-10', '25510', 'LOJA B', 'P5', '55555555555', null, 1, 0, 'APROVADA');
  `);
}

function registrosCRM() {
  const leitura = lerPlanilha({ nomeArquivo: 'campanhas.xlsx', buffer: arquivoCRMTresMarcas(), XLSX });
  const det = detectarTipo(leitura);
  return prepararImportacao(det.tipo, leitura, det.ranking[0].mapa, {
    mapaBins: BIN_MARCA_PADRAO, mapaLojas: {}, marcasAba: marcasPorAba(leitura), nomeArquivo: 'campanhas.xlsx'
  }).registros;
}

async function importarCRM(userId, registros, hash) {
  return comoUsuario(db, userId, async (tx) => {
    const ini = await rpc(tx, 'rpc_importacao_iniciar', { p_tipo_arquivo: 'credsystem_crm_campanhas', p_nome_arquivo: 'campanhas.xlsx', p_hash: hash, p_metadados: {} });
    const res = await rpc(tx, 'rpc_credsystem_crm_importar', { p_lote_id: ini.lote_id, p_linhas: registros });
    const lote = await rpc(tx, 'rpc_importacao_finalizar', { p_lote_id: ini.lote_id, p_linhas_lidas: registros.length, p_abas: ['TESOURA DE OURO'], p_cancelado: false });
    return { ini, res, lote };
  });
}

before(async () => { db = await criarBanco({ antesDaMigrationNova: seedLegado }); });

test('saneamento: propostas gravadas como emissao, duplicatas sem ID e seed ficam fora do BI (sem apagar)', async () => {
  const { rows } = await db.query(`select count(*)::int total, count(*) filter (where not excluido_bi)::int validas,
    count(*) filter (where motivo_exclusao_bi like 'Arquivo de propostas%')::int props,
    count(*) filter (where motivo_exclusao_bi like 'Duplicata%')::int dups,
    count(*) filter (where motivo_exclusao_bi like 'Registro de seed%')::int seed
    from dados_cartoes_credsystem`);
  assert.deepEqual(rows[0], { total: 7, validas: 2, props: 2, dups: 2, seed: 1 });
  const v = await db.query(`select sum(total_cartoes)::int c from vw_credsystem_resumo_geral`);
  assert.equal(v.rows[0].c, 2, 'view antiga tambem ignora as linhas excluidas');
});

test('pseudonimizacao: deterministica, sem CPF em texto e nao executavel por authenticated', async () => {
  const { rows } = await db.query(`select cliente_pseudo_id from stage_credsystem_propostas where id_cod_proposta = 'P1'`);
  assert.match(rows[0].cliente_pseudo_id, /^cpf:[0-9a-f]{64}$/);
  const r2 = await db.query(`select public.gto_pseudonimizar('111.111.111-11') = public.gto_pseudonimizar('11111111111') igual`);
  assert.equal(r2.rows[0].igual, true);
  await assert.rejects(comoUsuario(db, USERS.admin, (tx) => tx.query(`select public.gto_pseudonimizar('1')`)), /permission denied/);
});

test('importacao CRM com 3 marcas pelo admin e reimportacao idempotente', async () => {
  const registros = registrosCRM();
  const a = await importarCRM(USERS.admin, registros, HASH(1));
  assert.deepEqual(a.res, { inseridas: 4, atualizadas: 0, inalteradas: 0, rejeitadas: 0 });
  assert.equal(a.lote.status, 'concluido');
  assert.deepEqual([...a.lote.marcas].sort(), ['Free Center Calçados', 'Magazine da Economia', 'Tesoura de Ouro']);
  assert.equal(a.lote.periodo_inicio, '2026-03-10');

  // mesmo arquivo de novo: avisa o hash repetido e NAO duplica
  const b = await importarCRM(USERS.admin, registros, HASH(1));
  assert.equal(b.ini.importacoes_anteriores.length, 1);
  assert.deepEqual(b.res, { inseridas: 0, atualizadas: 0, inalteradas: 4, rejeitadas: 0 });
  assert.deepEqual([...b.lote.marcas].sort(), ['Free Center Calçados', 'Magazine da Economia', 'Tesoura de Ouro'], 'lote registra marcas mesmo sem alteracoes');
  const { rows } = await db.query('select count(*)::int n from credsystem_campanhas_crm');
  assert.equal(rows[0].n, 4);
});

test('atualizacao de registro existente quando a metrica muda', async () => {
  const registros = registrosCRM();
  registros[0] = { ...registros[0], qt_adesao_abordado: 60, vl_gasto_abordado: '6000.00' };
  const r = await importarCRM(USERS.admin, registros, HASH(2));
  assert.deepEqual(r.res, { inseridas: 0, atualizadas: 1, inalteradas: 3, rejeitadas: 0 });
  const { rows } = await db.query(`select qt_adesao_abordado::int q, dados_originais ? 'DS_FRASE' tem_original from credsystem_campanhas_crm where qt_adesao_abordado = 60`);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].tem_original, true);
});

test('servidor bloqueia divergencia BIN x aba e BIN desconhecido, mesmo se o cliente enviar', async () => {
  const [base] = registrosCRM();
  const linhas = [
    { ...base, linha: 90, ds_campanha: 'CONFLITO', marca_aba: 'Free Center Calçados', nr_bin: '960358' },
    { ...base, linha: 91, ds_campanha: 'BIN NOVO', nr_bin: '123456', marca_aba: null }
  ];
  const r = await importarCRM(USERS.admin, linhas, HASH(3));
  assert.equal(r.res.rejeitadas, 2);
  assert.equal(r.lote.status, 'falhou');
  const { rows } = await db.query(`select codigo from importacao_erros_linha where lote_id = $1 order by linha`, [r.ini.lote_id]);
  assert.deepEqual(rows.map((x) => x.codigo), ['CONFLITO_MARCA', 'BIN_DESCONHECIDO']);
});

test('servidor valida tipos e faixas (nao confia no cliente)', async () => {
  const [base] = registrosCRM();
  const linhas = [
    { ...base, linha: 1, ds_campanha: 'NEG', qt_abordado: -5 },
    { ...base, linha: 2, ds_campanha: 'TX', tx_conv_abordado: '250' },
    { ...base, linha: 3, ds_campanha: 'TXT', vl_gasto_abordado: 'DROP TABLE' },
    { ...base, linha: 4, ds_campanha: null },
    { ...base, linha: 5, ds_campanha: 'DATA', dh_disparo: '10/03/2026', mes: null, ano: null }
  ];
  const r = await importarCRM(USERS.admin, linhas, HASH(4));
  assert.equal(r.res.rejeitadas, 5);
  const { rows } = await db.query(`select codigo from importacao_erros_linha where lote_id = $1 and severidade = 'erro' order by linha`, [r.ini.lote_id]);
  assert.deepEqual(rows.map((x) => x.codigo), ['QUANTIDADE_INVALIDA', 'TAXA_FORA_DA_FAIXA', 'VALOR_NUMERICO_INVALIDO', 'CAMPO_OBRIGATORIO', 'DATA_INVALIDA']);
});

test('RLS: analista de uma marca nao grava nem le outra marca; escrita direta e negada', async () => {
  const registros = registrosCRM().map((r) => ({ ...r, ds_campanha: r.ds_campanha + ' (ouro)' }));
  const r = await importarCRM(USERS.ouro, registros, HASH(5));
  assert.equal(r.res.inseridas, 2, 'so as 2 linhas da Tesoura de Ouro');
  assert.equal(r.res.rejeitadas, 2);
  const { rows: erros } = await db.query(`select distinct codigo from importacao_erros_linha where lote_id = $1`, [r.ini.lote_id]);
  assert.deepEqual(erros.map((e) => e.codigo), ['SEM_PERMISSAO_MARCA']);

  const visiveis = await comoUsuario(db, USERS.economia, (tx) => tx.query('select distinct marca from credsystem_campanhas_crm'));
  assert.deepEqual(visiveis.rows.map((x) => x.marca), ['Magazine da Economia']);

  await assert.rejects(
    comoUsuario(db, USERS.economia, (tx) => tx.query(`insert into credsystem_campanhas_crm (marca, marca_origem, chave_natural, dt_disparo, ds_campanha) values ('Magazine da Economia','aba_ou_selecao','x','2026-01-01','x')`)),
    /permission denied/
  );
  await assert.rejects(comoUsuario(db, USERS.semPerfil, (tx) => rpc(tx, 'rpc_importacao_iniciar', { p_tipo_arquivo: 'credsystem_crm_campanhas', p_nome_arquivo: 'x', p_hash: HASH(6), p_metadados: {} })), /permiss/);

  // usuario so ve lotes proprios/da sua marca
  const lotes = await comoUsuario(db, USERS.economia, (tx) => tx.query('select count(*)::int n from importacao_lotes'));
  const lotesAdmin = await comoUsuario(db, USERS.admin, (tx) => tx.query('select count(*)::int n from importacao_lotes'));
  assert.ok(lotes.rows[0].n < lotesAdmin.rows[0].n);
});

test('consolidacao: total "Todas" = soma das marcas e taxas ponderadas (nao media de taxas)', async () => {
  const linhas = (await comoUsuario(db, USERS.admin, (tx) => tx.query(`select marca, ds_campanha, qt_abordado::float8 qt_abordado, qt_adesao_abordado::float8 qt_adesao_abordado,
      vl_gasto_abordado::float8 vl_gasto_abordado, qt_controle::float8 qt_controle, qt_adesao_controle::float8 qt_adesao_controle,
      vl_gasto_controle::float8 vl_gasto_controle, vl_vendas_incrementais::float8 vl_vendas_incrementais, tx_conv_abordado::float8 tx_conv_abordado
      from credsystem_campanhas_crm where ds_campanha not like '%(ouro)'`))).rows;
  const todas = consolidarCRM(linhas);
  const porMarca = ['Tesoura de Ouro', 'Free Center Calçados', 'Magazine da Economia'].map((m) => consolidarCRM(linhas.filter((l) => l.marca === m)));
  assert.equal(todas.abordagens, porMarca.reduce((s, x) => s + x.abordagens, 0));
  assert.equal(todas.valorAbordados, porMarca.reduce((s, x) => s + x.valorAbordados, 0));
  assert.equal(todas.vendasIncrementais, porMarca.reduce((s, x) => s + x.vendasIncrementais, 0));
  // 1000/60 (atualizado) + 400/40 + 300/3 + 200/20 => 123 / 1900
  assert.equal(todas.abordagens, 1900);
  assert.equal(todas.adesoes, 123);
  assert.ok(Math.abs(todas.conversao - (123 / 1900) * 100) < 1e-9);
  const mediaSimples = linhas.reduce((s, l) => s + l.tx_conv_abordado, 0) / linhas.length;
  assert.notEqual(Math.round(todas.conversao * 100), Math.round(mediaSimples * 100), 'nao e media simples das taxas');
  assert.ok(Math.abs(todas.ticketAbordados - (6000 + 2000 + 600 + 1000) / 123) < 1e-9);
  assert.equal(taxa(5, 0), null);
});

test('resumo operacional: coorte proposta->cartao->ativacao, filtros de periodo e marca', async () => {
  const tudo = await comoUsuario(db, USERS.admin, (tx) => rpc(tx, 'rpc_credsystem_operacional_resumo', { p_marca: null, p_de: null, p_ate: null }));
  const ouro = tudo.por_marca.find((m) => m.marca === 'Tesoura de Ouro');
  assert.deepEqual(
    { p: ouro.propostas, a: ouro.aprovadas, r: ouro.rejeitadas, e: ouro.emitidas_coorte, at: ouro.ativadas_coorte, emi: ouro.emitidos_periodo },
    { p: 5, a: 3, r: 2, e: 2, at: 1, emi: 2 },
    'cartoes excluidos do BI nao contam'
  );
  const fc = tudo.por_marca.find((m) => m.marca === 'Free Center Calçados');
  assert.equal(fc, undefined, 'seed manual excluido nao gera marca com dados');

  const junho = await comoUsuario(db, USERS.admin, (tx) => rpc(tx, 'rpc_credsystem_operacional_resumo', { p_marca: 'Tesoura de Ouro', p_de: '2026-06-01', p_ate: '2026-06-15' }));
  assert.equal(junho.por_marca[0].propostas, 3);
  assert.equal(junho.lojas.length, 1);
  assert.equal(junho.motivos.find((m) => m.motivo === 'APROVADA').total, 2);
  assert.equal(junho.base.propostas[0].n, 5, 'base informa total importado independente do filtro');

  const semAcesso = await comoUsuario(db, USERS.economia, (tx) => rpc(tx, 'rpc_credsystem_operacional_resumo', { p_marca: null, p_de: null, p_ate: null }));
  assert.deepEqual(semAcesso.por_marca, [], 'RLS: analista da Magazine nao ve dados da Tesoura');
});

test('importacao de propostas e emissoes via RPC: idempotente, atualiza status e pseudonimiza', async () => {
  const linhas = [
    { aba: 'P', linha: 2, marca_hint: null, nr_bin: '960358', id_cod_proposta: 'NP1', dt_proposta: '2026-08-01', proposta_aprov: '1', proposta_rejei: '0', cpf_cliente: '99988877766', id_cod_cartao: 'NK1', dt_emissao: '2026-08-02', dt_ativacao: '2026-08-03', nm_loja: 'LOJA N', dados_originais: { CPF_CLIENTE: '99988877766', MOTIVO: 'APROVADA' } },
    { aba: 'P', linha: 3, marca_hint: 'Tesoura de Ouro', id_cod_proposta: 'NP2', dt_proposta: '2026-08-01', status: 'Recusada', motivo_rejeicao: 'RESTRITIVO' }
  ];
  const run = (rows, h) => comoUsuario(db, USERS.ouro, async (tx) => {
    const ini = await rpc(tx, 'rpc_importacao_iniciar', { p_tipo_arquivo: 'credsystem_propostas', p_nome_arquivo: 'p.csv', p_hash: HASH(h), p_metadados: {} });
    const res = await rpc(tx, 'rpc_credsystem_propostas_importar', { p_lote_id: ini.lote_id, p_linhas: rows });
    await rpc(tx, 'rpc_importacao_finalizar', { p_lote_id: ini.lote_id, p_linhas_lidas: rows.length, p_abas: [], p_cancelado: false });
    return res;
  });
  assert.deepEqual(await run(linhas, 10), { inseridas: 2, atualizadas: 0, inalteradas: 0, rejeitadas: 0 });
  assert.deepEqual(await run(linhas, 10), { inseridas: 0, atualizadas: 0, inalteradas: 2, rejeitadas: 0 });
  const { rows } = await db.query(`select p.proposta_rejei, p.cpf_cliente, p.cliente_pseudo_id, p.payload_bruto, c.data_ativacao
    from stage_credsystem_propostas p left join dados_cartoes_credsystem c on c.id_cod_cartao = p.id_cod_cartao where p.id_cod_proposta in ('NP1','NP2') order by p.id_cod_proposta`);
  assert.equal(rows[0].cpf_cliente, null, 'CPF nao armazenado em texto');
  assert.match(rows[0].cliente_pseudo_id, /^cpf:/);
  assert.equal('CPF_CLIENTE' in rows[0].payload_bruto, false);
  assert.equal(rows[0].data_ativacao.toISOString().slice(0, 10), '2026-08-03', 'linha combinada grava a emissao');
  assert.equal(rows[1].proposta_rejei, 1, 'status textual "Recusada" vira rejeitada');

  // emissao avulsa reimportada atualiza a ativacao
  const emi = (ativ, h) => comoUsuario(db, USERS.ouro, async (tx) => {
    const ini = await rpc(tx, 'rpc_importacao_iniciar', { p_tipo_arquivo: 'credsystem_emissoes', p_nome_arquivo: 'e.csv', p_hash: HASH(h), p_metadados: {} });
    return rpc(tx, 'rpc_credsystem_emissoes_importar', { p_lote_id: ini.lote_id, p_linhas: [{ aba: 'E', linha: 2, marca_hint: 'Tesoura de Ouro', id_cod_cartao: 'NK9', dt_emissao: '2026-08-05', dt_ativacao: ativ, nm_loja: 'L' }] });
  });
  assert.equal((await emi(null, 11)).inseridas, 1);
  assert.equal((await emi('2026-08-09', 12)).atualizadas, 1);
});

test('retencao: so calcula com transacoes; status de importacao por tipo', async () => {
  const vazio = await comoUsuario(db, USERS.admin, (tx) => rpc(tx, 'rpc_credsystem_retencao_resumo', { p_marca: null, p_de: null, p_ate: null, p_dias_inatividade: 90 }));
  assert.equal(vazio.tem_dados, false);
  const res = await comoUsuario(db, USERS.admin, async (tx) => {
    const ini = await rpc(tx, 'rpc_importacao_iniciar', { p_tipo_arquivo: 'credsystem_transacoes', p_nome_arquivo: 't.csv', p_hash: HASH(20), p_metadados: {} });
    const linhas = [
      ['T1', 'A', '2026-01-10', '100.00'], ['T2', 'A', '2026-02-10', '50.00'], ['T3', 'B', '2026-02-15', '80.00'], ['T4', 'C', '2025-06-01', '30.00'], ['T5', 'C', '2026-03-01', '40.00']
    ].map(([id, cli, dt, vl], i) => ({ aba: 'T', linha: i + 2, marca_hint: 'Tesoura de Ouro', id_transacao: id, cliente_pseudo_id: 'cli:' + cli, dt_transacao: dt, vl_transacao: vl }));
    const r = await rpc(tx, 'rpc_credsystem_transacoes_importar', { p_lote_id: ini.lote_id, p_linhas: linhas });
    await rpc(tx, 'rpc_importacao_finalizar', { p_lote_id: ini.lote_id, p_linhas_lidas: 5, p_abas: [], p_cancelado: false });
    return r;
  });
  assert.equal(res.inseridas, 5);
  const r = await comoUsuario(db, USERS.admin, (tx) => rpc(tx, 'rpc_credsystem_retencao_resumo', { p_marca: null, p_de: '2026-01-01', p_ate: '2026-03-31', p_dias_inatividade: 90 }));
  assert.equal(r.tem_dados, true);
  assert.equal(r.clientes_unicos, 3);
  assert.equal(r.clientes_novos, 2, 'A e B; C ja comprava antes do periodo');
  assert.equal(r.clientes_recorrentes, 1);
  assert.equal(r.clientes_reativados, 1, 'C voltou depois de >90 dias');
  assert.equal(Number(r.ticket_medio_transacao), 67.5);

  const status = await comoUsuario(db, USERS.admin, (tx) => rpc(tx, 'rpc_credsystem_status_importacoes', { p_marca: null }));
  assert.ok(status.credsystem_crm_campanhas.ultima_importacao);
  assert.ok(status.credsystem_transacoes);
});

test('migration 045 e re-executavel sem efeitos colaterais (idempotente)', async () => {
  const { readFileSync } = await import('node:fs');
  const antes = (await db.query(`select (select count(*) from credsystem_campanhas_crm)::int crm, (select count(*) filter (where excluido_bi) from dados_cartoes_credsystem)::int excl,
    (select count(*) from credsystem_bin_marca)::int bins, (select valor from gto_private.segredos where nome = 'credsystem_pseudonimo_pepper') pepper`)).rows[0];
  await db.exec(readFileSync('supabase/migrations/20261113_045_credsystem_importacao_inteligente.sql', 'utf8'));
  const depois = (await db.query(`select (select count(*) from credsystem_campanhas_crm)::int crm, (select count(*) filter (where excluido_bi) from dados_cartoes_credsystem)::int excl,
    (select count(*) from credsystem_bin_marca)::int bins, (select valor from gto_private.segredos where nome = 'credsystem_pseudonimo_pepper') pepper`)).rows[0];
  assert.deepEqual({ ...depois, pepper: Buffer.from(depois.pepper).toString('hex') }, { ...antes, pepper: Buffer.from(antes.pepper).toString('hex') }, 'pepper nao muda: pseudonimos continuam estaveis');
});

test('cartao gravado pelo assistente manual antigo e reimportado pelo importador novo: atualiza, nao duplica nem falha', async () => {
  // caminho legado: insert direto (upsert do PostgREST) sem chave_natural
  await comoUsuario(db, USERS.ouro, (tx) => tx.query(`insert into dados_cartoes_credsystem (marca, data_emissao, loja_operacao, id_cod_cartao, origem_arquivo) values ('Tesoura de Ouro','2026-09-01','L','LEG1','legado.csv')`));
  const r = await comoUsuario(db, USERS.ouro, async (tx) => {
    const ini = await rpc(tx, 'rpc_importacao_iniciar', { p_tipo_arquivo: 'credsystem_emissoes', p_nome_arquivo: 'e.csv', p_hash: HASH(30), p_metadados: {} });
    return rpc(tx, 'rpc_credsystem_emissoes_importar', { p_lote_id: ini.lote_id, p_linhas: [{ aba: 'E', linha: 2, marca_hint: 'Tesoura de Ouro', id_cod_cartao: 'LEG1', dt_emissao: '2026-09-01', dt_ativacao: '2026-09-02', nm_loja: 'L' }] });
  });
  assert.deepEqual(r, { inseridas: 0, atualizadas: 1, inalteradas: 0, rejeitadas: 0 });
  const { rows } = await db.query(`select count(*)::int n, max(data_ativacao)::text a from dados_cartoes_credsystem where id_cod_cartao = 'LEG1'`);
  assert.deepEqual(rows[0], { n: 1, a: '2026-09-02' });
});

test('Modelo Padrao 2026: grava id_registro, nao colapsa linhas com mesma campanha/data e reimporta sem duplicar', async () => {
  const leitura = separarAbasDeDados(lerPlanilha({ nomeArquivo: 'modelo.xlsx', buffer: arquivoModeloPadrao2026(), XLSX })).leitura;
  const det = detectarTipo(leitura);
  const registros = prepararImportacao(det.tipo, leitura, det.ranking[0].mapa, {
    mapaBins: BIN_MARCA_PADRAO, mapaLojas: {}, marcasAba: marcasPorAba(leitura), nomeArquivo: 'modelo.xlsx'
  }).registros;
  assert.equal(registros.length, 6);
  const a = await importarCRM(USERS.admin, registros, HASH(2026));
  assert.deepEqual(a.res, { inseridas: 6, atualizadas: 0, inalteradas: 0, rejeitadas: 0 });
  const { rows } = await db.query(`select id_registro_origem, qt_abordado from credsystem_campanhas_crm
    where ds_campanha = 'B2B_960358_PL_20230829_TESOURA_REATIVACAO_SMS_JR_M3' order by qt_abordado`);
  assert.deepEqual(rows.map((r) => [r.id_registro_origem, Number(r.qt_abordado)]), [['f3284e0c956b3ce9f4a1', 2147], ['9b309f7d03c81e571b91', 2235]]);
  const b = await importarCRM(USERS.admin, registros, HASH(2026));
  assert.deepEqual(b.res, { inseridas: 0, atualizadas: 0, inalteradas: 6, rejeitadas: 0 });
});
