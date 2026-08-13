---
name: frontend-design
description: Use for any UI work on GTO Insights - refatoracao de tela, novo componente, modal, menu lateral/topbar, ou mudanca de CSS. Cobre a arquitetura real do app (single-file HTML/JS em public/index.html, sem build, sem React) e as convencoes de seguranca/estado ja estabelecidas no projeto.
---

# Frontend GTO Insights

Este projeto tem duas implementacoes de front-end em paralelo. **Antes de tocar em qualquer
tela, confirme qual arquivo voce esta editando de verdade:**

- [`public/index.html`](../../public/index.html) - **o app real**, servido por `npm run dev` e
  publicado no Netlify. HTML/CSS/JS num unico arquivo, sem build, sem JSX. Login, dashboards,
  modais, importacao de CSV e integracoes ficam todos aqui. **E aqui que qualquer refatoracao
  de UI deve acontecer.**
- `src/` (`App.tsx`, `hooks/`, `services/`, `types/`) - scaffold React/Vite paralelo, **nao e o
  que roda em producao nem em `npm run dev`**. So mexa aqui se o pedido for explicitamente sobre
  esse scaffold.
- `netlify-deploy/index.html` - copia espelhada de `public/index.html`, gerada por
  `npm run sync:netlify` (`scripts/sync-netlify-deploy.mjs`). **Nunca edite este arquivo direto**
  - a proxima sincronizacao sobrescreve qualquer mudanca feita nele.

## Fluxo obrigatorio para qualquer mudanca de UI

1. Edita **so** `public/index.html`.
2. Roda `npm run sync:netlify` pra propagar pra `netlify-deploy/index.html`.
3. Roda `npm run check:env` e `npm run check:contracts` (rapidos, pegam regressao de config e
   de views do Supabase referenciadas).
4. Sobe `npm run dev` e testa a tela no navegador (`http://127.0.0.1:5173`) - este projeto nao
   tem teste automatizado de UI, a validacao visual manual e a unica rede de seguranca real.

Sem passo 2, a mudanca nunca chega em producao (o Netlify publica `netlify-deploy/`, nao
`public/`) - foi exatamente esse gap que causou uma leva inteira de fixes de seguranca nunca
chegarem no app real numa sessao anterior.

## Arquitetura da tela (`public/index.html`)

Sem framework: um objeto `state` global, uma funcao `render()` que decide o que mostrar a
partir de `state.page`/`state.session`, e funcoes `renderX()` por tela que fazem
`app.innerHTML = \`...\`` com template literals. Depois de cada `innerHTML`, os handlers de
evento sao religados manualmente (`document.querySelector("#id").onclick = fn` ou
`addEventListener`) - nao ha re-render reativo automatico, quem muda `state` precisa chamar
`render()` (ou a funcao de render local da tela) de novo.

**Menu lateral** (`nav` dentro de `render()`, por volta da linha 1494): um `<button>` por
pagina, classe `active` condicional em `state.page`, `onclick` seta `state.page` e chama
`render()`. Pra adicionar uma pagina nova: novo botao no `<nav>`, nova entrada em `pageTitle()`,
novo `if (state.page === "...")` no fim de `render()` chamando a funcao de render da tela.

**Menu do topbar** (dropdown de perfil): olha `topbarProfileMenuHtml()` e
`wireTopbarProfileMenu()` como referencia - o padrao e `dropdown-menu.topbar-dropdown` com
`state.topbarMenuOpen` controlando visibilidade, `closeTopbarMenu()` fechando ao clicar fora.

**Modais**: um `<div class="modal-overlay" id="xModal" hidden>` reservado no `render()` raiz
(ver linha ~1522), preenchido via `openXModal()`/fechado via `closeXModal()`. Cada modal tem seu
proprio `bindXModalGlobal()` chamado uma vez no carregamento do script, que registra o listener
de tecla Escape com uma flag `xBound` pra nao duplicar o listener em re-renders (ver
`bindProfileModalGlobal()`/`bindSecurityModalGlobal()` como exemplo). Siga esse padrao para
modal novo em vez de inventar outro mecanismo.

## Regras nao-negociaveis (seguranca)

- **Todo texto dinamico inserido em `innerHTML` passa por `escapeHtml()`** - nome de usuario,
  campo de CSV importado, mensagem de erro, secret/URI vindo de uma API, literalmente qualquer
  string que nao seja um literal fixo no proprio template. Um `<img src="${valor}">` sem escapar
  quebra o HTML se `valor` tiver aspas (foi um bug real nesta sessao, no QR code de MFA); um
  campo de usuario sem escapar e XSS armazenado (foi um vuln real, corrigido no commit
  `439573b`). Nao existe excecao "essa fonte e confiavel" - a Supabase API e Edge Functions ja
  contam como fonte nao-confiavel para efeito deste projeto.
- **Erro de API nunca vai cru pra tela.** Use `safeErrorMessage(error, fallback)` (definida perto
  da linha 4529), nunca `error.message` direto - evita vazar detalhes de schema/tabela do
  Postgres pro usuario final.
- Autorizacao (quem pode ver o que) e decidida no banco via RLS, nunca so no front. Esconder um
  botao ou pagina no client e UX, nao seguranca - se a mudanca envolve dado sensivel por marca
  ou cargo, confirme que a policy RLS correspondente ja cobre isso antes de assumir que esconder
  na UI e suficiente.

## CSS

Um unico `<style>` no `<head>`, classes flat (sem CSS-in-JS, sem Tailwind, sem CSS modules).
Cor de destaque via variavel `--accent`/`--accent-rgb` no `:root` (por volta da linha 12) -
reaproveite essa variavel em vez de hardcodar uma cor nova de azul. Olhe classes existentes
proximas do que voce vai construir (`.modal-block`, `.dropdown-menu`, `.mfa-factor-item`, etc.)
antes de criar uma classe nova do zero - o app tem bastante inconsistencia visual acumulada e
cada componente novo que ignora o que ja existe piora isso.

## O que evitar

- Nao introduza React/JSX/build step em `public/index.html` - e deliberadamente um arquivo
  sem build, isso e uma decisao de arquitetura do projeto, nao uma lacuna a preencher.
- Nao edite `netlify-deploy/index.html` a mao.
- Nao crie um novo padrao de state management (Redux, signals, etc.) para uma tela isolada -
  o objeto `state` global existente e o unico que o resto do app entende.
