// Sincroniza comentarios do Instagram e Facebook para o Hub de Reputacao (comments_reputation).
//
// Os escopos instagram_business_manage_comments e pages_read_user_content estao em Standard
// Access (app em modo Development): so funcionam para contas com papel (Admin/Developer/Tester)
// no app ate a Meta liberar Acesso Avancado apos a primeira chamada real. Contas conectadas antes
// desses escopos entrarem em meta-oauth-start precisam reconectar - o token antigo nao carrega
// as permissoes novas.
import {
  assertAdminOrGestor,
  errorMessage,
  getAdminClient,
  getAuthenticatedUser,
  jsonResponse,
  logMetaEvent,
  metaGet,
  safeErrorMessage,
  withCors,
} from "../_shared/meta.ts";
import { classificarPendentes } from "../_shared/reputation.ts";

type Integracao = {
  id: string;
  marca: string;
  page_id: string;
  page_name: string | null;
  instagram_business_account_id: string | null;
  access_token: string;
};

type PostRef = { rede_social: "Instagram" | "Facebook"; post_id: string };

// Teto de posts por rede, por conta, a cada execucao - evita estourar o limite de requisicoes da
// Graph API numa conta com muitas publicacoes.
const MAX_POSTS_POR_REDE = 15;

function ePostReal(postId: string) {
  return Boolean(postId) && !postId.startsWith("page-summary:");
}

// Posts ja sincronizados pelo meta-sync-insights (stage_social_format_metrics) - reaproveita essa
// lista em vez de chamar /media ou /posts de novo so pra descobrir quais existem.
async function postsRecentes(integracao: Integracao): Promise<PostRef[]> {
  const supabase = getAdminClient();
  const contaIds = [integracao.instagram_business_account_id, integracao.page_id].filter(Boolean) as string[];
  if (!contaIds.length) return [];

  const { data, error } = await supabase
    .from("stage_social_format_metrics")
    .select("rede_social,conta_id,post_id,data_referencia")
    .eq("marca", integracao.marca)
    .in("conta_id", contaIds)
    .order("data_referencia", { ascending: false })
    .limit(300);

  if (error) throw error;

  const vistos = new Set<string>();
  const posts: PostRef[] = [];
  for (const row of data || []) {
    if (!ePostReal(row.post_id)) continue;
    const chave = `${row.rede_social}:${row.post_id}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    posts.push({ rede_social: row.rede_social as "Instagram" | "Facebook", post_id: row.post_id });
  }
  return posts;
}

// Erros de permissao (escopo nao concedido/nao aprovado) sao esperados ate a revisao da Meta
// terminar - detecta pra deixar o aviso claro em vez de um erro generico.
function mensagemAmigavel(mensagemBruta: string) {
  if (/OAuthException|does not have permission|permission|scope/i.test(mensagemBruta)) {
    return `Sem permissao para ler comentarios desta conta - reconecte-a (ela precisa ter um papel de Admin/Developer/Tester no app Meta, ou a Meta ja ter liberado Acesso Avancado para instagram_business_manage_comments/pages_read_user_content). Detalhe: ${mensagemBruta}`;
  }
  return mensagemBruta;
}

async function upsertComentario(
  source: "meta_instagram" | "meta_facebook",
  marca: string,
  comentario: { id?: string; texto: string | null; autor: string | null; criadoEm: string | null },
) {
  const commentId = String(comentario.id || "");
  if (!commentId) return 0;

  const supabase = getAdminClient();
  const { error } = await supabase
    .from("comments_reputation")
    .upsert({
      source,
      external_id: commentId,
      marca,
      author_name: comentario.autor,
      content: comentario.texto,
      created_at: comentario.criadoEm || new Date().toISOString(),
      atualizado_em: new Date().toISOString(),
    }, { onConflict: "marca,source,external_id" });

  if (error) throw error;
  return 1;
}

async function syncComentariosInstagram(integracao: Integracao, post: PostRef, warnings: string[]) {
  try {
    const resposta = await metaGet(`/${post.post_id}/comments`, {
      fields: "id,text,username,timestamp",
      access_token: integracao.access_token,
    });

    let importados = 0;
    for (const item of resposta?.data || []) {
      importados += await upsertComentario("meta_instagram", integracao.marca, {
        id: item.id,
        texto: item.text || null,
        autor: item.username || null,
        criadoEm: item.timestamp || null,
      });
    }
    return importados;
  } catch (error) {
    warnings.push(`Comentarios Instagram (post ${post.post_id}): ${mensagemAmigavel(errorMessage(error))}`);
    return 0;
  }
}

async function syncComentariosFacebook(integracao: Integracao, post: PostRef, warnings: string[]) {
  try {
    const resposta = await metaGet(`/${post.post_id}/comments`, {
      fields: "id,message,from,created_time",
      access_token: integracao.access_token,
    });

    let importados = 0;
    for (const item of resposta?.data || []) {
      importados += await upsertComentario("meta_facebook", integracao.marca, {
        id: item.id,
        texto: item.message || null,
        autor: item.from?.name || null,
        criadoEm: item.created_time || null,
      });
    }
    return importados;
  } catch (error) {
    warnings.push(`Comentarios Facebook (post ${post.post_id}): ${mensagemAmigavel(errorMessage(error))}`);
    return 0;
  }
}

Deno.serve(withCors(async (req) => {
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const cronSecret = Deno.env.get("META_SYNC_CRON_SECRET");
    const isScheduledCall = Boolean(cronSecret) && req.headers.get("x-cron-secret") === cronSecret;
    if (!isScheduledCall) {
      const user = await getAuthenticatedUser(req);
      await assertAdminOrGestor(user.id);
    }

    const body = await req.json().catch(() => ({}));
    const supabase = getAdminClient();

    let query = supabase
      .from("integracao_meta_contas")
      .select("id,marca,page_id,page_name,instagram_business_account_id,access_token")
      .eq("ativo", true);
    if (body.integracao_id) query = query.eq("id", body.integracao_id);
    if (body.marca && body.marca !== "Todas") query = query.eq("marca", body.marca);

    const { data: integracoes, error } = await query;
    if (error) throw error;

    if (!integracoes?.length) {
      return jsonResponse({ ok: true, results: [], message: "Nenhuma conta Meta ativa para sincronizar comentarios." });
    }

    const results: Array<{ id: string; marca: string; importados: number; warnings: string[]; error?: string }> = [];
    const marcasComNovos: string[] = [];

    for (const integracao of integracoes as Integracao[]) {
      const warnings: string[] = [];
      let importados = 0;

      try {
        const posts = await postsRecentes(integracao);
        const instagramPosts = posts.filter((p) => p.rede_social === "Instagram").slice(0, MAX_POSTS_POR_REDE);
        const facebookPosts = posts.filter((p) => p.rede_social === "Facebook").slice(0, MAX_POSTS_POR_REDE);

        if (!instagramPosts.length && !facebookPosts.length) {
          warnings.push("Nenhum post sincronizado ainda para esta conta — rode a sincronizacao de Redes Sociais antes.");
        }

        for (const post of instagramPosts) importados += await syncComentariosInstagram(integracao, post, warnings);
        for (const post of facebookPosts) importados += await syncComentariosFacebook(integracao, post, warnings);

        if (importados > 0) marcasComNovos.push(integracao.marca);

        await logMetaEvent({
          integracao_id: integracao.id,
          marca: integracao.marca,
          tipo_evento: "sync_comentarios",
          status: "sucesso",
          mensagem: `Comentarios sincronizados: ${importados}.`,
          payload_resumo: { importados, warnings: warnings.slice(0, 5) },
        });

        results.push({ id: integracao.id, marca: integracao.marca, importados, warnings });
      } catch (syncError) {
        const mensagem = safeErrorMessage(syncError, "Falha na sincronizacao de comentarios da Meta.");
        results.push({ id: integracao.id, marca: integracao.marca, importados, warnings, error: mensagem });
        await logMetaEvent({
          integracao_id: integracao.id,
          marca: integracao.marca,
          tipo_evento: "sync_comentarios",
          status: "erro",
          mensagem: errorMessage(syncError),
        });
      }
    }

    // Classificacao por IA em lote; falhas aqui nao derrubam a sincronizacao.
    const classificacao = await classificarPendentes(marcasComNovos).catch((erro) => {
      console.error("Falha na classificacao de reputacao", erro);
      return null;
    });

    return jsonResponse({
      ok: true,
      results,
      classificacao,
      message: `Sincronizacao de comentarios concluida para ${results.length} conta(s).`,
    });
  } catch (error) {
    return jsonResponse({ error: safeErrorMessage(error, "Nao foi possivel sincronizar comentarios da Meta.") }, 400);
  }
}));
