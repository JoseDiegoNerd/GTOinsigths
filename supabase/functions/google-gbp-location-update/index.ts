import {
  assertAal2,
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

type JsonRecordLike = Record<string, unknown>;

const DIAS_SEMANA = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];

// Valida regularHours no formato do Google: { periods: [{ openDay, openTime {hours, minutes},
// closeDay, closeTime }] }. 24:00 no closeTime representa meia-noite ao fim do closeDay.
function validarHorario(valor: unknown) {
  const periods = (valor as { periods?: unknown })?.periods;
  if (!Array.isArray(periods)) throw new Error("Horario invalido: informe { periods: [...] }.");
  for (const p of periods as JsonRecordLike[]) {
    if (!DIAS_SEMANA.includes(String(p.openDay)) || !DIAS_SEMANA.includes(String(p.closeDay))) {
      throw new Error("Horario invalido: dia da semana desconhecido.");
    }
    for (const chave of ["openTime", "closeTime"]) {
      const t = (p[chave] || {}) as { hours?: number; minutes?: number };
      const h = Number(t.hours || 0);
      const m = Number(t.minutes || 0);
      if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 24 || m < 0 || m > 59 || (h === 24 && m !== 0)) {
        throw new Error("Horario invalido: use HH:MM entre 00:00 e 24:00.");
      }
    }
  }
  return { periods };
}

// Mapa campo-do-nosso-schema -> { mascara do updateMask, montagem do payload, coluna local }.
// `atual` e o Location gravado em payload_bruto na ultima sincronizacao.
const CAMPOS_SUPORTADOS: Record<string, {
  updateMaskField: string;
  build: (valor: unknown, atual: JsonRecordLike) => JsonRecordLike;
  coluna: string;
  normalizar?: (valor: unknown) => unknown;
}> = {
  telefone: {
    // O Google exige primaryPhone e additionalPhones juntos no update; preserva os adicionais.
    updateMaskField: "phoneNumbers",
    build: (valor, atual) => ({
      phoneNumbers: {
        primaryPhone: valor,
        additionalPhones: ((atual.phoneNumbers || {}) as JsonRecordLike).additionalPhones || [],
      },
    }),
    coluna: "telefone",
    normalizar: (valor) => String(valor ?? "").trim(),
  },
  website: {
    updateMaskField: "websiteUri",
    build: (valor) => ({ websiteUri: valor }),
    coluna: "website",
    normalizar: (valor) => {
      const texto = String(valor ?? "").trim();
      if (texto && !/^https?:\/\/[^\s]+\.[^\s]+/i.test(texto)) throw new Error("Website invalido: use um endereco iniciando com http:// ou https://.");
      return texto;
    },
  },
  descricao: {
    updateMaskField: "profile",
    build: (valor) => ({ profile: { description: valor } }),
    coluna: "descricao",
    normalizar: (valor) => {
      const texto = String(valor ?? "").trim();
      if (texto.length > 750) throw new Error("Descricao muito longa: o Google aceita ate 750 caracteres.");
      return texto;
    },
  },
  horario_funcionamento: {
    updateMaskField: "regularHours",
    build: (valor) => ({ regularHours: valor }),
    coluna: "horario_funcionamento",
    normalizar: validarHorario,
  },
  horario_especial: {
    updateMaskField: "specialHours",
    build: (valor) => ({ specialHours: valor }),
    coluna: "horario_especial",
  },
};

Deno.serve(withCors(async (req) => {
  if (req.method !== "POST" && req.method !== "PATCH") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const user = await getAuthenticatedUser(req);
    await assertAal2(req, user.id);
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
      .select("id,marca,location_id,integracao_id,payload_bruto")
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

    // Valida e normaliza tudo antes de chamar o Google (erro de formato nao gasta cota).
    const valores: JsonRecordLike = {};
    for (const chave of camposValidos) {
      const definicao = CAMPOS_SUPORTADOS[chave];
      valores[chave] = definicao.normalizar ? definicao.normalizar(campos[chave]) : campos[chave];
    }

    const accessToken = await getValidAccessToken(integracao);
    const atual = (local.payload_bruto || {}) as JsonRecordLike;

    let patchBody: JsonRecordLike = {};
    const updateMaskFields: string[] = [];
    for (const chave of camposValidos) {
      const definicao = CAMPOS_SUPORTADOS[chave];
      patchBody = { ...patchBody, ...definicao.build(valores[chave], atual) };
      updateMaskFields.push(definicao.updateMaskField);
    }

    const patchUrl = `${GOOGLE_BUSINESS_INFO_API}/${local.location_id}?updateMask=${encodeURIComponent(updateMaskFields.join(","))}`;

    // O PATCH devolve o Location atualizado; guardamos para o drawer refletir o que o Google aceitou.
    const atualizado = await googleFetch(patchUrl, accessToken, {
      method: "PATCH",
      body: JSON.stringify(patchBody),
    }) as JsonRecordLike;

    const atualizacaoLocal: JsonRecordLike = {
      payload_bruto: { ...atual, ...patchBody, ...(atualizado || {}) },
      atualizado_em: new Date().toISOString(),
    };
    for (const chave of camposValidos) {
      atualizacaoLocal[CAMPOS_SUPORTADOS[chave].coluna] = valores[chave] === "" ? null : valores[chave];
    }

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
