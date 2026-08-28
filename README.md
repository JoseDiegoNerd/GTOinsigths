# GTO Insights BI

Aplicacao React/Vite preparada para consumir as tabelas Supabase do GTO Insights.

## Estrutura principal

- `public/index.html`: **app real servido em `npm run dev`** — HTML/JS single-file (sem build), consome o Supabase client via CDN (esm.sh). Login, dashboards, importacao de CSV e a tela de Conexoes Meta ficam todos aqui.
- `src/`: scaffold React/Vite paralelo (`App.tsx`, `hooks/`, `services/`, `types/`) — nao e o que roda em `npm run dev` hoje.
- `supabase/`: migrations, fixes e checks SQL.
- `supabase/functions/`: Edge Functions (`meta-oauth-start`, `meta-oauth-callback`, `meta-sync-insights`, `meta-ads-sync`, `google-oauth-start`, `google-oauth-callback`, `google-gbp-sync`, `google-gbp-review-reply`, `google-gbp-location-update`).

## Como rodar localmente

1. Copie `.env.example` para `.env.local`.
2. Instale dependencias:

```bash
npm install
```

3. Rode os checks locais:

```bash
npm run check:env
npm run check:contracts
```

4. Inicie a aplicacao:

```bash
npm run dev
```

5. Abra `http://127.0.0.1:5173`.

## Observacao de seguranca

O front-end envia e filtra a coluna `marca`, mas a autorizacao real acontece no banco via RLS e `public.gto_tem_acesso_marca(marca)`.

MFA (TOTP) e opcional por usuario, com UI de ativacao/desafio em `public/index.html` (menu do usuario → **Seguranca**). A obrigatoriedade tambem e reforcada no banco: `public.gto_aal2_ok()` (migration `20260813_027_enforce_mfa_aal2_rls.sql`) bloqueia `gto_meu_cargo`/`gto_minha_marca`/`gto_tem_acesso_marca` (logo, toda policy RLS do projeto) para sessoes aal1 de usuarios com fator TOTP verificado — sem isso, a tela de desafio no login seria so uma checagem client-side, contornavel com uma requisicao direta a API.

## Integracao Meta Business (organico: Facebook + Instagram)

As Edge Functions `meta-oauth-start`, `meta-oauth-callback` e `meta-sync-insights` (`supabase/functions/`) implementam a conexao com a Graph API. O app tem uma tela dedicada para isso. Escopos pedidos hoje: `pages_show_list`, `pages_read_engagement`, `business_management`, `read_insights`, `instagram_basic`, `instagram_manage_insights`, `ads_read` (este ultimo cobre a integracao de anuncios, ver secao propria abaixo).

### Conectar/testar pela UI

1. Menu lateral → **Conexoes**.
2. Selecione uma marca especifica no filtro (nao pode ser "Todas").
3. Clique em **Conectar Meta Business** → autorize no Facebook → a Meta pode devolver varias Paginas (com Instagram Business vinculado, quando existir) e varias contas de anuncios de uma vez.
4. Na tabela "Contas para revisao", clique **Confirmar** nas Paginas que realmente pertencem a marca (ou **Ignorar** nas que nao pertencem).
5. Clique **Sincronizar** na linha da conta (ou **Sincronizar confirmadas** para todas de uma vez).
6. Resultados aparecem em `stage_social_format_metrics` (granular por post) e `stage_meta_business_analytics` (resumo diario por marca); erros/avisos ficam em `logs_integracao_meta`.

Contas conectadas antes de um ajuste de escopos (ex: quando Instagram ou anuncios foram habilitados) precisam reconectar (botao **Conectar Meta Business**) para o token refletir as permissoes novas — o token antigo simplesmente nao tem a permissao nova, mesmo que a conta ja esteja confirmada.

### Acesso a Paginas/contas de terceiros (erro Graph API `#10`)

O App da Meta em modo Development so le dados de Paginas e contas de anuncios administradas por quem tem role (Admin/Developer/Tester) dentro do proprio app, ou que estejam no mesmo Business Manager vinculado ao app (**Configuracoes do app → API de Marketing → Gerenciador de Negocios**). Para ler Paginas/contas de clientes que nao vao virar testers:

1. Em [developers.facebook.com](https://developers.facebook.com) → app do `META_APP_ID` → **App Review**, solicitar *Advanced Access* para: `pages_read_engagement`, `pages_show_list`, `read_insights`, `business_management` (justificativa pronta e roteiro de screencast em [`docs/meta-app-review.md`](docs/meta-app-review.md)).
2. Pre-requisitos do review: Business Verification no Meta Business Manager, Politica de Privacidade publicada, video demonstrando o caso de uso.
3. Mesmo aprovado, o dono de cada Pagina/conta de anuncios de cliente precisa conceder acesso ao Business Portfolio do app (Business Settings → Pages/Ad Accounts → Add), ou aceitar convite de parceiro.
4. Alternativa rapida so para teste: adicionar a conta do Facebook que administra a Pagina como Tester em *App roles → Roles* — nao escala para paginas/contas de terceiros.

### Metricas de descoberta e retencao (Instagram/Facebook)

Alem de alcance e engajamento, o sync tambem traz:

- **Reels do Instagram**: `tempo_medio_visualizacao` (`ig_reels_avg_watch_time`, convertido de ms para segundos) e `taxa_rejeicao_inicial`/skip rate (`reels_skip_rate`). So sao pedidas para posts do tipo Reels — pedir para outros formatos derruba a chamada com erro `#100`.
- **Todo post do Instagram**: `visitas_perfil` (`profile_visits`) e `seguidores_conquistados` (`follows`) — mede quando aquele post especifico levou alguem a visitar o perfil ou seguir a conta (o sinal de "descoberta" que o app ja rotula os Reels com, mas que so passou a ser medido nessa integracao).
- **Seguidores do Facebook** (`seguidores_facebook` em `stage_meta_business_analytics`, via `fan_count` da Pagina) — pareado com `seguidores_instagram`, que ja existia.

### Limitacoes conhecidas

- A Graph API descontinuou as metricas classicas de impressoes por post e por pagina (`post_impressions`, `page_impressions`, etc. → erro `#100`) e, desde 15/jun/2026, tambem o Post/Page Reach classico em todas as versoes da API (substituido pela familia "media views" / Page Viewer). O app usa `post_total_media_view_unique` (por post) e `page_total_media_view_unique` com fallback para `page_views_total` (resumo da pagina) — ajustado em [supabase/functions/meta-sync-insights/index.ts](supabase/functions/meta-sync-insights/index.ts). Cliques por post continuam sem substituto na API. Engajamento por post usa `reactions + comments + shares`; o resumo da pagina tambem usa `page_post_engagements` e `page_total_actions`. Versao padrao da Graph API bumped para `v25.0` em [supabase/functions/_shared/meta.ts](supabase/functions/_shared/meta.ts) (pode ser sobrescrita pelo secret `META_GRAPH_VERSION`).
- O App da Meta usa o modelo de "Casos de uso" (Business Login) em vez de scopes livres: so e possivel pedir permissoes que estejam configuradas em algum Caso de uso do app (`developers.facebook.com` → app → **Casos de uso**). O produto "Graph API do Instagram" (classico, via Facebook Login) e o "API de Marketing" precisam estar adicionados como produtos do app para os escopos `instagram_basic`/`instagram_manage_insights` e `ads_read` funcionarem.
- **Stories** (Instagram e Facebook) praticamente nunca aparecem: a API so retorna Stories enquanto ativas (24h), e o sync roda em janela diaria — a maioria expira antes de ser capturada. Rodar o sync com mais frequencia reduziria a perda, mas nunca chega a 100%.
- **Retencao de video do Facebook** (Reels/videos da Pagina) fica em endpoint separado (`/video_insights` no ID do video, nao do post) — nao implementado ainda; `retencao_qualificada_5s` do Facebook continua fixo em `0`.
- **Tempo de resposta a comentarios** (`tempo_resposta_comentarios_horas`) nao e calculado — precisaria de uma chamada extra por post para listar comentarios com `from`/`created_time` e distinguir resposta da Pagina vs. comentario de cliente; nao implementado para nao arriscar timeout na sincronizacao.

## Integracao Meta Ads (Marketing API)

Sistema separado da integracao organica acima (API diferente, mesmo padrao de revisao manual antes de sincronizar). Tabelas: `integracao_meta_ads_contas` (contas de anuncios descobertas, revisao por marca) e `stage_meta_ads_metrics` (metricas por campanha). Edge Function: `meta-ads-sync`.

### Conectar/testar pela UI

1. Pre-requisito: produto **"API de Marketing"** adicionado ao app (`developers.facebook.com` → app → **Configuracoes do app** → **API de Marketing** → **Configurar**) e vinculado ao Business Manager das contas de anuncios (mesmo card, campo "Gerenciador de Negocios").
2. Menu lateral → **Conexoes** → selecione a marca → **Conectar Meta Business** (o mesmo botao/fluxo da integracao organica; `ads_read` ja esta no escopo padrao). Contas ja conectadas antes disso precisam reconectar.
3. A Meta pode devolver varias contas de anuncios do mesmo Business Manager de uma vez (ex: contas antigas, de teste, de outras marcas do grupo) — a secao **"Contas de anuncios para revisao"** (abaixo da tabela de Paginas, na mesma tela de Conexoes) funciona igual: **Confirmar** so a conta correta pra marca selecionada, **Ignorar** o resto.
4. Clique **Sincronizar anuncios confirmados** (ou **Sincronizar** na linha da conta).
5. Resultados aparecem na nova tela **Anuncios** (menu lateral): investimento, alcance, impressoes, cliques, CPM/CPC/CTR medios e uma tabela por campanha.

### Como funciona a sincronizacao

- Nivel **campanha** apenas (nao ha ainda breakdown por conjunto de anuncios ou anuncio individual).
- Janela **rolante de 30 dias** (`date_preset: last_30d`) — cada sincronizacao sobrescreve a linha daquela campanha com o acumulado dos ultimos 30 dias, nao e uma serie historica dia a dia.
- `status`/periodo da campanha vem de uma chamada separada e **paginada** a `/{ad_account_id}/campaigns?fields=id,effective_status,start_time,stop_time` (campanhas referenciadas pelos insights mas ausentes dessa listagem — arquivadas etc. — sao buscadas por id em lotes de 50), combinada com o resultado de `/insights` pelo `campaign_id`. `effective_status` (nao `status`) vira a coluna `status`; `start_time`/`stop_time` viram `campanha_inicio`/`campanha_fim` (migration `20260828_038_meta_ads_periodo_campanha.sql`). Ao fim de cada sync o `meta-ads-sync` **restampa** `status`/periodo em todas as linhas historicas de cada campanha conhecida, para que uma campanha encerrada/pausada depois da ultima entrega nao fique congelada como "Ativa" no banco.
- Na tela **Anuncios**, o filtro "Ativas" (e o badge de status da tabela) considera campanha ativa quando `effective_status == ACTIVE`, a data de hoje esta dentro de `[campanha_inicio, campanha_fim]` (quando ha `stop_time`) e houve entrega (impressoes/gasto) na janela de data selecionada. A tabela mostra **Data de Inicio** e **Data de Termino** (`Continuo` quando nao ha `stop_time`).
- Metricas: `spend`, `impressions`, `reach`, `clicks`, `inline_link_clicks`, `cpm`, `cpc`, `ctr`, `frequency`. O payload bruto de cada linha (incluindo `actions`, quando presentes) fica salvo em `payload_bruto` para uso futuro.

### Limitacoes conhecidas

- **Conversoes/resultados nao sao interpretados.** A API devolve um array `actions` heterogeneo (leads, compras, etc.) cujo campo relevante depende do objetivo da campanha — decidir qual `action_type` vira "resultado" e "custo por resultado" foi deixado de fora deste primeiro corte para nao mostrar um numero errado; o dado bruto ja esta salvo em `payload_bruto` para quando isso for priorizado.
- **Marketing API Access Tier "Limited"** enquanto o app estiver em modo Development e sem App Review para Marketing API — funciona para contas onde o usuario logado e admin (como as 3 marcas hoje), mas nao escala para contas de clientes fora do Business Manager do app sem o mesmo processo de Advanced Access da secao anterior.
- **Uma conta de anuncios pode ter campanhas de mais de uma marca** (ex: um Business Manager compartilhado historicamente rodou trafego pago pra links de marcas diferentes na mesma conta) — a sincronizacao atribui todas as campanhas daquela conta a marca que a confirmou; nao ha filtro automatico por campanha.

## Integracao Google Business Profile

Backend pronto (migration + 5 Edge Functions), sem UI ainda — o frontend consumidor sera construido a parte. Segue o mesmo padrao da integracao Meta: OAuth com revisao manual de contas antes de sincronizar, tabelas `integracao_google_*` por marca com RLS, e log de eventos em `logs_integracao_google`.

- `google-oauth-start` / `google-oauth-callback`: fluxo OAuth2 com `access_type=offline&prompt=consent` (garante `refresh_token`), lista contas e locais via Account Management / Business Information API, salva com `conta_confirmada: false` (revisao manual).
- `google-gbp-sync`: sincroniza avaliacoes, metricas diarias de performance e fotos das contas confirmadas; atualiza `stage_google_business_profile` (tabela legada que ja alimenta o dashboard "Marketing & Canais").
- `google-gbp-review-reply`: responde ou apaga resposta de uma avaliacao (`action: 'reply'|'delete'`) — liberado para Admin/Gestor/Coordenador/Analista.
- `google-gbp-location-update`: atualiza telefone, descricao e horarios (regular/especial) de uma loja — restrito a Admin/Gestor/Coordenador.

**Pre-requisito obrigatorio antes de qualquer teste real:** a API do Google exige projeto no Google Cloud, tela de consentimento OAuth e aprovacao previa de acesso a Business Profile API (processo parecido com o App Review da Meta). Checklist completo em [`docs/google-business-api-setup.md`](docs/google-business-api-setup.md).

### Limitacoes conhecidas

- Nenhum endpoint foi testado contra a API real do Google ainda (bloqueado pelo pre-requisito acima) — os caminhos exatos de `reviews`/`reply`/`media`/metricas de performance foram implementados com o melhor conhecimento disponivel e estao marcados no codigo para verificacao contra a documentacao viva do Google.
- Distincao entre foto enviada pelo proprietario vs. por cliente em `integracao_google_fotos.origem` e um best-effort (a API nao expoe isso de forma direta e confiavel para todo item) — conferir ao testar com dados reais.
- Nao existe cargo "Social Media" no enum `cargo_usuario` — `Analista` faz esse papel (responde/apaga resposta de avaliacao, nao edita cadastro).
