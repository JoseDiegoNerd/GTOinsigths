import type { Marca } from './gto';

// Contrato do modulo Influenciadores. Os campos de Influencer, Campaign, MediaContent e
// FollowerSnapshot espelham as colunas de supabase/migrations/20260921_039_influenciadores.sql
// (scripts/check-contracts.mjs confere isso). O front-end do modulo e JavaScript de navegador
// (public/modules/influenciadores/), entao estes tipos documentam o formato; o compilador nao
// checa o JS.

export type Bandeira = Exclude<Marca, 'Todas'>;
export type RedeSocial = 'Instagram' | 'TikTok' | 'YouTube';
export type StatusInfluenciador = 'Ativo' | 'Pausado' | 'Encerrado';
export type FormatoMidia = 'Reel' | 'Feed' | 'Story' | 'Video' | 'Short';
export type FonteMetrica = 'manual' | 'meta_colab' | 'business_discovery';

export interface Influencer {
  id: string;
  marca: Bandeira;
  nome: string;
  handle: string;
  rede_social: RedeSocial;
  verificado: boolean;
  nicho: string | null;
  avatar_path: string | null;
  cupom_codigo: string | null;
  cupom_exclusivo: boolean;
  status: StatusInfluenciador;
  criado_em: string;
  atualizado_em: string;
}

export interface Campaign {
  id: string;
  influenciador_id: string;
  marca: Bandeira;
  nome: string;
  data_inicio: string;
  data_fim: string | null;
  cache_valor: number;
  voucher_valor: number;
  investimento_total: number;
  criado_em: string;
  atualizado_em: string;
}

export interface MediaContent {
  id: string;
  influenciador_id: string;
  marca: Bandeira;
  campanha_id: string | null;
  titulo: string;
  url: string;
  plataforma: RedeSocial | null;
  formato: FormatoMidia | null;
  publicada_em: string;
  views: number;
  alcance: number;
  curtidas: number;
  comentarios: number;
  salvos: number;
  compartilhamentos: number;
  fonte: FonteMetrica;
  criado_em: string;
  atualizado_em: string;
}

export interface FollowerSnapshot {
  id: string;
  influenciador_id: string;
  marca: Bandeira;
  data: string;
  seguidores: number;
  criado_em: string;
}

// Agregados calculados no cliente (public/modules/influenciadores/calculos.js).
export interface KpiValor {
  atual: number | null;
  anterior: number | null;
  variacao: number | null;
}

export interface Metrics {
  investimento: KpiValor;
  alcance: KpiValor;
  engajamento: KpiValor;
  cpe: KpiValor;
  interacoes: KpiValor;
}

export interface InfluencerAggregate {
  seguidores: number | null;
  crescimentoAbs: number | null;
  crescimentoPct: number | null;
  campanhasAtivas: number;
  cacheTotal: number;
  voucherTotal: number;
  investimentoTotal: number;
  alcanceTotal: number;
  totalMidias: number;
}
