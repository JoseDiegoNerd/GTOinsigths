// Preview local do modulo Influenciadores com dados de exemplo, sem tocar no Supabase real e sem
// exigir login. Nao e publicado (fica fora de public/). Uso: node scripts/preview-influenciadores.mjs
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

const PORTA = 5183;
const HOJE = new Date().toISOString().slice(0, 10);

const influenciadores = [
  { id: 'i1', marca: 'Tesoura de Ouro', nome: 'Isabela Lima', handle: '@isabelalima.style', rede_social: 'Instagram', verificado: true, nicho: 'Moda & Varejo', avatar_path: null, cupom_codigo: 'TESOURA10', cupom_exclusivo: true, status: 'Ativo' },
  { id: 'i2', marca: 'Tesoura de Ouro', nome: 'Lucas Martins', handle: '@lucasmartins.oficial', rede_social: 'TikTok', verificado: false, nicho: null, avatar_path: null, cupom_codigo: null, cupom_exclusivo: false, status: 'Ativo' },
  { id: 'i3', marca: 'Magazine da Economia', nome: 'Camila Rodrigues', handle: '@camilafashion', rede_social: 'Instagram', verificado: false, nicho: 'Achadinhos', avatar_path: null, cupom_codigo: null, cupom_exclusivo: false, status: 'Pausado' }
];
const campanhas = [
  { id: 'c1', influenciador_id: 'i1', marca: 'Tesoura de Ouro', nome: 'Campanha dos Pais 2026', data_inicio: `${HOJE.slice(0, 7)}-01`, data_fim: null, cache_valor: 10000, voucher_valor: 5000, investimento_total: 15000 }
];
const midias = [
  { id: 'm1', influenciador_id: 'i1', marca: 'Tesoura de Ouro', campanha_id: 'c1', titulo: 'Reel: Provador Tesoura de Ouro', url: 'https://www.instagram.com/reel/C8x9L_p/', plataforma: 'Instagram', formato: 'Reel', publicada_em: `${HOJE.slice(0, 7)}-10`, views: 1840000, alcance: 4230000, curtidas: 94200, comentarios: 1200, salvos: 14800, compartilhamentos: 3100, fonte: 'manual' }
];
const snapshots = [
  { id: 's1', influenciador_id: 'i1', marca: 'Tesoura de Ouro', data: `${HOJE.slice(0, 7)}-14`, seguidores: 1420000 },
  { id: 's2', influenciador_id: 'i1', marca: 'Tesoura de Ouro', data: HOJE, seguidores: 1450000 }
];

const banco = { influenciadores, influenciador_campanhas: campanhas, influenciador_midias: midias, influenciador_seguidores_historico: snapshots };

const raiz = 'public';
const tipos = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png' };

createServer((req, res) => {
  const url = (req.url ?? '/').split('?')[0];
  if (url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8" />
      <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght@400&display=swap" rel="stylesheet" />
      <style>body{font-family:Inter,system-ui,sans-serif;background:#f8fafc;margin:0}
      button,input,select{font:inherit}button{border:0;border-radius:8px;background:#1D4ED8;color:white;padding:10px 14px;font-weight:700;cursor:pointer}
      button.secondary,button.danger{background:#fff}button.danger{color:#dc2626;border:1px solid #fecaca}
      input,select{border:1px solid #d8e3fb;border-radius:8px;padding:10px 12px;background:white}
      label{display:grid;gap:6px;color:#475569;font-size:12px;font-weight:800;text-transform:uppercase}
      .card{background:white;border:1px solid #e2e8f0;border-radius:12px}
      .content{padding:32px;max-width:1400px;margin:0 auto}.muted{color:#94a3b8;font-size:12px}
      .modal-overlay{position:fixed;inset:0;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;z-index:100;padding:20px}
      .modal-overlay[hidden]{display:none}.modal-panel{background:#fff;border-radius:16px;max-width:640px;width:100%;max-height:88vh;overflow-y:auto}
      .modal-header{display:flex;justify-content:space-between;padding:20px 22px 14px;border-bottom:1px solid #e2e8f0}
      .modal-body{padding:18px 22px 22px;display:grid;gap:14px}.alert.error{background:#fef2f2;color:#b91c1c;border:1px solid #fecaca;border-radius:10px;padding:12px}
      </style></head><body><div id="content" class="content"></div>
      <script type="module">
        const banco = ${JSON.stringify(banco)};

        // Cliente Supabase falso minimo, com a mesma forma usada por public/modules/influenciadores/service.js.
        // Definido aqui dentro (no navegador) porque precisa existir antes do initInfluenciadores rodar;
        // no processo Node ele nao teria efeito nenhum sobre o modulo servido para a pagina.
        function criarClienteFalso() {
          function from(tabela) {
            let dados = banco[tabela] ?? [];
            const construir = () => {
              const q = new Proxy({}, {
                get(_, prop) {
                  if (prop === 'then') return (resolve) => resolve({ data: dados, error: null });
                  if (prop === 'eq') return (coluna, valor) => { dados = dados.filter((r) => r[coluna] === valor); return q; };
                  if (prop === 'range') return () => q;
                  if (prop === 'select' || prop === 'order') return () => q;
                  if (prop === 'single') return async () => ({ data: dados[0] ?? { id: \`novo-\${Date.now()}\` }, error: null });
                  if (prop === 'insert') return (valor) => { const linha = { id: \`novo-\${Date.now()}\`, ...valor }; banco[tabela] = [...(banco[tabela] ?? []), linha]; dados = [linha]; return q; };
                  if (prop === 'update' || prop === 'upsert' || prop === 'delete') return () => q;
                  return () => q;
                }
              });
              return q;
            };
            return construir();
          }
          return {
            from,
            storage: { from: () => ({ upload: async () => ({ error: null }), remove: async () => ({ error: null }), createSignedUrls: async () => ({ data: [], error: null }) }) }
          };
        }

        import { initInfluenciadores, renderInfluenciadores } from '/modules/influenciadores/index.js';
        const perfis = { Admin: { cargo: 'Admin' }, Coordenador: { cargo: 'Coordenador', marca_vinculada: 'Tesoura de Ouro' } };
        const state = { marca: 'Todas', perfil: perfis[new URLSearchParams(location.search).get('cargo') ?? 'Admin'], contentEl: document.querySelector('#content') };
        function escapeHtml(v) { return String(v ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;'); }
        function safeErrorMessage(e, fallback) { console.error(e); return fallback; }
        await initInfluenciadores({ supabase: criarClienteFalso(), state, escapeHtml, marcas: ['Todas','Tesoura de Ouro','Magazine da Economia','Free Center Calçados'], safeErrorMessage });
        await renderInfluenciadores();
      </script></body></html>`);
    return;
  }
  try {
    const caminho = normalize(join(raiz, decodeURIComponent(url)));
    if (!caminho.startsWith(normalize(raiz))) throw new Error('fora da raiz');
    res.writeHead(200, { 'Content-Type': tipos[extname(caminho)] ?? 'application/octet-stream' });
    res.end(readFileSync(caminho));
  } catch {
    res.writeHead(404);
    res.end('não encontrado');
  }
}).listen(PORTA, '127.0.0.1', () => {
  console.log(`Preview de Influenciadores (dados de exemplo, sem Supabase real):`);
  console.log(`- http://127.0.0.1:${PORTA}/           (Admin, vê todas as marcas)`);
  console.log(`- http://127.0.0.1:${PORTA}/?cargo=Coordenador  (só a marca vinculada)`);
});
