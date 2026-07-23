export type Marca =
  | 'Tesoura de Ouro'
  | 'Magazine da Economia'
  | 'Free Center Calçados';

export type CargoUsuario = 'Admin' | 'Gestor' | 'Coordenador' | 'Analista';

export type PeriodoFiltro = '7d' | '30d' | '1y' | 'all';

export type Perfil = {
  id: string;
  email: string;
  nome: string | null;
  cargo: CargoUsuario;
  marca_vinculada: Marca | null;
  ativo: boolean;
  criado_em: string;
  atualizado_em: string;
};

export type DadosCartoesCredsystem = {
  id: string;
  marca: Marca;
  data_emissao: string;
  data_ativacao: string | null;
  loja_operacao: string;
  nome_cliente: string | null;
  telefone: string | null;
  valor_compra_inicial: number | null;
  frequencia_recorrencia: number;
  origem_arquivo: string | null;
  lote_importacao: string | null;
  importado_por: string | null;
  criado_em: string;
  atualizado_em: string;
};

export type CredsystemInsert = Omit<
  DadosCartoesCredsystem,
  'id' | 'importado_por' | 'criado_em' | 'atualizado_em'
> & {
  id?: string;
};

export type StageRdStationMarketing = {
  id: string;
  marca: Marca;
  id_campanha: string;
  nome_campanha: string;
  enviados: number;
  entregues: number;
  taxa_abertura: number | null;
  taxa_clique: number | null;
  descadastros: number;
  assunto_email: string | null;
  preheader: string | null;
  corpo_copy: string | null;
  analise_copy_ia: Record<string, unknown>;
  payload_bruto: Record<string, unknown>;
  data_referencia: string;
  origem_api: string;
  lote_importacao: string | null;
  importado_por: string | null;
  criado_em: string;
  atualizado_em: string;
};

export type StageMetaBusinessAnalytics = {
  id: string;
  marca: Marca;
  data_referencia: string;
  seguidores_instagram: number;
  alcance_facebook: number;
  engajamento_total: number;
  post_destaque_semana_url: string | null;
  payload_bruto: Record<string, unknown>;
  origem_api: string;
  lote_importacao: string | null;
  importado_por: string | null;
  criado_em: string;
  atualizado_em: string;
};

export type StageGoogleBusinessProfile = {
  id: string;
  marca: Marca;
  id_loja_gmb: string;
  nome_loja: string | null;
  rating_medio: number | null;
  status_resposta: string | null;
  horario_funcionamento: Record<string, unknown>;
  payload_bruto: Record<string, unknown>;
  data_referencia: string;
  origem_api: string;
  lote_importacao: string | null;
  importado_por: string | null;
  criado_em: string;
  atualizado_em: string;
};

export type StageCredsystemPropostas = {
  id: string;
  marca: Marca;
  dt_proposta: string;
  hr_proposta: string | null;
  cd_loja_cs: string | null;
  nm_loja: string | null;
  id_cod_proposta: string;
  cpf_cliente: string | null;
  cd_cliente: string | null;
  id_cod_cartao: string | null;
  campanha: string | null;
  origem_prop: string | null;
  proposta_aprov: number;
  proposta_rejei: number;
  motivo: string | null;
  cpf_promotor: string | null;
  login_operador: string | null;
  tel_celular: string | null;
  cpf_operador: string | null;
  nivel_2: string | null;
  payload_bruto: Record<string, unknown>;
  origem_arquivo: string | null;
  lote_importacao: string | null;
  importado_por: string | null;
  criado_em: string;
  atualizado_em: string;
};

export type StageSource =
  | 'credsystem_emissoes'
  | 'credsystem_propostas'
  | 'rd_station'
  | 'meta_business'
  | 'google_business_profile';

export type DashboardSummary = {
  totalCartoes: number;
  cartoesAtivos: number;
  novosCartoes: number;
  ticketMedio: number;
  recorrenciaMedia: number;
  totalPropostas: number;
  propostasAprovadas: number;
  propostasRejeitadas: number;
  taxaAprovacao: number;
  totalCampanhas: number;
  taxaAberturaMedia: number;
  taxaCliqueMedia: number;
  alcanceFacebook: number;
  engajamentoTotal: number;
};

export type BrandMetric = {
  marca: Marca;
  totalCartoes: number;
  ativados: number;
  ticketMedio: number;
  recorrenciaMedia: number;
};

export type MotivoPropostaMetric = {
  motivo: string;
  total: number;
  participacao: number;
};

export type CredsystemResumoGeral = {
  marca: Marca;
  total_cartoes: number;
  cartoes_ativados: number;
  ticket_medio: number;
  recorrencia_media: number;
  total_propostas: number;
  propostas_aprovadas: number;
  propostas_rejeitadas: number;
  taxa_aprovacao: number;
};

export type CredsystemPorLoja = {
  marca: Marca;
  loja: string;
  total_cartoes: number;
  cartoes_ativados: number;
  total_propostas: number;
  propostas_aprovadas: number;
  propostas_rejeitadas: number;
  taxa_aprovacao: number;
};

export type CredsystemMotivoRejeicao = {
  marca: Marca;
  motivo: string;
  total: number;
  propostas_aprovadas: number;
  propostas_rejeitadas: number;
  participacao: number;
};

export type CredsystemFunil = {
  marca: Marca;
  total_propostas: number;
  propostas_aprovadas: number;
  propostas_rejeitadas: number;
  cartoes_emitidos: number;
  cartoes_ativados: number;
  taxa_aprovacao: number;
  taxa_emissao_sobre_propostas: number;
  taxa_ativacao: number;
};

export type CredsystemBI = {
  resumo: CredsystemResumoGeral[];
  porMarca: CredsystemResumoGeral[];
  lojas: CredsystemPorLoja[];
  motivos: CredsystemMotivoRejeicao[];
  funil: CredsystemFunil[];
};

export type ImportPreview = {
  fileName: string;
  source: StageSource;
  marca: Marca;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  columns: string[];
  sample: Record<string, string>[];
  errors: string[];
};
