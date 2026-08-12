// Traduz erros do Supabase/Postgres em mensagens seguras para o usuário final.
// Nunca repassa `error.message`/`error.details`/`error.hint` brutos pro cliente:
// esses campos podem conter nomes de tabela, coluna, constraint ou trecho de SQL.

type SupabaseLikeError = {
  code?: string;
  message?: string;
  status?: number;
};

const AUTH_MESSAGES: Record<string, string> = {
  invalid_credentials: 'Email ou senha inválidos.',
  email_not_confirmed: 'Confirme seu email antes de entrar.',
  user_not_found: 'Email ou senha inválidos.',
  over_request_rate_limit: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.'
};

const POSTGRES_MESSAGES: Record<string, string> = {
  '23505': 'Já existe um registro com esses dados.',
  '23503': 'Operação inválida: registro relacionado não encontrado.',
  '23514': 'Dados inválidos para esta operação.',
  '42501': 'Você não tem permissão para esta operação.',
  PGRST116: 'Registro não encontrado.',
  PGRST301: 'Sessão expirada. Entre novamente.'
};

function isSupabaseLikeError(err: unknown): err is SupabaseLikeError {
  return typeof err === 'object' && err !== null && ('code' in err || 'status' in err);
}

export function toSafeErrorMessage(err: unknown, fallback: string): string {
  // Loga o erro completo so no console do dev (nunca em UI), para depuracao local.
  // Optional chaining: o build estatico (esbuild) nao define import.meta.env por
  // completo, so chaves VITE_* pontuais - acessar .DEV direto lancaria TypeError.
  if (import.meta.env?.DEV) {
    console.error(err);
  }

  if (isSupabaseLikeError(err)) {
    if (err.code && AUTH_MESSAGES[err.code]) return AUTH_MESSAGES[err.code];
    if (err.code && POSTGRES_MESSAGES[err.code]) return POSTGRES_MESSAGES[err.code];
    if (err.status === 401 || err.status === 403) return 'Você não tem permissão para esta operação.';
  }

  return fallback;
}
