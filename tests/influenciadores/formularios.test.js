import test from 'node:test';
import assert from 'node:assert/strict';
import {
  campanhaVazia, estadoInicialInfluenciador, influencerFormHtml, validarFormularioInfluenciador
} from '../../public/modules/influenciadores/influencer-form-modal.js';
import {
  estadoInicialMidia, midiaFormHtml, validarFormularioMidia
} from '../../public/modules/influenciadores/midia-form-modal.js';
import { MARCAS_VALIDAS } from '../../public/modules/influenciadores/validacao.js';

const influenciador = {
  id: 'i1', marca: 'Tesoura de Ouro', nome: 'Isabela Lima', handle: '@isabelalima.style', rede_social: 'Instagram',
  verificado: true, nicho: 'Moda', cupom_codigo: 'TESOURA10', cupom_exclusivo: true, status: 'Pausado'
};
const campanhas = [{ id: 'c1', nome: 'Pais 2026', data_inicio: '2026-08-01', data_fim: null, cache_valor: 10000.5, voucher_valor: 5000 }];

test('campanhaVazia usa a data de hoje e valores zerados', () => {
  assert.deepEqual(campanhaVazia('2026-09-21'), {
    id: null, nome: '', data_inicio: '2026-09-21', data_fim: '', cache_valor: '0', voucher_valor: '0'
  });
});

test('estadoInicialInfluenciador (novo) usa padroes e a marca sugerida', () => {
  const e = estadoInicialInfluenciador({ influenciador: null, campanhas: [], marcaPadrao: 'Magazine da Economia' });
  assert.equal(e.id, null);
  assert.equal(e.marca, 'Magazine da Economia');
  assert.equal(e.rede_social, 'Instagram');
  assert.equal(e.status, 'Ativo');
  assert.deepEqual(e.campanhas, []);
});

test('estadoInicialInfluenciador (edicao) carrega dados e converte valores para texto BR', () => {
  const e = estadoInicialInfluenciador({ influenciador, campanhas, marcaPadrao: 'x' });
  assert.equal(e.id, 'i1');
  assert.equal(e.marca, 'Tesoura de Ouro');
  assert.equal(e.status, 'Pausado');
  assert.deepEqual(e.campanhas[0], { id: 'c1', nome: 'Pais 2026', data_inicio: '2026-08-01', data_fim: '', cache_valor: '10000,5', voucher_valor: '5000' });
});

test('formulario de novo influenciador mostra a escolha de bandeira e nao mostra excluir', () => {
  const e = estadoInicialInfluenciador({ influenciador: null, campanhas: [], marcaPadrao: 'Tesoura de Ouro' });
  const html = influencerFormHtml(e, { marcasEditaveis: MARCAS_VALIDAS, podeExcluir: true });
  assert.match(html, /id="infFMarca"/);
  assert.match(html, /Novo influenciador/);
  assert.ok(!html.includes('data-excluir-influenciador'));
});

test('formulario de coordenador (uma marca) fixa a bandeira', () => {
  const e = estadoInicialInfluenciador({ influenciador: null, campanhas: [], marcaPadrao: 'Tesoura de Ouro' });
  const html = influencerFormHtml(e, { marcasEditaveis: ['Tesoura de Ouro'], podeExcluir: false });
  assert.ok(!html.includes('id="infFMarca"'));
  assert.match(html, /Tesoura de Ouro/);
});

test('formulario de edicao mostra valores, campanhas e o botao de excluir', () => {
  const e = estadoInicialInfluenciador({ influenciador, campanhas, marcaPadrao: 'x' });
  const html = influencerFormHtml(e, { marcasEditaveis: MARCAS_VALIDAS, podeExcluir: true });
  for (const texto of ['Editar influenciador', 'value="Isabela Lima"', 'value="@isabelalima.style"', 'value="TESOURA10"',
    'value="Pais 2026"', 'value="10000,5"', 'data-remover-camp="0"', 'data-adicionar-camp', 'data-excluir-influenciador']) {
    assert.ok(html.includes(texto), `faltou ${texto}`);
  }
  assert.ok(!html.includes('id="infFMarca"'), 'na edicao a bandeira nao muda');
});

test('formulario pede confirmacao antes de excluir', () => {
  const e = { ...estadoInicialInfluenciador({ influenciador, campanhas, marcaPadrao: 'x' }), confirmandoExclusao: true };
  const html = influencerFormHtml(e, { marcasEditaveis: MARCAS_VALIDAS, podeExcluir: true });
  assert.match(html, /data-confirmar-exclusao/);
  assert.match(html, /data-cancelar-exclusao/);
  assert.ok(!html.includes('data-excluir-influenciador'));
});

test('formulario mostra erros por campo e desabilita salvar enquanto salva', () => {
  const e = { ...estadoInicialInfluenciador({ influenciador: null, campanhas: [], marcaPadrao: 'Tesoura de Ouro' }),
    erros: { nome: 'Informe o nome (2 a 120 caracteres).' }, erroGeral: 'Falhou ao salvar', salvando: true };
  const html = influencerFormHtml(e, { marcasEditaveis: MARCAS_VALIDAS, podeExcluir: false });
  assert.match(html, /<small class="inf-erro">Informe o nome/);
  assert.match(html, /Falhou ao salvar/);
  assert.match(html, /type="submit"[^>]*disabled/);
});

test('formulario escapa dados do usuario', () => {
  const e = estadoInicialInfluenciador({ influenciador: { ...influenciador, nome: '"><script>1</script>' }, campanhas: [], marcaPadrao: 'x' });
  const html = influencerFormHtml(e, { marcasEditaveis: MARCAS_VALIDAS, podeExcluir: true });
  assert.ok(!html.includes('<script>1</script>'));
});

test('validarFormularioInfluenciador valida pai e campanhas juntos', () => {
  const e = estadoInicialInfluenciador({ influenciador, campanhas, marcaPadrao: 'x' });
  const r = validarFormularioInfluenciador(e);
  assert.equal(r.ok, true);
  assert.equal(r.valor.handle, '@isabelalima.style');
  assert.deepEqual(r.campanhas, [{ id: 'c1', valor: { nome: 'Pais 2026', data_inicio: '2026-08-01', data_fim: null, cache_valor: 10000.5, voucher_valor: 5000 } }]);
});

test('validarFormularioInfluenciador aponta a campanha invalida pelo indice', () => {
  const e = estadoInicialInfluenciador({ influenciador, campanhas, marcaPadrao: 'x' });
  e.campanhas.push({ ...campanhaVazia('2026-09-21'), nome: '', cache_valor: '-1' });
  const r = validarFormularioInfluenciador(e);
  assert.equal(r.ok, false);
  assert.ok(r.erros.campanhas[1].nome);
  assert.ok(r.erros.campanhas[1].cache_valor);
  assert.equal(r.erros.campanhas[0], undefined);
});

test('validarFormularioInfluenciador rejeita avatar invalido', () => {
  const e = { ...estadoInicialInfluenciador({ influenciador, campanhas: [], marcaPadrao: 'x' }), avatarFile: { type: 'image/gif', size: 10 } };
  const r = validarFormularioInfluenciador(e);
  assert.equal(r.ok, false);
  assert.ok(r.erros.avatar);
});

// midia ------------------------------------------------------------------------------------------
const midia = {
  id: 'm1', titulo: 'Reel: Provador', url: 'https://www.instagram.com/reel/C8x9L_p/', plataforma: 'Instagram', formato: 'Reel',
  publicada_em: '2026-09-10', campanha_id: 'c1', views: 1840000, alcance: 4230000, curtidas: 94200, comentarios: 0, salvos: 14800, compartilhamentos: 0
};

test('estadoInicialMidia (nova) usa hoje e formato Reel', () => {
  const e = estadoInicialMidia({ midia: null, influenciador, campanhas, hoje: '2026-09-21' });
  assert.equal(e.id, null);
  assert.equal(e.influenciadorId, 'i1');
  assert.equal(e.marca, 'Tesoura de Ouro');
  assert.equal(e.publicada_em, '2026-09-21');
  assert.equal(e.formato, 'Reel');
  assert.deepEqual(e.campanhas, [{ id: 'c1', nome: 'Pais 2026' }]);
});

test('formulario de midia mostra campos, campanhas e metricas', () => {
  const e = estadoInicialMidia({ midia, influenciador, campanhas, hoje: '2026-09-21' });
  const html = midiaFormHtml(e);
  for (const texto of ['Editar mídia', 'value="Reel: Provador"', 'value="https://www.instagram.com/reel/C8x9L_p/"',
    '<option value="c1" selected>Pais 2026</option>', 'value="1840000"', 'id="infMForm"', 'Métricas informadas manualmente']) {
    assert.ok(html.includes(texto), `faltou ${texto}`);
  }
});

test('formulario de midia nova mostra o titulo certo e escapa dados', () => {
  const e = estadoInicialMidia({ midia: null, influenciador: { ...influenciador, nome: '<b>x</b>' }, campanhas, hoje: '2026-09-21' });
  const html = midiaFormHtml({ ...e, titulo: '"><script>1</script>' });
  assert.match(html, /Vincular nova URL/);
  assert.ok(!html.includes('<script>1</script>'));
  assert.ok(!html.includes('<b>x</b>'));
});

test('validarFormularioMidia reaproveita as regras de validacao', () => {
  const e = estadoInicialMidia({ midia, influenciador, campanhas, hoje: '2026-09-21' });
  const r = validarFormularioMidia(e);
  assert.equal(r.ok, true);
  assert.equal(r.valor.plataforma, 'Instagram');
  assert.equal(r.valor.campanha_id, 'c1');
  assert.equal(validarFormularioMidia({ ...e, url: 'http://x.com/a' }).ok, false);
});
