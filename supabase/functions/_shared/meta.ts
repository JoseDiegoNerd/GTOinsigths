import { createClient } from "npm:@supabase/supabase-js@2";

export type JsonRecord = Record<string, unknown>;

// Origem(ns) confiavel(is) do frontend - usada tanto pro CORS das Edge Functions quanto pro
// destino do redirect final do OAuth (resolveAppReturnUrl). Configuravel via APP_ALLOWED_ORIGINS
// (csv) no ambiente da funcao; sem isso, so os hosts de dev local sao aceitos.
const DEFAULT_ALLOWED_ORIGINS = ["http://127.0.0.1:5173", "http://localhost:5173", "http://localhost:3000"];

function getAllowedOrigins(): string[] {
  const configured = (Deno.env.get("APP_ALLOWED_ORIGINS") || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return configured.length ? configured : DEFAULT_ALLOWED_ORIGINS;
}

// Access-Control-Allow-Origin nao aceita lista - so um valor exato (ou "*", que nos evitamos aqui
// porque essas rotas aceitam Authorization: Bearer e um "*" deixa qualquer site ler a resposta se
// o token ja vazou por outro canal). Reflete a Origin da requisicao so quando ela bate com a
// allowlist; fora disso cai no primeiro item da lista (bloqueia CORS pra origem nao permitida).
export function corsHeaders(req: Request) {
  const allowedOrigins = getAllowedOrigins();
  const requestOrigin = req.headers.get("origin");
  const allowOrigin = requestOrigin && allowedOrigins.includes(requestOrigin) ? requestOrigin : allowedOrigins[0];

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    Vary: "Origin",
  };
}

// Envolve o handler de um Deno.serve pra aplicar corsHeaders(req) em toda resposta (incluindo o
// preflight OPTIONS) sem precisar tocar cada chamada de jsonResponse individualmente.
export function withCors(handler: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    const cors = corsHeaders(req);
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

    const response = await handler(req);
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(cors)) headers.set(key, value);
    return new Response(response.body, { status: response.status, headers });
  };
}

export function jsonResponse(body: JsonRecord, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function getRequiredEnv(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing required secret: ${name}`);
  return value;
}

export function getGraphVersion() {
  return Deno.env.get("META_GRAPH_VERSION") || "v25.0";
}

export function resolveAppReturnUrl(req: Request, requestedUrl: string | undefined): string {
  const allowedOrigins = getAllowedOrigins();

  const requestOrigin = req.headers.get("origin");
  if (requestOrigin && allowedOrigins.includes(requestOrigin)) return requestOrigin;

  if (requestedUrl) {
    try {
      const requestedOrigin = new URL(requestedUrl).origin;
      if (allowedOrigins.includes(requestedOrigin)) return requestedOrigin;
    } catch {
      // URL invalida - ignora e cai no default abaixo.
    }
  }

  return allowedOrigins[0];
}

export function getAdminClient() {
  return createClient(
    getRequiredEnv("SUPABASE_URL"),
    getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}

export async function getAuthenticatedUser(req: Request) {
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Missing bearer token.");

  const supabase = getAdminClient();
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) throw new Error("Invalid authenticated user.");
  return data.user;
}

// Extrai o claim "aal" do access token ja validado por getAuthenticatedUser(req) (decodifica o
// payload do JWT sem reverificar assinatura - seguro porque so e chamada depois de
// supabase.auth.getUser(token) ja ter confirmado que o token e autentico e pertence a userId).
function decodeJwtAal(token: string): string {
  const payloadSegment = token.split(".")[1];
  if (!payloadSegment) return "aal1";
  const base64 = payloadSegment.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(payloadSegment.length / 4) * 4, "=");
  try {
    const payload = JSON.parse(atob(base64));
    return String(payload.aal || "aal1");
  } catch {
    return "aal1";
  }
}

// Fecha em Edge Functions o mesmo enforcement de MFA que gto_aal2_ok() ja faz em RLS (migration
// 20260813_027): nega a chamada se o usuario tem fator TOTP verificado mas a sessao ainda esta
// em aal1 (desafio de 2FA pendente). Chamar sempre logo depois de getAuthenticatedUser(req), na
// mesma requisicao - o token decodificado aqui precisa ser o mesmo que getAuthenticatedUser ja
// validou.
export async function assertAal2(req: Request, userId: string) {
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  const aal = decodeJwtAal(token);

  const supabase = getAdminClient();
  const { data: ok, error } = await supabase.rpc("gto_aal2_ok_para", { p_user_id: userId, p_aal: aal });

  if (error) throw error;
  if (!ok) throw new Error("Verificacao em duas etapas pendente. Complete o desafio de MFA antes de continuar.");
}

export async function assertAdminOrGestor(userId: string) {
  const supabase = getAdminClient();
  const { data, error } = await supabase
    .from("perfis")
    .select("id,cargo,ativo")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  if (!data?.ativo || !["Admin", "Gestor"].includes(String(data.cargo))) {
    throw new Error("Apenas Admin ou Gestor podem gerenciar conexoes Meta.");
  }
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

export async function signState(payload: JsonRecord) {
  const encodedPayload = base64Url(textBytes(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey(
    "raw",
    textBytes(getRequiredEnv("META_APP_SECRET")),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, textBytes(encodedPayload));
  return `${encodedPayload}.${base64Url(new Uint8Array(signature))}`;
}

export async function verifyState(state: string) {
  const [encodedPayload, signature] = state.split(".");
  if (!encodedPayload || !signature) throw new Error("Invalid OAuth state.");

  const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(encodedPayload)));
  const expected = await signState(payload);
  if (expected !== state) throw new Error("OAuth state signature mismatch.");

  const ts = Number(payload.ts || 0);
  const ageMs = Date.now() - ts;
  if (!ts || ageMs > 15 * 60 * 1000) throw new Error("OAuth state expired.");

  return payload as JsonRecord;
}

// Mensagem segura para devolver ao chamador da API: nunca repassa message/code/details/hint
// de um erro com formato de PostgrestError (revelaria nomes de tabela/coluna/constraint).
// O erro completo sempre vai pro log da Edge Function (console.error, so visivel no
// dashboard do Supabase) - so a resposta HTTP e generica.
export function safeErrorMessage(error: unknown, fallback = "Ocorreu um erro ao processar a solicitacao."): string {
  console.error(error);

  const looksLikePostgrestError =
    error !== null &&
    typeof error === "object" &&
    ("code" in error || "details" in error || "hint" in error) &&
    !(error instanceof Error);

  if (looksLikePostgrestError) return fallback;
  if (error instanceof Error) return error.message;
  return fallback;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const withDetails = error as { message?: unknown; code?: unknown; details?: unknown; hint?: unknown };
    if (typeof withDetails.message === "string" && withDetails.message) {
      const parts = [withDetails.message];
      if (withDetails.code) parts.push(`(code: ${withDetails.code})`);
      if (withDetails.details) parts.push(`- ${withDetails.details}`);
      if (withDetails.hint) parts.push(`Hint: ${withDetails.hint}`);
      return parts.join(" ");
    }
    try {
      return JSON.stringify(error);
    } catch {
      // fall through to String(error) below
    }
  }
  return String(error);
}

export async function metaGet(path: string, params: Record<string, string | number | boolean | undefined | null>) {
  const url = new URL(`https://graph.facebook.com/${getGraphVersion()}${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  });

  const response = await fetch(url);
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body?.error?.message || `Meta API error on ${path}`);
  }
  return body;
}

export async function logMetaEvent(input: {
  integracao_id?: string | null;
  marca?: string | null;
  tipo_evento: string;
  status: "sucesso" | "erro" | "aviso" | "iniciado";
  mensagem?: string;
  payload_resumo?: JsonRecord;
}) {
  const supabase = getAdminClient();
  await supabase.from("logs_integracao_meta").insert({
    integracao_id: input.integracao_id || null,
    marca: input.marca || null,
    tipo_evento: input.tipo_evento,
    status: input.status,
    mensagem: input.mensagem || null,
    payload_resumo: input.payload_resumo || {},
  });
}
