import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MARCAS_VALIDAS, parseNumeroBR, parseInteiro, detectarPlataforma,
  validarInfluenciador, validarCampanha, validarMidia, validarSeguidores, validarAvatar
} from '../../public/modules/influenciadores/validacao.js';

test('parseNumeroBR aceita formatos brasileiro e internacional', () => {
  assert.equal(parseNumeroBR('10.000,50'), 10000.5);
  assert.equal(parseNumeroBR('10.000'), 10000);
  assert.equal(parseNumeroBR('10000.5'), 10000.5);
  assert.equal(parseNumeroBR('1,5'), 1.5);
  assert.equal(parseNumeroBR('R$ 2.500,00'), 2500);
  assert.equal(parseNumeroBR('0'), 0);
  assert.ok(Number.isNaN(parseNumeroBR('abc')));
  assert.ok(Number.isNaN(parseNumeroBR('')));
});

test('parseInteiro aceita separador de milhar e vazio como zero', () => {
  assert.equal(parseInteiro('1.840.000'), 1840000);
  assert.equal(parseInteiro('  94200 '), 94200);
  assert.equal(parseInteiro(''), 0);
  assert.ok(Number.isNaN(parseInteiro('12,5')));
  assert.ok(Number.isNaN(parseInteiro('-3')));
});

test('detectarPlataforma pelo dominio', () => {
  assert.equal(detectarPlataforma('https://www.instagram.com/reel/C8x9L_p/'), 'Instagram');
  assert.equal(detectarPlataforma('https://vm.tiktok.com/abc'), 'TikTok');
  assert.equal(detectarPlataforma('https://youtu.be/abc'), 'YouTube');
  assert.equal(detectarPlataforma('https://www.youtube.com/shorts/abc'), 'YouTube');
  assert.equal(detectarPlataforma('https://exemplo.com/x'), null);
  assert.equal(detectarPlataforma('nao e url'), null);
});

const influenciadorValido = {
  marca: 'Tesoura de Ouro', nome: '  Isabela Lima ', handle: 'isabelalima.style', rede_social: 'Instagram',
  verificado: true, nicho: 'Moda & Varejo', cupom_codigo: 'tesoura10', cupom_exclusivo: true, status: 'Ativo'
};

test('validarInfluenciador normaliza handle, nome e cupom', () => {
  const r = validarInfluenciador(influenciadorValido);
  assert.equal(r.ok, true);
  assert.deepEqual(r.valor, {
    marca: 'Tesoura de Ouro', nome: 'Isabela Lima', handle: '@isabelalima.style', rede_social: 'Instagram',
    verificado: true, nicho: 'Moda & Varejo', cupom_codigo: 'TESOURA10', cupom_exclusivo: true, status: 'Ativo'
  });
});

test('validarInfluenciador transforma campos vazios opcionais em null', () => {
  const r = validarInfluenciador({ ...influenciadorValido, nicho: ' ', cupom_codigo: '', cupom_exclusivo: false });
  assert.equal(r.ok, true);
  assert.equal(r.valor.nicho, null);
  assert.equal(r.valor.cupom_codigo, null);
});

test('validarInfluenciador rejeita dados invalidos com mensagens em portugues', () => {
  const r = validarInfluenciador({
    marca: 'Outra', nome: 'A', handle: '@a b', rede_social: 'Kwai', status: 'X',
    nicho: 'x'.repeat(61), cupom_codigo: 'a', cupom_exclusivo: false
  });
  assert.equal(r.ok, false);
  for (const campo of ['marca', 'nome', 'handle', 'rede_social', 'status', 'nicho', 'cupom_codigo']) {
    assert.equal(typeof r.erros[campo], 'string', `esperava erro em ${campo}`);
  }
});

test('validarInfluenciador exige codigo quando o cupom e exclusivo', () => {
  const r = validarInfluenciador({ ...influenciadorValido, cupom_codigo: '', cupom_exclusivo: true });
  assert.equal(r.ok, false);
  assert.match(r.erros.cupom_codigo, /cupom/i);
});

test('validarCampanha converte valores e datas', () => {
  const r = validarCampanha({
    nome: ' Campanha dos Pais 2026 ', data_inicio: '2026-08-01', data_fim: '',
    cache_valor: '10.000,00', voucher_valor: '5000'
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.valor, {
    nome: 'Campanha dos Pais 2026', data_inicio: '2026-08-01', data_fim: null, cache_valor: 10000, voucher_valor: 5000
  });
});

test('validarCampanha trata valores vazios como zero', () => {
  const r = validarCampanha({ nome: 'X', data_inicio: '2026-08-01', data_fim: '', cache_valor: '', voucher_valor: '' });
  assert.equal(r.ok, true);
  assert.equal(r.valor.cache_valor, 0);
  assert.equal(r.valor.voucher_valor, 0);
});

test('validarCampanha rejeita periodo invertido, data inexistente e valor negativo', () => {
  assert.match(validarCampanha({ nome: 'X', data_inicio: '2026-08-10', data_fim: '2026-08-01', cache_valor: '0', voucher_valor: '0' }).erros.data_fim, /fim/i);
  assert.ok(validarCampanha({ nome: 'X', data_inicio: '2026-02-30', data_fim: '', cache_valor: '0', voucher_valor: '0' }).erros.data_inicio);
  assert.ok(validarCampanha({ nome: '', data_inicio: '2026-08-01', data_fim: '', cache_valor: '-5', voucher_valor: 'abc' }).erros.nome);
  const r = validarCampanha({ nome: 'X', data_inicio: '2026-08-01', data_fim: '', cache_valor: '-5', voucher_valor: 'abc' });
  assert.ok(r.erros.cache_valor);
  assert.ok(r.erros.voucher_valor);
});

const midiaValida = {
  titulo: 'Reel: Provador Tesoura de Ouro', url: 'https://www.instagram.com/reel/C8x9L_p/', plataforma: '',
  formato: 'Reel', publicada_em: '2026-09-10', campanha_id: '',
  views: '1.840.000', alcance: '4.230.000', curtidas: '94.200', comentarios: '', salvos: '14.800', compartilhamentos: '0'
};

test('validarMidia detecta a plataforma pela URL e converte metricas', () => {
  const r = validarMidia(midiaValida);
  assert.equal(r.ok, true);
  assert.equal(r.valor.plataforma, 'Instagram');
  assert.equal(r.valor.views, 1840000);
  assert.equal(r.valor.comentarios, 0);
  assert.equal(r.valor.campanha_id, null);
  assert.equal(r.valor.url, 'https://www.instagram.com/reel/C8x9L_p/');
});

test('validarMidia rejeita http, javascript: e URL invalida', () => {
  assert.ok(validarMidia({ ...midiaValida, url: 'http://instagram.com/reel/x' }).erros.url);
  assert.ok(validarMidia({ ...midiaValida, url: 'javascript:alert(1)' }).erros.url);
  assert.ok(validarMidia({ ...midiaValida, url: 'instagram.com/reel/x' }).erros.url);
  assert.ok(validarMidia({ ...midiaValida, url: 'https://a.com/' + 'x'.repeat(500) }).erros.url);
});

test('validarMidia exige plataforma quando o dominio nao e reconhecido', () => {
  const r = validarMidia({ ...midiaValida, url: 'https://blog.exemplo.com/post', plataforma: '' });
  assert.ok(r.erros.plataforma);
  assert.equal(validarMidia({ ...midiaValida, url: 'https://blog.exemplo.com/post', plataforma: 'YouTube' }).ok, true);
});

test('validarMidia rejeita metrica invalida e formato desconhecido', () => {
  const r = validarMidia({ ...midiaValida, views: '12,5', formato: 'Podcast', publicada_em: '' });
  assert.ok(r.erros.views);
  assert.ok(r.erros.formato);
  assert.ok(r.erros.publicada_em);
});

test('validarSeguidores', () => {
  assert.deepEqual(validarSeguidores({ data: '2026-09-21', seguidores: '1.450.000' }, '2026-09-21').valor, { data: '2026-09-21', seguidores: 1450000 });
  assert.ok(validarSeguidores({ data: '2026-09-22', seguidores: '10' }, '2026-09-21').erros.data);
  assert.ok(validarSeguidores({ data: '2026-09-21', seguidores: '' }, '2026-09-21').erros.seguidores);
  assert.ok(validarSeguidores({ data: '2026-09-21', seguidores: '-1' }, '2026-09-21').erros.seguidores);
});

test('validarAvatar limita tipo e tamanho', () => {
  assert.equal(validarAvatar({ type: 'image/png', size: 500000 }).ok, true);
  assert.equal(validarAvatar({ type: 'image/webp', size: 1048576 }).ok, true);
  assert.equal(validarAvatar({ type: 'image/gif', size: 100 }).ok, false);
  assert.equal(validarAvatar({ type: 'image/jpeg', size: 1048577 }).ok, false);
  assert.match(validarAvatar({ type: 'image/jpeg', size: 2000000 }).erro, /1 MB/);
});

test('MARCAS_VALIDAS lista as tres bandeiras', () => {
  assert.deepEqual(MARCAS_VALIDAS, ['Tesoura de Ouro', 'Magazine da Economia', 'Free Center Calçados']);
});
