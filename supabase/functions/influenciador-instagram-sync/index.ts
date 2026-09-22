import { createClient } from "npm:@supabase/supabase-js@2";
import {
  getAdminClient,
  getAuthenticatedUser,
  assertAal2,
  getRequiredEnv,
  jsonResponse,
  safeErrorMessage,
  metaBusinessDiscovery,
  withCors,
} from "../_shared/meta.ts";

type Influenciador = {
  id: string;
  marca: string;
  handle: string;
  rede_social: string;
};

type ContaMeta = {
  instagram_business_account_id: string | null;
  access_token: string;
};

// Sincroniza um influenciador: busca a conta Meta da marca, chama a Business Discovery, baixa e
// reenvia a foto, e atualiza influenciadores + influenciador_seguidores_historico. Nunca lanca -
// qualquer falha vira { erro } gravado na propria linha, para o chamador (botao ou lote) decidir
// o que fazer sem interromper os demais.
async function sincronizarUm(
  admin: ReturnType<typeof getAdminClient>,
  writeClient: ReturnType<typeof getAdminClient>,
  influenciador: Influenciador,
): Promise<{ erro: string | null; seguidores?: number; publicacoes_total?: number }> {
  if (influenciador.rede_social !== "Instagram") {
    return { erro: "Sincronizacao automatica so esta disponivel para Instagram." };
  }

  // Checa permissao de escrita ANTES de qualquer chamada privilegiada (leitura de token, API da
  // Meta, upload no Storage) - sem isso, um usuario sem acesso de escrita a marca-alvo conseguiria
  // disparar esses efeitos colaterais antes do bloqueio final (RLS so barrava o update final).
  const { data: permissao, error: permissaoError } = await writeClient
    .from("influenciadores")
    .update({ instagram_sync_erro: null })
    .eq("id", influenciador.id)
    .select("id");
  if (permissaoError) throw permissaoError;
  if (!permissao || permissao.length === 0) {
    return { erro: "Voce nao tem permissao para sincronizar este influenciador." };
  }

  const { data: conta, error: contaError } = await admin
    .from("integracao_meta_contas")
    .select("instagram_business_account_id,access_token")
    .eq("marca", influenciador.marca)
    .eq("ativo", true)
    .not("instagram_business_account_id", "is", null)
    .maybeSingle<ContaMeta>();

  if (contaError) throw contaError;
  if (!conta?.instagram_business_account_id) {
    const erro = "Conecte o Instagram da marca em Conexoes antes de sincronizar.";
    await writeClient.from("influenciadores").update({ instagram_sync_erro: erro }).eq("id", influenciador.id);
    return { erro };
  }

  let dados;
  try {
    dados = await metaBusinessDiscovery(conta.instagram_business_account_id, influenciador.handle, conta.access_token);
  } catch (error) {
    // Nao usa safeErrorMessage(error, fallback) aqui: metaGet manda o access_token como query
    // param da URL, e um erro bruto de rede (DNS/timeout) do fetch no Deno pode incluir a URL
    // completa na mensagem - vazaria o token pro banco (instagram_sync_erro) e pra resposta HTTP.
    // O erro completo vai so pro log (console.error), nunca pro usuario.
    console.error("Erro ao consultar Business Discovery:", error);
    const erro = "Falha ao consultar o Instagram. Tente novamente mais tarde.";
    await writeClient.from("influenciadores").update({ instagram_sync_erro: erro }).eq("id", influenciador.id);
    return { erro };
  }

  if (!dados) {
    const erro = `Nao foi possivel sincronizar - verifique se ${influenciador.handle} e uma conta Business/Creator publica do Instagram.`;
    await writeClient.from("influenciadores").update({ instagram_sync_erro: erro }).eq("id", influenciador.id);
    return { erro };
  }

  let avatarPath: string | null = null;
  if (dados.profile_picture_url) {
    try {
      const imagem = await fetch(dados.profile_picture_url);
      if (imagem.ok) {
        const bytes = new Uint8Array(await imagem.arrayBuffer());
        const contentType = imagem.headers.get("content-type") || "image/jpeg";
        avatarPath = `${influenciador.id}/avatar`;
        const { error: uploadError } = await admin.storage
          .from("influenciadores-avatares")
          .upload(avatarPath, bytes, { upsert: true, contentType, cacheControl: "3600" });
        if (uploadError) avatarPath = null; // mantem avatar_path anterior, nao interrompe o resto
      }
    } catch {
      avatarPath = null; // falha de rede ao baixar a foto - mantem a foto anterior
    }
  }

  const atualizacao: Record<string, unknown> = {
    publicacoes_total: dados.media_count,
    instagram_sincronizado_em: new Date().toISOString(),
    instagram_sync_erro: null,
  };
  if (avatarPath) atualizacao.avatar_path = avatarPath;

  const { data: linhasAtualizadas, error: updateError } = await writeClient
    .from("influenciadores")
    .update(atualizacao)
    .eq("id", influenciador.id)
    .select("id");

  if (updateError) throw updateError;
  if (!linhasAtualizadas || linhasAtualizadas.length === 0) {
    return { erro: "Voce nao tem permissao para sincronizar este influenciador." };
  }

  const hoje = new Date().toISOString().slice(0, 10);
  const { error: seguidoresError } = await admin.from("influenciador_seguidores_historico").upsert(
    { influenciador_id: influenciador.id, marca: influenciador.marca, data: hoje, seguidores: dados.followers_count },
    { onConflict: "influenciador_id,data" },
  );
  if (seguidoresError) throw seguidoresError;

  return { erro: null, seguidores: dados.followers_count, publicacoes_total: dados.media_count };
}

Deno.serve(withCors(async (req) => {
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const cronSecret = req.headers.get("x-cron-secret");
  const modoLote = Boolean(cronSecret);

  try {
    const admin = getAdminClient();

    if (modoLote) {
      if (cronSecret !== getRequiredEnv("INSTAGRAM_SYNC_CRON_SECRET")) {
        return jsonResponse({ error: "Segredo de cron invalido." }, 403);
      }

      const { data: influenciadores, error } = await admin
        .from("influenciadores")
        .select("id,marca,handle,rede_social")
        .eq("rede_social", "Instagram");
      if (error) throw error;

      let sincronizados = 0;
      let comErro = 0;
      for (const influenciador of influenciadores || []) {
        // Isolamento de erro: sincronizarUm normalmente devolve { erro } sem lancar, mas alguns
        // caminhos (ex.: erro de banco inesperado em updateError/seguidoresError, ou qualquer
        // excecao nao prevista) propagam uma excecao de verdade. Sem este try/catch, uma unica
        // falha desse tipo interromperia o "for" e derrubaria a sincronizacao de todos os
        // influenciadores restantes do lote - o que contraria o requisito de que um erro isolado
        // nunca deve afetar os demais.
        try {
          const resultado = await sincronizarUm(admin, admin, influenciador as Influenciador);
          if (resultado.erro) comErro += 1;
          else sincronizados += 1;
        } catch (error) {
          comErro += 1;
          const erro = safeErrorMessage(error, "Falha inesperada ao sincronizar com o Instagram.");
          // Essa gravacao tambem pode falhar (ex.: banco fora do ar) - se falhar, so loga e
          // segue, pra nao derrubar o restante do lote (o mesmo problema que este catch existe
          // pra evitar).
          try {
            await admin.from("influenciadores").update({ instagram_sync_erro: erro }).eq("id", (influenciador as Influenciador).id);
          } catch (writeError) {
            console.error("Falha ao gravar instagram_sync_erro apos excecao no lote:", writeError);
          }
        }
      }
      return jsonResponse({ ok: true, sincronizados, com_erro: comErro });
    }

    const usuario = await getAuthenticatedUser(req);
    await assertAal2(req, usuario.id);

    const body = await req.json().catch(() => ({}));
    const influenciadorId = String(body.influenciador_id || "").trim();
    if (!influenciadorId) return jsonResponse({ error: "Informe influenciador_id." }, 400);

    const { data: influenciador, error: buscaError } = await admin
      .from("influenciadores")
      .select("id,marca,handle,rede_social")
      .eq("id", influenciadorId)
      .maybeSingle<Influenciador>();
    if (buscaError) throw buscaError;
    if (!influenciador) return jsonResponse({ error: "Influenciador nao encontrado." }, 404);

    // Client do proprio usuario (nao admin): a atualizacao final de influenciadores passa por
    // este client, entao a policy de escrita (cargo + gto_tem_acesso_marca) decide se o
    // chamador pode mesmo sincronizar este influenciador - sem duplicar essa logica aqui.
    const writeClient = createClient(
      getRequiredEnv("SUPABASE_URL"),
      getRequiredEnv("SUPABASE_ANON_KEY"),
      { global: { headers: { Authorization: req.headers.get("authorization") || "" } } },
    );

    const resultado = await sincronizarUm(admin, writeClient, influenciador);
    if (resultado.erro) return jsonResponse({ error: resultado.erro }, 400);
    return jsonResponse({ ok: true, seguidores: resultado.seguidores, publicacoes_total: resultado.publicacoes_total });
  } catch (error) {
    return jsonResponse({ error: safeErrorMessage(error, "Nao foi possivel sincronizar com o Instagram.") }, 400);
  }
}));
