import test from 'node:test';
import assert from 'node:assert/strict';
import { influencersTableHtml } from '../../public/modules/influenciadores/influencers-table.js';
import { influencerDrawerHtml } from '../../public/modules/influenciadores/influencer-drawer.js';

const influenciador = {
  id: 'i1', marca: 'Tesoura de Ouro', nome: 'Isabela Lima', handle: '@isabelalima.style', rede_social: 'Instagram',
  verificado: true, nicho: 'Moda & Varejo', cupom_codigo: 'TESOURA10', cupom_exclusivo: true, status: 'Ativo'
};
const agregado = {
  seguidores: 1450000, crescimentoAbs: 17400, crescimentoPct: 1.2, campanhasAtivas: 3,
  cacheTotal: 10000, voucherTotal: 5000, investimentoTotal: 15000, alcanceTotal: 4230000, totalMidias: 1
};
const base = {
  linhas: [{ influenciador, agregado, avatarUrl: null }], cadastrados: 18, total: 1, pagina: 1, totalPaginas: 1,
  busca: '', abertoId: null, selecionados: new Set(), podeEditar: true
};

// tabela -----------------------------------------------------------------------------------------
test('tabela mostra cabecalho, contagem e colunas do prototipo', () => {
  const html = influencersTableHtml(base);
  for (const texto of ['Influenciadores Ativos', '18 cadastrados', 'Criador', 'Seguidores', 'Crescimento Semanal',
    'Campanhas Ativas', 'Investimento Total', 'Alcance', 'Ações', 'Novo Influenciador']) {
    assert.ok(html.includes(texto), `faltou ${texto}`);
  }
});

test('tabela renderiza a linha com formatacao pt-BR', () => {
  const html = influencersTableHtml(base);
  for (const texto of ['Isabela Lima', '@isabelalima.style', '1.450.000', '▲ +1,2%', '3 campanhas',
    'R$ 15.000,00', '4.230.000', 'inf-rede ig', 'Ver Detalhes']) {
    assert.ok(html.includes(texto), `faltou ${texto}`);
  }
  assert.match(html, /material-symbols-outlined inf-verificado/);
  assert.match(html, /<span class="inf-avatar inf-avatar-md"[^>]*>IL<\/span>/);
});

test('tabela destaca a linha aberta e marca os checkboxes selecionados', () => {
  const html = influencersTableHtml({ ...base, abertoId: 'i1', selecionados: new Set(['i1']) });
  assert.match(html, /<tr class="inf-linha aberta" data-id="i1">/);
  assert.match(html, /data-check="i1" checked/);
  assert.match(html, /inf-btn-detalhes primario/);
});

test('tabela esconde "Novo Influenciador" para quem nao edita', () => {
  assert.ok(!influencersTableHtml({ ...base, podeEditar: false }).includes('Novo Influenciador'));
});

test('tabela mostra rodape e paginacao', () => {
  const html = influencersTableHtml({ ...base, total: 18, pagina: 1, totalPaginas: 4 });
  assert.match(html, /Mostrando <strong>1<\/strong> de <strong>18<\/strong> criadores contratados/);
  assert.match(html, /<button type="button" disabled>Anterior<\/button>/);
  assert.match(html, /class="ativa" data-pagina="1">1</);
  assert.match(html, /data-pagina="2">2</);
  assert.match(html, /data-pagina="2">Próximo</);
});

test('tabela distingue "nada cadastrado" de "busca sem resultado"', () => {
  const vazio = influencersTableHtml({ ...base, linhas: [], cadastrados: 0, total: 0 });
  assert.match(vazio, /Nenhum influenciador cadastrado nesta bandeira/);
  const semResultado = influencersTableHtml({ ...base, linhas: [], cadastrados: 18, total: 0, busca: 'zzz' });
  assert.match(semResultado, /Nenhum resultado para a busca/);
});

test('tabela escapa dados do usuario', () => {
  const malicioso = { ...influenciador, nome: '<img src=x onerror=alert(1)>', handle: '@"x' };
  const html = influencersTableHtml({ ...base, busca: '"><script>', linhas: [{ influenciador: malicioso, agregado, avatarUrl: null }] });
  assert.ok(!html.includes('<img src=x'));
  assert.ok(!html.includes('<script>'));
});

test('tabela sem dados de crescimento mostra travessao', () => {
  const html = influencersTableHtml({ ...base, linhas: [{ influenciador, agregado: { ...agregado, seguidores: null, crescimentoPct: null }, avatarUrl: null }] });
  assert.match(html, /inf-cresc neutro">—</);
});

// drawer -----------------------------------------------------------------------------------------
const midia = {
  id: 'm1', titulo: 'Reel: Provador Tesoura de Ouro', url: 'https://www.instagram.com/reel/C8x9L_p/', plataforma: 'Instagram',
  views: 1840000, curtidas: 94200, salvos: 14800
};
const modeloDrawer = {
  influenciador, avatarUrl: null, agregado,
  campanhas: [{ id: 'c1', nome: 'Campanha dos Pais 2026' }, { id: 'c2', nome: 'Dia das Crianças' }],
  midias: [midia],
  pontos: [{ data: '2026-09-19', seguidores: 100 }, { data: '2026-09-20', seguidores: 150 }, { data: '2026-09-21', seguidores: 200 }],
  podeEditar: true, hoje: '2026-09-21'
};

test('drawer sem selecao mostra estado vazio', () => {
  const html = influencerDrawerHtml({ ...modeloDrawer, influenciador: null });
  assert.match(html, /Selecione um influenciador/);
});

test('drawer mostra os blocos do prototipo', () => {
  const html = influencerDrawerHtml(modeloDrawer);
  for (const texto of ['Isabela Lima', '@isabelalima.style', 'Moda &amp; Varejo', 'Tesoura de Ouro',
    'Investimento &amp; Acordos', 'Cachê', 'R$ 10.000', 'Voucher / Permuta', 'R$ 5.000', 'Invest. Total', 'R$ 15.000',
    'Cupom Exclusivo:', 'SIM', 'TESOURA10',
    'Campanhas Realizadas', 'Campanha dos Pais 2026', 'Dia das Crianças',
    'Crescimento Semanal', '+17.400 novos seguidores', '▲ +1,2%', '<polyline',
    'Mídias Vinculadas (Meta API)', '1 posts', 'Reel: Provador Tesoura de Ouro', 'Views', '1.840.000', 'Curtidas', '94.200', 'Salvos', '14.800',
    'instagram.com/reel/C8x9L_p/', '+ Vincular Nova URL']) {
    assert.ok(html.includes(texto), `faltou ${texto}`);
  }
  assert.match(html, /inf-status ativo">Ativo</);
  assert.match(html, /href="https:\/\/www\.instagram\.com\/reel\/C8x9L_p\/" target="_blank" rel="noopener noreferrer"/);
});

test('drawer para quem nao edita nao oferece acoes de escrita', () => {
  const html = influencerDrawerHtml({ ...modeloDrawer, podeEditar: false });
  for (const acao of ['data-acao="editar"', 'data-acao="nova-midia"', 'data-editar-midia', 'data-excluir-midia', 'id="infSnapForm"']) {
    assert.ok(!html.includes(acao), `nao deveria ter ${acao}`);
  }
  assert.ok(html.includes('data-acao="fechar"'));
});

test('drawer para editor oferece editar, vincular, editar/excluir midia e registrar seguidores', () => {
  const html = influencerDrawerHtml(modeloDrawer);
  for (const acao of ['data-acao="editar"', 'data-acao="nova-midia"', 'data-editar-midia="m1"', 'data-excluir-midia="m1"', 'id="infSnapForm"', 'value="2026-09-21"']) {
    assert.ok(html.includes(acao), `faltou ${acao}`);
  }
});

test('drawer sem cupom exclusivo mostra NAO e nao mostra o botao de copiar', () => {
  const html = influencerDrawerHtml({ ...modeloDrawer, influenciador: { ...influenciador, cupom_exclusivo: false, cupom_codigo: null } });
  assert.match(html, /<strong class="nao">NÃO<\/strong>/);
  assert.ok(!html.includes('data-cupom='));
});

test('drawer trata ausencia de campanhas, midias e base de crescimento', () => {
  const html = influencerDrawerHtml({
    ...modeloDrawer, campanhas: [], midias: [], pontos: [],
    agregado: { ...agregado, crescimentoAbs: null, crescimentoPct: null, cacheTotal: 0, voucherTotal: 0, investimentoTotal: 0 }
  });
  assert.match(html, /Nenhuma campanha cadastrada/);
  assert.match(html, /Nenhuma mídia vinculada/);
  assert.match(html, /Sem base de 7 dias/);
  assert.match(html, /Registre ao menos 2 dias/);
});

test('drawer nao emite href perigoso e escapa dados do usuario', () => {
  const ruim = { ...midia, titulo: '<b>x</b>', url: 'javascript:alert(1)' };
  const html = influencerDrawerHtml({ ...modeloDrawer, midias: [ruim], campanhas: [{ id: 'c', nome: '<script>1</script>' }] });
  assert.ok(!html.includes('href="javascript:'));
  assert.ok(html.includes('href="#"'));
  assert.ok(!html.includes('<b>x</b>'));
  assert.ok(!html.includes('<script>1</script>'));
});

test('drawer mostra queda de seguidores sem "novos"', () => {
  const html = influencerDrawerHtml({ ...modeloDrawer, agregado: { ...agregado, crescimentoAbs: -500, crescimentoPct: -0.4 } });
  assert.match(html, /-500 seguidores/);
  assert.ok(!html.includes('-500 novos'));
});
