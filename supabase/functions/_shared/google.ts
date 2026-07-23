import {
  assertAdminOrGestor,
  corsHeaders,
  getAdminClient,
  getAuthenticatedUser,
  getRequiredEnv,
  jsonResponse,
} from "./meta.ts";
import type { JsonRecord } from "./meta.ts";

export { assertAdminOrGestor, corsHeaders, getAdminClient, getAuthenticatedUser, getRequiredEnv, jsonResponse };
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

// Espelha a funcao SQL gto_tem_acesso_marca em TypeScript, para checagens dentro
// de Edge Functions que rodam com service_role (onde a RLS nao se aplica sozinha).
export async function assertAcessoMarca(userId: string, marca: string) {
  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from("perfis")
    .select("cargo,marca_vinculada,ativo")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  const ehAdminOuGestor = data?.ativo && ["Admin", "Gestor"].includes(String(data.cargo));
  if (ehAdminOuGestor) return;
  if (data?.ativo && data.marca_vinculada === marca) return;

  throw new Error(`Sem acesso a marca "${marca}".`);
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
