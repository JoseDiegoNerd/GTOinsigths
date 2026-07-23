# GTO Insights BI

Aplicacao React/Vite preparada para consumir as tabelas Supabase do GTO Insights.

## Estrutura principal

- `public/index.html`: **app real servido em `npm run dev`** — HTML/JS single-file (sem build), consome o Supabase client via CDN (esm.sh). Login, dashboards, importacao de CSV e a tela de Conexoes Meta ficam todos aqui.
- `src/`: scaffold React/Vite paralelo (`App.tsx`, `hooks/`, `services/`, `types/`) — nao e o que roda em `npm run dev` hoje.
- `supabase/`: migrations, fixes e checks SQL.
- `supabase/functions/`: Edge Functions (`meta-oauth-start`, `meta-oauth-callback`, `meta-sync-insights`, `google-oauth-start`, `google-oauth-callback`, `google-gbp-sync`, `google-gbp-review-reply`, `google-gbp-location-update`).

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

## Integracao Meta Business

As Edge Functions `meta-oauth-start`, `meta-oauth-callback` e `meta-sync-insights` (`supabase/functions/`) implementam a conexao com a Graph API. O app tem uma tela dedicada para isso.

### Conectar/testar pela UI

1. Menu lateral → **Conexoes**.
2. Selecione uma marca especifica no filtro (nao pode ser "Todas").
3. Clique em **Conectar Meta Business** → autorize no Facebook → a Meta pode devolver varias Paginas de uma vez.
4. Na tabela "Contas para revisao", clique **Confirmar** nas Paginas que realmente pertencem a marca (ou **Ignorar** nas que nao pertencem).
5. Clique **Sincronizar** na linha da conta (ou **Sincronizar confirmadas** para todas de uma vez).
6. Resultados aparecem em `stage_social_format_metrics` e `stage_meta_business_analytics`; erros/avisos ficam em `logs_integracao_meta`.

### Acesso a Paginas de terceiros (erro Graph API `#10`)

O App da Meta em modo Development so le dados de Paginas administradas por quem tem role (Admin/Developer/Tester) dentro do proprio app. Para ler Paginas de clientes que nao vao virar testers:

1. Em [developers.facebook.com](https://developers.facebook.com) → app do `META_APP_ID` → **App Review**, solicitar *Advanced Access* para: `pages_read_engagement`, `pages_show_list`, `read_insights`, `business_management` (justificativa pronta e roteiro de screencast em [`docs/meta-app-review.md`](docs/meta-app-review.md)).
2. Pre-requisitos do review: Business Verification no Meta Business Manager, Politica de Privacidade publicada, video demonstrando o caso de uso.
3. Mesmo aprovado, o dono de cada Pagina de cliente precisa conceder acesso ao Business Portfolio do app (Business Settings → Pages → Add), ou aceitar convite de parceiro.
4. Alternativa rapida so para teste: adicionar a conta do Facebook que administra a Pagina como Tester em *App roles → Roles* — nao escala para paginas de terceiros.

### Limitacoes conhecidas

- A Graph API descontinuou as metricas classicas de alcance/impressoes por post e por pagina (`post_impressions`, `page_impressions`, etc. → erro `#100`). O engajamento por post usa `reactions + comments + shares`; o resumo da pagina usa `page_views_total`, `page_post_engagements`, `page_total_actions`.
- `seguidores_instagram` em `stage_meta_business_analytics` ainda fica fixo em `0` (nao implementado).
- O App da Meta usa o modelo de "Casos de uso" (Business Login) em vez de scopes livres: so e possivel pedir permissoes que estejam configuradas em algum Caso de uso do app (`developers.facebook.com` → app → **Casos de uso**).
- **Instagram desativado no OAuth por enquanto.** O caso de uso "Gerenciar mensagens e conteudo no Instagram" configurado nesse app e do produto *Instagram API with Instagram Login* (login nativo via instagram.com), incompativel com o fluxo Facebook Login que `meta-oauth-start` usa (`facebook.com/dialog/oauth`) — pedir `instagram_basic`/`instagram_manage_insights` ou `instagram_business_basic`/`instagram_business_manage_insights` por esse fluxo retorna `Invalid Scopes`. Para reativar, e preciso configurar o produto "Instagram Graph API" classico (via Facebook Login) nos Casos de uso do app, ou implementar o fluxo de Instagram Login separado.
- Contas conectadas antes de qualquer ajuste de scopes devem reconectar (botao **Conectar Meta Business**) para o token refletir as permissoes atuais.

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
