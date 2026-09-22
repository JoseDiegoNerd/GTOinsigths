import test from 'node:test';
import assert from 'node:assert/strict';
import { criarService, buscarTodas, traduzirErro } from '../../public/modules/influenciadores/service.js';

// Cliente Supabase falso: cada from(tabela) devolve um encadeavel que registra as operacoes e,
// ao ser aguardado, responde com respostas[tabela] (valor ou funcao do registro).
function criarFake({ respostas = {}, falharAssinatura = false, falharRemocao = false } = {}) {
  const chamadas = [];
  const storage = { uploads: [], remocoes: [], assinaturas: [] };
  function from(tabela) {
    const registro = { tabela, ops: [] };
    chamadas.push(registro);
    const q = new Proxy({}, {
      get(_, prop) {
        if (prop === 'then') {
          return (resolve, reject) => {
            const r = respostas[tabela];
            const resposta = typeof r === 'function' ? r(registro) : (r ?? { data: null, error: null });
            return Promise.resolve(resposta).then(resolve, reject);
          };
        }
        return (...args) => { registro.ops.push([prop, ...args]); return q; };
      }
    });
    return q;
  }
  const supabase = {
    from,
    storage: {
      from: (bucket) => ({
        upload: async (caminho, arquivo, opcoes) => { storage.uploads.push({ bucket, caminho, opcoes }); return { error: null }; },
        remove: async (caminhos) => {
          if (falharRemocao) throw new Error('falha de rede');
          storage.remocoes.push({ bucket, caminhos });
          return { error: null };
        },
        createSignedUrls: async (caminhos, segundos) => {
          if (falharAssinatura) throw new Error('falha de rede');
          storage.assinaturas.push({ bucket, caminhos, segundos });
          return { data: caminhos.map((p) => ({ path: p, signedUrl: `https://assinada/${p}` })), error: null };
        }
      })
    }
  };
  return { supabase, chamadas, storage };
}

const op = (registro, nome) => registro.ops.find((o) => o[0] === nome);
const doTabela = (chamadas, tabela) => chamadas.filter((c) => c.tabela === tabela);
const ok = { data: [], error: null };

test('buscarTodas pagina com range e filtra por marca', async () => {
  let n = 0;
  const paginas = [[1, 2], [3]];
  const { supabase, chamadas } = criarFake({ respostas: { t: () => ({ data: paginas[n++], error: null }) } });
  const linhas = await buscarTodas(supabase, 't', 'Tesoura de Ouro', 'nome', 2);
  assert.deepEqual(linhas, [1, 2, 3]);
  assert.equal(chamadas.length, 2);
  assert.deepEqual(op(chamadas[0], 'range'), ['range', 0, 1]);
  assert.deepEqual(op(chamadas[1], 'range'), ['range', 2, 3]);
  assert.deepEqual(op(chamadas[0], 'eq'), ['eq', 'marca', 'Tesoura de Ouro']);
});

test('buscarTodas nao filtra quando a marca e "Todas"', async () => {
  const { supabase, chamadas } = criarFake({ respostas: { t: { data: [], error: null } } });
  await buscarTodas(supabase, 't', 'Todas', 'nome');
  assert.equal(op(chamadas[0], 'eq'), undefined);
});

test('buscarTodas propaga o erro do Supabase', async () => {
  const { supabase } = criarFake({ respostas: { t: { data: null, error: { message: 'x', code: '42501' } } } });
  await assert.rejects(buscarTodas(supabase, 't', 'Todas', 'nome'), { code: '42501' });
});

test('carregarTudo busca as quatro tabelas e assina os avatares por 1 hora', async () => {
  const { supabase, storage } = criarFake({
    respostas: {
      influenciadores: { data: [{ id: 'i1', avatar_path: 'i1/avatar' }, { id: 'i2', avatar_path: null }], error: null },
      influenciador_campanhas: ok, influenciador_midias: ok, influenciador_seguidores_historico: ok
    }
  });
  const dados = await criarService(supabase).carregarTudo('Todas');
  assert.equal(dados.influenciadores.length, 2);
  assert.equal(dados.avatares.get('i1/avatar'), 'https://assinada/i1/avatar');
  assert.deepEqual(storage.assinaturas, [{ bucket: 'influenciadores-avatares', caminhos: ['i1/avatar'], segundos: 3600 }]);
});

test('carregarTudo sem avatares nao chama o storage', async () => {
  const { supabase, storage } = criarFake({
    respostas: { influenciadores: { data: [{ id: 'i1', avatar_path: null }], error: null },
      influenciador_campanhas: ok, influenciador_midias: ok, influenciador_seguidores_historico: ok }
  });
  const dados = await criarService(supabase).carregarTudo('Todas');
  assert.equal(storage.assinaturas.length, 0);
  assert.equal(dados.avatares.size, 0);
});

test('carregarTudo nao quebra a tela se a assinatura de avatar falhar', async () => {
  const { supabase } = criarFake({
    falharAssinatura: true,
    respostas: { influenciadores: { data: [{ id: 'i1', avatar_path: 'i1/avatar' }], error: null },
      influenciador_campanhas: ok, influenciador_midias: ok, influenciador_seguidores_historico: ok }
  });
  const dados = await criarService(supabase).carregarTudo('Todas');
  assert.equal(dados.influenciadores.length, 1);
  assert.equal(dados.avatares.size, 0);
});

const valorInfluenciador = {
  marca: 'Tesoura de Ouro', nome: 'Isabela Lima', handle: '@isabelalima', rede_social: 'Instagram', verificado: true,
  nicho: null, cupom_codigo: null, cupom_exclusivo: false, status: 'Ativo'
};
const valorCampanha = { nome: 'Pais', data_inicio: '2026-08-01', data_fim: null, cache_valor: 10000, voucher_valor: 5000 };

test('salvarInfluenciador (novo) insere o pai e depois as campanhas com id e marca do pai', async () => {
  const { supabase, chamadas } = criarFake({
    respostas: { influenciadores: { data: { id: 'novo' }, error: null }, influenciador_campanhas: ok }
  });
  const id = await criarService(supabase).salvarInfluenciador({
    id: null, valor: valorInfluenciador, campanhas: [{ id: null, valor: valorCampanha }], removidas: [], avatar: null
  });
  assert.equal(id, 'novo');
  const [pai] = doTabela(chamadas, 'influenciadores');
  assert.deepEqual(op(pai, 'insert'), ['insert', valorInfluenciador]);
  const [camp] = doTabela(chamadas, 'influenciador_campanhas');
  assert.deepEqual(op(camp, 'insert'), ['insert', [{ ...valorCampanha, influenciador_id: 'novo', marca: 'Tesoura de Ouro' }]]);
});

test('salvarInfluenciador (edicao) nao altera a marca, remove, atualiza e envia avatar', async () => {
  const { supabase, chamadas, storage } = criarFake({ respostas: { influenciadores: ok, influenciador_campanhas: ok } });
  const arquivo = { type: 'image/png', size: 1000 };
  const id = await criarService(supabase).salvarInfluenciador({
    id: 'i1', valor: valorInfluenciador,
    campanhas: [{ id: 'c1', valor: valorCampanha }], removidas: ['c9'], avatar: arquivo
  });
  assert.equal(id, 'i1');
  const [atualizaPai, atualizaAvatar] = doTabela(chamadas, 'influenciadores');
  const { marca, ...semMarca } = valorInfluenciador;
  assert.deepEqual(op(atualizaPai, 'update'), ['update', semMarca]);
  assert.deepEqual(op(atualizaPai, 'eq'), ['eq', 'id', 'i1']);
  assert.deepEqual(op(atualizaAvatar, 'update'), ['update', { avatar_path: 'i1/avatar' }]);
  const camps = doTabela(chamadas, 'influenciador_campanhas');
  assert.deepEqual(op(camps[0], 'in'), ['in', 'id', ['c9']]);
  assert.ok(op(camps[0], 'delete'));
  assert.deepEqual(op(camps[1], 'update'), ['update', valorCampanha]);
  assert.deepEqual(op(camps[1], 'eq'), ['eq', 'id', 'c1']);
  assert.deepEqual(storage.uploads, [{
    bucket: 'influenciadores-avatares', caminho: 'i1/avatar',
    opcoes: { upsert: true, contentType: 'image/png', cacheControl: '3600' }
  }]);
});

test('salvarInfluenciador traduz handle duplicado', async () => {
  const { supabase } = criarFake({ respostas: { influenciadores: { data: null, error: { code: '23505' } } } });
  await assert.rejects(
    criarService(supabase).salvarInfluenciador({ id: null, valor: valorInfluenciador, campanhas: [], removidas: [], avatar: null }),
    /já existe um influenciador/i
  );
});

test('excluirInfluenciador remove a linha e tenta apagar o avatar sem falhar se o storage cair', async () => {
  const { supabase, chamadas, storage } = criarFake({ respostas: { influenciadores: ok } });
  await criarService(supabase).excluirInfluenciador('i1');
  assert.deepEqual(op(chamadas[0], 'eq'), ['eq', 'id', 'i1']);
  assert.deepEqual(storage.remocoes, [{ bucket: 'influenciadores-avatares', caminhos: ['i1/avatar'] }]);

  const { supabase: s2 } = criarFake({ respostas: { influenciadores: ok }, falharRemocao: true });
  await criarService(s2).excluirInfluenciador('i1');
});

test('salvarMidia insere com id e marca, atualiza sem eles e traduz URL duplicada', async () => {
  const valor = { titulo: 'Reel', url: 'https://instagram.com/reel/x', plataforma: 'Instagram', formato: 'Reel', publicada_em: '2026-09-10', campanha_id: null, views: 1, alcance: 2, curtidas: 3, comentarios: 4, salvos: 5, compartilhamentos: 6 };
  const a = criarFake({ respostas: { influenciador_midias: ok } });
  await criarService(a.supabase).salvarMidia({ id: null, influenciadorId: 'i1', marca: 'Tesoura de Ouro', valor });
  assert.deepEqual(op(a.chamadas[0], 'insert'), ['insert', { ...valor, influenciador_id: 'i1', marca: 'Tesoura de Ouro' }]);

  const b = criarFake({ respostas: { influenciador_midias: ok } });
  await criarService(b.supabase).salvarMidia({ id: 'm1', influenciadorId: 'i1', marca: 'Tesoura de Ouro', valor });
  assert.deepEqual(op(b.chamadas[0], 'update'), ['update', valor]);
  assert.deepEqual(op(b.chamadas[0], 'eq'), ['eq', 'id', 'm1']);

  const c = criarFake({ respostas: { influenciador_midias: { data: null, error: { code: '23505' } } } });
  await assert.rejects(
    criarService(c.supabase).salvarMidia({ id: null, influenciadorId: 'i1', marca: 'Tesoura de Ouro', valor }),
    /URL já está vinculada/i
  );
});

test('excluirMidia', async () => {
  const { supabase, chamadas } = criarFake({ respostas: { influenciador_midias: ok } });
  await criarService(supabase).excluirMidia('m1');
  assert.ok(op(chamadas[0], 'delete'));
  assert.deepEqual(op(chamadas[0], 'eq'), ['eq', 'id', 'm1']);
});

test('registrarSeguidores faz upsert por influenciador e dia', async () => {
  const { supabase, chamadas } = criarFake({ respostas: { influenciador_seguidores_historico: ok } });
  await criarService(supabase).registrarSeguidores({ influenciadorId: 'i1', marca: 'Tesoura de Ouro', data: '2026-09-21', seguidores: 1450000 });
  assert.deepEqual(op(chamadas[0], 'upsert'), [
    'upsert',
    { influenciador_id: 'i1', marca: 'Tesoura de Ouro', data: '2026-09-21', seguidores: 1450000 },
    { onConflict: 'influenciador_id,data' }
  ]);
});

test('traduzirErro', () => {
  assert.match(traduzirErro({ code: '23505' }, { duplicado: 'Repetido!' }).message, /Repetido!/);
  assert.match(traduzirErro({ code: '23505' }).message, /Já existe/);
  assert.match(traduzirErro({ code: '42501' }).message, /permissão/);
  assert.match(traduzirErro({ code: '23514' }).message, /fora do permitido/);
  const desconhecido = { code: 'XX000', message: 'boom' };
  assert.equal(traduzirErro(desconhecido), desconhecido);
});
