import { CSSProperties, FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from './hooks/useAuth';
import { useCredsystemDashboard } from './hooks/useCredsystemDashboard';
import { usePresenceHeartbeat } from './hooks/usePresence';
import { useStageImport } from './hooks/useStageImport';
import { formatZodError, loginSchema } from './lib/validation';
import UsuariosPage from './pages/UsuariosPage';
import type { CargoUsuario, Marca, PeriodoFiltro, StageSource } from './types/gto';

type PageKey =
  | 'dashboard'
  | 'redes-sociais'
  | 'anuncios'
  | 'cartao-proprio'
  | 'email-marketing'
  | 'google-meu-negocio'
  | 'conexoes'
  | 'importar-planilhas'
  | 'usuarios';

type NavItem = {
  key: PageKey;
  label: string;
  icon: string;
  adminOnly?: boolean;
};

// Ordem exigida pelo produto: navegação operacional primeiro, itens administrativos por último.
const NAV_ITEMS: NavItem[] = [
  { key: 'dashboard', label: 'Dashboard Geral', icon: 'dashboard' },
  { key: 'redes-sociais', label: 'Redes Sociais', icon: 'share' },
  { key: 'anuncios', label: 'Anúncios', icon: 'ads_click' },
  { key: 'cartao-proprio', label: 'Cartão Próprio', icon: 'credit_card' },
  { key: 'email-marketing', label: 'Email Marketing', icon: 'mail' },
  { key: 'google-meu-negocio', label: 'Google Meu Negócio', icon: 'store' },
  { key: 'conexoes', label: 'Conexões', icon: 'cable', adminOnly: true },
  { key: 'importar-planilhas', label: 'Importar Planilhas', icon: 'upload_file', adminOnly: true },
  { key: 'usuarios', label: 'Gestão de Usuários', icon: 'manage_accounts', adminOnly: true }
];

const DEFAULT_PAGE: PageKey = 'dashboard';

function isAdminCargo(cargo: CargoUsuario | undefined): boolean {
  return cargo === 'Admin';
}

function pageFromHash(hash: string): PageKey {
  const key = hash.replace(/^#\/?/, '');
  return NAV_ITEMS.some((item) => item.key === key) ? (key as PageKey) : DEFAULT_PAGE;
}

function useHashPage(): [PageKey, (page: PageKey) => void] {
  const [page, setPage] = useState<PageKey>(() => pageFromHash(window.location.hash));

  useEffect(() => {
    function handleHashChange() {
      setPage(pageFromHash(window.location.hash));
    }
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const navigate = useCallback((next: PageKey) => {
    const nextHash = `#/${next}`;
    if (window.location.hash === nextHash) {
      setPage(next);
    } else {
      window.location.hash = nextHash;
    }
  }, []);

  return [page, navigate];
}

const marcas: Array<Marca | 'Todas'> = [
  'Todas',
  'Tesoura de Ouro',
  'Magazine da Economia',
  'Free Center Calçados'
];

const sources: Array<{ value: StageSource; label: string; table: string }> = [
  { value: 'credsystem_emissoes', label: 'CredSystem Emissões', table: 'dados_cartoes_credsystem' },
  { value: 'credsystem_propostas', label: 'CredSystem Propostas', table: 'stage_credsystem_propostas' },
  { value: 'rd_station', label: 'RD Station', table: 'stage_rd_station_marketing' },
  { value: 'meta_business', label: 'Meta Business', table: 'stage_meta_business_analytics' },
  { value: 'google_business_profile', label: 'Google Business Profile', table: 'stage_google_business_profile' }
];

function formatNumber(value: number): string {
  return new Intl.NumberFormat('pt-BR').format(Math.round(value));
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(value);
}

function formatPercent(value: number): string {
  return `${value.toFixed(2).replace('.', ',')}%`;
}

function LoginScreen({ onLogin, error }: { onLogin: (email: string, password: string) => Promise<void>; error: string | null }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setValidationError(null);

    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      setValidationError(formatZodError(parsed.error));
      return;
    }

    setSubmitting(true);
    try {
      await onLogin(parsed.data.email, parsed.data.password);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-panel">
        <div className="brand-mark">GTO</div>
        <h1>GTO Insights</h1>
        <p>Entre com o usuário criado no Supabase Auth para consumir os dados reais protegidos por RLS.</p>
        <form onSubmit={handleSubmit} className="login-form">
          <label>
            Email
            <input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              type="email"
              maxLength={254}
              autoComplete="username"
              required
            />
          </label>
          <label>
            Senha
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              maxLength={128}
              autoComplete="current-password"
              required
            />
          </label>
          {validationError ? <div className="alert error">{validationError}</div> : null}
          {!validationError && error ? <div className="alert error">{error}</div> : null}
          <button type="submit" disabled={submitting}>
            {submitting ? 'Entrando...' : 'Entrar'}
          </button>
        </form>
      </section>
    </main>
  );
}

function KpiCard(props: { label: string; value: string; hint: string; icon: string }) {
  return (
    <article className="card kpi-card">
      <div className="kpi-top">
        <span>{props.label}</span>
        <span className="material-symbols-outlined">{props.icon}</span>
      </div>
      <strong>{props.value}</strong>
      <small>{props.hint}</small>
    </article>
  );
}

function Skeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  return <div className={`skeleton ${className ?? ''}`.trim()} style={style} />;
}

function SkeletonKpiCard() {
  return (
    <article className="card kpi-card skeleton-card" aria-hidden="true">
      <div className="kpi-top">
        <Skeleton className="skeleton-text skeleton-text-sm" />
        <Skeleton className="skeleton-icon" />
      </div>
      <Skeleton className="skeleton-text skeleton-text-lg" />
      <Skeleton className="skeleton-text skeleton-text-sm" />
    </article>
  );
}

function SkeletonTableRows({ rows, cols }: { rows: number; cols: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <tr key={rowIndex}>
          {Array.from({ length: cols }).map((__, colIndex) => (
            <td key={colIndex}>
              <Skeleton className="skeleton-text" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

// Reproduz a estrutura exata do dashboard real (kpi-grid, dashboard-grid, tabelas) para que a
// transição do skeleton para os dados não "pule" o layout.
function DashboardSkeleton() {
  return (
    <>
      <div className="kpi-grid">
        {Array.from({ length: 12 }).map((_, index) => (
          <SkeletonKpiCard key={index} />
        ))}
      </div>

      <div className="dashboard-grid">
        <article className="card wide-card skeleton-card" aria-hidden="true">
          <Skeleton className="skeleton-text skeleton-text-sm" style={{ width: '40%' }} />
          <div className="brand-bars">
            {Array.from({ length: 3 }).map((_, index) => (
              <div className="brand-row" key={index}>
                <div>
                  <Skeleton className="skeleton-text skeleton-text-sm" />
                  <Skeleton className="skeleton-text skeleton-text-sm" style={{ width: '70%' }} />
                </div>
                <Skeleton className="skeleton-bar" />
                <Skeleton className="skeleton-text skeleton-text-sm" />
              </div>
            ))}
          </div>
        </article>

        <article className="card skeleton-card" aria-hidden="true">
          <Skeleton className="skeleton-text skeleton-text-sm" style={{ width: '50%' }} />
          <Skeleton className="skeleton-text" />
          <Skeleton className="skeleton-text" style={{ width: '85%' }} />
        </article>
      </div>

      <article className="card skeleton-card" aria-hidden="true">
        <Skeleton className="skeleton-text skeleton-text-sm" style={{ width: '30%' }} />
        <div className="table-wrap">
          <table>
            <tbody>
              <SkeletonTableRows rows={5} cols={3} />
            </tbody>
          </table>
        </div>
      </article>

      <article className="card skeleton-card" aria-hidden="true">
        <Skeleton className="skeleton-text skeleton-text-sm" style={{ width: '30%' }} />
        <div className="table-wrap">
          <table>
            <tbody>
              <SkeletonTableRows rows={6} cols={6} />
            </tbody>
          </table>
        </div>
      </article>
    </>
  );
}

function Dashboard() {
  const [marca, setMarca] = useState<Marca | 'Todas'>('Todas');
  const [periodo, setPeriodo] = useState<PeriodoFiltro>('30d');
  const dashboard = useCredsystemDashboard({ marca, periodo });

  const brandMax = useMemo(
    () => Math.max(...dashboard.brandMetrics.map((item) => item.totalCartoes), 1),
    [dashboard.brandMetrics]
  );

  return (
    <section className="content-stack">
      <div className="page-header">
        <div>
          <p className="eyebrow">Dados reais do Supabase</p>
          <h2>Dashboard Geral</h2>
          <p>KPIs calculados a partir de CredSystem, RD Station e Meta Business.</p>
        </div>
        <div className="filters">
          <select value={marca} onChange={(event) => setMarca(event.target.value as Marca | 'Todas')}>
            {marcas.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
          <select value={periodo} onChange={(event) => setPeriodo(event.target.value as PeriodoFiltro)}>
            <option value="7d">7 dias</option>
            <option value="30d">30 dias</option>
            <option value="1y">1 ano</option>
            <option value="all">Tudo</option>
          </select>
          <button onClick={dashboard.reload}>Atualizar</button>
        </div>
      </div>

      {dashboard.error ? <div className="alert error">{dashboard.error}</div> : null}
      {dashboard.refreshing ? <div className="alert refreshing">Atualizando dados...</div> : null}

      {dashboard.loading ? (
        <DashboardSkeleton />
      ) : (
        <>
          <div className="kpi-grid">
            <KpiCard label="Total de cartões" value={formatNumber(dashboard.summary?.totalCartoes ?? 0)} hint="Registros visíveis pelo seu perfil" icon="credit_card" />
            <KpiCard label="Cartões ativados" value={formatNumber(dashboard.summary?.cartoesAtivos ?? 0)} hint="Com data de ativação preenchida" icon="verified" />
            <KpiCard label="Ticket médio" value={formatCurrency(dashboard.summary?.ticketMedio ?? 0)} hint="Valor de compra inicial" icon="payments" />
            <KpiCard label="Campanhas RD" value={formatNumber(dashboard.summary?.totalCampanhas ?? 0)} hint="Registros de stage visíveis" icon="campaign" />
            <KpiCard label="Taxa abertura" value={formatPercent(dashboard.summary?.taxaAberturaMedia ?? 0)} hint="Média RD Station" icon="mail" />
            <KpiCard label="Taxa clique" value={formatPercent(dashboard.summary?.taxaCliqueMedia ?? 0)} hint="Média RD Station" icon="ads_click" />
            <KpiCard label="Alcance Facebook" value={formatNumber(dashboard.summary?.alcanceFacebook ?? 0)} hint="Meta Business" icon="sensors" />
            <KpiCard label="Engajamento" value={formatNumber(dashboard.summary?.engajamentoTotal ?? 0)} hint="Meta Business" icon="favorite" />
            <KpiCard label="Propostas" value={formatNumber(dashboard.summary?.totalPropostas ?? 0)} hint="CredSystem propostas" icon="assignment" />
            <KpiCard label="Aprovadas" value={formatNumber(dashboard.summary?.propostasAprovadas ?? 0)} hint="Propostas aprovadas" icon="check_circle" />
            <KpiCard label="Rejeitadas" value={formatNumber(dashboard.summary?.propostasRejeitadas ?? 0)} hint="Propostas rejeitadas" icon="cancel" />
            <KpiCard label="Taxa aprovação" value={formatPercent(dashboard.summary?.taxaAprovacao ?? 0)} hint="Aprovadas / total" icon="percent" />
          </div>

          <div className="dashboard-grid">
            <article className="card wide-card">
              <div className="section-title">
                <div>
                  <h3>Performance por marca</h3>
                  <p>A policy do banco limita automaticamente o que cada usuário pode ver.</p>
                </div>
              </div>
              <div className="brand-bars">
                {dashboard.brandMetrics.length === 0 ? (
                  <p className="empty">Nenhum dado de cartão disponível para os filtros atuais.</p>
                ) : (
                  dashboard.brandMetrics.map((item) => (
                    <div className="brand-row" key={item.marca}>
                      <div>
                        <strong>{item.marca}</strong>
                        <span>{formatCurrency(item.ticketMedio)} ticket médio</span>
                      </div>
                      <div className="bar-track">
                        <div className="bar-fill" style={{ width: `${(item.totalCartoes / brandMax) * 100}%` }} />
                      </div>
                      <b>{formatNumber(item.totalCartoes)}</b>
                    </div>
                  ))
                )}
              </div>
            </article>

            <article className="card">
              <h3>Controle de acesso</h3>
              <p className="security-copy">
                O front envia e filtra por <code>marca</code>, mas a regra definitiva fica no PostgreSQL:
                <code> public.gto_tem_acesso_marca(marca)</code>.
              </p>
            </article>
          </div>

          <article className="card">
            <div className="section-title">
              <div>
                <h3>Principais motivos das propostas</h3>
                <p>Ranking vindo de <code>stage_credsystem_propostas</code>.</p>
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Motivo</th>
                    <th>Total</th>
                    <th>Participação</th>
                  </tr>
                </thead>
                <tbody>
                  {dashboard.motivosPropostas.length === 0 ? (
                    <tr>
                      <td colSpan={3}>Sem propostas importadas.</td>
                    </tr>
                  ) : (
                    dashboard.motivosPropostas.map((item) => (
                      <tr key={item.motivo}>
                        <td>{item.motivo}</td>
                        <td>{formatNumber(item.total)}</td>
                        <td>{formatPercent(item.participacao)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </article>

          <article className="card">
            <div className="section-title">
              <div>
                <h3>Últimos registros CredSystem</h3>
                <p>Consulta direta em <code>dados_cartoes_credsystem</code>.</p>
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Marca</th>
                    <th>Emissão</th>
                    <th>Ativação</th>
                    <th>Loja</th>
                    <th>Cliente</th>
                    <th>Valor inicial</th>
                  </tr>
                </thead>
                <tbody>
                  {dashboard.cards.slice(0, 12).map((card) => (
                    <tr key={card.id}>
                      <td>{card.marca}</td>
                      <td>{card.data_emissao}</td>
                      <td>{card.data_ativacao ?? '-'}</td>
                      <td>{card.loja_operacao}</td>
                      <td>{card.nome_cliente ?? '-'}</td>
                      <td>{formatCurrency(card.valor_compra_inicial ?? 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>
        </>
      )}
    </section>
  );
}

function ImportPage() {
  const [marca, setMarca] = useState<Marca>('Tesoura de Ouro');
  const [source, setSource] = useState<StageSource>('credsystem');
  const importer = useStageImport();

  async function handleFile(file: File | undefined) {
    if (!file) return;
    await importer.prepareFile(file, source, marca);
  }

  return (
    <section className="content-stack">
      <div className="page-header">
        <div>
          <p className="eyebrow">Importação controlada</p>
          <h2>Importar planilhas</h2>
          <p>Prepare CSVs para CredSystem, RD Station, Meta ou Google Business Profile.</p>
        </div>
      </div>

      <div className="import-grid">
        <article className="card import-panel">
          <label>
            Marca
            <select value={marca} onChange={(event) => setMarca(event.target.value as Marca)}>
              {marcas.filter((item): item is Marca => item !== 'Todas').map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <label>
            Origem
            <select value={source} onChange={(event) => setSource(event.target.value as StageSource)}>
              {sources.map((item) => (
                <option value={item.value} key={item.value}>
                  {item.label} - {item.table}
                </option>
              ))}
            </select>
          </label>

          <div className="drop-zone">
            <span className="material-symbols-outlined">upload_file</span>
            <strong>Selecione um CSV</strong>
            <p>XLSX fica para o próximo conector; este fluxo já cobre CSV seguro para stage.</p>
            <input type="file" accept=".csv" onChange={(event) => handleFile(event.target.files?.[0])} />
          </div>

          {importer.error ? <div className="alert error">{importer.error}</div> : null}
          {importer.result ? <div className="alert success">{importer.result}</div> : null}
        </article>

        <article className="card">
          <h3>Preview e validação</h3>
          {!importer.preview ? (
            <p className="empty">Escolha marca, origem e arquivo para ver a prévia.</p>
          ) : (
            <div className="preview-stack">
              <div className="preview-metrics">
                <span>Arquivo: <b>{importer.preview.fileName}</b></span>
                <span>Linhas: <b>{importer.preview.totalRows}</b></span>
                <span>Válidas: <b>{importer.preview.validRows}</b></span>
                <span>Erros: <b>{importer.preview.invalidRows}</b></span>
              </div>
              {importer.preview.errors.map((error) => (
                <div className="alert error" key={error}>{error}</div>
              ))}
              <div className="table-wrap compact">
                <table>
                  <thead>
                    <tr>
                      {importer.preview.columns.slice(0, 6).map((column) => (
                        <th key={column}>{column}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {importer.preview.sample.map((row, index) => (
                      <tr key={index}>
                        {importer.preview?.columns.slice(0, 6).map((column) => (
                          <td key={column}>{row[column] || '-'}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="button-row">
                <button onClick={importer.reset} className="secondary-button">Limpar</button>
                <button onClick={importer.importPreparedRows} disabled={importer.loading || importer.preview.errors.length > 0}>
                  {importer.loading ? 'Importando...' : 'Importar para Supabase'}
                </button>
              </div>
            </div>
          )}
        </article>
      </div>
    </section>
  );
}

function ComingSoon({ item }: { item: NavItem }) {
  return (
    <section className="content-stack">
      <div className="page-header">
        <div>
          <p className="eyebrow">Em desenvolvimento</p>
          <h2>{item.label}</h2>
          <p>Este módulo ainda está sendo construído e chega em breve.</p>
        </div>
      </div>
      <article className="card">
        <div className="section-title">
          <div>
            <h3>
              <span className="material-symbols-outlined" aria-hidden="true">
                {item.icon}
              </span>{' '}
              {item.label}
            </h3>
            <p>Assim que os conectores de dados estiverem prontos, os indicadores aparecerão aqui.</p>
          </div>
        </div>
        <p className="empty">Nenhum dado disponível ainda para este módulo.</p>
      </article>
    </section>
  );
}

export default function App() {
  const auth = useAuth();
  const [page, navigate] = useHashPage();
  const isAdmin = isAdminCargo(auth.perfil?.cargo);
  const activeItem = NAV_ITEMS.find((item) => item.key === page) ?? NAV_ITEMS[0];
  const blockedByRole = Boolean(activeItem.adminOnly) && !isAdmin;

  usePresenceHeartbeat({
    userId: auth.session ? (auth.user?.id ?? null) : null,
    nome: auth.perfil?.nome ?? auth.user?.email ?? 'Usuário',
    email: auth.user?.email ?? '',
    cargo: auth.perfil?.cargo ?? null
  });

  useEffect(() => {
    if (auth.loading || !auth.session) return;
    if (blockedByRole) {
      navigate(DEFAULT_PAGE);
    }
  }, [auth.loading, auth.session, blockedByRole, navigate]);

  if (auth.loading) {
    return <main className="center-page">Carregando sessão...</main>;
  }

  if (!auth.session) {
    return <LoginScreen onLogin={auth.signIn} error={auth.error} />;
  }

  const visibleNavItems = NAV_ITEMS.filter((item) => !item.adminOnly || isAdmin);

  function renderPage() {
    if (blockedByRole) return null;
    switch (page) {
      case 'dashboard':
        return <Dashboard />;
      case 'importar-planilhas':
        return <ImportPage />;
      case 'usuarios':
        return <UsuariosPage />;
      default:
        return <ComingSoon item={activeItem} />;
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-icon">G</div>
          <div>
            <h1>GTO Insights</h1>
            <span>BI Platform</span>
          </div>
        </div>
        <nav>
          {visibleNavItems.map((item) => (
            <button key={item.key} className={page === item.key ? 'active' : ''} onClick={() => navigate(item.key)}>
              <span className="material-symbols-outlined">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>
        <div className="profile-box">
          <strong>{auth.perfil?.nome ?? auth.user?.email}</strong>
          <span>{auth.perfil?.cargo ?? 'Perfil pendente'} · {auth.perfil?.marca_vinculada ?? 'Todas as marcas'}</span>
          <button onClick={auth.signOut}>Sair</button>
        </div>
      </aside>
      <main className="main-canvas">
        <header className="topbar">
          <div>
            <strong>{blockedByRole ? 'Redirecionando...' : activeItem.label}</strong>
            <span>Supabase conectado com RLS por marca</span>
          </div>
          <span className="status-pill">Autenticado</span>
        </header>
        <div className="canvas-scroll">{renderPage()}</div>
      </main>
    </div>
  );
}
