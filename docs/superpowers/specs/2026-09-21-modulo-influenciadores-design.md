# Módulo Influenciadores — Design

Data: 2026-09-21 · Branch: `feat/modulo-influenciadores` (a partir de `origin/main`)

## 1. Objetivo

Adicionar ao GTO Insights a tela **Influenciadores** (Marketing de Influência): KPIs do mês, tabela de criadores no estilo Modash e um painel lateral (drawer) com acordos, campanhas, crescimento de seguidores e mídias vinculadas. O layout é o protótipo HTML/Tailwind já aprovado; este documento define como ele vira código de produção **dentro do app real**, com dados no Supabase e RLS por marca.

## 2. Contexto e restrições descobertas

- O app real é `public/index.html` (HTML/JS puro, `<script type="module">` com `state.page` + funções `render*()`). O `src/` React é um scaffold paralelo que **não roda** em `npm run dev` nem em produção.
- Produção: Vercel serve `public/` como está (`vercel.json`); Netlify copia `public/` recursivamente (`sync-netlify-deploy.mjs`). Subpastas com `.js` são publicadas.
- CSP (`vercel.json`, `netlify.toml`, `serve-public.mjs`): `script-src 'self' 'unsafe-inline' https://esm.sh ...`; `img-src 'self' data: https://ysreenjwihmwzockyrls.supabase.co`. Consequências:
  - o CDN do Tailwind do protótipo **não carrega** → as classes são portadas para CSS do app;
  - imagens externas (googleusercontent, CDN do Instagram/TikTok) são **bloqueadas** → avatares vêm do Supabase Storage;
  - módulos ES em `public/modules/...` são permitidos por `'self'`.
- Não existe nenhuma tabela, tela ou código de influenciadores hoje.
- A sync da Meta (`meta-sync-insights`) lê apenas `/{instagram_business_account_id}/media` e `/{page_id}/posts`, isto é, **contas das marcas**. Posts de influenciadores não estão em `stage_social_format_metrics`, e views/salvos/alcance de conta de terceiros exigem o token do dono. Por isso as métricas de mídia e os seguidores são **manuais** neste corte.
- Um único projeto Supabase (`ysreenjwihmwzockyrls`) atende preview e produção.
- Migration numerada **039**: a `main` termina em 037 e a branch `fix/meta-ads-status-periodo-campanha` já usa 038.

## 3. Decisões aprovadas

| Tema | Decisão |
|---|---|
| Stack | Vanilla no app real; interfaces TS em `src/types/influenciadores.ts` como contrato |
| Estrutura | Módulos ES em `public/modules/influenciadores/`, carregados por `import()` dinâmico |
| Dados | Schema + CRUD + mídias vinculadas, com RLS por marca |
| Fonte das métricas | Manual agora; coluna `fonte` prepara automação Meta depois |
| Sub-abas | Só **Visão Geral** funcional; Desempenho de Parcerias, Vincular Conteúdo e Comparativo aparecem desativadas ("Em breve") |
| Permissões | Ver: todos os cargos com acesso à marca. Editar: Admin, Gestor, Coordenador. Analista só lê |
| Avatares | Upload no Supabase Storage, bucket privado, URL assinada |
| Entrega | Branch + preview na Vercel; merge na `main` e migration em produção só com OK explícito |

**Fora de escopo:** as três sub-abas sem layout aprovado; qualquer chamada nova à Graph API (Business Discovery, Collab); importação de planilha de influenciadores; recriar a sidebar/header do protótipo (o app já tem); refatorar o restante do `index.html`.

## 4. Banco de dados (`supabase/migrations/20260921_039_influenciadores.sql`)

Convenções seguidas (iguais a `20260824_037_lojas_unidades.sql` e `20260702_001`): `begin; ... commit;`, `create table if not exists`, `enable` + `force row level security`, `drop policy if exists` antes de cada `create policy`, `(select public.fn())` nas policies, `revoke all ... from anon`, `grant ... to authenticated`, `notify pgrst, 'reload schema'`, comentários em português sem acento (padrão dos arquivos SQL).

### 4.1 Tabelas

**`influenciadores`**
`id uuid pk default gen_random_uuid()`, `marca bandeira_marca not null`, `nome text not null` (2–120), `handle text not null` (`^@[A-Za-z0-9._]{2,50}$`), `rede_social text not null` (Instagram | TikTok | YouTube), `verificado boolean default false`, `nicho text` (≤ 60), `avatar_path text`, `cupom_codigo text` (`^[A-Z0-9_-]{2,30}$`), `cupom_exclusivo boolean default false`, `status text default 'Ativo'` (Ativo | Pausado | Encerrado), `criado_por uuid default auth.uid() references auth.users on delete set null`, `criado_em`, `atualizado_em`.
Constraints: `unique (id, marca)` (alvo das FKs compostas), `unique (marca, rede_social, handle)`, `cupom_exclusivo = false or cupom_codigo is not null`.

**`influenciador_campanhas`**
`id`, `influenciador_id`, `marca`, `nome text not null` (≤ 120), `data_inicio date not null`, `data_fim date` (≥ `data_inicio`), `cache_valor numeric(12,2) default 0 check >= 0`, `voucher_valor numeric(12,2) default 0 check >= 0`, `investimento_total numeric(12,2) generated always as (cache_valor + voucher_valor) stored`, `criado_em`, `atualizado_em`.
FK composta `(influenciador_id, marca) → influenciadores (id, marca) on delete cascade`.

**`influenciador_midias`**
`id`, `influenciador_id`, `marca`, `campanha_id uuid null`, `titulo text not null` (≤ 160), `url text not null` (`^https://`, ≤ 500), `plataforma text` (Instagram | TikTok | YouTube), `formato text` (Reel | Feed | Story | Video | Short), `publicada_em date not null`, `views`, `alcance`, `curtidas`, `comentarios`, `salvos`, `compartilhamentos` (todos `bigint default 0 check >= 0`), `fonte text default 'manual'` (manual | meta_colab | business_discovery), `criado_em`, `atualizado_em`.
FK composta `(influenciador_id, marca)` como acima; FK composta `(campanha_id, marca)` para `influenciador_campanhas (id, marca)` (que também ganha `unique (id, marca)`), com `on delete set null (campanha_id)`. `unique (influenciador_id, url)`.

**`influenciador_seguidores_historico`**
`id`, `influenciador_id`, `marca`, `data date not null`, `seguidores bigint not null check >= 0`, `criado_em`. `unique (influenciador_id, data)`. FK composta como acima.

Índices: `(marca)` em todas; `(influenciador_id)` nas filhas; `(marca, publicada_em)` em mídias; `(marca, data_inicio)` em campanhas.

### 4.2 RLS

- **SELECT** (`to authenticated`): `(select public.gto_eh_admin_ou_gestor()) or public.gto_tem_acesso_marca(marca)`.
- **INSERT/UPDATE/DELETE**: a mesma condição de acesso **e** `(select public.gto_meu_cargo()) in ('Admin','Gestor','Coordenador')` (`using` e `with check` no update). Analista não escreve.
- `gto_tem_acesso_marca` já embute o bloqueio por MFA aal2 (migration 027).
- Triggers: `trg_<tabela>_set_atualizado_em` (`gto_set_atualizado_em`) e `trg_<tabela>_auditoria` (`gto_registrar_auditoria`) em todas as tabelas.

### 4.3 Storage — bucket `influenciadores-avatares`

- **Privado** (o padrão do projeto, `avatars` e `sugestoes-anexos`, é público, mas acesso por marca não é expressável em bucket público). Leitura via `createSignedUrl` (1 h).
- Caminho `{influenciador_id}/avatar.{ext}`. **Não** usar o nome da marca no caminho: tem espaço e acento (`Free Center Calçados`), problemático como chave de objeto.
- Policies em `storage.objects` (SELECT/INSERT/UPDATE/DELETE) validam o influenciador pelo primeiro segmento do caminho: `exists (select 1 from public.influenciadores i where i.id::text = (storage.foldername(name))[1] and public.gto_tem_acesso_marca(i.marca))`; escrita exige também o cargo Admin/Gestor/Coordenador.
- Limites aplicados no bucket: `file_size_limit` 1 MB e `allowed_mime_types` image/jpeg, image/png, image/webp.
- Fluxo de criação: inserir a linha → enviar o arquivo → gravar `avatar_path`.

### 4.4 Verificação SQL

`supabase/checks/20260921_check_influenciadores.sql`, no formato de `20260812_verify_rls_and_cross_brand_access.sql`. Deve provar: (a) usuário da marca A não lê nem escreve dados da marca B; (b) Analista lê e não escreve; (c) FK composta rejeita filho com `marca` divergente do pai; (d) constraints (valor negativo, URL `http://`, cupom exclusivo sem código); (e) policies do bucket.

## 5. Contrato TypeScript (`src/types/influenciadores.ts`)

`RedeSocial`, `StatusInfluenciador`, `FonteMetrica`; interfaces `Influencer`, `Campaign`, `MediaContent`, `FollowerSnapshot` e `Metrics` (agregados calculados, ver §7). Nomes de campo em português espelhando as colunas (`cache_valor`, `publicada_em` ...). O `scripts/check-contracts.mjs` passa a exigir o arquivo, a migration, o arquivo de check e as quatro tabelas.

Limitação assumida: o código do módulo é JS de navegador, então os tipos documentam e são conferidos contra a migration pelo `check-contracts`, mas o compilador não checa o JS.

## 6. Front-end (`public/modules/influenciadores/`)

| Arquivo | Responsabilidade | Depende de |
|---|---|---|
| `index.js` | `initInfluenciadores(deps)` e `renderInfluenciadores()`; estado do módulo (marca, busca, página, selecionados, influenciador aberto), ligação de eventos | todos os demais |
| `service.js` | Leitura das 4 tabelas por marca; criar/editar/excluir influenciador, campanha, mídia, snapshot; upload de avatar e URL assinada | `supabase` injetado |
| `calculos.js` | Funções **puras**: agregados por influenciador, KPIs do mês vs. mês anterior, crescimento semanal, campanhas ativas, formatadores pt-BR | nenhuma |
| `kpi-cards.js` | 4 cards (Investimento Total, Alcance Total Gerado, Engajamento Médio, CPE) | `calculos` |
| `brand-filter-pills.js` | Pílulas de bandeira | filtro de marca do app |
| `influencers-table.js` | Cabeçalho da tabela, busca, checkboxes, avatares, badges de rede, paginação, botão "Novo Influenciador" | `calculos` |
| `influencer-drawer.js` | Painel: cabeçalho, Investimento & Acordos (cachê, voucher, total, cupom com copiar), Campanhas Realizadas, Crescimento Semanal, Mídias Vinculadas, botão "+ Vincular Nova URL" | `growth-chart`, `calculos` |
| `growth-chart.js` | Gráfico SVG (polyline + área + ponto final) a partir dos snapshots | nenhuma |
| `influencer-form-modal.js` | Criar/editar influenciador, campanhas/acordo e upload de avatar | `service` |
| `midia-form-modal.js` | Vincular URL com métricas manuais | `service` |

Convenção dos componentes: cada um exporta funções `xxxHtml(dados, opções) → string` (sempre com `escapeHtml`) e, quando há interação, `bindXxx(raiz, callbacks)`.

### 6.1 Integração no `public/index.html` (mudança mínima)

- Botão de menu `navInfluenciadores` (ícone `group`) **depois de Redes Sociais**, `state.page = "influenciadores"`, título em `pageTitle()`, overlays `influenciadorModal` e `influenciadorMidiaModal`.
- Ramo em `renderContent` que faz `const m = await import("./modules/influenciadores/index.js")` e chama `m.renderInfluenciadores()`. As dependências (`supabase`, `state`, `escapeHtml`, `render`, filtro de marca) são injetadas uma vez por `initInfluenciadores`.
- Bloco de CSS `.inf-*` no `<style>` existente.
- A sidebar e o header do protótipo **não** são recriados.

### 6.2 CSS

Classes Tailwind do protótipo portadas para `.inf-*`, com `#1D4ED8` (primário) e `#1E40AF` (hover) fixos, conforme o protótipo, em vez do `--accent` dinâmico por marca. Reaproveitar `.kpis`, `.card`, `.kpi`, `.kpi-top`, `.kpi-anterior`, `.pills`, `.pill` onde o visual for equivalente. Badges de rede: Instagram (rosa), TikTok (preto), YouTube (vermelho). Breakpoints do protótipo (`lg`, `xl`) traduzidos para `@media` equivalentes; abaixo de `lg` o drawer empilha sob a tabela.

### 6.3 Comportamento

- **Filtro de bandeira:** "Todas as Lojas" + as 3 marcas. Reaproveita o filtro de marca global do app; RLS garante que Coordenador/Analista só vejam a própria marca.
- **Tabela:** 5 linhas por página (como o protótipo); busca por nome, `@handle` ou nicho; linha selecionada abre o drawer e recebe o destaque azul do protótipo; checkbox do cabeçalho seleciona a página.
- **Drawer:** abre ao clicar na linha ou em "Ver Detalhes"; "X" fecha. Sem seleção, mostra estado vazio.
- **Avatar:** URL assinada; sem foto, círculo com iniciais.
- **Permissões na tela:** botões de criar, editar, excluir e vincular só aparecem para Admin/Gestor/Coordenador. O RLS é a barreira real.
- **Cupom:** botão copia via `navigator.clipboard` com feedback.
- **Sub-abas:** as 3 sem layout ficam `disabled` com título "Em breve".
- **Estados:** carregando, vazio ("Nenhum influenciador cadastrado nesta marca") e erro com mensagem amigável (padrão `errorHandling`).

## 7. Cálculo dos indicadores (`calculos.js`)

Mês de referência = mês corrente; "mês anterior" = mês imediatamente anterior. Valores em BRL formatados em pt-BR.

- **Investimento Total** = Σ `investimento_total` das campanhas com `data_inicio` no mês.
- **Alcance Total Gerado** = Σ `alcance` das mídias com `publicada_em` no mês.
- **Interações** = Σ (`curtidas + comentarios + salvos + compartilhamentos`) das mesmas mídias.
- **Engajamento Médio** = Interações ÷ Alcance Total (%).
- **CPE** = Investimento Total ÷ Interações.
- **Variação** = (atual − anterior) ÷ anterior; sem base anterior (0) exibe "—" em vez de infinito.
- **Por influenciador:** Seguidores = último snapshot; Crescimento Semanal (%) = (último − snapshot mais recente com ≥ 7 dias de distância) ÷ esse valor; Campanhas Ativas = `data_inicio ≤ hoje` e (`data_fim` nula ou ≥ hoje); Investimento Total = Σ das campanhas; Alcance = Σ das mídias.
- Divisão por zero retorna "—", nunca `NaN`/`Infinity`.

**Nota:** os números do protótipo eram ilustrativos e não fecham entre si. A tela exibe o que os dados reais calculam.

## 8. Segurança

- Toda interpolação em template string passa por `escapeHtml` (o app já tem a função; o histórico do projeto tem hardening de XSS).
- URLs de mídia: validadas como `https://` no formulário **e** por `check` no banco; links abertos com `target="_blank" rel="noopener noreferrer"`.
- `handle`, cupom e demais campos validados no cliente e no banco; erros do banco traduzidos, sem vazar detalhes internos.
- Upload: tipo e tamanho validados no cliente, reforçados pelo bucket.
- Nenhuma chave nova no front; nenhuma chamada nova a serviço externo.
- Escrita protegida por cargo no banco, não só na UI.

## 9. Testes e verificação

1. `node --test` sobre `calculos.js` (`public/modules/influenciadores/calculos.test.js`): KPIs, mês anterior zerado, divisão por zero, crescimento semanal com snapshots esparsos, campanhas ativas nas bordas, formatação pt-BR.
2. SQL de verificação (§4.4), executado no Supabase **somente após autorização**.
3. `npm run check:contracts` estendido.
4. Verificação no navegador com `npm run dev`: login, navegação, filtro por marca, busca, paginação, abrir/fechar drawer, cadastro, vínculo de URL, upload de avatar, checagem de console (CSP/erros) e visual contra o protótipo em desktop e largura estreita.
5. O `npm run build` e o `esbuild` do repositório estão defasados (o app real não usa build); não fazem parte da verificação.

## 10. Entrega

1. Trabalho no worktree `G:\GTO-Insigths-wt-influenciadores`, branch `feat/modulo-influenciadores`; as alterações não commitadas de `public/index.html` e das Edge Functions do Google na pasta principal não são tocadas.
2. Push da branch → a Vercel gera a URL de **preview** (se a integração com o GitHub estiver ativa; não há `.vercel` local para confirmar).
3. **A migration precisa estar aplicada no Supabase para o preview funcionar**; sem ela a tela abre e mostra erro de carga. A aplicação no banco (compartilhado com produção) só acontece com confirmação explícita. É aditiva (tabelas novas), então não afeta as telas atuais.
4. Merge na `main`, que atualiza `gtoinsights.vercel.app`, só com OK explícito.

## 11. Riscos e pontos em aberto

- **Preview sem migration:** exige o passo de banco acima antes da validação.
- **Entrada manual:** métricas e seguidores dependem de preenchimento humano; a qualidade dos números depende disso. A coluna `fonte` deixa a automação (Collab/Business Discovery) para uma fase futura, condicionada ao App Review da Meta.
- **Um influenciador por marca:** atuar em duas marcas gera dois cadastros.
- **Crescimento semanal** fica em "—" até existirem dois snapshots com ≥ 7 dias de distância.
- **Numeração da migration:** se a branch `fix/meta-ads-...` for mesclada antes, a 038 dela e a 039 deste módulo coexistem sem conflito.
- **`ON DELETE SET NULL (campanha_id)`** em FK composta exige PostgreSQL 15+; o projeto usa a 17.6 (`supabase/.temp/postgres-version`).
