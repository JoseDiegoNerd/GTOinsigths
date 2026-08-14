import { FormEvent, ReactNode, useEffect, useMemo, useState } from 'react';
import { useOnlineUsers } from '../hooks/usePresence';
import { useUsuariosAdmin } from '../hooks/useUsuariosAdmin';
import { conviteUsuarioSchema, formatZodError } from '../lib/validation';
import type { CargoUsuario, ConviteUsuarioInput, Marca, UsuarioAdmin } from '../types/gto';

const CARGOS: CargoUsuario[] = ['Admin', 'Gestor', 'Coordenador', 'Analista'];
const MARCAS: Marca[] = ['Tesoura de Ouro', 'Magazine da Economia', 'Free Center Calçados'];
const CARGOS_COM_MARCA_OBRIGATORIA: CargoUsuario[] = ['Coordenador', 'Analista'];

const MARCA_CHIP_CLASS: Record<Marca, string> = {
  'Tesoura de Ouro': 'chip-ouro',
  'Magazine da Economia': 'chip-economia',
  'Free Center Calçados': 'chip-calcados'
};

const CARGO_BADGE_CLASS: Record<CargoUsuario, string> = {
  Admin: 'badge-cargo-admin',
  Gestor: 'badge-cargo-gestor',
  Coordenador: 'badge-cargo-coordenador',
  Analista: 'badge-cargo-analista'
};

function formatDateTime(value: string | null): string {
  if (!value) return 'Nunca acessou';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value));
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function MarcasChecklist(props: { value: Marca[]; onChange: (marcas: Marca[]) => void; disabled?: boolean }) {
  function toggle(marca: Marca) {
    if (props.value.includes(marca)) {
      props.onChange(props.value.filter((item) => item !== marca));
    } else {
      props.onChange([...props.value, marca]);
    }
  }

  return (
    <div className="marca-checklist" role="group" aria-label="Marcas permitidas">
      {MARCAS.map((marca) => (
        <label key={marca} className={`marca-check ${props.value.includes(marca) ? 'checked' : ''}`}>
          <input
            type="checkbox"
            checked={props.value.includes(marca)}
            disabled={props.disabled}
            onChange={() => toggle(marca)}
          />
          {marca}
        </label>
      ))}
    </div>
  );
}

function Modal(props: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') props.onClose();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [props.onClose]);

  return (
    <div className="modal-overlay" onMouseDown={(event) => event.target === event.currentTarget && props.onClose()}>
      <div className="modal-panel" role="dialog" aria-modal="true" aria-label={props.title}>
        <div className="modal-header">
          <h3>{props.title}</h3>
          <button type="button" className="icon-button" onClick={props.onClose} aria-label="Fechar">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        {props.children}
      </div>
    </div>
  );
}

function InviteModal(props: {
  onClose: () => void;
  onSubmit: (input: ConviteUsuarioInput) => Promise<boolean>;
  pending: boolean;
}) {
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [cargo, setCargo] = useState<CargoUsuario>('Analista');
  const [marcas, setMarcas] = useState<Marca[]>([]);
  const [validationError, setValidationError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setValidationError(null);

    const parsed = conviteUsuarioSchema.safeParse({ nome, email, cargo, marcas });
    if (!parsed.success) {
      setValidationError(formatZodError(parsed.error));
      return;
    }

    const ok = await props.onSubmit(parsed.data);
    if (ok) props.onClose();
  }

  return (
    <Modal title="Convidar usuário" onClose={props.onClose}>
      <form onSubmit={handleSubmit} className="modal-form">
        <label>
          Nome completo
          <input value={nome} onChange={(event) => setNome(event.target.value)} maxLength={120} required />
        </label>
        <label>
          E-mail corporativo
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            maxLength={254}
            autoComplete="off"
            required
          />
        </label>
        <label>
          Cargo
          <select value={cargo} onChange={(event) => setCargo(event.target.value as CargoUsuario)}>
            {CARGOS.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
        <label>
          Marcas permitidas
          {CARGOS_COM_MARCA_OBRIGATORIA.includes(cargo) ? null : (
            <span className="hint-inline">Opcional para {cargo}: já enxerga todas as marcas.</span>
          )}
        </label>
        <MarcasChecklist value={marcas} onChange={setMarcas} />

        {validationError ? <div className="alert error">{validationError}</div> : null}

        <div className="modal-footer">
          <button type="button" className="secondary-button" onClick={props.onClose}>
            Cancelar
          </button>
          <button type="submit" disabled={props.pending}>
            {props.pending ? 'Enviando convite...' : 'Enviar convite'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function EditAccessModal(props: {
  usuario: UsuarioAdmin;
  onClose: () => void;
  onSubmit: (cargo: CargoUsuario, marcas: Marca[]) => Promise<boolean>;
  pending: boolean;
}) {
  const [cargo, setCargo] = useState<CargoUsuario>(props.usuario.cargo);
  const [marcas, setMarcas] = useState<Marca[]>(props.usuario.marcas);
  const [validationError, setValidationError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setValidationError(null);

    if (CARGOS_COM_MARCA_OBRIGATORIA.includes(cargo) && marcas.length === 0) {
      setValidationError('Selecione ao menos uma marca permitida para este cargo.');
      return;
    }

    const ok = await props.onSubmit(cargo, marcas);
    if (ok) props.onClose();
  }

  return (
    <Modal title={`Editar acesso · ${props.usuario.nome ?? props.usuario.email}`} onClose={props.onClose}>
      <form onSubmit={handleSubmit} className="modal-form">
        <label>
          Cargo
          <select value={cargo} onChange={(event) => setCargo(event.target.value as CargoUsuario)}>
            {CARGOS.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
        <label>
          Marcas permitidas
          {CARGOS_COM_MARCA_OBRIGATORIA.includes(cargo) ? null : (
            <span className="hint-inline">Opcional para {cargo}: já enxerga todas as marcas.</span>
          )}
        </label>
        <MarcasChecklist value={marcas} onChange={setMarcas} />

        {validationError ? <div className="alert error">{validationError}</div> : null}

        <div className="modal-footer">
          <button type="button" className="secondary-button" onClick={props.onClose}>
            Cancelar
          </button>
          <button type="submit" disabled={props.pending}>
            {props.pending ? 'Salvando...' : 'Salvar alterações'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default function UsuariosPage() {
  const admin = useUsuariosAdmin();
  const online = useOnlineUsers();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editingUsuario, setEditingUsuario] = useState<UsuarioAdmin | null>(null);

  const onlineIds = useMemo(() => new Set(online.map((item) => item.userId)), [online]);

  const ultimoAcessoGeral = useMemo(() => {
    const timestamps = admin.usuarios.map((item) => item.last_sign_in_at).filter((value): value is string => Boolean(value));
    if (timestamps.length === 0) return null;
    return timestamps.reduce((latest, current) => (current > latest ? current : latest));
  }, [admin.usuarios]);

  return (
    <section className="content-stack">
      <div className="page-header">
        <div>
          <p className="eyebrow">Admin · RBAC</p>
          <h2>Gestão de Usuários</h2>
          <p>Convites, cargos, marcas permitidas e presença em tempo real de quem acessa o GTO Insights.</p>
        </div>
        <div className="filters">
          <button className="secondary-button" onClick={() => admin.reload()}>
            <span className="material-symbols-outlined" aria-hidden="true">
              refresh
            </span>
            Atualizar
          </button>
          <button onClick={() => setInviteOpen(true)}>
            <span className="material-symbols-outlined" aria-hidden="true">
              person_add
            </span>
            Convidar usuário
          </button>
        </div>
      </div>

      {admin.loadError ? <div className="alert error">{admin.loadError}</div> : null}
      {admin.actionError ? <div className="alert error">{admin.actionError}</div> : null}
      {admin.actionSuccess ? <div className="alert success">{admin.actionSuccess}</div> : null}

      <div className="usuarios-status-grid">
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

      <article className="card">
        <div className="section-title">
          <div>
            <h3>Controle de acessos</h3>
            <p>Alterar cargo/marcas, ativar ou bloquear, e disparar redefinição de senha ou reset de MFA.</p>
          </div>
        </div>

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
              {admin.loading ? (
                <tr>
                  <td colSpan={6}>Carregando usuários...</td>
                </tr>
              ) : admin.usuarios.length === 0 ? (
                <tr>
                  <td colSpan={6}>Nenhum usuário cadastrado ainda.</td>
                </tr>
              ) : (
                admin.usuarios.map((usuario) => {
                  const isOnline = onlineIds.has(usuario.id);
                  const busyPrefix = admin.pendingActionId;
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
                            onClick={() => setEditingUsuario(usuario)}
                          >
                            <span className="material-symbols-outlined">edit</span>
                          </button>
                          <label className="switch" title={usuario.ativo ? 'Bloquear usuário' : 'Ativar usuário'}>
                            <input
                              type="checkbox"
                              checked={usuario.ativo}
                              disabled={busyPrefix === `status-${usuario.id}`}
                              onChange={() => admin.alternarStatus(usuario)}
                            />
                            <span className="switch-track" aria-hidden="true" />
                          </label>
                          <button
                            type="button"
                            className="icon-button"
                            title="Enviar e-mail de redefinição de senha"
                            disabled={busyPrefix === `senha-${usuario.id}`}
                            onClick={() => admin.enviarRedefinicaoSenha(usuario)}
                          >
                            <span className="material-symbols-outlined">mail_lock</span>
                          </button>
                          <button
                            type="button"
                            className="icon-button"
                            title="Resetar MFA (2FA)"
                            disabled={busyPrefix === `mfa-${usuario.id}` || !usuario.mfa_enrolled}
                            onClick={() => admin.resetarMfa(usuario)}
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
      </article>

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
