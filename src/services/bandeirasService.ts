import { supabase } from '../lib/supabaseClient';
import type { Marca } from '../types/gto';

export type BandeiraStatus = 'LIVE' | 'MANUTENÇÃO';

export type BandeiraResumo = {
  marca: Marca;
  nomeExibicao: string;
  lojas: number;
  status: BandeiraStatus;
};

const NOME_EXIBICAO: Record<Marca, string> = {
  'Tesoura de Ouro': 'Tesoura de Ouro',
  'Free Center Calçados': 'Free Center',
  'Magazine da Economia': 'Magazine da Economia'
};

// Conta de verdade a tabela lojas_unidades (migration 20260824_037) em vez de usar numero fixo -
// LIVE se a marca tiver ao menos 1 loja cadastrada, MANUTENÇÃO se nao tiver nenhuma.
export async function listBandeirasComContagem(): Promise<BandeiraResumo[]> {
  const { data, error } = await supabase.from('lojas_unidades').select('marca');
  if (error) throw error;

  const contagem = new Map<Marca, number>();
  for (const row of data ?? []) {
    const marca = row.marca as Marca;
    contagem.set(marca, (contagem.get(marca) ?? 0) + 1);
  }

  return (Object.keys(NOME_EXIBICAO) as Marca[]).map((marca) => {
    const lojas = contagem.get(marca) ?? 0;
    return {
      marca,
      nomeExibicao: NOME_EXIBICAO[marca],
      lojas,
      status: lojas > 0 ? 'LIVE' : 'MANUTENÇÃO'
    };
  });
}
