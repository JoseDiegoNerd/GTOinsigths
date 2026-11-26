import {
  assertAal2,
  assertAcessoMarca,
  assertCargoPermitido,
  getAdminClient,
  getAuthenticatedUser,
  getValidAccessToken,
  GOOGLE_MYBUSINESS_LEGACY_API,
  googleFetch,
  GoogleApiError,
  jsonResponse,
  logGoogleEvent,
  safeErrorMessage,
  withCors,
} from "../_shared/google.ts";

// Publica uma foto na ficha de UMA loja do Google Business Profile, a partir da pagina Google Meu
// Negocio ("Carregar" na Galeria de Fotos). Mesmos cargos que podem editar o cadastro da loja.
const CARGOS_PERMITIDOS = ["Admin", "Gestor", "Coordenador"];

// Requisitos de foto do Google Business Profile: JPG ou PNG, de 10 KB a 5 MB.
const TIPOS_ACEITOS = ["image/jpeg", "image/png"];
const TAMANHO_MIN = 10 * 1024;
const TAMANHO_MAX = 5 * 1024 * 1024;

// Subconjunto de MediaItem.locationAssociation.category que faz sentido para varejo.
const CATEGORIAS = ["ADDITIONAL", "EXTERIOR", "INTERIOR", "PRODUCT", "AT_WORK", "TEAMS", "COMMON_AREA", "COVER", "LOGO"];

// Endpoint de envio de bytes da API v4 (fluxo media:startUpload -> upload -> media.create).
// ATENCAO: caminho conforme a documentacao da My Business API v4; validar contra a API real
// quando o projeto Google Cloud tiver a Business Profile API liberada (ver README).
const GOOGLE_UPLOAD_API = "https://mybusiness.googleapis.com/upload/v1/media";

Deno.serve(withCors(async (req) => {
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  let contexto: { integracao_id?: string; marca?: string; local_id?: string } = {};
  try {
    const user = await getAuthenticatedUser(req);
    await assertAal2(req, user.id);
    await assertCargoPermitido(user.id, CARGOS_PERMITIDOS);

    const form = await req.formData().catch(() => null);
    if (!form) return jsonResponse({ error: "Envie a foto como multipart/form-data." }, 400);

    const localId = String(form.get("local_id") || "").trim();
    const categoria = String(form.get("categoria") || "ADDITIONAL").trim().toUpperCase();
    const arquivo = form.get("arquivo");

    if (!localId) return jsonResponse({ error: "Informe a unidade (local_id)." }, 400);
    if (!CATEGORIAS.includes(categoria)) return jsonResponse({ error: "Categoria de foto invalida." }, 400);
    if (!(arquivo instanceof File)) return jsonResponse({ error: "Selecione uma imagem." }, 400);
    if (!TIPOS_ACEITOS.includes(arquivo.type)) return jsonResponse({ error: "Formato nao aceito: use JPG ou PNG." }, 400);
    if (arquivo.size < TAMANHO_MIN || arquivo.size > TAMANHO_MAX) {
      return jsonResponse({ error: "A foto precisa ter entre 10 KB e 5 MB." }, 400);
    }

    const supabase = getAdminClient();
    const { data: local, error: localError } = await supabase
      .from("integracao_google_locais")
      .select("id,marca,location_id,integracao_id,nome_loja")
      .eq("id", localId)
      .maybeSingle();
    if (localError) throw localError;
    if (!local) return jsonResponse({ error: "Unidade nao encontrada." }, 404);

    await assertAcessoMarca(user.id, local.marca);
    contexto = { integracao_id: local.integracao_id, marca: local.marca, local_id: local.id };

    const { data: integracao, error: integracaoError } = await supabase
      .from("integracao_google_contas")
      .select("id,google_account_id,access_token,refresh_token,token_expires_at,ativo,conta_confirmada,ignorada")
      .eq("id", local.integracao_id)
      .maybeSingle();
    if (integracaoError) throw integracaoError;
    if (!integracao) return jsonResponse({ error: "Conta Google nao encontrada para esta unidade." }, 404);
    if (!integracao.ativo || !integracao.conta_confirmada || integracao.ignorada) {
      return jsonResponse({ error: "A conta Google desta unidade nao esta confirmada em Conexoes." }, 400);
    }

    const accessToken = await getValidAccessToken(integracao);
    const parent = `${integracao.google_account_id}/${local.location_id}`;

    // 1) Reserva um destino para os bytes.
    const reserva = await googleFetch(`${GOOGLE_MYBUSINESS_LEGACY_API}/${parent}/media:startUpload`, accessToken, {
      method: "POST",
      body: "{}",
    });
    const resourceName = String(reserva?.resourceName || "");
    if (!resourceName) throw new Error("O Google nao devolveu o destino do upload (resourceName).");

    // 2) Envia a imagem (googleFetch forca JSON, por isso fetch direto aqui).
    const upload = await fetch(`${GOOGLE_UPLOAD_API}/${encodeURI(resourceName)}?upload_type=media`, {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": arquivo.type },
      body: await arquivo.arrayBuffer(),
    });
    if (!upload.ok) {
      const detalhe = await upload.json().catch(() => ({}));
      throw new GoogleApiError(detalhe?.error?.message || `Falha ao enviar a imagem ao Google (HTTP ${upload.status}).`, upload.status, upload.status === 429);
    }

    // 3) Cria o item de midia na ficha, ja com a categoria.
    const item = await googleFetch(`${GOOGLE_MYBUSINESS_LEGACY_API}/${parent}/media`, accessToken, {
      method: "POST",
      body: JSON.stringify({
        mediaFormat: "PHOTO",
        locationAssociation: { category: categoria },
        dataRef: { resourceName },
      }),
    });

    const foto = {
      local_id: local.id,
      marca: local.marca,
      media_id: String(item?.name || resourceName),
      url: item?.googleUrl || item?.thumbnailUrl || null,
      origem: "proprietario",
      categoria,
      criado_em_google: item?.createTime || new Date().toISOString(),
      payload_bruto: item || {},
    };
    const { data: gravada, error: gravarError } = await supabase
      .from("integracao_google_fotos")
      .upsert(foto, { onConflict: "local_id,media_id" })
      .select("id,local_id,url,origem,categoria,criado_em_google")
      .maybeSingle();
    if (gravarError) throw gravarError;

    await logGoogleEvent({
      integracao_id: integracao.id,
      marca: local.marca,
      tipo_evento: "upload_foto_gmb",
      status: "sucesso",
      mensagem: `Foto publicada na ficha "${local.nome_loja || local.location_id}".`,
      payload_resumo: { local_id: local.id, location_id: local.location_id, usuario_id: user.id, categoria, media_id: foto.media_id, bytes: arquivo.size },
    });

    return jsonResponse({ ok: true, foto: gravada || foto });
  } catch (error) {
    if (contexto.integracao_id) {
      await logGoogleEvent({
        integracao_id: contexto.integracao_id,
        marca: contexto.marca,
        tipo_evento: "upload_foto_gmb",
        status: "erro",
        mensagem: safeErrorMessage(error, "Falha ao publicar foto."),
        payload_resumo: { local_id: contexto.local_id },
      }).catch(() => {});
    }
    return jsonResponse({ error: safeErrorMessage(error, "Nao foi possivel publicar a foto no Google.") }, 400);
  }
}));
