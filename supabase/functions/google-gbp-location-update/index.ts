import {
  assertAcessoMarca,
  assertCargoPermitido,
  getAdminClient,
  getAuthenticatedUser,
  getValidAccessToken,
  GOOGLE_BUSINESS_INFO_API,
  googleFetch,
  jsonResponse,
  logGoogleEvent,
  safeErrorMessage,
  withCors,
} from "../_shared/google.ts";

const CARGOS_PERMITIDOS = ["Admin", "Gestor", "Coordenador"];

// Mapa campo-do-nosso-schema -> { caminho no payload da Business Information API, nome do updateMask }.
// Conferir nomes exatos contra a documentacao viva do Google antes do primeiro teste real.
const CAMPOS_SUPORTADOS: Record<string, { updateMaskField: string; build: (valor: unknown) => JsonRecordLike }> = {
  telefone: {
    updateMaskField: "phoneNumbers",
    build: (valor) => ({ phoneNumbers: { primaryPhone: valor } }),
  },
  descricao: {
    updateMaskField: "profile",
    build: (valor) => ({ profile: { description: valor } }),
  },
  horario_funcionamento: {
    updateMaskField: "regularHours",
    build: (valor) => ({ regularHours: valor }),
  },
  horario_especial: {
    updateMaskField: "specialHours",
    build: (valor) => ({ specialHours: valor }),
  },
};

type JsonRecordLike = Record<string, unknown>;

Deno.serve(withCors(async (req) => {
  if (req.method !== "POST" && req.method !== "PATCH") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const user = await getAuthenticatedUser(req);
    await assertCargoPermitido(user.id, CARGOS_PERMITIDOS);

    const body = await req.json().catch(() => ({}));
    const localId = String(body.local_id || "").trim();
    const campos = (body.campos || {}) as JsonRecordLike;

    if (!localId) return jsonResponse({ error: "Informe local_id." }, 400);

    const camposValidos = Object.keys(campos).filter((chave) => chave in CAMPOS_SUPORTADOS);
    if (!camposValidos.length) {
      return jsonResponse({
        error: `Nenhum campo suportado informado. Campos aceitos: ${Object.keys(CAMPOS_SUPORTADOS).join(", ")}.`,
      }, 400);
    }

    const supabase = getAdminClient();

    const { data: local, error: localError } = await supabase
      .from("integracao_google_locais")
      .select("id,marca,location_id,integracao_id")
      .eq("id", localId)
      .maybeSingle();

    if (localError) throw localError;
    if (!local) return jsonResponse({ error: "Local nao encontrado." }, 404);

    await assertAcessoMarca(user.id, local.marca);

    const { data: integracao, error: integracaoError } = await supabase
      .from("integracao_google_contas")
      .select("id,access_token,refresh_token,token_expires_at")
      .eq("id", local.integracao_id)
      .maybeSingle();

    if (integracaoError) throw integracaoError;
    if (!integracao) return jsonResponse({ error: "Conta Google nao encontrada para este local." }, 404);

    const accessToken = await getValidAccessToken(integracao);

    let patchBody: JsonRecordLike = {};
    const updateMaskFields: string[] = [];

    for (const chave of camposValidos) {
      const definicao = CAMPOS_SUPORTADOS[chave];
      patchBody = { ...patchBody, ...definicao.build(campos[chave]) };
      updateMaskFields.push(definicao.updateMaskField);
    }

    const patchUrl = `${GOOGLE_BUSINESS_INFO_API}/${local.location_id}?updateMask=${updateMaskFields.join(",")}`;

    await googleFetch(patchUrl, accessToken, {
      method: "PATCH",
      body: JSON.stringify(patchBody),
    });

    const atualizacaoLocal: JsonRecordLike = {};
    if ("telefone" in campos) atualizacaoLocal.telefone = campos.telefone;
    if ("descricao" in campos) atualizacaoLocal.descricao = campos.descricao;
    if ("horario_funcionamento" in campos) atualizacaoLocal.horario_funcionamento = campos.horario_funcionamento;
    if ("horario_especial" in campos) atualizacaoLocal.horario_especial = campos.horario_especial;

    const { error: updateError } = await supabase
      .from("integracao_google_locais")
      .update(atualizacaoLocal)
      .eq("id", local.id);

    if (updateError) throw updateError;

    await logGoogleEvent({
      integracao_id: integracao.id,
      marca: local.marca,
      tipo_evento: "atualizacao_cadastral_gmb",
      status: "sucesso",
      mensagem: "Cadastro da loja atualizado no Google Business Profile.",
      payload_resumo: { local_id: local.id, location_id: local.location_id, usuario_id: user.id, campos: camposValidos },
    });

    return jsonResponse({ ok: true, campos_atualizados: camposValidos });
  } catch (error) {
    return jsonResponse({ error: safeErrorMessage(error, "Nao foi possivel atualizar o local.") }, 400);
  }
}));
