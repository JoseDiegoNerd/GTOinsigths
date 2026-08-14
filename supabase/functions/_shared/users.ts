import {
  assertAal2,
  corsHeaders,
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
  assertAal2,
  corsHeaders,
  getAdminClient,
  getAuthenticatedUser,
  getRequiredEnv,
  jsonResponse,
  resolveAppReturnUrl,
  safeErrorMessage,
  withCors,
};
export type { JsonRecord };

// Mesma forma de assertCargoPermitido em _shared/google.ts, mas sem acoplar as funcoes de
// Gestao de Usuarios a um modulo nomeado "google.ts". Fica deliberadamente restrito a ["Admin"]
// nos chamadores (nao aceita Gestor) porque convite/reset de MFA sao acoes administrativas
// destrutivas (criam contas, derrubam sessoes) - mais sensiveis que gerenciar uma integracao.
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
