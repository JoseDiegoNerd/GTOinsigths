import { FormEvent, ReactNode, useEffect, useState } from 'react';
import { conviteUsuarioSchema, formatZodError } from '../lib/validation';
import type { CargoUsuario, ConviteUsuarioInput, Marca, UsuarioAdmin } from '../types/gto';

const CARGOS: CargoUsuario[] = ['Admin', 'Gestor', 'Coordenador', 'Analista'];
const MARCAS: Marca[] = ['Tesoura de Ouro', 'Magazine da Economia', 'Free Center Calçados'];
const CARGOS_COM_MARCA_OBRIGATORIA: CargoUsuario[] = ['Coordenador', 'Analista'];

export const MARCA_CHIP_CLASS: Record<Marca, string> = {
  'Tesoura de Ouro': 'chip-ouro',
  'Magazine da Economia': 'chip-economia',
  'Free Center Calçados': 'chip-calcados'
};

export const CARGO_BADGE_CLASS: Record<CargoUsuario, string> = {
  Admin: 'badge-cargo-admin',
  Gestor: 'badge-cargo-gestor',
  Coordenador: 'badge-cargo-coordenador',
  Analista: 'badge-cargo-analista'
};

export function formatDateTime(value: string | null): string {
  if (!value) return 'Nunca acessou';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value));
}

export function initials(name: string): string {
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

export function InviteModal(props: {
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

export function EditAccessModal(props: {
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

