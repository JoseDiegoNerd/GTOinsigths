# Sincronização automática de perfil (Instagram) — Design

Data: 2026-09-22 · Branch: `feat/modulo-influenciadores`

## 1. Objetivo

Eliminar o preenchimento manual de foto, quantidade de seguidores e total de publicações dos influenciadores com Instagram, buscando esses dados diretamente na Instagram Business Discovery API, usando o token já conectado da marca. Substitui parte do fluxo manual descrito na spec original do módulo (`2026-09-21-modulo-influenciadores-design.md`, §11: "métricas e seguidores dependem de preenchimento humano... automação... fase futura"). Esta é essa fase futura, restrita a Instagram.

## 2. Contexto e restrições descobertas

- O app já tem integração Meta (`meta-oauth-start`, `meta-oauth-callback`, `meta-sync-insights`), com o escopo `instagram_basic` já concedido — exatamente o que a Business Discovery exige.
- Business Discovery consulta dados **públicos** de contas Instagram **Business/Creator** de terceiros (foto, seguidores, total de posts) sem o dono autorizar nada — mas só funciona se o influenciador tiver conta Business/Creator pública, e só se a marca já tiver Instagram conectado e confirmado em `integracao_meta_contas` (`ativo = true`, `instagram_business_account_id` preenchido).
- Business Discovery **não** expõe métricas privadas de posts de terceiros (views, salvos, compartilhamentos) — só o dono da conta vê isso. Por isso as métricas de cada mídia vinculada (`influenciador_midias`) continuam manuais; só o **perfil** (foto, seguidores, total de posts) é automatizado.
- A imagem de perfil do Instagram não pode ser referenciada direto no front (CSP só libera `img-src` do próprio Supabase) — precisa ser baixada no servidor e reenviada ao bucket `influenciadores-avatares` já existente.
- O projeto já tem um padrão pronto de rotina agendada: `pg_cron` + `pg_net.http_post` chamando a Edge Function com um segredo (`x-cron-secret`) guardado no Supabase Vault (ver `20260802_014_schedule_meta_sync_daily.sql`). A função nova replica esse padrão.
- Helpers compartilhados já existentes (`supabase/functions/_shared/meta.ts`): `withCors`, `jsonResponse`, `getAdminClient`, `getAuthenticatedUser`, `assertAal2`, `getGraphVersion`, `metaGet`, `safeErrorMessage`, `logMetaEvent` — a função nova reaproveita tudo isso.
- TikTok e YouTube ficam fora de escopo (decisão do usuário): TikTok não tem uma API pública equivalente à Business Discovery para conta de terceiro sem login do dono.

## 3. Decisões aprovadas

| Tema | Decisão |
|---|---|
| Escopo de redes | Só Instagram nesta etapa |
| Dado sincronizado | Foto, seguidores, total de publicações (`media_count`) — não métricas de post individual |
| Gatilho | Botão "Sincronizar" (sob demanda) + rotina diária automática (cron) |
| Falha | Cai para os campos manuais existentes, com mensagem de erro clara — nunca bloqueia |
| Upload manual | Continua existindo no formulário de criação/edição, como está hoje |

**Fora de escopo:** TikTok/YouTube; sincronizar métricas de posts individuais (views/curtidas/salvos continuam manuais); qualquer scraping não-oficial fora da API pública da Meta.

## 4. Banco de dados (`supabase/migrations/20260923_041_influenciadores_instagram_sync.sql`)

Aditiva, sem alterar tabelas/policies existentes.

**`influenciadores` ganha 3 colunas:**
- `publicacoes_total bigint` — de `media_count`.
- `instagram_sincronizado_em timestamptz` — quando a última sincronização deu certo.
- `instagram_sync_erro text` — mensagem do último erro; `null` quando a última tentativa deu certo.

**`influenciador_seguidores_historico` não muda.** A sincronização usa o mesmo `upsert` por `(influenciador_id, data)` que `service.js` já usa em `registrarSeguidores` — se a automática rodar depois de um registro manual do mesmo dia, sobrescreve com o valor oficial.

**Elegibilidade:** `rede_social = 'Instagram'` **e** a marca ter linha ativa em `integracao_meta_contas` com `instagram_business_account_id` preenchido.

## 5. Edge Function (`supabase/functions/influenciador-instagram-sync/index.ts`)

Dois modos de invocação:
1. **Sob demanda** (usuário autenticado, botão): corpo `{ influenciador_id }`. Autentica via `getAuthenticatedUser`/`assertAal2` (padrão já usado nas outras funções); confirma que o usuário tem acesso de escrita ao influenciador (mesma regra de RLS/cargo das policies do banco — a função usa o client autenticado do próprio usuário para a leitura/escrita em `influenciadores`, deixando o RLS decidir, e só usa o client admin para operações que exigem `service_role` como o upload no Storage e a leitura de `access_token` em `integracao_meta_contas`, que tem RLS restrito).
2. **Rotina diária** (cron, sem usuário): sem corpo; autentica via header `x-cron-secret` contra o segredo no Vault (`influenciador_instagram_sync_cron_secret`), roda para todos os influenciadores elegíveis de todas as marcas, usando o client `service_role`.

**Por influenciador:**
1. Pula se `rede_social !== 'Instagram'`.
2. Busca a conta da marca em `integracao_meta_contas` (`ativo = true`, `instagram_business_account_id` não nulo). Sem isso: grava `instagram_sync_erro = "Conecte o Instagram da marca em Conexões antes de sincronizar."` e segue para o próximo (modo lote) ou retorna erro (modo botão).
3. Chama `GET /{instagram_business_account_id}?fields=business_discovery.username({handle_sem_arroba}){followers_count,media_count,profile_picture_url}` via `metaGet`.
4. Sem resultado (conta pessoal, @ não encontrado): `instagram_sync_erro = "Não foi possível sincronizar — verifique se @<handle> é uma conta Business/Creator pública do Instagram."`, segue.
5. Com resultado: baixa `profile_picture_url` (fetch server-side, sem CSP), sobe para `influenciadores-avatares` no path já usado (`{influenciador_id}/avatar`), atualiza `avatar_path`, `publicacoes_total`, `instagram_sincronizado_em = now()`, `instagram_sync_erro = null`; faz upsert do snapshot de seguidores do dia.
6. Erros de download de foto não apagam o avatar anterior — só marcam erro e mantêm o que já havia.
7. No modo lote, um erro num influenciador não interrompe os demais (try/catch por item).

**Migration da rotina (mesmo arquivo ou complementar):** `cron.schedule('influenciador-instagram-sync-daily', '0 10 * * *', ...)` chamando a função via `net.http_post` com o segredo do Vault, no mesmo formato de `20260802_014`.

## 6. Frontend

- `service.js` ganha `sincronizarInstagram(influenciadorId)`, chamando `supabase.functions.invoke('influenciador-instagram-sync', { body: { influenciador_id: influenciadorId } })`, com erro traduzido pela mesma disciplina de `traduzirErro`/`safeErrorMessage` já usada.
- `influencer-drawer.js` ganha: botão "Sincronizar com Instagram" (só quando `rede_social === 'Instagram'`); texto de status ("Sincronizado há X" ou a mensagem de erro); `publicacoes_total` exibido perto do cabeçalho (nome/handle/foto), ao lado de seguidores.
- `index.js` liga o botão: chama o service, mostra "Sincronizando…" no botão enquanto espera, recarrega (`carregar()`) ao terminar.
- O formulário de criação/edição (`influencer-form-modal.js`) **não muda** — upload manual continua como está.

## 7. Testes

- `service.js`: teste unitário de `sincronizarInstagram` com o cliente Supabase falso já usado no resto da suíte (`node --test`).
- Formatação nova (ex.: "Sincronizado há X") em `calculos.js`, testada isoladamente.
- Edge Function: **sem teste automatizado**, mesma convenção já estabelecida por todas as Edge Functions existentes no projeto (nenhuma tem testes hoje) — verificação manual contra a API real.
- Migration: Seção A (estática) + Seção B (funcional, com rollback), aplicada em produção só com aprovação explícita do usuário, mesma disciplina das migrations anteriores deste módulo.

## 8. Riscos e pontos em aberto

- **Cobertura parcial:** só influenciadores com conta Instagram Business/Creator pública se beneficiam; conta pessoal continua manual, sem alternativa.
- **Rate limit da Graph API:** a rotina diária em lote pode esbarrar em limite de taxa se o número de influenciadores crescer muito; não há throttling nesta primeira versão (YAGNI) — se necessário, vira um ajuste futuro.
- **Sem log histórico de sincronização:** só o último erro/sucesso fica salvo na própria linha do influenciador, sem uma tabela de histórico de tentativas — decisão consciente para manter o escopo simples; pode virar um refinamento futuro se for necessário auditar tentativas passadas.
