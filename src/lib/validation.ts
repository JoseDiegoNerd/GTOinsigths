import { z } from 'zod';

// Validação client-side: primeira barreira de UX, nunca a fonte de verdade.
// A autenticação/autorização real é sempre feita pelo Supabase Auth + RLS no servidor.
export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, 'Informe o email.')
    .max(254, 'Email muito longo.')
    .email('Email inválido.'),
  password: z
    .string()
    .min(1, 'Informe a senha.')
    .max(128, 'Senha muito longa.')
});

export type LoginInput = z.infer<typeof loginSchema>;

export function formatZodError(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Dados inválidos.';
}
