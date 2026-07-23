import { supabase } from '../lib/supabaseClient';
import type { Database } from '../types/database';
import type { ImportPreview, Marca, StageSource } from '../types/gto';

type ParsedCsv = {
  columns: string[];
  rows: Record<string, string>[];
};

type ImportResult = {
  insertedRows: number;
  source: StageSource;
  table: string;
};

const sourceTable: Record<StageSource, string> = {
  credsystem_emissoes: 'dados_cartoes_credsystem',
  credsystem_propostas: 'stage_credsystem_propostas',
  rd_station: 'stage_rd_station_marketing',
  meta_business: 'stage_meta_business_analytics',
  google_business_profile: 'stage_google_business_profile'
};

async function insertInChunks<T>(
  rows: T[],
  insertChunk: (chunk: T[]) => Promise<{ error: { message: string } | null }>,
  chunkSize = 500
) {
  let insertedRows = 0;

  for (let start = 0; start < rows.length; start += chunkSize) {
    const chunk = rows.slice(start, start + chunkSize);
    const { error } = await insertChunk(chunk);
    if (error) throw error;
    insertedRows += chunk.length;
  }

  return insertedRows;
}

function normalizeHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

function parseCurrency(value: string | undefined): number | null {
  if (!value) return null;
  const normalized = value.replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseNumber(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Number(value.replace(',', '.').replace(/[^\d.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeDate(value: string | undefined): string {
  if (!value) return new Date().toISOString().slice(0, 10);
  const clean = value.trim();

  if (/^\d{4}\/\d{2}\/\d{2}$/.test(clean)) {
    return clean.replaceAll('/', '-');
  }

  if (/^\d{2}\/\d{2}\/\d{4}$/.test(clean)) {
    const [day, month, year] = clean.split('/');
    return `${year}-${month}-${day}`;
  }

  return clean.slice(0, 10);
}

function joinPhone(ddd: string | undefined, phone: string | undefined): string {
  const cleanDdd = (ddd ?? '').replace(/\D/g, '');
  const cleanPhone = (phone ?? '').replace(/\D/g, '');
  return `${cleanDdd}${cleanPhone}`;
}

export async function parseCsvFile(file: File): Promise<ParsedCsv> {
  const text = await readCsvText(file);
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const separator = lines[0]?.includes(';') ? ';' : ',';
  const columns = (lines[0] ?? '').split(separator).map(normalizeHeader);

  const rows = lines.slice(1).map((line) => {
    const values = line.split(separator);
    return columns.reduce<Record<string, string>>((row, column, index) => {
      row[column] = values[index]?.trim() ?? '';
      return row;
    }, {});
  });

  return { columns, rows };
}

async function readCsvText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const utf8Text = new TextDecoder('utf-8', { fatal: false }).decode(buffer);

  if (!utf8Text.includes('�')) return utf8Text;

  try {
    return new TextDecoder('windows-1252').decode(buffer);
  } catch {
    return new TextDecoder('iso-8859-1').decode(buffer);
  }
}

export function buildImportPreview(
  fileName: string,
  source: StageSource,
  marca: Marca,
  parsed: ParsedCsv
): ImportPreview {
  const errors: string[] = [];

  if (parsed.rows.length === 0) {
    errors.push('O arquivo nao possui linhas de dados.');
  }

  if (
    source === 'credsystem_emissoes' &&
    !parsed.columns.includes('data_emissao') &&
    !parsed.columns.includes('dt_emissao')
  ) {
    errors.push('CredSystem Emissoes exige a coluna DT_EMISSAO.');
  }

  if (
    source === 'credsystem_propostas' &&
    !parsed.columns.includes('id_cod_proposta')
  ) {
    errors.push('CredSystem Propostas exige a coluna ID_COD_PROPOSTA.');
  }

  if (source === 'rd_station' && !parsed.columns.includes('id_campanha')) {
    errors.push('RD Station exige a coluna id_campanha.');
  }

  return {
    fileName,
    source,
    marca,
    totalRows: parsed.rows.length,
    validRows: errors.length === 0 ? parsed.rows.length : 0,
    invalidRows: errors.length === 0 ? 0 : parsed.rows.length,
    columns: parsed.columns,
    sample: parsed.rows.slice(0, 5),
    errors
  };
}

export function mapRowsForSource(
  source: StageSource,
  marca: Marca,
  rows: Record<string, string>[],
  fileName: string
) {
  if (source === 'credsystem_emissoes') {
    return rows.map((row) => ({
      marca,
      data_emissao: normalizeDate(row.dt_emissao || row.data_emissao || row.data),
      data_ativacao: row.dt_ativacao || row.data_ativacao
        ? normalizeDate(row.dt_ativacao || row.data_ativacao)
        : null,
      loja_operacao: row.nm_loja || row.loja_operacao || row.loja || row.cd_loja_cs || 'Nao informado',
      nome_cliente: row.nm_cliente || row.nome_cliente || row.cliente || null,
      telefone: joinPhone(row.ddd_celular, row.nr_fone_celular) || row.telefone || null,
      valor_compra_inicial: parseCurrency(row.valor_compra_inicial || row.valor || row.ticket),
      frequencia_recorrencia: parseNumber(row.frequencia_recorrencia || row.recorrencia || row.d_ativacao),
      origem_arquivo: fileName,
      lote_importacao: crypto.randomUUID()
    }));
  }

  if (source === 'credsystem_propostas') {
    return rows.map((row) => ({
      marca,
      dt_proposta: normalizeDate(row.dt_proposta || row.data_proposta || row.data),
      hr_proposta: row.hr_proposta || null,
      cd_loja_cs: row.cd_loja_cs || null,
      nm_loja: row.nm_loja || null,
      id_cod_proposta: row.id_cod_proposta || crypto.randomUUID(),
      cpf_cliente: row.cpf_cliente || null,
      cd_cliente: row.cd_cliente || null,
      id_cod_cartao: row.id_cod_cartao || null,
      campanha: row.campanha || null,
      origem_prop: row.origem_prop || null,
      proposta_aprov: parseNumber(row.proposta_aprov),
      proposta_rejei: parseNumber(row.proposta_rejei),
      motivo: row.motivo || null,
      cpf_promotor: row.cpf_promotor || null,
      login_operador: row.login_operador || null,
      tel_celular: row.tel_celular || null,
      cpf_operador: row.cpf_operador || null,
      nivel_2: row.nivel_2 || null,
      payload_bruto: row,
      origem_arquivo: fileName,
      lote_importacao: crypto.randomUUID()
    }));
  }

  if (source === 'rd_station') {
    return rows.map((row) => ({
      marca,
      id_campanha: row.id_campanha || row.campanha_id || crypto.randomUUID(),
      nome_campanha: row.nome_campanha || row.campanha || 'Campanha sem nome',
      enviados: parseNumber(row.enviados),
      entregues: parseNumber(row.entregues),
      taxa_abertura: parseNumber(row.taxa_abertura),
      taxa_clique: parseNumber(row.taxa_clique),
      descadastros: parseNumber(row.descadastros),
      assunto_email: row.assunto_email || row.assunto || null,
      preheader: row.preheader || null,
      corpo_copy: row.corpo_copy || row.copy || null,
      payload_bruto: row,
      data_referencia: row.data_referencia || new Date().toISOString().slice(0, 10),
      origem_api: 'csv_import',
      lote_importacao: crypto.randomUUID()
    }));
  }

  if (source === 'meta_business') {
    return rows.map((row) => ({
      marca,
      data_referencia: row.data_referencia || row.data || new Date().toISOString().slice(0, 10),
      seguidores_instagram: parseNumber(row.seguidores_instagram),
      alcance_facebook: parseNumber(row.alcance_facebook),
      engajamento_total: parseNumber(row.engajamento_total),
      post_destaque_semana_url: row.post_destaque_semana_url || null,
      payload_bruto: row,
      origem_api: 'csv_import',
      lote_importacao: crypto.randomUUID()
    }));
  }

  return rows.map((row) => ({
    marca,
    id_loja_gmb: row.id_loja_gmb || row.id_loja || crypto.randomUUID(),
    nome_loja: row.nome_loja || row.loja || null,
    rating_medio: parseNumber(row.rating_medio || row.rating),
    status_resposta: row.status_resposta || null,
    horario_funcionamento: row.horario_funcionamento
      ? { raw: row.horario_funcionamento }
      : {},
    payload_bruto: row,
    data_referencia: row.data_referencia || row.data || new Date().toISOString().slice(0, 10),
    origem_api: 'csv_import',
    lote_importacao: crypto.randomUUID()
  }));
}

export async function importRowsToStage(params: {
  source: StageSource;
  marca: Marca;
  rows: Record<string, string>[];
  fileName: string;
}): Promise<ImportResult> {
  const table = sourceTable[params.source];

  if (params.source === 'credsystem_emissoes') {
    const rows = mapRowsForSource(params.source, params.marca, params.rows, params.fileName) as Database['public']['Tables']['dados_cartoes_credsystem']['Insert'][];
    const insertedRows = await insertInChunks(rows, (chunk) =>
      supabase.from('dados_cartoes_credsystem').insert(chunk)
    );
    return { insertedRows, source: params.source, table };
  }

  if (params.source === 'credsystem_propostas') {
    const rows = mapRowsForSource(params.source, params.marca, params.rows, params.fileName) as Database['public']['Tables']['stage_credsystem_propostas']['Insert'][];
    const insertedRows = await insertInChunks(rows, (chunk) =>
      supabase.from('stage_credsystem_propostas').upsert(chunk, {
        onConflict: 'marca,id_cod_proposta',
        ignoreDuplicates: true
      }),
      100
    );
    return { insertedRows, source: params.source, table };
  }

  if (params.source === 'rd_station') {
    const rows = mapRowsForSource(params.source, params.marca, params.rows, params.fileName) as Database['public']['Tables']['stage_rd_station_marketing']['Insert'][];
    const insertedRows = await insertInChunks(rows, (chunk) =>
      supabase.from('stage_rd_station_marketing').insert(chunk)
    );
    return { insertedRows, source: params.source, table };
  }

  if (params.source === 'meta_business') {
    const rows = mapRowsForSource(params.source, params.marca, params.rows, params.fileName) as Database['public']['Tables']['stage_meta_business_analytics']['Insert'][];
    const insertedRows = await insertInChunks(rows, (chunk) =>
      supabase.from('stage_meta_business_analytics').insert(chunk)
    );
    return { insertedRows, source: params.source, table };
  }

  const rows = mapRowsForSource(params.source, params.marca, params.rows, params.fileName) as Database['public']['Tables']['stage_google_business_profile']['Insert'][];
  const insertedRows = await insertInChunks(rows, (chunk) =>
    supabase.from('stage_google_business_profile').insert(chunk)
  );

  return {
    insertedRows,
    source: params.source,
    table
  };
}
