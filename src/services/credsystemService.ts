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

type PropostaRow = {
  marca: Marca;
  proposta_aprov: number;
  proposta_rejei: number;
  motivo: string | null;
  dt_proposta: string;
};

function credsystemPropostasPage(params: { marca?: Marca | 'Todas' }, from: number, pageSize: number) {
  let query = supabase
    .from('stage_credsystem_propostas')
    .select('marca,proposta_aprov,proposta_rejei,motivo,dt_proposta')
    .range(from, from + pageSize - 1);

  if (params.marca && params.marca !== 'Todas') {
    query = query.eq('marca', params.marca);
  }

  return query;
}

// REVERTIDO: a versao anterior pedia count:'exact' na 1a pagina pra saber quantas paginas
// restantes disparar em paralelo. Isso forca o Postgres a montar um count(*) OVER() (contagem
// exata via window function) antes de devolver qualquer linha - bem mais caro que LIMIT/OFFSET
// sozinho, principalmente com RLS avaliando gto_tem_acesso_marca() por linha. Em producao
// (public/index.html, que usa o mesmo padrao) isso estourou o statement_timeout de 20s do role
// authenticated (Postgres 57014) no Dashboard Geral, que ja dispara ~15 consultas em paralelo.
// Busca em lotes de BATCH_SIZE paginas sem pedir count nenhum; para no primeiro lote em que
// alguma pagina volta com menos que pageSize linhas.
async function listCredsystemPropostas(params?: { marca?: Marca | 'Todas' }): Promise<PropostaRow[]> {
  const pageSize = 1000;
  const batchSize = 10;
  let allRows: PropostaRow[] = [];
  let from = 0;

  while (true) {
    const batch = await Promise.all(
      Array.from({ length: batchSize }, (_, index) => credsystemPropostasPage(params ?? {}, from + index * pageSize, pageSize))
    );

    let reachedEnd = false;
    for (const page of batch) {
      if (page.error) throw page.error;
      const rows = (page.data ?? []) as PropostaRow[];
      allRows = allRows.concat(rows);
      if (rows.length < pageSize) {
        reachedEnd = true;
        break;
      }
    }

    if (reachedEnd) break;
    from += batchSize * pageSize;
  }

  return allRows;
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
}): Promise<{
  summary: DashboardSummary;
  brandMetrics: BrandMetric[];
  motivosPropostas: MotivoPropostaMetric[];
  cards: DadosCartoesCredsystem[];
}> {
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
