// Constantes do modulo Cartao Proprio CredSystem: marcas, cores, BINs iniciais e o "dicionario" de
// campos de cada tipo de planilha (Tipo A CRM, Tipo B operacional, Tipo C transacional). Arquitetura
// extensivel: um tipo novo de importacao = uma entrada nova em TIPOS_ARQUIVO + sua RPC no banco.

export const MARCAS = ["Tesoura de Ouro", "Magazine da Economia", "Free Center Calçados"];

// Mesmas cores de brandColors em public/index.html (identidade visual atual do app).
export const CORES_MARCA = {
  "Tesoura de Ouro": "#2e3192",
  "Magazine da Economia": "#ec078d",
  "Free Center Calçados": "#f16e2c"
};
export const COR_NEUTRA = "#475569";

// Mapeamento inicial (a fonte de verdade e a tabela credsystem_bin_marca no banco; este e so o
// fallback da pre-visualizacao quando a tabela ainda nao foi carregada).
export const BIN_MARCA_PADRAO = {
  "960358": "Tesoura de Ouro",
  "960360": "Free Center Calçados",
  "960361": "Magazine da Economia"
};

// Tipos de campo: data | inteiro | decimal | percentual | texto | bin | flag
// aliases = cabecalhos normalizados (minusculo, sem acento, "_") aceitos para o campo.
const f = (campo, rotulo, tipo, aliases = [], extra = {}) => ({ campo, rotulo, tipo, aliases: [campo, ...aliases], ...extra });

export const CAMPOS_CRM = [
  f("dh_disparo", "Data de disparo", "data", ["data_disparo", "dt_disparo", "data_do_disparo"]),
  f("mes", "Mês", "inteiro", ["mes_disparo"]),
  f("ano", "Ano", "inteiro", ["ano_disparo"]),
  f("nr_bin", "Identificador BIN", "bin", ["bin", "nr_bin_cartao"]),
  f("ds_campanha", "Nome da campanha", "texto", ["campanha", "nome_campanha"]),
  f("ds_canal", "Canal", "texto", ["canal"]),
  f("ds_step", "Etapa da régua", "texto", ["step", "etapa", "etapa_regua"]),
  f("ds_cluster_campanha", "Categoria de campanha", "texto", ["cluster_campanha", "cluster", "categoria", "categoria_campanha"]),
  f("fl_regua", "Indicador de régua", "texto", ["regua", "flag_regua"]),
  f("qt_abordado", "Quantidade de abordagens", "inteiro", ["qtd_abordado", "qtd_abordagens", "qt_abordagens", "abordados"]),
  f("qt_adesao_abordado", "Adesões abordados", "inteiro", ["qtd_adesao_abordado", "qtd_adesoes_abordados", "adesao_abordado"]),
  f("vl_gasto_abordado", "Valor gasto abordados", "decimal", ["valor_gasto_abordado", "valor_gasto_abordados"]),
  f("tkm_abordado", "Ticket médio abordados", "decimal", ["ticket_abordado", "ticket_medio_informado_abordados", "ticket_medio_abordados"]),
  f("qt_controle", "Quantidade do controle", "inteiro", ["qtd_controle", "controle"]),
  f("qt_adesao_controle", "Adesões controle", "inteiro", ["qtd_adesao_controle", "qtd_adesoes_controle", "adesao_controle"]),
  f("vl_gasto_controle", "Valor gasto controle", "decimal", ["valor_gasto_controle"]),
  f("tkm_controle", "Ticket médio controle", "decimal", ["ticket_controle", "ticket_medio_informado_controle", "ticket_medio_controle"]),
  f("tx_conv_abordado", "Conversão abordados", "percentual", ["taxa_conv_abordado", "taxa_conversao_informada_abordados", "taxa_conversao_abordados", "conversao_abordado"]),
  f("tx_conv_controle", "Conversão controle", "percentual", ["taxa_conv_controle", "taxa_conversao_informada_controle", "taxa_conversao_controle", "conversao_controle"]),
  f("vl_vendas_incrementais", "Vendas incrementais", "decimal", ["vendas_incrementais", "vendas_incrementais_informadas", "vl_venda_incremental"]),
  f("ds_frase", "Mensagem da campanha", "texto", ["frase", "mensagem", "mensagem_campanha"]),
  f("ds_titulo_push", "Título do push", "texto", ["titulo_push", "titulo"]),
  // Colunas extras do "Modelo Padrao CredSystem 2026" (planilha consolidada das tres marcas).
  f("marca", "Marca (conferência)", "texto", ["bandeira", "nm_marca", "ds_marca"]),
  f("id_registro", "Identificador do registro", "texto", ["id_registro_origem"]),
  f("aba_origem", "Aba de origem", "texto", []),
  f("linha_origem", "Linha de origem", "inteiro", [])
];

export const CAMPOS_PROPOSTAS = [
  f("id_cod_proposta", "Identificador da proposta", "texto", ["id_proposta", "cod_proposta", "nr_proposta", "proposta_id", "numero_proposta"]),
  f("dt_proposta", "Data da proposta", "data", ["data_proposta", "dh_proposta"]),
  f("hr_proposta", "Hora da proposta", "texto", ["hora_proposta"]),
  f("nr_bin", "BIN", "bin", ["bin"]),
  f("marca", "Bandeira", "texto", ["bandeira", "nm_marca", "ds_marca"]),
  f("cd_loja_cs", "Código da loja", "texto", ["cd_loja", "cod_loja", "codigo_loja", "id_loja"]),
  f("nm_loja", "Nome da loja", "texto", ["loja", "nome_loja", "ds_loja"]),
  f("status", "Status da proposta", "texto", ["status_proposta", "situacao", "ds_status"]),
  f("proposta_aprov", "Flag aprovada (0/1)", "flag", ["fl_aprovada", "aprovada"]),
  f("proposta_rejei", "Flag rejeitada (0/1)", "flag", ["fl_rejeitada", "rejeitada"]),
  f("motivo", "Motivo da proposta", "texto", ["motivo_proposta", "ds_motivo"]),
  f("motivo_rejeicao", "Motivo da rejeição", "texto", ["ds_motivo_rejeicao", "motivo_recusa"]),
  f("dt_aprovacao", "Data de aprovação", "data", ["data_aprovacao"]),
  f("dt_emissao", "Data de emissão", "data", ["data_emissao"]),
  f("dt_ativacao", "Data de ativação", "data", ["data_ativacao"]),
  f("id_cod_cartao", "Identificador seguro do cartão", "texto", ["id_cartao", "id_cartao_tokenizado", "cod_cartao"]),
  f("cliente_pseudo_id", "Cliente pseudonimizado", "texto", ["id_cliente_pseudo", "id_cliente_pseudonimo", "cliente_hash", "hash_cliente"]),
  f("cpf_cliente", "CPF do cliente (será pseudonimizado)", "texto", ["cpf", "nr_cpf"], { sensivel: true }),
  f("cd_cliente", "Código do cliente", "texto", ["cod_cliente", "id_cliente"]),
  f("campanha", "Campanha", "texto", []),
  f("origem_prop", "Origem da proposta", "texto", ["origem", "origem_proposta"]),
  f("nivel_2", "Nível 2", "texto", [])
];

export const CAMPOS_EMISSOES = [
  f("id_cod_cartao", "Identificador seguro do cartão", "texto", ["id_cartao", "id_cartao_tokenizado", "cod_cartao"]),
  f("dt_emissao", "Data de emissão", "data", ["data_emissao"]),
  f("dt_ativacao", "Data de ativação", "data", ["data_ativacao"]),
  f("nr_bin", "BIN", "bin", ["bin"]),
  f("marca", "Bandeira", "texto", ["bandeira", "nm_marca"]),
  f("cd_loja_cs", "Código da loja", "texto", ["cd_loja", "cod_loja", "codigo_loja"]),
  f("nm_loja", "Nome da loja", "texto", ["loja", "loja_operacao", "nome_loja"]),
  f("cliente_pseudo_id", "Cliente pseudonimizado", "texto", ["id_cliente_pseudo", "id_cliente_pseudonimo", "cliente_hash"]),
  f("cpf_cliente", "CPF do cliente (será pseudonimizado)", "texto", ["cpf"], { sensivel: true }),
  f("canal", "Canal de emissão", "texto", []),
  f("sub_canal", "Subcanal", "texto", []),
  f("tipo_cartao", "Tipo de cartão", "texto", [])
];

export const CAMPOS_TRANSACOES = [
  f("id_transacao", "Identificador da compra", "texto", ["nsu", "cupom", "nr_cupom", "id_venda", "cod_transacao"]),
  f("dt_transacao", "Data da compra", "data", ["dt_compra", "data_compra", "data_venda", "dt_venda"]),
  f("hr_transacao", "Hora da compra", "texto", ["hora_compra"]),
  f("vl_transacao", "Valor da compra", "decimal", ["vl_compra", "valor_compra", "vl_venda", "valor"]),
  f("qt_itens", "Quantidade de itens", "inteiro", ["itens", "qtd_itens"]),
  f("nr_bin", "BIN", "bin", ["bin"]),
  f("marca", "Bandeira", "texto", ["bandeira"]),
  f("cd_loja", "Código da loja", "texto", ["cd_loja_cs", "cod_loja", "codigo_loja"]),
  f("nm_loja", "Nome da loja", "texto", ["loja", "nome_loja"]),
  f("cliente_pseudo_id", "Cliente pseudonimizado", "texto", ["id_cliente_pseudo", "id_cliente_pseudonimo", "cliente_hash", "id_cliente"]),
  f("cpf_cliente", "CPF do cliente (será pseudonimizado)", "texto", ["cpf"], { sensivel: true }),
  f("id_cod_cartao", "Identificador seguro do cartão", "texto", ["id_cartao", "id_cartao_tokenizado"]),
  f("forma_pagamento", "Forma de pagamento", "texto", ["pagamento"])
];

// requisitos: lista de grupos; cada grupo e satisfeito se QUALQUER campo dele estiver mapeado.
// assinatura: campos que, presentes, praticamente so existem neste tipo (pesam mais na deteccao).
export const TIPOS_ARQUIVO = {
  credsystem_crm_campanhas: {
    rotulo: "Tipo A · Campanhas CRM CredSystem",
    curto: "Campanhas CRM",
    campos: CAMPOS_CRM,
    requisitos: [["ds_campanha"], ["qt_abordado"], ["dh_disparo", "ano"]],
    assinatura: ["qt_abordado", "qt_adesao_abordado", "qt_controle", "tx_conv_abordado", "tkm_abordado", "vl_vendas_incrementais", "ds_step"],
    rpc: "rpc_credsystem_crm_importar",
    destino: "Desempenho de Campanhas CRM"
  },
  credsystem_propostas: {
    rotulo: "Tipo B · Operação de Cartões (propostas)",
    curto: "Propostas",
    campos: CAMPOS_PROPOSTAS,
    requisitos: [["id_cod_proposta"], ["dt_proposta"], ["status", "proposta_aprov", "proposta_rejei"]],
    assinatura: ["id_cod_proposta", "dt_proposta", "proposta_aprov", "proposta_rejei", "motivo"],
    rpc: "rpc_credsystem_propostas_importar",
    destino: "Funil de Cartões"
  },
  credsystem_emissoes: {
    rotulo: "Tipo B · Operação de Cartões (emissões/ativações)",
    curto: "Emissões",
    campos: CAMPOS_EMISSOES,
    requisitos: [["dt_emissao"], ["id_cod_cartao", "cpf_cliente", "cliente_pseudo_id"]],
    assinatura: ["dt_emissao", "dt_ativacao", "id_cod_cartao", "tipo_cartao", "sub_canal"],
    rpc: "rpc_credsystem_emissoes_importar",
    destino: "Funil de Cartões"
  },
  credsystem_transacoes: {
    rotulo: "Tipo C · Compras e comportamento transacional",
    curto: "Transações",
    campos: CAMPOS_TRANSACOES,
    requisitos: [["dt_transacao"], ["vl_transacao"], ["id_transacao", "cpf_cliente", "cliente_pseudo_id"]],
    assinatura: ["dt_transacao", "vl_transacao", "id_transacao", "qt_itens", "forma_pagamento"],
    rpc: "rpc_credsystem_transacoes_importar",
    destino: "Retenção e Comportamento"
  }
};

export const LIMITES = {
  tamanhoArquivoBytes: 25 * 1024 * 1024,
  linhasPorArquivo: 300000,
  colunasPorAba: 200,
  linhasPorChamada: 500,
  linhasBuscaCabecalho: 20
};

export const EXTENSOES_ACEITAS = [".xlsx", ".xls", ".csv"];
