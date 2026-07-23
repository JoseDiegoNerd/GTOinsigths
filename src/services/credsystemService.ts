import { supabase } from '../lib/supabaseClient';
import type {
  BrandMetric,
  CredsystemBI,
  CredsystemInsert,
  DadosCartoesCredsystem,
  DashboardSummary,
  Marca,
  MotivoPropostaMetric,
  PeriodoFiltro
} from '../types/gto';

function dateFromPeriod(periodo: PeriodoFiltro): string | null {
  if (periodo === 'all') return null;

  const date = new Date();
  if (periodo === '7d') date.setDate(date.getDate() - 7);
  if (periodo === '30d') date.setDate(date.getDate() - 30);
  if (periodo === '1y') date.setFullYear(date.getFullYear() - 1);
  return date.toISOString().slice(0, 10);
}

function asNumber(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function average(values: number[]): number {
  const valid = values.filter((value) => Number.isFinite(value));
  if (valid.length === 0) return 0;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

async function listCredsystemPropostas(params?: {
  marca?: Marca | 'Todas';
}) {
  const pageSize = 1000;
  let from = 0;
  let rows: Array<{
    marca: Marca;
    proposta_aprov: number;
    proposta_rejei: number;
    motivo: string | null;
    dt_proposta: string;
  }> = [];

  while (true) {
    let query = supabase
      .from('stage_credsystem_propostas')
      .select('marca,proposta_aprov,proposta_rejei,motivo,dt_proposta')
      .range(from, from + pageSize - 1);

    if (params?.marca && params.marca !== 'Todas') {
      query = query.eq('marca', params.marca);
    }

    const { data, error } = await query;
    if (error) throw error;

    const page = data ?? [];
    rows = rows.concat(page);

    if (page.length < pageSize) break;
    from += pageSize;
  }

  return rows;
}

export async function listCredsystemCards(params?: {
  marca?: Marca | 'Todas';
  periodo?: PeriodoFiltro;
  limit?: number;
}) {
  const periodo = params?.periodo ?? '30d';
  const fromDate = dateFromPeriod(periodo);

  let query = supabase
    .from('dados_cartoes_credsystem')
    .select('*')
    .order('data_emissao', { ascending: false })
    .limit(params?.limit ?? 500);

  if (params?.marca && params.marca !== 'Todas') {
    query = query.eq('marca', params.marca);
  }

  if (fromDate) {
    query = query.gte('data_emissao', fromDate);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function insertCredsystemCards(rows: CredsystemInsert[]) {
  const { data, error } = await supabase
    .from('dados_cartoes_credsystem')
    .insert(rows)
    .select('*');

  if (error) throw error;
  return data ?? [];
}

export async function getCredsystemDashboard(params?: {
  marca?: Marca | 'Todas';
  periodo?: PeriodoFiltro;
}) {
  const [cardsResult, rdResult, metaResult, propostasResult] = await Promise.all([
    listCredsystemCards(params),
    supabase
      .from('stage_rd_station_marketing')
      .select('marca,enviados,taxa_abertura,taxa_clique,data_referencia')
      .limit(500),
    supabase
      .from('stage_meta_business_analytics')
      .select('marca,alcance_facebook,engajamento_total,data_referencia')
      .limit(500),
    listCredsystemPropostas(params)
  ]);

  if (rdResult.error) throw rdResult.error;
  if (metaResult.error) throw metaResult.error;

  const cards = cardsResult;
  const rdRows = rdResult.data ?? [];
  const metaRows = metaResult.data ?? [];
  const propostasRows = propostasResult;
  const totalPropostas = propostasRows.length;
  const propostasAprovadas = propostasRows.reduce((sum, row) => sum + asNumber(row.proposta_aprov), 0);
  const propostasRejeitadas = propostasRows.reduce((sum, row) => sum + asNumber(row.proposta_rejei), 0);

  const summary: DashboardSummary = {
    totalCartoes: cards.length,
    cartoesAtivos: cards.filter((card) => Boolean(card.data_ativacao)).length,
    novosCartoes: cards.length,
    ticketMedio: average(cards.map((card) => asNumber(card.valor_compra_inicial))),
    recorrenciaMedia: average(cards.map((card) => card.frequencia_recorrencia)),
    totalPropostas,
    propostasAprovadas,
    propostasRejeitadas,
    taxaAprovacao: totalPropostas > 0 ? (propostasAprovadas / totalPropostas) * 100 : 0,
    totalCampanhas: rdRows.length,
    taxaAberturaMedia: average(rdRows.map((row) => asNumber(row.taxa_abertura))),
    taxaCliqueMedia: average(rdRows.map((row) => asNumber(row.taxa_clique))),
    alcanceFacebook: metaRows.reduce((sum, row) => sum + asNumber(row.alcance_facebook), 0),
    engajamentoTotal: metaRows.reduce((sum, row) => sum + asNumber(row.engajamento_total), 0)
  };

  const byBrand = cards.reduce<Record<Marca, DadosCartoesCredsystem[]>>((acc, card) => {
    acc[card.marca] = acc[card.marca] ?? [];
    acc[card.marca].push(card);
    return acc;
  }, {} as Record<Marca, DadosCartoesCredsystem[]>);

  const brandMetrics: BrandMetric[] = Object.entries(byBrand).map(([marca, rows]) => ({
    marca: marca as Marca,
    totalCartoes: rows.length,
    ativados: rows.filter((row) => Boolean(row.data_ativacao)).length,
    ticketMedio: average(rows.map((row) => asNumber(row.valor_compra_inicial))),
    recorrenciaMedia: average(rows.map((row) => row.frequencia_recorrencia))
  }));

  const motivoMap = propostasRows.reduce<Record<string, number>>((acc, row) => {
    const motivo = row.motivo || 'SEM MOTIVO';
    acc[motivo] = (acc[motivo] ?? 0) + 1;
    return acc;
  }, {});

  const motivosPropostas: MotivoPropostaMetric[] = Object.entries(motivoMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([motivo, total]) => ({
      motivo,
      total,
      participacao: totalPropostas > 0 ? (total / totalPropostas) * 100 : 0
    }));

  return {
    summary,
    brandMetrics,
    motivosPropostas,
    cards
  };
}

export async function getCredsystemBI(params?: {
  marca?: Marca | 'Todas';
}): Promise<CredsystemBI> {
  let resumo = supabase.from('vw_credsystem_resumo_geral').select('*');
  let porMarca = supabase.from('vw_credsystem_por_marca').select('*');
  let lojas = supabase
    .from('vw_credsystem_por_loja')
    .select('*')
    .order('total_propostas', { ascending: false })
    .limit(20);
  let motivos = supabase
    .from('vw_credsystem_motivos_rejeicao')
    .select('*')
    .order('total', { ascending: false })
    .limit(20);
  let funil = supabase.from('vw_credsystem_funil_propostas_emissoes').select('*');

  if (params?.marca && params.marca !== 'Todas') {
    resumo = resumo.eq('marca', params.marca);
    porMarca = porMarca.eq('marca', params.marca);
    lojas = lojas.eq('marca', params.marca);
    motivos = motivos.eq('marca', params.marca);
    funil = funil.eq('marca', params.marca);
  }

  const [resumoResult, porMarcaResult, lojasResult, motivosResult, funilResult] = await Promise.all([
    resumo,
    porMarca,
    lojas,
    motivos,
    funil
  ]);

  const firstError =
    resumoResult.error ||
    porMarcaResult.error ||
    lojasResult.error ||
    motivosResult.error ||
    funilResult.error;
  if (firstError) throw firstError;

  return {
    resumo: resumoResult.data ?? [],
    porMarca: porMarcaResult.data ?? [],
    lojas: lojasResult.data ?? [],
    motivos: motivosResult.data ?? [],
    funil: funilResult.data ?? []
  };
}
