// Estilos do modulo (injetados uma vez em <head>; a CSP do app permite style inline). Reaproveita
// as classes base do app (card, kpi, grid, kpis, table-wrap, subtabs, pill, alert) e so acrescenta
// o que e especifico do Cartao Proprio. Prefixo cs- para nao colidir com o resto do app.
export const ESTILO_CREDSYSTEM = `
.cs-faixa { display:flex; flex-wrap:wrap; gap:8px 18px; align-items:center; background:#fff; border:1px solid #e2e8f0; border-radius:12px; padding:10px 14px; font-size:12px; color:#475569; }
.cs-faixa b { color:#0f172a; font-weight:600; }
.cs-faixa .cs-link { margin-left:auto; display:inline-flex; align-items:center; gap:6px; padding:6px 10px; font-size:12px; }
.cs-faixa .cs-link .material-symbols-outlined { font-size:16px; }
.cs-abas { flex-wrap:wrap; max-width:100%; }
.cs-corpo { display:grid; gap:16px; min-width:0; }
.cs-secao { display:grid; gap:12px; }
.cs-secao-topo { display:flex; flex-wrap:wrap; justify-content:space-between; align-items:center; gap:10px; }
.cs-fonte { display:inline-flex; align-items:center; gap:4px; font-size:11px; font-weight:600; color:#64748b; background:#f1f5f9; border-radius:999px; padding:3px 10px; }
.cs-fonte .material-symbols-outlined { font-size:14px; }
.cs-kpis { grid-template-columns:repeat(4, minmax(0,1fr)); }
.cs-kpis-2 { grid-template-columns:repeat(2, minmax(0,1fr)); }
.cs-kpis-5 { grid-template-columns:repeat(5, minmax(0,1fr)); }
.cs-kpi strong { overflow-wrap:anywhere; }
.cs-kpi-nota { display:block; margin-top:6px; color:#94a3b8; font-size:11px; line-height:1.35; }
.cs-nd { color:#94a3b8 !important; }
.cs-estado { display:block; margin-top:8px; font-size:13px; font-weight:600; color:#64748b; line-height:1.35; }
.cs-estado-erro, .cs-estado-sem_permissao { color:#b91c1c; }
.cs-estado-sem_registros_periodo { color:#b45309; }
.cs-duas { grid-template-columns:repeat(2, minmax(0,1fr)); }
.cs-vazio { display:grid; justify-items:center; text-align:center; gap:6px; padding:28px 12px; color:#64748b; }
.cs-vazio .material-symbols-outlined { font-size:34px; color:#94a3b8; }
.cs-vazio p { margin:0; max-width:620px; }
.cs-vazio-inline { padding:18px 0; text-align:center; }
.cs-lista { text-align:left; columns:2; gap:24px; color:#475569; font-size:13px; margin:8px 0 0; }
.cs-chip { display:inline-flex; align-items:center; gap:6px; font-size:12px; font-weight:600; white-space:nowrap; }
.cs-chip::before { content:""; width:9px; height:9px; border-radius:50%; background:var(--cs-cor); }
.cs-tabela th, .cs-tabela td { white-space:nowrap; }
.cs-tabela td:first-child { white-space:normal; min-width:140px; }
.cs-tabela-alta { max-height:440px; overflow:auto; }
.cs-ordenavel th { cursor:pointer; user-select:none; }
.cs-ordenavel th.ativo::after { content:" ▾"; }
.cs-ordenavel th.ativo.asc::after { content:" ▴"; }
.cs-acoes { display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
.cs-acoes input[type=search] { min-width:220px; }
.cs-hbars { display:grid; gap:8px; }
.cs-hbar { display:grid; grid-template-columns:minmax(90px, 32%) 1fr auto; gap:10px; align-items:center; font-size:12px; }
.cs-hbar-rotulo { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:#334155; }
.cs-hbar-trilho { background:#f1f5f9; border-radius:6px; height:14px; overflow:hidden; }
.cs-hbar-barra { display:block; height:100%; border-radius:6px; }
.cs-hbar-valor { font-weight:700; color:#0f172a; text-align:right; white-space:nowrap; }
.cs-hbar-valor small { display:block; font-weight:500; color:#94a3b8; font-size:10px; }
.cs-legenda { display:flex; flex-wrap:wrap; gap:6px 14px; margin-top:8px; font-size:11px; color:#475569; }
.cs-legenda i { display:inline-block; width:10px; height:10px; border-radius:3px; margin-right:5px; vertical-align:-1px; }
.cs-chart-scroll { overflow-x:auto; }
.cs-funil { display:grid; gap:6px; }
.cs-funil-etapa { position:relative; min-height:44px; display:flex; align-items:center; }
.cs-funil-barra { position:absolute; left:0; top:0; bottom:0; border-radius:10px; }
.cs-funil-texto { position:relative; display:flex; justify-content:space-between; width:100%; padding:0 14px; color:#fff; font-size:13px; text-shadow:0 1px 2px rgba(0,0,0,.35); }
.cs-funil-texto strong { font-size:16px; }
.cs-funil-taxa { display:flex; align-items:center; gap:4px; font-size:12px; color:#475569; padding-left:8px; }
.cs-funil-taxa .material-symbols-outlined { font-size:16px; color:#94a3b8; }
.cs-importador { display:grid; gap:14px; }
.cs-passos { flex-wrap:wrap; }
.cs-passos .feito { color:#16a34a; }
.cs-etapa { display:grid; gap:14px; min-width:0; }
.cs-subcard { box-shadow:none; }
.cs-subcard h4 { margin:0 0 10px; font-size:14px; }
.cs-lista-dados { list-style:none; padding:0; margin:0; display:grid; gap:8px; font-size:13px; }
.cs-lista-dados li { display:flex; justify-content:space-between; gap:12px; border-bottom:1px dashed #e2e8f0; padding-bottom:6px; }
.cs-lista-dados b { text-align:right; }
.cs-badge { display:inline-block; border-radius:999px; padding:3px 10px; font-size:11px; font-weight:700; background:#e2e8f0; color:#334155; }
.cs-badge-alta, .cs-status-concluido { background:#dcfce7; color:#166534; }
.cs-badge-media, .cs-status-concluido_com_erros, .cs-status-cancelado { background:#fef3c7; color:#92400e; }
.cs-badge-baixa, .cs-status-falhou { background:#fee2e2; color:#991b1b; }
.cs-obrig { color:#dc2626; font-weight:800; }
.cs-sensivel { font-size:10px; font-weight:700; color:#7c3aed; background:#f3e8ff; border-radius:999px; padding:2px 7px; }
.cs-ok { color:#16a34a; font-size:18px; }
.cs-erro { color:#b91c1c; }
.cs-mini { padding:5px 10px; font-size:12px; }
.cs-val.ok strong { color:#16a34a; }
.cs-val.erro strong { color:#dc2626; }
.cs-val.alerta strong { color:#d97706; }
.cs-salvar-modelo { display:flex; flex-wrap:wrap; gap:8px; }
.cs-salvar-modelo input { flex:1; min-width:220px; }
.cs-arquivos { flex-wrap:wrap; }
.cs-girando { animation:cs-gira 1s linear infinite; font-size:16px; vertical-align:-3px; }
@keyframes cs-gira { to { transform:rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .cs-girando { animation:none; } }
@media (max-width: 1100px) { .cs-kpis, .cs-kpis-5 { grid-template-columns:repeat(2, minmax(0,1fr)); } .cs-duas { grid-template-columns:minmax(0,1fr); } }
@media (max-width: 560px) {
  .cs-kpis, .cs-kpis-2, .cs-kpis-5 { grid-template-columns:minmax(0,1fr); }
  .cs-hbar { grid-template-columns:1fr auto; }
  .cs-hbar-trilho { grid-column:1 / -1; grid-row:2; }
  .cs-lista { columns:1; }
  .cs-faixa .cs-link { margin-left:0; }
  .cs-acoes input[type=search] { min-width:0; width:100%; }
}
`;
