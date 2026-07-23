# App Review da Meta — GTO Insights BI

Material de apoio para submeter o app `GTO Insigths - Teste` (ou o app de producao equivalente) para **Advanced Access** das permissoes de Pagina, via `developers.facebook.com` → app → **Casos de uso** → "Gerenciar tudo na sua Pagina" → **Enviar para analise**.

## Pre-requisitos antes de submeter

- [ ] **Business Verification** concluida no Business Manager da conta "Som das Galaxias" (Configuracoes de Negocios → Central de seguranca → Verificacao de negocios). Sem isso a Meta recusa o Advanced Access de permissoes de Pagina.
- [ ] **Politica de Privacidade** publicada e com URL publica cadastrada em Configuracoes do app → Basico → Politica de Privacidade.
- [ ] **URL de exclusao de dados** (Data Deletion) cadastrada no mesmo painel — pode ser uma pagina simples explicando como o usuario solicita exclusao dos dados coletados.
- [ ] Testar o caso de uso "Gerenciar tudo na sua Pagina" usando a **Pagina real da Tesoura de Ouro** (nao uma pagina pessoal de teste), para o screencast refletir o uso real.

## Descricao do app (para o formulario)

> O GTO Insights BI e uma plataforma interna de Business Intelligence que consolida metricas de marketing e vendas de multiplas marcas (Tesoura de Ouro, Magazine da Economia, Free Center Calcados) em dashboards unificados. A integracao com a Meta Business API permite que administradores de cada marca conectem suas Paginas do Facebook e contas comerciais do Instagram para importar automaticamente metricas de alcance, engajamento e desempenho de publicacoes, exibidas nos paineis "Redes Sociais" e "Marketing & Canais" da plataforma. O acesso e restrito a usuarios autenticados com papel de Admin ou Gestor de cada marca, e cada conta Meta conectada passa por uma etapa de confirmacao manual antes de qualquer dado ser sincronizado.

## Justificativa por permissao

### `pages_show_list`
> Usado logo apos a autenticacao OAuth para listar as Paginas do Facebook administradas pelo usuario (`GET /me/accounts`). O app exibe essa lista na tela "Conexoes" para que o administrador da marca revise e confirme manualmente quais Paginas pertencem ao negocio antes de qualquer sincronizacao de dados.

### `pages_read_engagement`
> Usado para ler publicacoes recentes das Paginas confirmadas (`GET /{page-id}/feed` e `/{page-id}/posts`) e agregar metricas de reacoes, comentarios e compartilhamentos por publicacao. Esses dados alimentam o ranking de conteudo e o resumo de engajamento exibidos no dashboard "Redes Sociais", usado pelos gestores de marketing de cada marca para decidir quais formatos de post repetir.

### `read_insights`
> Usado para buscar metricas agregadas de desempenho da Pagina (`GET /{page-id}/insights`, metricas `page_views_total`, `page_post_engagements`, `page_total_actions`) nos ultimos 30 dias. Alimenta os KPIs de alcance e engajamento no dashboard geral da marca.

### `business_management`
> Usado para resolver o Gerenciador de Negocios ao qual a Pagina pertence, garantindo que apenas contas dentro do portfolio de negocios autorizado sejam sincronizadas, evitando que dados de Paginas nao relacionadas as marcas do GTO Insights sejam importados por engano.

## Roteiro do screencast

A Meta exige um video mostrando o recurso sendo usado de ponta a ponta, com a Pagina real (nao generica). Sugestao de roteiro (2-4 minutos):

1. Login no GTO Insights BI com um usuario Admin/Gestor.
2. Selecionar a marca "Tesoura de Ouro" no filtro superior.
3. Abrir a aba **Conexoes** no menu lateral — mostrar a tela vazia ou com contas pendentes.
4. Clicar em **Conectar Meta Business** → mostrar a tela de autorizacao da Meta com as permissoes pedidas → autorizar com a conta que administra a Pagina real da Tesoura de Ouro.
5. De volta no app, mostrar a Pagina da Tesoura de Ouro na lista "Contas para revisao" → clicar **Confirmar**.
6. Clicar **Sincronizar** na linha da conta confirmada → mostrar a mensagem de sincronizacao concluida com numeros reais (nao zerados).
7. Navegar ate o dashboard **Redes Sociais** → mostrar os KPIs de alcance/engajamento e o ranking de posts preenchidos com os dados recem-importados da Pagina real.

## Observacoes

- `pages_read_user_content` e os escopos `instagram_basic`/`instagram_manage_insights`/`instagram_business_basic`/`instagram_business_manage_insights` **nao estao configurados** nos Casos de uso deste app hoje — nao devem ser incluidos nesta submissao. Ver limitacao de Instagram documentada no `README.md`.
- Apos a aprovacao, contas ja conectadas antes do Advanced Access continuam funcionando com o mesmo token — nao e necessario reconectar, a permissao passa a valer automaticamente para o app inteiro.
