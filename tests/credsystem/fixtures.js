// Fixtures SINTETICAS para testes (valores ficticios, nunca gravados em producao). Reproduzem a
// ESTRUTURA da planilha de campanhas CredSystem: 3 abas (uma por marca) com os 22 campos.
import * as XLSX from '../../public/vendor/xlsx-0.20.3.js';

export { XLSX };

export const CABECALHO_CRM = [
  'DH_DISPARO', 'MES', 'ANO', 'NR_BIN', 'DS_CAMPANHA', 'DS_CANAL', 'DS_STEP', 'DS_CLUSTER_CAMPANHA', 'FL_REGUA',
  'QT_ABORDADO', 'QT_ADESAO_ABORDADO', 'VL_GASTO_ABORDADO', 'TKM_ABORDADO', 'QT_CONTROLE', 'QT_ADESAO_CONTROLE',
  'VL_GASTO_CONTROLE', 'TKM_CONTROLE', 'TX_CONV_ABORDADO', 'TX_CONV_CONTROLE', 'VL_VENDAS_INCREMENTAIS', 'DS_FRASE', 'DS_TITULO_PUSH'
];

// serial Excel de uma data ISO (UTC)
export function serial(iso, hora = '00:00:00') {
  const [h, m, s] = hora.split(':').map(Number);
  return Date.UTC(...iso.split('-').map((v, i) => (i === 1 ? Number(v) - 1 : Number(v))), h, m, s) / 86400000 + 25569;
}

// Linha CRM sintetica. tx em escala 0-100 por padrao.
export function linhaCRM({
  data = '2026-03-10', hora = '10:00:00', bin = 960358, campanha = 'CAMPANHA TESTE', canal = 'SMS', step = 'D+1',
  cluster = 'ATIVACAO', regua = 'S', qa = 1000, qaa = 50, vga = 5000, qc = 100, qac = 2, vgc = 150, vvi = 1200,
  frase = 'Mensagem sintetica', titulo = 'Titulo', txEscala = 100
} = {}) {
  const tka = qaa ? vga / qaa : null;
  const tkc = qac ? vgc / qac : null;
  return [
    serial(data, hora), Number(data.slice(5, 7)), Number(data.slice(0, 4)), bin, campanha, canal, step, cluster, regua,
    qa, qaa, vga, tka, qc, qac, vgc, tkc,
    qa ? (qaa / qa) * txEscala : null, qc ? (qac / qc) * txEscala : null, vvi, frase, titulo
  ];
}

export function workbookCRM(abas) {
  const wb = XLSX.utils.book_new();
  for (const [nome, linhas] of Object.entries(abas)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([CABECALHO_CRM, ...linhas]), nome);
  }
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
}

// "Modelo Padrao CredSystem 2026": planilha consolidada (uma aba, 26 colunas em snake_case) com
// marca, id_registro, aba_origem e linha_origem. Linhas reproduzem casos observados no modelo real:
// duas linhas da mesma campanha/data/canal com metricas diferentes, BIN da coluna diferente do BIN
// citado no nome da campanha, controle zerado (taxa/ticket em branco) e uma divergencia BIN x marca.
export const CABECALHO_MODELO_2026 = [
  'id_registro', 'marca', 'data_disparo', 'mes', 'ano', 'bin', 'campanha', 'canal', 'etapa_regua', 'categoria_campanha',
  'flag_regua', 'qtd_abordagens', 'qtd_adesoes_abordados', 'valor_gasto_abordados', 'ticket_medio_informado_abordados',
  'qtd_controle', 'qtd_adesoes_controle', 'valor_gasto_controle', 'ticket_medio_informado_controle',
  'taxa_conversao_informada_abordados', 'taxa_conversao_informada_controle', 'vendas_incrementais_informadas',
  'mensagem_campanha', 'titulo_push', 'aba_origem', 'linha_origem'
];

export function arquivoModeloPadrao2026() {
  const T = 'Tesoura de Ouro', F = 'Free Center Calçados', M = 'Magazine da Economia';
  const linhas = [
    ['a9baf2073940de78eb5b', T, '2026-01-29', 1, 2026, 960358, 'B2B_960358_PL_20260129_TESOURA_AULAS_PUSH_JP', 'PUSH', null, 'Geral', 'N',
      23587, 1528, 395318.6, 258.7, 4170, 266, 64120.8, 241.1, 6.5, 6.4, 32629, '%%NM_CLIENTE%%, O look perfeito para a volta as aulas', 'MODA INFANTIL', T, 2],
    ['f3284e0c956b3ce9f4a1', T, '2026-01-01', 1, 2026, 960358, 'B2B_960358_PL_20230829_TESOURA_REATIVACAO_SMS_JR_M3', 'SMS', 'M3', 'Reativacao', 'S',
      2147, 179, 45282.1, 253, 368, 31, 6632, 213.9, 8.3, 8.4, 6590, null, null, T, 15],
    ['9b309f7d03c81e571b91', T, '2026-01-01', 1, 2026, 960358, 'B2B_960358_PL_20230829_TESOURA_REATIVACAO_SMS_JR_M3', 'SMS', 'M3', 'Reativacao', 'S',
      2235, 185, 40467.2, 218.7, 397, 35, 6316.2, 180.5, 8.3, 8.8, 4909, null, null, T, 21],
    ['c30ce25b74c97bb685ae', T, '2026-05-06', 5, 2026, 960358, 'B2B_960361_PL_20260506_MAGAZINEECO_PROMO_SMS_JP', 'SMS', null, 'Geral', 'N',
      1382, 54, 17262.4, 319.7, 247, 7, 1123.8, 160.5, 3.9, 2.8, 4142, null, null, T, 190],
    ['532018707e3665f34cc7', F, '2026-02-11', 2, 2026, 960360, 'B2B_960360_PL_20260211_FREE_CARNAVAL_SMS_JP', 'SMS', null, 'Geral', 'N',
      21, 0, 0, null, 0, 0, 0, null, 0, null, 0, null, null, F, 2],
    ['91eb6ecb8e0c8c05ceb0', M, '2026-01-13', 1, 2026, 960361, 'B2B_960361_PL_20260113_MAGAZINEECO_FERIAS_SMS_JP', 'SMS', null, 'Geral', 'N',
      2090, 150, 44601.7, 297.3, 326, 21, 5220.3, 248.6, 7.2, 6.4, 11134, null, null, M, 2],
    ['ffffffffffffffffffff', M, '2026-01-13', 1, 2026, 960358, 'B2B_960358_PL_20260113_TESOURA_X_SMS_JP', 'SMS', null, 'Geral', 'N',
      100, 5, 500, 100, 10, 0, 0, null, 5, 0, 0, null, null, M, 3]
  ];
  // Mesmas abas auxiliares do arquivo real. O dicionario tem uma coluna "DH_DISPARO" que, se a aba
  // entrasse na deteccao, roubaria o mapeamento da data (bug encontrado com o arquivo real).
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['marca', 'registros_campanhas', 'abordagens_somadas'], ['TOTAL', 7, 1]]), '00_RESUMO');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([CABECALHO_MODELO_2026, ...linhas]), '01_CAMPANHAS_CRM');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['id_proposta', 'marca', 'bin', 'codigo_loja', 'data_proposta', 'status_proposta']]), '02_PROPOSTAS');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['marca_padrao', 'bin', 'cor_painel', 'sigla'], ['Tesoura de Ouro', '960358', 'Azul', 'TO']]), '05_MAPA_MARCAS');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['aba', 'campo_padrao', 'coluna_origem', 'tipo_sugerido'],
    ['01_CAMPANHAS_CRM', 'data_disparo', 'DH_DISPARO', 'data ISO'],
    ['01_CAMPANHAS_CRM', 'mes', 'MES', 'inteiro']
  ]), '06_DICIONARIO');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['TEMA', 'ORIENTAÇÃO'], ['BIN', 'Manter como texto']]), 'LEIA_ME');
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
}

export function arquivoCRMTresMarcas() {
  return workbookCRM({
    'TESOURA DE OURO': [
      linhaCRM({ bin: 960358, campanha: 'ATIVACAO D+1', qa: 1000, qaa: 50, vga: 5000, qc: 100, qac: 2, vgc: 150, vvi: 1200 }),
      linhaCRM({ bin: 960358, campanha: 'ANIVERSARIO', cluster: 'ANIVERSARIO', canal: 'WhatsApp', data: '2026-04-02', qa: 400, qaa: 40, vga: 2000, qc: 50, qac: 1, vgc: 60, vvi: 900 })
    ],
    'FREE CENTER': [
      linhaCRM({ bin: 960360, campanha: 'REATIVACAO 90D', cluster: 'REATIVACAO', canal: 'E-MAIL', qa: 300, qaa: 3, vga: 600, qc: 30, qac: 0, vgc: 0, vvi: 200 })
    ],
    'MAGAZINE DA ECONOMIA': [
      linhaCRM({ bin: 960361, campanha: 'ATIVACAO D+1', canal: 'PUSH', qa: 200, qaa: 20, vga: 1000, qc: 20, qac: 1, vgc: 40, vvi: 300 })
    ]
  });
}
