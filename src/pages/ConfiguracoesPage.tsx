import { useState } from 'react';
import { useUsuariosAdmin } from '../hooks/useUsuariosAdmin';
import { CARGO_BADGE_CLASS, EditAccessModal, InviteModal, formatDateTime, initials } from './UsuariosPage';
import type { UsuarioAdmin } from '../types/gto';

type BandeiraStatus = 'LIVE' | 'MANUTENÇÃO';

type Bandeira = {
  nome: string;
  lojas: number;
  status: BandeiraStatus;
};

const BANDEIRAS: Bandeira[] = [
  { nome: 'Tesoura de Ouro', lojas: 32, status: 'LIVE' },
  { nome: 'Free Center', lojas: 18, status: 'LIVE' },
  { nome: 'Magazine da Economia', lojas: 12, status: 'MANUTENÇÃO' }
];

type ConexaoStatus = 'CONECTADO' | 'ERRO';

type Conexao = {
  nome: string;
  icon: string;
  status: ConexaoStatus;
  detalhe: string;
};

const CONEXOES: Conexao[] = [
  { nome: 'CredSystem', icon: 'credit_card', status: 'CONECTADO', detalhe: 'Sincronizado há 2 horas' },
  { nome: 'RD Station', icon: 'campaign', status: 'CONECTADO', detalhe: 'Sincronizado há 4 horas' },
  { nome: 'Meta Ads', icon: 'share', status: 'CONECTADO', detalhe: 'Sincronizado há 1 hora' },
  { nome: 'Google Ads', icon: 'ads_click', status: 'ERRO', detalhe: 'Token expirado desde ontem' }
];

function BandeiraCard({ bandeira }: { bandeira: Bandeira }) {
  const isLive = bandeira.status === 'LIVE';
  return (
    <article className="card bandeira-card">
      <div className="bandeira-card-top">
        <div>
          <strong>{bandeira.nome}</strong>
          <span>{bandeira.lojas} lojas</span>
        </div>
        <span className={`badge ${isLive ? 'badge-ativo' : 'badge-manutencao'}`}>{bandeira.status}</span>
      </div>
    </article>
  );
}

function ConexaoCard({ conexao, onReconectar }: { conexao: Conexao; onReconectar: (nome: string) => void }) {
  const conectado = conexao.status === 'CONECTADO';
  return (
    <article className="card conexao-card">
      <div className="conexao-card-top">
        <span className="conexao-icon material-symbols-outlined" aria-hidden="true">
          {conexao.icon}
        </span>
        <span className={`badge ${conectado ? 'badge-ativo' : 'badge-inativo'}`}>{conexao.status}</span>
      </div>
      <strong>{conexao.nome}</strong>
      <small>{conexao.detalhe}</small>
      {!conectado ? (
        <button type="button" className="secondary-button conexao-reconectar" onClick={() => onReconectar(conexao.nome)}>
          <span className="material-symbols-outlined" aria-hidden="true">
            sync_problem
          </span>
          RECONECTAR AGORA
        </button>
      ) : null}
    </article>
  );
}

function UsuariosTable(props: {
  usuarios: UsuarioAdmin[];
  loading: boolean;
  pendingActionId: string | null;
  onEditar: (usuario: UsuarioAdmin) => void;
  onExcluir: (usuario: UsuarioAdmin) => void;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Nome / E-mail</th>
            <th>Cargo</th>
            <th>Último acesso</th>
            <th>Status</th>
            <th>Ações</th>
          </tr>
        </thead>
        <tbody>
          {props.loading ? (
            <tr>
              <td colSpan={5}>Carregando usuários...</td>
            </tr>
          ) : props.usuarios.length === 0 ? (
            <tr>
              <td colSpan={5}>Nenhum usuário cadastrado ainda.</td>
            </tr>
          ) : (
            props.usuarios.map((usuario) => (
              <tr key={usuario.id}>
                <td>
                  <div className="usuario-cell">
                    <span className="presence-avatar">{initials(usuario.nome ?? usuario.email)}</span>
                    <div>
                      <strong>{usuario.nome ?? 'Sem nome'}</strong>
                      <span className="usuario-email">{usuario.email}</span>
                    </div>
                  </div>
                </td>
                <td>
                  <span className={`badge ${CARGO_BADGE_CLASS[usuario.cargo]}`}>{usuario.cargo}</span>
                </td>
                <td>{formatDateTime(usuario.last_sign_in_at)}</td>
                <td>
                  <span className={`badge ${usuario.ativo ? 'badge-ativo' : 'badge-inativo'}`}>
                    {usuario.ativo ? 'Ativo' : 'Inativo'}
                  </span>
                </td>
                <td>
                  <div className="row-actions">
                    <button
                      type="button"
                      className="icon-button"
                      title="Editar cargo e marcas"
                      onClick={() => props.onEditar(usuario)}
                    >
                      <span className="material-symbols-outlined">edit</span>
                    </button>
                    <button
                      type="button"
                      className="icon-button icon-button-danger"
                      title={usuario.ativo ? 'Excluir (desativar) usuário' : 'Usuário já está inativo'}
                      disabled={props.pendingActionId === `status-${usuario.id}` || !usuario.ativo}
                      onClick={() => props.onExcluir(usuario)}
                    >
                      <span className="material-symbols-outlined">delete</span>
                    </button>
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export default function ConfiguracoesPage() {
  const admin = useUsuariosAdmin();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editingUsuario, setEditingUsuario] = useState<UsuarioAdmin | null>(null);
  const [modoEscuro, setModoEscuro] = useState(false);
  const [notifRelatorios, setNotifRelatorios] = useState(true);
  const [notifDiscrepancia, setNotifDiscrepancia] = useState(true);

  function handleExcluir(usuario: UsuarioAdmin) {
    const confirmado = window.confirm(`Excluir o acesso de ${usuario.nome ?? usuario.email}? O usuário será desativado.`);
    if (confirmado) admin.alternarStatus(usuario);
  }

  function handleReconectar(nome: string) {
    window.alert(`Reautenticação de ${nome} ainda não está disponível nesta build. Use a tela de Conexões.`);
  }

  return (
    <section className="content-stack">
      <div className="page-header">
        <div>
          <p className="eyebrow">Admin</p>
          <h2>Configurações do Sistema</h2>
          <p>Gerencie permissões, marcas, fontes de dados e preferências da plataforma.</p>
        </div>
      </div>

      {admin.loadError ? <div className="alert error">{admin.loadError}</div> : null}
      {admin.actionError ? <div className="alert error">{admin.actionError}</div> : null}
      {admin.actionSuccess ? <div className="alert success">{admin.actionSuccess}</div> : null}

      <article className="card">
        <div className="section-title">
          <div>
            <h3>Gerenciar usuários</h3>
            <p>Convites, cargos e status de acesso à plataforma.</p>
          </div>
          <button type="button" onClick={() => setInviteOpen(true)}>
            <span className="material-symbols-outlined" aria-hidden="true">
              add
            </span>
            NOVO USUÁRIO
          </button>
        </div>
        <UsuariosTable
          usuarios={admin.usuarios}
          loading={admin.loading}
          pendingActionId={admin.pendingActionId}
          onEditar={setEditingUsuario}
          onExcluir={handleExcluir}
        />
      </article>

      <div className="settings-row">
        <article className="card">
          <div className="section-title">
            <div>
              <h3>Gerenciar bandeiras</h3>
              <p>Marcas ativas na plataforma e status operacional.</p>
            </div>
          </div>
          <div className="bandeira-grid">
            {BANDEIRAS.map((bandeira) => (
              <BandeiraCard bandeira={bandeira} key={bandeira.nome} />
            ))}
          </div>
        </article>

        <article className="card">
          <div className="section-title">
            <div>
              <h3>Preferências do sistema</h3>
              <p>Exibição e alertas por e-mail.</p>
            </div>
          </div>

          <div className="preferencias-stack">
            <div className="preferencia-item">
              <div>
                <strong>Modo de exibição</strong>
                <span>Escolha entre tema claro ou escuro.</span>
              </div>
              <div className="theme-toggle" role="group" aria-label="Modo de exibição">
                <button
                  type="button"
                  className={!modoEscuro ? 'active' : ''}
                  onClick={() => setModoEscuro(false)}
                >
                  <span className="material-symbols-outlined" aria-hidden="true">
                    light_mode
                  </span>
                  Claro
                </button>
                <button type="button" className={modoEscuro ? 'active' : ''} onClick={() => setModoEscuro(true)}>
                  <span className="material-symbols-outlined" aria-hidden="true">
                    dark_mode
                  </span>
                  Escuro
                </button>
              </div>
            </div>

            <div className="preferencia-item">
              <div>
                <strong>Relatórios semanais</strong>
                <span>Resumo de performance por e-mail.</span>
              </div>
              <label className="switch" title="Notificações de relatórios semanais">
                <input
                  type="checkbox"
                  checked={notifRelatorios}
                  onChange={(event) => setNotifRelatorios(event.target.checked)}
                />
                <span className="switch-track" aria-hidden="true" />
              </label>
            </div>

            <div className="preferencia-item">
              <div>
                <strong>Alertas de discrepância</strong>
                <span>Avisos quando os dados divergirem do esperado.</span>
              </div>
              <label className="switch" title="Notificações de alertas de discrepância">
                <input
                  type="checkbox"
                  checked={notifDiscrepancia}
                  onChange={(event) => setNotifDiscrepancia(event.target.checked)}
                />
                <span className="switch-track" aria-hidden="true" />
              </label>
            </div>
          </div>
        </article>
      </div>

      <article className="card">
        <div className="section-title">
          <div>
            <h3>Fontes de dados integradas</h3>
            <p>Status das conexões de API que alimentam o GTO Insights.</p>
          </div>
        </div>
        <div className="conexoes-grid">
          {CONEXOES.map((conexao) => (
            <ConexaoCard conexao={conexao} onReconectar={handleReconectar} key={conexao.nome} />
          ))}
        </div>
      </article>

      <footer className="settings-footer">
        <span>GTO INSIGHTS © 2023 | Versão 2.4.0-build.82</span>
        <div className="settings-footer-links">
          <button type="button" title="Em breve">
            Termos de Uso
          </button>
          <button type="button" title="Em breve">
            Política de Privacidade
          </button>
          <button type="button" title="Em breve">
            Logs de Auditoria
          </button>
        </div>
      </footer>

      {inviteOpen ? (
        <InviteModal onClose={() => setInviteOpen(false)} onSubmit={admin.convidar} pending={admin.pendingActionId === 'convite'} />
      ) : null}

      {editingUsuario ? (
        <EditAccessModal
          usuario={editingUsuario}
          onClose={() => setEditingUsuario(null)}
          pending={admin.pendingActionId === `cargo-${editingUsuario.id}`}
          onSubmit={(cargo, marcas) => admin.alterarCargoMarcas(editingUsuario, cargo, marcas)}
        />
      ) : null}
    </section>
  );
}
