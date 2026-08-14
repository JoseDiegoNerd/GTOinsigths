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

const CARGOS_COM_MARCA_OBRIGATORIA = ['Coordenador', 'Analista'];

export const conviteUsuarioSchema = z
  .object({
    nome: z
      .string()
      .trim()
      .min(2, 'Informe o nome completo.')
      .max(120, 'Nome muito longo.'),
    email: z
      .string()
      .trim()
      .min(1, 'Informe o e-mail.')
      .max(254, 'Email muito longo.')
      .email('E-mail inválido.'),
    cargo: z.enum(['Admin', 'Gestor', 'Coordenador', 'Analista'], {
      errorMap: () => ({ message: 'Selecione um cargo.' })
    }),
    marcas: z.array(z.enum(['Tesoura de Ouro', 'Magazine da Economia', 'Free Center Calçados']))
  })
  .refine((data) => !CARGOS_COM_MARCA_OBRIGATORIA.includes(data.cargo) || data.marcas.length > 0, {
    message: 'Selecione ao menos uma marca permitida para este cargo.',
    path: ['marcas']
  });

export type ConviteUsuarioFormInput = z.infer<typeof conviteUsuarioSchema>;

export function formatZodError(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Dados inválidos.';
}
