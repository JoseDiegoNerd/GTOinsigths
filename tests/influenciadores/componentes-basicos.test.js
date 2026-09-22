import test from 'node:test';
import assert from 'node:assert/strict';
import { avatarHtml, corAvatar } from '../../public/modules/influenciadores/avatar.js';
import {
  rotuloDiaSemana, calcularPontosSvg, growthChartHtml, crescimentoBadgeHtml
} from '../../public/modules/influenciadores/growth-chart.js';
import { kpiCardsHtml } from '../../public/modules/influenciadores/kpi-cards.js';
import { opcoesMarca, brandFilterPillsHtml } from '../../public/modules/influenciadores/brand-filter-pills.js';

// avatar -----------------------------------------------------------------------------------------
test('avatarHtml usa a foto quando a URL e https', () => {
  const html = avatarHtml({ nome: 'Isabela Lima', url: 'https://ysreenjwihmwzockyrls.supabase.co/x?token=1', tamanho: 'lg', destaque: true });
  assert.match(html, /^<img class="inf-avatar inf-avatar-lg destaque"/);
  assert.match(html, /src="https:\/\/ysreenjwihmwzockyrls\.supabase\.co\/x\?token=1"/);
});

test('avatarHtml cai nas iniciais quando nao ha foto ou a URL nao e https', () => {
  for (const url of [undefined, null, '', 'http://x.com/a.png', 'javascript:alert(1)']) {
    const html = avatarHtml({ nome: 'Isabela Lima', url });
    assert.match(html, /^<span class="inf-avatar inf-avatar-md"/);
    assert.match(html, />IL<\/span>$/);
  }
});

test('avatarHtml escapa o nome', () => {
  const html = avatarHtml({ nome: '"><script>x</script>', url: '' });
  assert.ok(!html.includes('<script>'));
});

test('corAvatar e deterministica', () => {
  assert.deepEqual(corAvatar('Isabela Lima'), corAvatar('Isabela Lima'));
  assert.equal(corAvatar('Isabela Lima').length, 2);
});

// grafico ----------------------------------------------------------------------------------------
test('rotuloDiaSemana', () => {
  assert.equal(rotuloDiaSemana('2026-09-21'), 'Seg');
  assert.equal(rotuloDiaSemana('2026-09-20'), 'Dom');
  assert.equal(rotuloDiaSemana('2026-09-19'), 'Sáb');
});

test('calcularPontosSvg escala entre y=85 (minimo) e y=15 (maximo)', () => {
  assert.deepEqual(calcularPontosSvg([{ seguidores: 100 }, { seguidores: 200 }]), [{ x: 0, y: 85 }, { x: 320, y: 15 }]);
  assert.deepEqual(calcularPontosSvg([{ seguidores: 5 }, { seguidores: 5 }]).map((p) => p.y), [50, 50]);
});

test('growthChartHtml sem dados suficientes mostra orientacao', () => {
  assert.match(growthChartHtml([]), /Registre ao menos 2 dias/);
  assert.match(growthChartHtml([{ data: '2026-09-21', seguidores: 1 }]), /Registre ao menos 2 dias/);
});

test('growthChartHtml desenha linha, area, ponto final e dias da semana', () => {
  const html = growthChartHtml([
    { data: '2026-09-19', seguidores: 100 },
    { data: '2026-09-20', seguidores: 150 },
    { data: '2026-09-21', seguidores: 200 }
  ]);
  assert.match(html, /<polyline[^>]*points="0,85 160,50 320,15"/);
  assert.match(html, /<polygon[^>]*points="0,85 160,50 320,15 320,100 0,100"/);
  assert.match(html, /<circle cx="320" cy="15"/);
  assert.match(html, /<span>Sáb<\/span><span>Dom<\/span><span class="ultimo">Seg<\/span>/);
});

test('crescimentoBadgeHtml', () => {
  assert.match(crescimentoBadgeHtml(1.2), /inf-cresc sobe">▲ \+1,2%/);
  assert.match(crescimentoBadgeHtml(-0.5), /inf-cresc desce">▼ -0,5%/);
  assert.match(crescimentoBadgeHtml(null), /inf-cresc neutro">—/);
});

// KPIs -------------------------------------------------------------------------------------------
const kpis = {
  investimento: { atual: 45000, anterior: 32000, variacao: 40.625 },
  alcance: { atual: 12850400, anterior: 8100000, variacao: 58.6 },
  engajamento: { atual: 4.12, anterior: 3.2, variacao: 28.7 },
  cpe: { atual: 0.38, anterior: 0.45, variacao: -15.5 }
};

test('kpiCardsHtml renderiza os quatro cards com valores formatados', () => {
  const html = kpiCardsHtml(kpis);
  assert.equal(html.match(/<article/g).length, 4);
  for (const texto of ['INVESTIMENTO TOTAL', 'ALCANCE TOTAL GERADO', 'ENGAJAMENTO MÉDIO', 'CUSTO POR ENGAJAMENTO (CPE)',
    'R$ 45.000,00', '12.850.400', '4,12%', 'R$ 0,38', 'R$ 32.000,00']) {
    assert.ok(html.includes(texto), `faltou ${texto}`);
  }
});

test('kpiCardsHtml: para CPE, queda e favoravel; para os demais, alta e favoravel', () => {
  const html = kpiCardsHtml(kpis);
  assert.match(html, /inf-delta favoravel">▲ \+40,6%/);
  assert.match(html, /inf-delta favoravel">▼ -15,5%/);
  const ruim = kpiCardsHtml({ ...kpis, alcance: { atual: 1, anterior: 2, variacao: -10 }, cpe: { atual: 1, anterior: 0.5, variacao: 100 } });
  assert.match(ruim, /inf-delta desfavoravel">▼ -10,0%/);
  assert.match(ruim, /inf-delta desfavoravel">▲ \+100,0%/);
});

test('kpiCardsHtml sem base mostra travessao neutro', () => {
  const vazio = { atual: null, anterior: null, variacao: null };
  const html = kpiCardsHtml({ investimento: vazio, alcance: vazio, engajamento: vazio, cpe: vazio });
  assert.match(html, /inf-delta neutro">—/);
  assert.ok(!html.includes('NaN') && !html.includes('Infinity'));
});

// pilulas ----------------------------------------------------------------------------------------
const marcas = ['Todas', 'Tesoura de Ouro', 'Magazine da Economia', 'Free Center Calçados'];

test('opcoesMarca: todos os cargos veem "Todas" (visao ampla entre marcas)', () => {
  assert.deepEqual(opcoesMarca('Admin', marcas), marcas);
  assert.deepEqual(opcoesMarca('Gestor', marcas), marcas);
  assert.deepEqual(opcoesMarca('Coordenador', marcas), marcas);
  assert.deepEqual(opcoesMarca('Analista', marcas), marcas);
});

test('brandFilterPillsHtml marca a ativa e rotula "Todas as Lojas"', () => {
  const html = brandFilterPillsHtml({ opcoes: marcas, marcaAtual: 'Todas' });
  assert.match(html, /class="inf-pill ativa" data-marca="Todas">Todas as Lojas</);
  assert.match(html, /class="inf-pill" data-marca="Tesoura de Ouro">Tesoura de Ouro</);
  assert.match(html, /Bandeira:/);
});
