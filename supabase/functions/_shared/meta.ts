import { createClient } from "npm:@supabase/supabase-js@2";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export type JsonRecord = Record<string, unknown>;

export function jsonResponse(body: JsonRecord, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
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
