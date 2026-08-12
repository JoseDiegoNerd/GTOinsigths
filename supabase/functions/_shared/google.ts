import {
  assertAdminOrGestor,
  corsHeaders,
  errorMessage,
  getAdminClient,
  getAuthenticatedUser,
  getRequiredEnv,
  jsonResponse,
  resolveAppReturnUrl,
  safeErrorMessage,
  withCors,
} from "./meta.ts";
import type { JsonRecord } from "./meta.ts";

export {
  assertAdminOrGestor,
  corsHeaders,
  errorMessage,
  getAdminClient,
  getAuthenticatedUser,
  getRequiredEnv,
  jsonResponse,
  resolveAppReturnUrl,
  safeErrorMessage,
  withCors,
};
export type { JsonRecord };

// Base URLs da API do Google Business Profile. A API e fragmentada em varias
// sub-APIs que mudam de tempos em tempos — conferir contra a documentacao viva
// do Google (https://developers.google.com/my-business) antes do primeiro teste real.
export const GOOGLE_ACCOUNTS_API = "https://mybusinessaccountmanagement.googleapis.com/v1";
export const GOOGLE_BUSINESS_INFO_API = "https://mybusinessbusinessinformation.googleapis.com/v1";
export const GOOGLE_PERFORMANCE_API = "https://businessprofileperformance.googleapis.com/v1";
// Reviews (createReply/deleteReply/list) historicamente vivem na API legada "My Business v4".
// TODO verificar se ja migrou para um endpoint novo antes de usar em producao.
export const GOOGLE_MYBUSINESS_LEGACY_API = "https://mybusiness.googleapis.com/v4";

export function getGoogleOAuthScopes() {
  return (Deno.env.get("GOOGLE_OAUTH_SCOPES") || "https://www.googleapis.com/auth/business.manage").split(" ");
}

export async function assertCargoPermitido(userId: string, cargosPermitidos: string[]) {
  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from("perfis")
    .select("id,cargo,ativo")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  if (!data?.ativo || !cargosPermitidos.includes(String(data.cargo))) {
    throw new Error(`Acao restrita a: ${cargosPermitidos.join(", ")}.`);
  }
}

// Chama a RPC public.gto_tem_acesso_marca_para(p_user_id, p_marca) - migration
// 20260812_026_rpc_acesso_marca_por_usuario.sql - em vez de reimplementar a query aqui.
// Essa RPC e a mesma logica/fonte de verdade de public.gto_tem_acesso_marca(marca) (a usada
// pelas policies de RLS), so que parametrizada por usuario: gto_tem_acesso_marca(marca) le
// auth.uid(), que nao resolve quando quem chama e o client de service_role (getAdminClient()),
// como e o caso de toda Edge Function aqui. Antes desta funcao existir, assertAcessoMarca
// reimplementava a query TypeScript direto contra perfis/perfis_marcas - funcionava, mas
// duplicava a logica com risco de divergir de novo (foi exatamente o que aconteceu com a
// coluna legada marca_vinculada, corrigido numa sessao anterior).
//
// IMPORTANTE: a migration 20260812_026 precisa estar aplicada no projeto Supabase hospedado
// antes deste codigo ir pra producao - sem a funcao gto_tem_acesso_marca_para no banco, a
// chamada abaixo falha (RPC nao encontrada) e as duas Edge Functions que usam isto
// (google-gbp-location-update, google-gbp-review-reply) param de funcionar ate a migration
// ser aplicada.
export async function assertAcessoMarca(userId: string, marca: string) {
  const supabase = getAdminClient();
  const { data: temAcesso, error } = await supabase.rpc("gto_tem_acesso_marca_para", {
    p_user_id: userId,
    p_marca: marca,
  });

  if (error) throw error;
  if (!temAcesso) throw new Error(`Sem acesso a marca "${marca}".`);
}

function base64Url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function fromBase64Url(value: string) {
  const base64 = value
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

function textBytes(value: string) {
  return new TextEncoder().encode(value);
}

// Copia local de signState/verifyState (nao reaproveita a versao de _shared/meta.ts
// porque ela usa META_APP_SECRET como chave HMAC — aqui a chave e GOOGLE_CLIENT_SECRET).
export async function signGoogleState(payload: JsonRecord) {
  const encodedPayload = base64Url(textBytes(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey(
    "raw",
    textBytes(getRequiredEnv("GOOGLE_CLIENT_SECRET")),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, textBytes(encodedPayload));
  return `${encodedPayload}.${base64Url(new Uint8Array(signature))}`;
}

export async function verifyGoogleState(state: string) {
  const [encodedPayload, signature] = state.split(".");
  if (!encodedPayload || !signature) throw new Error("Invalid OAuth state.");

  const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(encodedPayload)));
  const expected = await signGoogleState(payload);
  if (expected !== state) throw new Error("OAuth state signature mismatch.");

  const ts = Number(payload.ts || 0);
  const ageMs = Date.now() - ts;
  if (!ts || ageMs > 15 * 60 * 1000) throw new Error("OAuth state expired.");

  return payload as JsonRecord;
}

export async function googleFetch(
  url: string,
  accessToken: string,
  init: RequestInit = {},
) {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init.headers || {}),
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body?.error?.message || `Google API error on ${url}`);
  }
  return body;
}

type IntegracaoGoogleConta = {
  id: string;
  access_token: string;
  refresh_token: string | null;
  token_expires_at: string | null;
};

export async function getValidAccessToken(integracao: IntegracaoGoogleConta) {
  const expiresAt = integracao.token_expires_at ? new Date(integracao.token_expires_at).getTime() : 0;
  const fiveMinutesMs = 5 * 60 * 1000;

  if (expiresAt && expiresAt - Date.now() > fiveMinutesMs) {
    return integracao.access_token;
  }

  if (!integracao.refresh_token) {
    await logGoogleEvent({
      integracao_id: integracao.id,
      tipo_evento: "refresh_token",
      status: "erro",
      mensagem: "Sem refresh_token salvo. Reconecte a conta via google-oauth-start (prompt=consent).",
    });
    throw new Error("Token Google expirado e sem refresh_token disponivel. Reconecte a conta.");
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: integracao.refresh_token,
      client_id: getRequiredEnv("GOOGLE_CLIENT_ID"),
      client_secret: getRequiredEnv("GOOGLE_CLIENT_SECRET"),
    }),
  });

  const body = await response.json();
  if (!response.ok) {
    await logGoogleEvent({
      integracao_id: integracao.id,
      tipo_evento: "refresh_token",
      status: "erro",
      mensagem: body?.error_description || body?.error || "Falha ao renovar access_token do Google.",
    });
    throw new Error(body?.error_description || "Falha ao renovar access_token do Google.");
  }

  const tokenExpiresAt = new Date(Date.now() + Number(body.expires_in || 3600) * 1000).toISOString();

  const supabase = getAdminClient();
  await supabase
    .from("integracao_google_contas")
    .update({ access_token: body.access_token, token_expires_at: tokenExpiresAt })
    .eq("id", integracao.id);

  return String(body.access_token);
}

export async function logGoogleEvent(input: {
  integracao_id?: string | null;
  marca?: string | null;
  tipo_evento: string;
  status: "sucesso" | "erro" | "aviso" | "iniciado";
  mensagem?: string;
  payload_resumo?: JsonRecord;
}) {
  const supabase = getAdminClient();
  await supabase.from("logs_integracao_google").insert({
    integracao_id: input.integracao_id || null,
    marca: input.marca || null,
    tipo_evento: input.tipo_evento,
    status: input.status,
    mensagem: input.mensagem || null,
    payload_resumo: input.payload_resumo || {},
  });
}
