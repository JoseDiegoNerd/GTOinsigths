// Acesso ao Supabase do modulo Influenciadores. Recebe o cliente por parametro (o mesmo
// createClient do index.html); a autorizacao real e o RLS do banco, nao este arquivo.

const BUCKET = "influenciadores-avatares";
const TABELAS = {
  influenciadores: "influenciadores",
  campanhas: "influenciador_campanhas",
  midias: "influenciador_midias",
  seguidores: "influenciador_seguidores_historico"
};
const TAMANHO_PAGINA = 1000;
const URL_ASSINADA_SEGUNDOS = 3600;
const MSG_INFLUENCIADOR_DUPLICADO = "Já existe um influenciador com este @ nesta rede e bandeira.";
const MSG_URL_DUPLICADA = "Esta URL já está vinculada a este influenciador.";

// Mensagens pt-BR curtas e sem detalhes internos (o app so mostra o que passa por safeErrorMessage).
export function traduzirErro(error, { duplicado } = {}) {
  const codigo = error?.code;
  if (codigo === "23505" && duplicado) return new Error(duplicado);
  const mensagens = {
    "23505": "Já existe um registro com esses dados.",
    "23503": "Registro relacionado não encontrado.",
    "23514": "Algum valor está fora do permitido.",
    "42501": "Você não tem permissão para esta ação."
  };
  return mensagens[codigo] ? new Error(mensagens[codigo]) : error;
}

export async function buscarTodas(supabase, tabela, marca, colunaOrdem, tamanho = TAMANHO_PAGINA) {
  const linhas = [];
  for (let de = 0; ; de += tamanho) {
    let consulta = supabase.from(tabela).select("*")
      .order(colunaOrdem, { ascending: true })
      .order("id", { ascending: true })
      .range(de, de + tamanho - 1);
    if (marca && marca !== "Todas") consulta = consulta.eq("marca", marca);
    const { data, error } = await consulta;
    if (error) throw error;
    linhas.push(...data);
    if (data.length < tamanho) break;
  }
  return linhas;
}

export function criarService(supabase) {
  // Falha em avatar nao pode derrubar a tela: sem URL assinada o avatar cai nas iniciais.
  async function assinarAvatares(influenciadores) {
    const caminhos = influenciadores.map((i) => i.avatar_path).filter(Boolean);
    if (caminhos.length === 0) return new Map();
    try {
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(caminhos, URL_ASSINADA_SEGUNDOS);
      if (error) throw error;
      return new Map(data.filter((d) => d.signedUrl).map((d) => [d.path, d.signedUrl]));
    } catch (erro) {
      console.error(erro);
      return new Map();
    }
  }

  async function carregarTudo(marca) {
    const [influenciadores, campanhas, midias, snapshots] = await Promise.all([
      buscarTodas(supabase, TABELAS.influenciadores, marca, "nome"),
      buscarTodas(supabase, TABELAS.campanhas, marca, "data_inicio"),
      buscarTodas(supabase, TABELAS.midias, marca, "publicada_em"),
      buscarTodas(supabase, TABELAS.seguidores, marca, "data")
    ]);
    const avatares = await assinarAvatares(influenciadores);
    return { influenciadores, campanhas, midias, snapshots, avatares };
  }

  // Nao e transacional (varias chamadas): se uma etapa falhar, o que ja foi gravado permanece e a
  // tela recarrega mostrando o estado real. A marca de um influenciador existente nunca muda.
  async function salvarInfluenciador({ id, valor, campanhas, removidas, avatar }) {
    let influenciadorId = id;
    if (id) {
      const { marca: _marca, ...semMarca } = valor;
      const { error } = await supabase.from(TABELAS.influenciadores).update(semMarca).eq("id", id);
      if (error) throw traduzirErro(error, { duplicado: MSG_INFLUENCIADOR_DUPLICADO });
    } else {
      const { data, error } = await supabase.from(TABELAS.influenciadores).insert(valor).select("id").single();
      if (error) throw traduzirErro(error, { duplicado: MSG_INFLUENCIADOR_DUPLICADO });
      influenciadorId = data.id;
    }

    if (removidas.length > 0) {
      const { error } = await supabase.from(TABELAS.campanhas).delete().in("id", removidas);
      if (error) throw traduzirErro(error);
    }
    const novas = campanhas
      .filter((c) => !c.id)
      .map((c) => ({ ...c.valor, influenciador_id: influenciadorId, marca: valor.marca }));
    if (novas.length > 0) {
      const { error } = await supabase.from(TABELAS.campanhas).insert(novas);
      if (error) throw traduzirErro(error);
    }
    for (const existente of campanhas.filter((c) => c.id)) {
      const { error } = await supabase.from(TABELAS.campanhas).update(existente.valor).eq("id", existente.id);
      if (error) throw traduzirErro(error);
    }

    if (avatar) {
      const caminho = `${influenciadorId}/avatar`;
      const { error: erroUpload } = await supabase.storage.from(BUCKET)
        .upload(caminho, avatar, { upsert: true, contentType: avatar.type, cacheControl: "3600" });
      if (erroUpload) throw erroUpload;
      const { error } = await supabase.from(TABELAS.influenciadores).update({ avatar_path: caminho }).eq("id", influenciadorId);
      if (error) throw traduzirErro(error);
    }
    return influenciadorId;
  }

  async function excluirInfluenciador(id) {
    const { error } = await supabase.from(TABELAS.influenciadores).delete().eq("id", id);
    if (error) throw traduzirErro(error);
    try {
      await supabase.storage.from(BUCKET).remove([`${id}/avatar`]);
    } catch (erro) {
      console.error(erro); // avatar orfao nao impede a exclusao
    }
  }

  async function salvarMidia({ id, influenciadorId, marca, valor }) {
    const consulta = id
      ? supabase.from(TABELAS.midias).update(valor).eq("id", id)
      : supabase.from(TABELAS.midias).insert({ ...valor, influenciador_id: influenciadorId, marca });
    const { error } = await consulta;
    if (error) throw traduzirErro(error, { duplicado: MSG_URL_DUPLICADA });
  }

  async function excluirMidia(id) {
    const { error } = await supabase.from(TABELAS.midias).delete().eq("id", id);
    if (error) throw traduzirErro(error);
  }

  async function registrarSeguidores({ influenciadorId, marca, data, seguidores }) {
    const { error } = await supabase.from(TABELAS.seguidores).upsert(
      { influenciador_id: influenciadorId, marca, data, seguidores },
      { onConflict: "influenciador_id,data" }
    );
    if (error) throw traduzirErro(error);
  }

  // supabase.functions.invoke() devolve { data, error, response }. Quando a Edge Function responde
  // com status != 2xx, error e um FunctionsHttpError cujo error.context e o Response bruto; o corpo
  // JSON que a funcao devolveu (ex.: { error: "mensagem em pt-BR" }) so aparece chamando
  // error.context.json() - nao existe um campo "context" separado no retorno do invoke(). Formato
  // confirmado em node_modules/@supabase/functions-js/dist/module/FunctionsClient.js.
  async function sincronizarInstagram(influenciadorId) {
    const { data, error } = await supabase.functions.invoke("influenciador-instagram-sync", {
      body: { influenciador_id: influenciadorId }
    });
    if (error) {
      let mensagem = "Nao foi possivel sincronizar com o Instagram.";
      try {
        const corpo = error.context?.json ? await error.context.json() : null;
        if (corpo?.error) mensagem = corpo.error;
      } catch {
        // resposta sem JSON legivel - mantem a mensagem generica
      }
      throw new Error(mensagem);
    }
    return { seguidores: data.seguidores, publicacoes_total: data.publicacoes_total };
  }

  return { carregarTudo, salvarInfluenciador, excluirInfluenciador, salvarMidia, excluirMidia, registrarSeguidores, sincronizarInstagram };
}
