# Setup da API do Google Business Profile — GTO Insights

Checklist de pré-requisitos antes que `google-oauth-start`/`google-oauth-callback`/`google-gbp-sync`/`google-gbp-review-reply`/`google-gbp-location-update` funcionem de ponta a ponta. Nada disso é código — é configuração no lado do Google, feita uma vez.

## 1. Projeto no Google Cloud

- [ ] Criar (ou reaproveitar) um projeto em [console.cloud.google.com](https://console.cloud.google.com/).
- [ ] Habilitar as APIs usadas pela integração: **My Business Account Management API**, **My Business Business Information API**, **Business Profile Performance API**. A gestão de avaliações (`reviews`/`reply`) historicamente vive na **My Business API** legada (v4) — pode aparecer com nome diferente no Console dependendo de quando sua conta foi criada; confirme o nome exato lá.

## 2. Acesso à Business Profile API (aprovação prévia obrigatória)

Diferente de outras APIs do Google Cloud, a Business Profile API **não libera acesso só por habilitar no Console**. É preciso preencher o [formulário de solicitação de acesso](https://developers.google.com/my-business/content/prereqs) explicando o caso de uso (gestão de múltiplas lojas físicas de varejo). A aprovação do Google pode levar dias — é o equivalente ao App Review da Meta que já enfrentamos nesta mesma integração.

- [ ] Preencher o formulário de acesso com a descrição do GTO Insights (multi-marca, gestão de presença local de lojas físicas).
- [ ] Aguardar aprovação antes de tentar autenticar com uma conta de produção.

## 3. Tela de consentimento OAuth

- [ ] Em **APIs e serviços → Tela de consentimento OAuth**, configurar o app (nome, e-mail de suporte, logo).
- [ ] Adicionar o escopo `https://www.googleapis.com/auth/business.manage` — é um escopo **restrito/sensível**, o que pode exigir **verificação de segurança** (CASA/security assessment) do Google antes do app sair do modo de teste e funcionar para contas fora da lista de testadores.
- [ ] Enquanto o app estiver em modo de teste, adicionar manualmente os e-mails do Google que vão autenticar (Admin/Gestor do GTO Insights) na lista de testadores.

## 4. OAuth Client ID

- [ ] Em **APIs e serviços → Credenciais → Criar credenciais → ID do cliente OAuth**, tipo **Aplicativo da Web**.
- [ ] Cadastrar como **URI de redirecionamento autorizado**: `https://ysreenjwihmwzockyrls.supabase.co/functions/v1/google-oauth-callback`.
- [ ] Anotar o **Client ID** e o **Client Secret** gerados.

## 5. Secrets no Supabase

```bash
supabase secrets set GOOGLE_CLIENT_ID=xxxxx.apps.googleusercontent.com --project-ref ysreenjwihmwzockyrls
supabase secrets set GOOGLE_CLIENT_SECRET=xxxxx --project-ref ysreenjwihmwzockyrls
supabase secrets set GOOGLE_REDIRECT_URI=https://ysreenjwihmwzockyrls.supabase.co/functions/v1/google-oauth-callback --project-ref ysreenjwihmwzockyrls
```

`GOOGLE_OAUTH_SCOPES` é opcional (default `https://www.googleapis.com/auth/business.manage`).

## 6. Depois disso

Com os 3 secrets acima configurados e o acesso à Business Profile API aprovado, o fluxo segue o mesmo padrão do Meta: `google-oauth-start` gera a URL de autorização, `google-oauth-callback` recebe o retorno e salva as contas/locais como "a revisar", e `google-gbp-sync` sincroniza avaliações/métricas/fotos das contas confirmadas.

## Observação sobre os endpoints exatos

A API de Business Profile é fragmentada em várias sub-APIs que mudam de tempos em tempos (Account Management, Business Information, Performance, e a gestão de avaliações que ainda vive na API legada v4). O código em `supabase/functions/google-*` foi implementado com o melhor conhecimento disponível no momento, mas os caminhos exatos (principalmente de `reviews`, `reply` e `media`) devem ser conferidos contra a [documentação viva do Google](https://developers.google.com/my-business) antes do primeiro teste real — assim como aconteceu com os nomes de escopo do Meta durante esta mesma sessão de trabalho.
