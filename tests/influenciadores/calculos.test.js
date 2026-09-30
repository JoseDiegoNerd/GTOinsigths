import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatBRL, formatBRLInteiro, formatInt, formatPct, formatVariacao, formatSincronizadoEm,
  mesChave, mesAnteriorChave, hojeISO, diasEntre, campanhaAtiva,
  calcularKpis, agregarInfluenciador, agruparPorInfluenciador, pontosCrescimento,
  iniciais, normalizarTexto, filtrarInfluenciadores, paginar, pluralCampanhas
} from '../../public/modules/influenciadores/calculos.js';

const quase = (a, b, margem = 1e-9) => assert.ok(Math.abs(a - b) < margem, `${a} != ${b}`);

test('formatadores pt-BR', () => {
  assert.equal(formatBRL(45000), 'R$ 45.000,00');
  assert.equal(formatBRL(0.38), 'R$ 0,38');
  assert.equal(formatBRLInteiro(10000), 'R$ 10.000');
  assert.equal(formatInt(12850400), '12.850.400');
  assert.equal(formatPct(4.12, 2), '4,12%');
  assert.equal(formatPct(3.25), '3,3%');
});

test('formatadores devolvem travessao para valor ausente', () => {
  for (const f of [formatBRL, formatBRLInteiro, formatInt, formatPct, formatVariacao]) {
    assert.equal(f(null), '—');
    assert.equal(f(undefined), '—');
    assert.equal(f(''), '—');
    assert.equal(f('abc'), '—');
  }
});

test('formatVariacao usa sinal explicito', () => {
  assert.equal(formatVariacao(40.625), '+40,6%');
  assert.equal(formatVariacao(-15.5), '-15,5%');
  assert.equal(formatVariacao(0), '0,0%');
});

test('mesChave e mesAnteriorChave', () => {
  assert.equal(mesChave('2026-09-21'), '2026-09');
  assert.equal(mesAnteriorChave('2026-09'), '2026-08');
  assert.equal(mesAnteriorChave('2026-01'), '2025-12');
});

test('hojeISO usa a data local, nao UTC', () => {
  assert.equal(hojeISO(new Date(2026, 8, 21, 23, 30)), '2026-09-21');
  assert.equal(hojeISO(new Date(2026, 0, 5, 0, 5)), '2026-01-05');
});

test('diasEntre', () => {
  assert.equal(diasEntre('2026-09-14', '2026-09-21'), 7);
  assert.equal(diasEntre('2026-08-31', '2026-09-01'), 1);
});

test('campanhaAtiva respeita as bordas', () => {
  const c = (data_inicio, data_fim) => ({ data_inicio, data_fim });
  assert.equal(campanhaAtiva(c('2026-09-05', null), '2026-09-21'), true);
  assert.equal(campanhaAtiva(c('2026-09-21', '2026-09-21'), '2026-09-21'), true);
  assert.equal(campanhaAtiva(c('2026-09-01', '2026-09-20'), '2026-09-21'), false);
  assert.equal(campanhaAtiva(c('2026-09-22', null), '2026-09-21'), false);
});

const campanhas = [
  { influenciador_id: 'i1', data_inicio: '2026-09-05', data_fim: null, cache_valor: 20000, voucher_valor: 10000, investimento_total: 30000 },
  { influenciador_id: 'i1', data_inicio: '2026-09-20', data_fim: '2026-09-25', cache_valor: 10000, voucher_valor: 5000, investimento_total: 15000 },
  { influenciador_id: 'i2', data_inicio: '2026-08-10', data_fim: '2026-08-31', cache_valor: 30000, voucher_valor: 2000, investimento_total: 32000 }
];
const midias = [
  { influenciador_id: 'i1', publicada_em: '2026-09-10', alcance: 1000000, curtidas: 40000, comentarios: 2000, salvos: 5000, compartilhamentos: 3000 },
  { influenciador_id: 'i1', publicada_em: '2026-09-15', alcance: 3000000, curtidas: 60000, comentarios: 4000, salvos: 10000, compartilhamentos: 6000 },
  { influenciador_id: 'i2', publicada_em: '2026-08-12', alcance: 2000000, curtidas: 30000, comentarios: 3000, salvos: 4000, compartilhamentos: 3000 }
];

test('calcularKpis compara o mes com o anterior', () => {
  const k = calcularKpis({ campanhas, midias, mes: '2026-09' });
  assert.equal(k.investimento.atual, 45000);
  assert.equal(k.investimento.anterior, 32000);
  quase(k.investimento.variacao, 40.625);
  assert.equal(k.alcance.atual, 4000000);
  assert.equal(k.alcance.anterior, 2000000);
  quase(k.alcance.variacao, 100);
  assert.equal(k.interacoes.atual, 130000);
  quase(k.engajamento.atual, 3.25);
  quase(k.engajamento.anterior, 2);
  quase(k.engajamento.variacao, 62.5);
  quase(k.cpe.atual, 45000 / 130000);
  quase(k.cpe.anterior, 0.8);
  quase(k.cpe.variacao, ((45000 / 130000 - 0.8) / 0.8) * 100);
});

test('calcularKpis sem base anterior devolve variacao nula, nunca infinito', () => {
  const k = calcularKpis({ campanhas, midias, mes: '2026-08' });
  assert.equal(k.investimento.anterior, 0);
  assert.equal(k.investimento.variacao, null);
  assert.equal(k.alcance.variacao, null);
});

test('calcularKpis em mes sem dados nao gera NaN', () => {
  const k = calcularKpis({ campanhas, midias, mes: '2026-10' });
  assert.equal(k.investimento.atual, 0);
  assert.equal(k.alcance.atual, 0);
  assert.equal(k.engajamento.atual, null);
  assert.equal(k.cpe.atual, null);
  quase(k.investimento.variacao, -100);
  assert.equal(k.engajamento.variacao, null);
});

test('calcularKpis tolera listas vazias e valores em texto', () => {
  const k = calcularKpis({ campanhas: [], midias: [], mes: '2026-09' });
  assert.equal(k.investimento.atual, 0);
  const t = calcularKpis({
    campanhas: [{ data_inicio: '2026-09-01', investimento_total: '1500.50' }],
    midias: [], mes: '2026-09'
  });
  assert.equal(t.investimento.atual, 1500.5);
});

const snapshots = [
  { data: '2026-09-17', seguidores: 1432600 },
  { data: '2026-09-10', seguidores: 1400000 },
  { data: '2026-09-21', seguidores: 1450000 },
  { data: '2026-09-14', seguidores: 1420000 }
];

test('agregarInfluenciador calcula crescimento com base de pelo menos 7 dias', () => {
  const a = agregarInfluenciador({
    campanhas: campanhas.filter((c) => c.influenciador_id === 'i1'),
    midias: midias.filter((m) => m.influenciador_id === 'i1'),
    snapshots
  }, '2026-09-21');
  assert.equal(a.seguidores, 1450000);
  assert.equal(a.crescimentoAbs, 30000);
  quase(a.crescimentoPct, (30000 / 1420000) * 100);
  assert.equal(a.campanhasAtivas, 2);
  assert.equal(a.cacheTotal, 30000);
  assert.equal(a.voucherTotal, 15000);
  assert.equal(a.investimentoTotal, 45000);
  assert.equal(a.alcanceTotal, 4000000);
  assert.equal(a.totalMidias, 2);
});

test('agregarInfluenciador sem snapshot com 7 dias de distancia nao inventa crescimento', () => {
  const a = agregarInfluenciador({
    campanhas: [], midias: [],
    snapshots: [{ data: '2026-09-18', seguidores: 100 }, { data: '2026-09-21', seguidores: 130 }]
  }, '2026-09-21');
  assert.equal(a.seguidores, 130);
  assert.equal(a.crescimentoAbs, null);
  assert.equal(a.crescimentoPct, null);
});

test('agregarInfluenciador sem nenhum dado', () => {
  const a = agregarInfluenciador({ campanhas: [], midias: [], snapshots: [] }, '2026-09-21');
  assert.equal(a.seguidores, null);
  assert.equal(a.crescimentoPct, null);
  assert.equal(a.campanhasAtivas, 0);
  assert.equal(a.investimentoTotal, 0);
});

test('agruparPorInfluenciador distribui os dados por id', () => {
  const mapa = agruparPorInfluenciador({
    influenciadores: [{ id: 'i1' }, { id: 'i2' }, { id: 'i3' }],
    campanhas, midias,
    snapshots: [{ influenciador_id: 'i2', data: '2026-09-01', seguidores: 1 }]
  });
  assert.equal(mapa.get('i1').campanhas.length, 2);
  assert.equal(mapa.get('i2').midias.length, 1);
  assert.equal(mapa.get('i2').snapshots.length, 1);
  assert.deepEqual(mapa.get('i3'), { campanhas: [], midias: [], snapshots: [] });
});

test('pontosCrescimento ordena e limita aos ultimos N', () => {
  const p = pontosCrescimento(snapshots, 3);
  assert.deepEqual(p.map((x) => x.data), ['2026-09-14', '2026-09-17', '2026-09-21']);
  assert.equal(p[2].seguidores, 1450000);
});

test('iniciais', () => {
  assert.equal(iniciais('Isabela Lima'), 'IL');
  assert.equal(iniciais('Rodrigo de Albuquerque'), 'RA');
  assert.equal(iniciais('Camila'), 'CA');
  assert.equal(iniciais('  '), '?');
});

test('normalizarTexto remove acento e caixa', () => {
  assert.equal(normalizarTexto('  Calçados Ç  '), 'calcados c');
});

const lista = [
  { nome: 'Isabela Lima', handle: '@isabelalima.style', nicho: 'Moda & Varejo' },
  { nome: 'Lucas Martins', handle: '@lucasmartins.oficial', nicho: null },
  { nome: 'Mariana Souza', handle: '@mari.achadinhos', nicho: 'Achadinhos' }
];

test('filtrarInfluenciadores busca por nome, @ ou nicho sem acento', () => {
  assert.equal(filtrarInfluenciadores(lista, '').length, 3);
  assert.deepEqual(filtrarInfluenciadores(lista, 'ISABELA').map((i) => i.nome), ['Isabela Lima']);
  assert.deepEqual(filtrarInfluenciadores(lista, '@mari').map((i) => i.nome), ['Mariana Souza']);
  assert.deepEqual(filtrarInfluenciadores(lista, 'varejo').map((i) => i.nome), ['Isabela Lima']);
  assert.equal(filtrarInfluenciadores(lista, 'nao existe').length, 0);
});

test('paginar limita a pagina ao intervalo valido', () => {
  const itens = Array.from({ length: 18 }, (_, i) => i);
  const p1 = paginar(itens, 1, 5);
  assert.equal(p1.itens.length, 5);
  assert.equal(p1.totalPaginas, 4);
  assert.equal(p1.total, 18);
  assert.deepEqual(paginar(itens, 4, 5).itens, [15, 16, 17]);
  assert.equal(paginar(itens, 99, 5).pagina, 4);
  assert.equal(paginar(itens, 0, 5).pagina, 1);
  const vazio = paginar([], 3, 5);
  assert.equal(vazio.pagina, 1);
  assert.equal(vazio.totalPaginas, 1);
});

test('pluralCampanhas', () => {
  assert.equal(pluralCampanhas(0), '0 campanhas');
  assert.equal(pluralCampanhas(1), '1 campanha');
  assert.equal(pluralCampanhas(3), '3 campanhas');
});

test('formatSincronizadoEm', () => {
  const agora = new Date('2026-09-22T12:00:00Z');
  assert.equal(formatSincronizadoEm(null, agora), 'Nunca sincronizado');
  assert.equal(formatSincronizadoEm('', agora), 'Nunca sincronizado');
  assert.equal(formatSincronizadoEm('2026-09-22T11:59:50Z', agora), 'Sincronizado agora mesmo');
  assert.equal(formatSincronizadoEm('2026-09-22T11:45:00Z', agora), 'Sincronizado há 15 minutos');
  assert.equal(formatSincronizadoEm('2026-09-22T11:59:00Z', agora), 'Sincronizado há 1 minuto');
  assert.equal(formatSincronizadoEm('2026-09-22T09:00:00Z', agora), 'Sincronizado há 3 horas');
  assert.equal(formatSincronizadoEm('2026-09-22T11:00:00Z', agora), 'Sincronizado há 1 hora');
  assert.equal(formatSincronizadoEm('2026-09-20T12:00:00Z', agora), 'Sincronizado há 2 dias');
  assert.equal(formatSincronizadoEm('2026-09-21T12:00:00Z', agora), 'Sincronizado há 1 dia');
});
