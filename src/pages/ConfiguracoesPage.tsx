import { useMemo, useState } from 'react';
import { useBandeiras } from '../hooks/useBandeiras';
import { useOnlineUsers } from '../hooks/usePresence';
import { useUsuariosAdmin } from '../hooks/useUsuariosAdmin';
import { CARGO_BADGE_CLASS, EditAccessModal, InviteModal, MARCA_CHIP_CLASS, formatDateTime, initials } from './UsuariosPage';
import type { BandeiraResumo } from '../services/bandeirasService';
import type { UsuarioAdmin } from '../types/gto';

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

function BandeiraCard({ bandeira }: { bandeira: BandeiraResumo }) {
  const isLive = bandeira.status === 'LIVE';
  return (
    <article className="card bandeira-card">
      <div className="bandeira-card-top">
        <div>
          <strong>{bandeira.nomeExibicao}</strong>
          <span>
            {bandeira.lojas} loja{bandeira.lojas === 1 ? '' : 's'}
          </span>
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
  onlineIds: Set<string>;
  pendingActionId: string | null;
  onEditar: (usuario: UsuarioAdmin) => void;
  onAlternarStatus: (usuario: UsuarioAdmin) => void;
  onRedefinirSenha: (usuario: UsuarioAdmin) => void;
  onResetarMfa: (usuario: UsuarioAdmin) => void;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Usuário</th>
            <th>Cargo</th>
            <th>Marcas permitidas</th>
            <th>Status</th>
            <th>Último acesso</th>
            <th>Ações</th>
          </tr>
        </thead>
        <tbody>
          {props.loading ? (
            <tr>
              <td colSpan={6}>Carregando usuários...</td>
            </tr>
          ) : props.usuarios.length === 0 ? (
            <tr>
              <td colSpan={6}>Nenhum usuário cadastrado ainda.</td>
            </tr>
          ) : (
            props.usuarios.map((usuario) => {
              const isOnline = props.onlineIds.has(usuario.id);
              const busyPrefix = props.pendingActionId;
              return (
                <tr key={usuario.id}>
                  <td>
                    <div className="usuario-cell">
                      <span className={`presence-avatar ${isOnline ? 'is-online' : ''}`}>{initials(usuario.nome ?? usuario.email)}</span>
                      <div>
                        <strong>{usuario.nome ?? 'Sem nome'}</strong>
                        <span className="usuario-email">{usuario.email}</span>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className={`badge ${CARGO_BADGE_CLASS[usuario.cargo]}`}>{usuario.cargo}</span>
                  </td>
                  <td>
                    <div className="chip-row">
                      {usuario.marcas.length === 0 ? (
                        <span className="empty">Todas as marcas</span>
                      ) : (
                        usuario.marcas.map((marca) => (
                          <span className={`chip ${MARCA_CHIP_CLASS[marca]}`} key={marca}>
                            {marca}
                          </span>
                        ))
                      )}
                    </div>
                  </td>
                  <td>
                    <span className={`badge ${usuario.ativo ? 'badge-ativo' : 'badge-inativo'}`}>
                      {usuario.ativo ? 'Ativo' : 'Bloqueado'}
                    </span>
                  </td>
                  <td>{formatDateTime(usuario.last_sign_in_at)}</td>
                  <td>
                    <div className="row-actions">
                      <button
                        type="button"
                        className="icon-button"
                        title="Alterar cargo e marcas"
                        onClick={() => props.onEditar(usuario)}
                      >
                        <span className="material-symbols-outlined">edit</span>
                      </button>
                      <label className="switch" title={usuario.ativo ? 'Bloquear usuário' : 'Ativar usuário'}>
                        <input
                          type="checkbox"
                          checked={usuario.ativo}
                          disabled={busyPrefix === `status-${usuario.id}`}
                          onChange={() => props.onAlternarStatus(usuario)}
                        />
                        <span className="switch-track" aria-hidden="true" />
                      </label>
                      <button
                        type="button"
                        className="icon-button"
                        title="Enviar e-mail de redefinição de senha"
                        disabled={busyPrefix === `senha-${usuario.id}`}
                        onClick={() => props.onRedefinirSenha(usuario)}
                      >
                        <span className="material-symbols-outlined">mail_lock</span>
                      </button>
                      <button
                        type="button"
                        className="icon-button"
                        title="Resetar MFA (2FA)"
                        disabled={busyPrefix === `mfa-${usuario.id}` || !usuario.mfa_enrolled}
                        onClick={() => props.onResetarMfa(usuario)}
                      >
                        <span className="material-symbols-outlined">phonelink_lock</span>
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

export default function ConfiguracoesPage() {
  const admin = useUsuariosAdmin();
  const bandeirasQuery = useBandeiras();
  const online = useOnlineUsers();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editingUsuario, setEditingUsuario] = useState<UsuarioAdmin | null>(null);
  const [modoEscuro, setModoEscuro] = useState(false);
  const [notifRelatorios, setNotifRelatorios] = useState(true);
  const [notifDiscrepancia, setNotifDiscrepancia] = useState(true);

  const onlineIds = useMemo(() => new Set(online.map((item) => item.userId)), [online]);

  const ultimoAcessoGeral = useMemo(() => {
    const timestamps = admin.usuarios.map((item) => item.last_sign_in_at).filter((value): value is string => Boolean(value));
    if (timestamps.length === 0) return null;
    return timestamps.reduce((latest, current) => (current > latest ? current : latest));
  }, [admin.usuarios]);

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

      {admin.actionError ? <div className="alert error">{admin.actionError}</div> : null}
      {admin.actionSuccess ? <div className="alert success">{admin.actionSuccess}</div> : null}

      <article className="card">
        <div className="section-title">
          <div>
            <h3>Gerenciar usuários</h3>
            <p>Convites, cargos, marcas permitidas e presença em tempo real de quem acessa o GTO Insights.</p>
          </div>
          <div className="filters">
            <button type="button" className="secondary-button" onClick={() => admin.reload()}>
              <span className="material-symbols-outlined" aria-hidden="true">
                refresh
              </span>
              Atualizar
            </button>
            <button type="button" onClick={() => setInviteOpen(true)}>
              <span className="material-symbols-outlined" aria-hidden="true">
                add
              </span>
              NOVO USUÁRIO
            </button>
          </div>
        </div>

        {admin.loadError ? (
          <div className="alert error">
            Não foi possível carregar a lista de usuários agora. {admin.loadError}
            <div className="button-row" style={{ marginTop: 10 }}>
              <button type="button" className="secondary-button" onClick={() => admin.reload()}>
                Tentar novamente
              </button>
            </div>
          </div>
        ) : (
          <>
            {admin.usuariosFallback ? (
              <div className="alert" style={{ marginBottom: 16 }}>
                Alguns dados (último acesso, verificação de MFA) estão indisponíveis no momento - mostrando os dados
                básicos do cadastro.
              </div>
            ) : null}
            <div className="usuarios-status-grid" style={{ marginBottom: 20 }}>
              <article className="card status-card status-card-online">
                <div className="kpi-top">
                  <span>Usuários online agora</span>
                  <span className="presence-dot" aria-hidden="true" />
                </div>
                <strong>{online.length}</strong>
                {online.length === 0 ? (
                  <small>Ninguém conectado neste momento.</small>
                ) : (
                  <div className="avatar-stack" title={online.map((item) => item.nome).join(', ')}>
                    {online.slice(0, 6).map((item) => (
                      <span className="avatar-chip" key={item.userId}>
                        {initials(item.nome)}
                      </span>
                    ))}
                    {online.length > 6 ? <span className="avatar-chip avatar-chip-more">+{online.length - 6}</span> : null}
                  </div>
                )}
              </article>

              <article className="card status-card">
                <div className="kpi-top">
                  <span>Total de cadastrados</span>
                  <span className="material-symbols-outlined">group</span>
                </div>
                <strong>{admin.usuarios.length}</strong>
                <small>{admin.usuarios.filter((item) => item.ativo).length} ativos</small>
              </article>

              <article className="card status-card">
                <div className="kpi-top">
                  <span>Último acesso registrado</span>
                  <span className="material-symbols-outlined">history</span>
                </div>
                <strong className="status-card-datetime">{formatDateTime(ultimoAcessoGeral)}</strong>
                <small>Considerando todos os perfis cadastrados</small>
              </article>
            </div>

            <UsuariosTable
              usuarios={admin.usuarios}
              loading={admin.loading}
              onlineIds={onlineIds}
              pendingActionId={admin.pendingActionId}
              onEditar={setEditingUsuario}
              onAlternarStatus={admin.alternarStatus}
              onRedefinirSenha={admin.enviarRedefinicaoSenha}
              onResetarMfa={admin.resetarMfa}
            />
          </>
        )}
      </article>

      <div className="settings-row">
        <article className="card">
          <div className="section-title">
            <div>
              <h3>Gerenciar bandeiras</h3>
              <p>Marcas ativas na plataforma e status operacional.</p>
            </div>
          </div>
          {bandeirasQuery.error ? (
            <div className="alert error">
              Não foi possível carregar as bandeiras agora. {bandeirasQuery.error}
              <div className="button-row" style={{ marginTop: 10 }}>
                <button type="button" className="secondary-button" onClick={() => bandeirasQuery.reload()}>
                  Tentar novamente
                </button>
              </div>
            </div>
          ) : (
            <div className="bandeira-grid">
              {bandeirasQuery.loading ? (
                <p className="empty">Carregando bandeiras...</p>
              ) : (
                bandeirasQuery.bandeiras.map((bandeira) => <BandeiraCard bandeira={bandeira} key={bandeira.marca} />)
              )}
            </div>
          )}
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
