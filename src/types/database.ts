import type {
  DadosCartoesCredsystem,
  Perfil,
  StageGoogleBusinessProfile,
  StageCredsystemPropostas,
  StageMetaBusinessAnalytics,
  StageRdStationMarketing,
  CredsystemFunil,
  CredsystemMotivoRejeicao,
  CredsystemPorLoja,
  CredsystemResumoGeral
} from './gto';

export type Database = {
  public: {
    Tables: {
      perfis: {
        Row: Perfil;
        Insert: Partial<Perfil> & Pick<Perfil, 'id' | 'email'>;
        Update: Partial<Perfil>;
      };
      dados_cartoes_credsystem: {
        Row: DadosCartoesCredsystem;
        Insert: Partial<DadosCartoesCredsystem> &
          Pick<DadosCartoesCredsystem, 'marca' | 'data_emissao' | 'loja_operacao'>;
        Update: Partial<DadosCartoesCredsystem>;
      };
      stage_rd_station_marketing: {
        Row: StageRdStationMarketing;
        Insert: Partial<StageRdStationMarketing> &
          Pick<StageRdStationMarketing, 'marca' | 'id_campanha' | 'nome_campanha'>;
        Update: Partial<StageRdStationMarketing>;
      };
      stage_credsystem_propostas: {
        Row: StageCredsystemPropostas;
        Insert: Partial<StageCredsystemPropostas> &
          Pick<StageCredsystemPropostas, 'marca' | 'dt_proposta' | 'id_cod_proposta'>;
        Update: Partial<StageCredsystemPropostas>;
      };
      stage_meta_business_analytics: {
        Row: StageMetaBusinessAnalytics;
        Insert: Partial<StageMetaBusinessAnalytics> &
          Pick<StageMetaBusinessAnalytics, 'marca'>;
        Update: Partial<StageMetaBusinessAnalytics>;
      };
      stage_google_business_profile: {
        Row: StageGoogleBusinessProfile;
        Insert: Partial<StageGoogleBusinessProfile> &
          Pick<StageGoogleBusinessProfile, 'marca' | 'id_loja_gmb'>;
        Update: Partial<StageGoogleBusinessProfile>;
      };
    };
    Views: {
      vw_credsystem_resumo_geral: {
        Row: CredsystemResumoGeral;
      };
      vw_credsystem_por_marca: {
        Row: CredsystemResumoGeral;
      };
      vw_credsystem_por_loja: {
        Row: CredsystemPorLoja;
      };
      vw_credsystem_motivos_rejeicao: {
        Row: CredsystemMotivoRejeicao;
      };
      vw_credsystem_funil_propostas_emissoes: {
        Row: CredsystemFunil;
      };
    };
    Functions: Record<string, never>;
    Enums: {
      cargo_usuario: 'Admin' | 'Gestor' | 'Coordenador' | 'Analista';
      bandeira_marca: 'Tesoura de Ouro' | 'Magazine da Economia' | 'Free Center Calçados';
    };
  };
};
