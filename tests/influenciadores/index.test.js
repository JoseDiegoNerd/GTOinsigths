import test from 'node:test';
import assert from 'node:assert/strict';
import {
  initInfluenciadores, renderInfluenciadores, prepararSnapshotSeguidores
} from '../../public/modules/influenciadores/index.js';

// Nao existe jsdom no projeto: este stub implementa so a superficie de DOM que index.js e os
// bind* dos componentes realmente usam (innerHTML como campo simples, querySelector devolvendo
// null e querySelectorAll devolvendo lista vazia). Os bind* fazem `if (el)` ou `.forEach(...)`
// sobre esses retornos, entao nada lanca excecao.
function criarElementoStub() {
  return {
    innerHTML: '',
    hidden: false,
    querySelector: () => null,
    querySelectorAll: () => []
  };
}

// Cliente Supabase falso: mesmo padrao de Proxy encadeavel de service.test.js, respondendo lista
// vazia em todas as tabelas. O objetivo aqui nao e testar dados, e provar que o boot dispara a
// consulta e sai do estado "Carregando...".
function criarSupabaseFalso() {
  const chamadas = [];
  function from(tabela) {
    const registro = { tabela, ops: [] };
    chamadas.push(registro);
    const q = new Proxy({}, {
      get(_, prop) {
        if (prop === 'then') {
          return (resolve, reject) => Promise.resolve({ data: [], error: null }).then(resolve, reject);
        }
        return (...args) => { registro.ops.push([prop, ...args]); return q; };
      }
    });
    return q;
  }
  const supabase = {
    from,
    storage: {
      from: () => ({
        createSignedUrls: async (caminhos) => ({ data: caminhos.map((p) => ({ path: p, signedUrl: `https://x/${p}` })), error: null })
      })
    }
  };
  return { supabase, chamadas };
}

const escapeHtml = (texto) => String(texto ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

test('renderInfluenciadores carrega os dados no primeiro boot e nao trava em "Carregando..."', async () => {
  const { supabase, chamadas } = criarSupabaseFalso();
  const contentEl = criarElementoStub();
  const state = { contentEl, marca: 'Todas', perfil: { cargo: 'Admin' } };

  await initInfluenciadores({
    supabase,
    state,
    escapeHtml,
    marcas: ['Todas', 'Tesoura de Ouro', 'Magazine da Economia', 'Free Center Calçados'],
    safeErrorMessage: (_erro, fallback) => fallback
  });

  await renderInfluenciadores();

  assert.ok(chamadas.length > 0, 'esperava ao menos uma consulta ao Supabase (carregar() deve rodar)');
  assert.ok(!contentEl.innerHTML.includes('Carregando'), 'a tela nao pode ficar presa no placeholder de carregamento');

  // Segunda visita a pagina (usuario sai e volta): o estado de modulo continua vivo e nao pode
  // recair no deadlock original.
  const antes = chamadas.length;
  await renderInfluenciadores();
  assert.ok(!contentEl.innerHTML.includes('Carregando'), 'a segunda navegacao tambem nao pode travar em carregamento');
  assert.ok(chamadas.length >= antes, 'a segunda navegacao nao deve quebrar a renderizacao');
});

test('Analista tambem edita (escrita ampliada): botao "Novo Influenciador" aparece para o cargo Analista', async () => {
  const { supabase } = criarSupabaseFalso();
  const contentEl = criarElementoStub();
  const state = { contentEl, marca: 'Todas', perfil: { cargo: 'Analista', marca_vinculada: 'Tesoura de Ouro' } };

  await initInfluenciadores({
    supabase,
    state,
    escapeHtml,
    marcas: ['Todas', 'Tesoura de Ouro', 'Magazine da Economia', 'Free Center Calçados'],
    safeErrorMessage: (_erro, fallback) => fallback
  });

  await renderInfluenciadores();

  assert.ok(contentEl.innerHTML.includes('Novo Influenciador'), 'Analista tambem deve poder criar/editar influenciadores agora');
});

test('prepararSnapshotSeguidores rejeita valor nao numerico em vez de gravar 0', () => {
  const r = prepararSnapshotSeguidores({ data: '2026-09-20', seguidores: '   ' }, '2026-09-22');
  assert.equal(r.ok, false);
  assert.match(r.mensagem, /seguidores/i);
});

test('prepararSnapshotSeguidores rejeita data futura', () => {
  const r = prepararSnapshotSeguidores({ data: '2026-12-31', seguidores: '1000' }, '2026-09-22');
  assert.equal(r.ok, false);
  assert.match(r.mensagem, /futura/i);
});

test('prepararSnapshotSeguidores devolve o valor ja convertido quando valido', () => {
  const r = prepararSnapshotSeguidores({ data: '2026-09-20', seguidores: '10.500' }, '2026-09-22');
  assert.equal(r.ok, true);
  assert.deepEqual(r.valor, { data: '2026-09-20', seguidores: 10500 });
});
