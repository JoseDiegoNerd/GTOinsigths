import test from 'node:test';
import assert from 'node:assert/strict';
import { XLSX, CABECALHO_CRM, linhaCRM, workbookCRM, arquivoCRMTresMarcas, arquivoModeloPadrao2026, serial } from './fixtures.js';
import { lerPlanilha, parseCsv, decodificarTexto } from '../../public/modules/credsystem/leitor-planilha.js';
import { detectarTipo, marcasPorAba, mapearAutomatico, separarAbasDeDados } from '../../public/modules/credsystem/detector.js';
import { prepararImportacao, resolverMarcaLinha, escalaTaxas, normalizarTaxa } from '../../public/modules/credsystem/transformacao.js';
import { parseNumero, parseData, marcaPorTexto, canalNormalizado, categoriaNormalizada } from '../../public/modules/credsystem/normalizacao.js';
import { BIN_MARCA_PADRAO } from '../../public/modules/credsystem/constantes.js';
import { gerarCsv, neutralizarCelula } from '../../public/modules/credsystem/exportacao.js';

function preparar(buffer, nomeArquivo = 'campanhas.xlsx', extra = {}) {
  const separacao = separarAbasDeDados(lerPlanilha({ nomeArquivo, buffer, XLSX })); // mesmo passo do importador
  const leitura = separacao.leitura;
  const det = detectarTipo(leitura);
  const tipo = extra.tipo || det.tipo;
  const mapa = extra.mapa || mapearAutomatico(tipo, det.cabecalhos);
  const prep = prepararImportacao(tipo, leitura, mapa, {
    mapaBins: BIN_MARCA_PADRAO, mapaLojas: {}, marcasAba: marcasPorAba(leitura),
    marcaSelecionada: extra.marcaSelecionada || null, nomeArquivo
  });
  return { leitura, det, prep, ignoradas: separacao.ignoradas };
}

// ---- normalizacao -------------------------------------------------------------------------------
test('parseNumero: formatos BR/internacional, vazio vira null (nao zero)', () => {
  assert.equal(parseNumero('1.234,56').valor, 1234.56);
  assert.equal(parseNumero('R$ 10,00').valor, 10);
  assert.equal(parseNumero('1,234.56').valor, 1234.56);
  assert.equal(parseNumero('1.234').valor, 1234);
  assert.equal(parseNumero('12.5').valor, 12.5);
  assert.equal(parseNumero('12,5%').valor, 12.5);
  assert.equal(parseNumero('12,5%').percentual, true);
  assert.equal(parseNumero('(150,00)').valor, -150);
  assert.equal(parseNumero('').valor, null);
  assert.equal(parseNumero(null).valor, null);
  assert.equal(parseNumero(0).valor, 0);
  assert.equal(parseNumero('abc').erro, 'NUMERO_INVALIDO');
  assert.equal(parseNumero('1.2.3,4,5').erro, 'NUMERO_INVALIDO');
});

test('parseData: serial Excel, dd/mm/aaaa, ISO, invalidas', () => {
  assert.deepEqual(parseData(serial('2026-03-10', '14:30:00')), { data: '2026-03-10', hora: '14:30:00', erro: null, formato: 'serial_excel' });
  assert.equal(parseData('01/06/2026').data, '2026-06-01');
  assert.equal(parseData('2026-06-01 08:05').hora, '08:05:00');
  assert.equal(parseData('20260601').data, '2026-06-01');
  assert.equal(parseData('31/02/2026').erro, 'DATA_INVALIDA');
  assert.equal(parseData('10.09%').erro, 'DATA_INVALIDA');
  assert.equal(parseData('').data, null);
});

test('marca por nome de aba e canais/categorias normalizados', () => {
  assert.equal(marcaPorTexto('TESOURA DE OURO'), 'Tesoura de Ouro');
  assert.equal(marcaPorTexto('FREE CENTER'), 'Free Center Calçados');
  assert.equal(marcaPorTexto('MAGAZINE DA ECONOMIA'), 'Magazine da Economia');
  assert.equal(marcaPorTexto('Planilha1'), null);
  assert.equal(marcaPorTexto('Tesoura x Magazine'), null, 'ambiguo nao adivinha');
  assert.equal(canalNormalizado('E-MAIL'), 'E-mail');
  assert.equal(canalNormalizado('whatsapp'), 'WhatsApp');
  assert.equal(categoriaNormalizada('REATIVACAO'), 'Reativação');
  assert.equal(categoriaNormalizada('ATIVAÇÃO'), 'Ativação');
});

// ---- deteccao -----------------------------------------------------------------------------------
test('reconhece automaticamente a planilha de campanhas CRM e os 22 campos', () => {
  const { det } = preparar(arquivoCRMTresMarcas());
  assert.equal(det.tipo, 'credsystem_crm_campanhas');
  assert.equal(det.confianca, 'alta');
  assert.equal(det.colunasReconhecidas.length, 22);
  assert.deepEqual(det.colunasNaoReconhecidas, []);
});

test('reconhece arquivo de propostas real (cabecalhos do arquivo CredSystem) e de emissoes', () => {
  const csvProp = 'id_cod_proposta;dt_proposta;hr_proposta;cd_loja_cs;nm_loja;cpf_cliente;cd_cliente;id_cod_cartao;campanha;origem_prop;proposta_aprov;proposta_rejei;motivo;cpf_promotor;login_operador;tel_celular;cpf_operador;nivel_2\n' +
    'P1;01/06/2026;10:00;30501;0025 TO PLANALTINA 1 DF 30501;12345678900;C1;K1;IMEDIATO;960358 TESOURA DE OURO;1;0;APROVADA;;op;61999999999;;N2\n';
  const { det, prep } = preparar(new TextEncoder().encode(csvProp), 'PROPOSTAS.CSV');
  assert.equal(det.tipo, 'credsystem_propostas');
  assert.equal(det.confianca, 'alta');
  assert.equal(prep.registros.length, 1);
  assert.equal(prep.registros[0].nr_bin, '960358', 'BIN extraido da origem_prop');
  assert.equal(prep.resumo.marcas['Tesoura de Ouro'], 1);
  assert.ok(!JSON.stringify(prep.registros[0].dados_originais).includes('61999999999'), 'telefone nao vai em dados_originais');
  assert.ok(!('cpf_cliente' in prep.registros[0].dados_originais), 'cpf nao vai em dados_originais');

  const csvEmi = 'id_cod_cartao;dt_emissao;dt_ativacao;nm_loja;canal;sub_canal;tipo_cartao\nK1;02/06/2026;05/06/2026;LOJA X;Emissão Imediata;Express;TITULAR\n';
  const r2 = preparar(new TextEncoder().encode(csvEmi), 'EMISSAO.CSV', { marcaSelecionada: 'Tesoura de Ouro' });
  assert.equal(r2.det.tipo, 'credsystem_emissoes');
  assert.equal(r2.prep.registros[0].dt_ativacao, '2026-06-05');
});

test('arquivo desconhecido nao e classificado por suposicao', () => {
  const csv = 'nome;valor;observacao\nA;1;x\n';
  const { det } = preparar(new TextEncoder().encode(csv), 'qualquer.csv', { tipo: 'credsystem_crm_campanhas' });
  assert.equal(det.tipo, null);
  assert.equal(det.confianca, 'baixa');
});

// ---- marcas -------------------------------------------------------------------------------------
test('arquivo com uma unica marca', () => {
  const buf = workbookCRM({ 'TESOURA DE OURO': [linhaCRM({}), linhaCRM({ campanha: 'OUTRA' })] });
  const { prep } = preparar(buf);
  assert.deepEqual(prep.resumo.marcas, { 'Tesoura de Ouro': 2 });
  assert.equal(prep.erros.length, 0);
});

test('arquivo com tres marcas e reconhecimento dos tres BINs', () => {
  const { prep } = preparar(arquivoCRMTresMarcas());
  assert.deepEqual(prep.resumo.marcas, { 'Tesoura de Ouro': 2, 'Free Center Calçados': 1, 'Magazine da Economia': 1 });
  assert.deepEqual(prep.resumo.periodo, { inicio: '2026-03-10', fim: '2026-04-02' });
  assert.equal(prep.resumo.validas, 4);
});

test('divergencia entre BIN e aba bloqueia a linha', () => {
  const buf = workbookCRM({ 'FREE CENTER': [linhaCRM({ bin: 960358 }), linhaCRM({ bin: 960360, campanha: 'OK' })] });
  const { prep } = preparar(buf);
  assert.equal(prep.resumo.validas, 1);
  assert.equal(prep.resumo.conflitosMarca, 1);
  assert.equal(prep.erros[0].codigo, 'CONFLITO_MARCA');
});

test('BIN desconhecido e rejeitado', () => {
  const r = resolverMarcaLinha({ bin: '999999', mapaBins: BIN_MARCA_PADRAO });
  assert.equal(r.erro, 'BIN_DESCONHECIDO');
  assert.equal(resolverMarcaLinha({ bin: '960361', mapaBins: BIN_MARCA_PADRAO }).marca, 'Magazine da Economia');
});

// ---- dados ausentes / invalidos -----------------------------------------------------------------
test('celulas vazias viram null, nao zero; valores invalidos rejeitam a linha', () => {
  const vazia = linhaCRM({ campanha: 'SEM CONTROLE' });
  vazia[13] = null; vazia[14] = null; vazia[15] = null; vazia[16] = null; vazia[18] = null; // controle ausente
  const invalida = linhaCRM({ campanha: 'INVALIDA' });
  invalida[9] = 'mil'; // QT_ABORDADO texto
  const semData = linhaCRM({ campanha: 'SEM DATA' });
  semData[0] = null; semData[1] = null;
  const buf = workbookCRM({ 'TESOURA DE OURO': [vazia, invalida, semData] });
  const { prep } = preparar(buf);
  assert.equal(prep.registros.length, 1);
  const r = prep.registros[0];
  assert.equal(r.qt_controle, null);
  assert.equal(r.vl_gasto_controle, null);
  assert.equal(r.tx_conv_controle, null);
  assert.equal(r.qt_abordado, 1000);
  const codigos = prep.erros.map((e) => e.codigo).sort();
  assert.deepEqual(codigos, ['DATA_INVALIDA', 'VALOR_NUMERICO_INVALIDO']);
});

test('taxas em fracao (0-1) sao normalizadas para 0-100 com registro da transformacao', () => {
  const buf = workbookCRM({ 'TESOURA DE OURO': [linhaCRM({ txEscala: 1 }), linhaCRM({ campanha: 'B', qa: 200, qaa: 30, txEscala: 1 })] });
  const { prep } = preparar(buf);
  assert.equal(prep.registros[0].tx_conv_abordado, '5.0000');
  assert.equal(prep.registros[1].tx_conv_abordado, '15.0000');
  assert.ok(prep.registros[0].transformacoes.some((t) => t.campo === 'TX_CONV_ABORDADO' && /fração/.test(t.regra)));
  assert.equal(escalaTaxas([{ tx: 12.5, num: null, den: null }]), 'percentual');
  assert.equal(normalizarTaxa({ tx: 0.4, num: null, den: null }, 'indefinida').alerta !== null, true);
});

test('duplicidade dentro do arquivo: identica ignorada, divergente rejeitada', () => {
  const a = linhaCRM({ campanha: 'DUP' });
  const b = linhaCRM({ campanha: 'DUP' });
  const c = linhaCRM({ campanha: 'DUP', qa: 999 });
  const { prep } = preparar(workbookCRM({ 'TESOURA DE OURO': [a, b, c] }));
  assert.equal(prep.resumo.validas, 1);
  assert.equal(prep.resumo.duplicadasIdenticas, 1);
  assert.equal(prep.resumo.duplicadasDivergentes, 1);
});

test('preserva cabecalhos originais e mensagem em dados_originais', () => {
  const { prep } = preparar(arquivoCRMTresMarcas());
  const orig = prep.registros[0].dados_originais;
  for (const c of ['DH_DISPARO', 'NR_BIN', 'DS_CAMPANHA', 'QT_ABORDADO', 'TX_CONV_ABORDADO', 'DS_FRASE', 'DS_TITULO_PUSH']) assert.ok(c in orig, c);
});

// ---- arquivos grandes / maliciosos --------------------------------------------------------------
test('aba "formatada" ate a ultima linha do Excel com muitas linhas vazias e lida rapido', () => {
  const ws = XLSX.utils.aoa_to_sheet([CABECALHO_CRM, linhaCRM({}), [], [], linhaCRM({ campanha: 'DEPOIS DAS VAZIAS' })]);
  ws['!ref'] = 'A1:V1048576';
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'TESOURA DE OURO');
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  const t0 = Date.now();
  const { prep } = preparar(buf);
  assert.ok(Date.now() - t0 < 5000, 'leitura deve ser rapida');
  assert.equal(prep.resumo.validas, 2);
  assert.equal(prep.resumo.linhasVazias, 2);
});

test('formulas nao sao avaliadas e textos maliciosos ficam literais e neutralizados na exportacao', () => {
  const linha = linhaCRM({ campanha: '=HYPERLINK("http://mal.example","clique")', frase: '<img src=x onerror=alert(1)>' });
  const ws = XLSX.utils.aoa_to_sheet([CABECALHO_CRM, linha]);
  ws.J2 = { t: 'n', v: 1000, f: 'WEBSERVICE("http://mal.example")' }; // celula com formula: so o valor em cache e lido
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'TESOURA DE OURO');
  const { prep } = preparar(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
  const r = prep.registros[0];
  assert.equal(r.qt_abordado, 1000);
  assert.equal(r.ds_campanha, '=HYPERLINK("http://mal.example","clique")');
  assert.ok(prep.alertas.some((a) => a.codigo === 'TEXTO_COM_FORMULA'));
  assert.equal(neutralizarCelula(r.ds_campanha), '\'=HYPERLINK("http://mal.example","clique")');
  const csv = gerarCsv([{ rotulo: 'Campanha', campo: 'ds_campanha' }], [r]);
  assert.ok(csv.includes('\'=HYPERLINK'));
});

test('CSV: separador ;, aspas com quebra de linha e codificacao Windows-1252', () => {
  const { linhas, separador } = parseCsv('a;b\n"x;1";"linha\nquebrada"\n');
  assert.equal(separador, ';');
  assert.deepEqual(linhas[1], ['x;1', 'linha\nquebrada']);
  const latin1 = new Uint8Array([0x4d, 0x4f, 0x54, 0x49, 0x56, 0x4f, 0x0a, 0x4a, 0xc1]); // "MOTIVO\nJÁ" em 1252
  assert.equal(decodificarTexto(latin1), 'MOTIVO\nJÁ');
});

// ---- Modelo Padrao CredSystem 2026 (estrutura enviada em PDF) ---------------------------------
test('Modelo Padrao 2026: reconhece as 26 colunas e mapeia todas sem ajuste manual', () => {
  const { det } = preparar(arquivoModeloPadrao2026(), 'GTO_Insights_Modelo_Padrao_CredSystem_2026.xlsx');
  assert.equal(det.tipo, 'credsystem_crm_campanhas');
  assert.equal(det.confianca, 'alta');
  const mapa = det.ranking[0].mapa;
  const esperado = {
    dh_disparo: 'data_disparo', nr_bin: 'bin', ds_campanha: 'campanha', ds_canal: 'canal', ds_step: 'etapa_regua',
    ds_cluster_campanha: 'categoria_campanha', fl_regua: 'flag_regua', qt_abordado: 'qtd_abordagens',
    qt_adesao_abordado: 'qtd_adesoes_abordados', vl_gasto_abordado: 'valor_gasto_abordados',
    tkm_abordado: 'ticket_medio_informado_abordados', qt_controle: 'qtd_controle', qt_adesao_controle: 'qtd_adesoes_controle',
    vl_gasto_controle: 'valor_gasto_controle', tkm_controle: 'ticket_medio_informado_controle',
    tx_conv_abordado: 'taxa_conversao_informada_abordados', tx_conv_controle: 'taxa_conversao_informada_controle',
    vl_vendas_incrementais: 'vendas_incrementais_informadas', ds_frase: 'mensagem_campanha', ds_titulo_push: 'titulo_push',
    marca: 'marca', id_registro: 'id_registro', aba_origem: 'aba_origem', linha_origem: 'linha_origem', mes: 'mes', ano: 'ano'
  };
  for (const [campo, col] of Object.entries(esperado)) assert.equal(mapa[campo], col, campo);
});

test('Modelo Padrao 2026: id_registro distingue linhas iguais em campanha/data/canal; BIN x marca bloqueia; BIN do nome so alerta', () => {
  const { prep } = preparar(arquivoModeloPadrao2026(), 'modelo.xlsx');
  assert.equal(prep.resumo.validas, 6);
  assert.equal(prep.resumo.duplicadasDivergentes, 0, 'mesma campanha/data/canal com id_registro diferente nao e duplicidade');
  assert.equal(prep.resumo.conflitosMarca, 1);
  assert.deepEqual(prep.resumo.marcas, { 'Tesoura de Ouro': 4, 'Free Center Calçados': 1, 'Magazine da Economia': 1 });
  assert.ok(prep.erros.some((e) => e.codigo === 'CONFLITO_MARCA' && e.linha === 8));
  const alerta = prep.alertas.find((a) => a.codigo === 'BIN_CAMPANHA_DIVERGENTE');
  assert.ok(alerta, 'BIN 960361 no nome da campanha com coluna BIN 960358');
  assert.equal(alerta.linha, 5);
  const magaNoNome = prep.registros.find((r) => r.id_registro === 'c30ce25b74c97bb685ae');
  assert.equal(magaNoNome.nr_bin, '960358');

  const r1 = prep.registros.find((r) => r.id_registro === 'a9baf2073940de78eb5b');
  assert.equal(Number(r1.tx_conv_abordado), 6.5, 'taxa ja em 0-100 mantida');
  assert.ok(!r1.transformacoes.some((t) => t.campo.startsWith('TX_')), 'nenhuma conversao de escala');
  const free = prep.registros.find((r) => r.id_registro === '532018707e3665f34cc7');
  assert.equal(free.tkm_abordado, null, 'ticket em branco continua sem valor (nao zero)');
  assert.equal(free.tx_conv_controle, null);
  assert.equal(free.qt_adesao_abordado, 0, 'zero informado continua zero');
  assert.ok(!prep.alertas.some((a) => a.codigo === 'ESCALA_TAXA_AMBIGUA'));
});

test('Modelo Padrao 2026: abas auxiliares e modelos vazios sao ignorados e nao roubam o mapeamento da data', () => {
  const { prep, det, ignoradas, leitura } = preparar(arquivoModeloPadrao2026(), 'modelo.xlsx');
  assert.deepEqual(leitura.abas.map((a) => a.nome), ['01_CAMPANHAS_CRM']);
  assert.deepEqual(ignoradas.map((i) => i.nome).sort(), ['00_RESUMO', '02_PROPOSTAS', '05_MAPA_MARCAS', '06_DICIONARIO', 'LEIA_ME']);
  assert.match(ignoradas.find((i) => i.nome === '02_PROPOSTAS').motivo, /sem linhas/);
  assert.equal(det.ranking[0].mapa.dh_disparo, 'data_disparo');
  assert.ok(!prep.alertas.some((a) => a.codigo === 'DATA_DERIVADA_MES_ANO'), 'datas reais, nao dia 1 do mes');
  assert.equal(prep.registros.find((r) => r.id_registro === 'a9baf2073940de78eb5b').dh_disparo, '2026-01-29');
  assert.equal(prep.resumo.linhasLidas, 7);
});

test('arquivo sem nenhuma aba reconhecida nao perde abas (segue para mapeamento manual)', () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['coluna_x', 'coluna_y'], ['a', 1]]), 'Planilha1');
  const { leitura, ignoradas } = preparar(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }), 'x.xlsx', { tipo: 'credsystem_crm_campanhas', mapa: {} });
  assert.equal(leitura.abas.length, 1);
  assert.equal(ignoradas.length, 0);
});
