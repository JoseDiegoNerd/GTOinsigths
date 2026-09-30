# Sincronização Automática de Perfil (Instagram) — Plano de Implementação

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: usar superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para executar este plano tarefa por tarefa. Os passos usam checkbox (`- [ ]`) para acompanhamento.

**Objetivo:** Buscar automaticamente foto, quantidade de seguidores e total de publicações de influenciadores com Instagram, via Instagram Business Discovery API, com fallback manual em qualquer falha.

**Arquitetura:** Uma Edge Function nova (`influenciador-instagram-sync`) reaproveita os helpers já existentes em `supabase/functions/_shared/meta.ts`/`_shared/users.ts`, chamada sob demanda (botão) ou por uma rotina diária (`pg_cron` + `pg_net`, mesmo padrão já usado por `meta-sync-insights`). O front ganha uma função de service, formatação de "sincronizado há X" e um botão no drawer.

**Tech Stack:** Deno (Edge Functions, já existente no projeto), PostgreSQL 17 + `pg_cron`/`pg_net`, JavaScript ES modules (front-end, sem build), `node --test`.

**Spec:** `docs/superpowers/specs/2026-09-22-instagram-auto-sync-influenciadores-design.md`

## Global Constraints

- Escopo: só Instagram. TikTok/YouTube continuam manuais (fora de escopo).
- Só o **perfil** é automatizado (foto, seguidores, `publicacoes_total`). Métricas de cada mídia vinculada (views/curtidas/comentários/salvos/compartilhamentos) continuam manuais — a Business Discovery não expõe isso para conta de terceiro.
- Qualquer falha cai para os campos manuais existentes, com mensagem clara — nunca bloqueia o cadastro nem apaga dado que já existia (ex.: falha ao baixar a foto nova não apaga a foto anterior).
- RLS é a barreira real de permissão: a Edge Function usa o client autenticado do próprio usuário (JWT do chamador) para ler/escrever `influenciadores`, deixando a policy de escrita (migration `20260922_040`, cargo + `gto_tem_acesso_marca`) decidir quem pode sincronizar o quê. O client `service_role` só é usado para o que exige privilégio elevado: ler `access_token` de `integracao_meta_contas` e subir a foto no Storage.
- Nenhuma Edge Function existente no projeto tem teste automatizado — esta também não terá; verificação é manual, documentada na Task 6.
- Migration aditiva; aplicar em produção e configurar segredos só com aprovação explícita do usuário (Task 5).
- Idioma: comentários em TS/JS podem ter acento; identificadores em português; mensagens de erro voltadas ao usuário final em pt-BR, sem vazar detalhe técnico (usar `safeErrorMessage`/`traduzirErro` já existentes).
- Commits terminam com `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.
- Trabalho no worktree `G:\GTO Insigths\.worktrees\influenciadores`, branch `feat/modulo-influenciadores`.

---

## Estrutura de arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `supabase/migrations/20260923_041_influenciadores_instagram_sync.sql` | criar | 3 colunas novas em `influenciadores`, agendamento do cron diário |
| `supabase/checks/20260923_check_influenciadores_instagram_sync.sql` | criar | Verificação estática + funcional (rollback) |
| `supabase/functions/_shared/meta.ts` | modificar | Nova função `metaBusinessDiscovery` |
| `supabase/functions/influenciador-instagram-sync/index.ts` | criar | Edge Function (2 modos: botão / cron) |
| `public/modules/influenciadores/service.js` | modificar | `sincronizarInstagram(influenciadorId)` |
| `public/modules/influenciadores/calculos.js` | modificar | `formatSincronizadoEm(timestamp, agora)` |
| `public/modules/influenciadores/influencer-drawer.js` | modificar | Botão "Sincronizar com Instagram", status, `publicacoes_total` |
| `public/modules/influenciadores/index.js` | modificar | Liga o botão de sincronizar ao service |
| `tests/influenciadores/service.test.js` | modificar | Teste de `sincronizarInstagram` |
| `tests/influenciadores/calculos.test.js` | modificar | Teste de `formatSincronizadoEm` |
| `tests/influenciadores/tabela-drawer.test.js` | modificar | Teste do botão/status/publicações no drawer |

---

### Task 1: Migration e verificação SQL

**Files:**
- Create: `supabase/migrations/20260923_041_influenciadores_instagram_sync.sql`
- Create: `supabase/checks/20260923_check_influenciadores_instagram_sync.sql`

**Interfaces:**
- Produces: colunas `public.influenciadores.publicacoes_total` (`bigint`), `public.influenciadores.instagram_sincronizado_em` (`timestamptz`), `public.influenciadores.instagram_sync_erro` (`text`). Job `cron.schedule('influenciador-instagram-sync-daily', ...)`.

Esta task não tem teste automatizado (é SQL contra Postgres real). A verificação real roda na Task 5, após aprovação do usuário. Aqui a disciplina é revisar linha a linha contra o padrão de `20260802_014_schedule_meta_sync_daily.sql` e `20260922_040_influenciadores_acesso_amplo.sql` (já neste mesmo worktree).

- [ ] **Step 1: Criar a migration**

Criar `supabase/migrations/20260923_041_influenciadores_instagram_sync.sql`:

```sql
-- GTO Insights - Sincronizacao automatica de perfil via Instagram Business Discovery.
-- Scope: 3 colunas novas em influenciadores (foto/seguidores continuam em avatar_path e
-- influenciador_seguidores_historico, ja existentes - aqui so o que faltava: total de posts e
-- status da ultima sincronizacao) + agendamento da rotina diaria.
--
-- publicacoes_total: media_count devolvido pela Business Discovery.
-- instagram_sincronizado_em: quando a ultima sincronizacao deu certo (null = nunca sincronizou).
-- instagram_sync_erro: mensagem do ultimo erro; null quando a ultima tentativa deu certo.
--
-- Safe to run multiple times.

begin;

alter table public.influenciadores
  add column if not exists publicacoes_total bigint,
  add column if not exists instagram_sincronizado_em timestamptz,
  add column if not exists instagram_sync_erro text;

alter table public.influenciadores
  drop constraint if exists influenciadores_publicacoes_total_chk;
alter table public.influenciadores
  add constraint influenciadores_publicacoes_total_chk check (publicacoes_total is null or publicacoes_total >= 0);

comment on column public.influenciadores.publicacoes_total is 'Total de posts do perfil (media_count da Business Discovery). Null se nunca sincronizado.';
comment on column public.influenciadores.instagram_sincronizado_em is 'Timestamp da ultima sincronizacao com sucesso via influenciador-instagram-sync.';
comment on column public.influenciadores.instagram_sync_erro is 'Mensagem do ultimo erro de sincronizacao (null quando a ultima tentativa deu certo).';

-- Rotina diaria: chama a Edge Function em modo lote (sem influenciador_id no corpo), autenticada
-- pelo segredo em x-cron-secret. O valor do segredo NUNCA fica neste arquivo nem em git - precisa
-- ser inserido manualmente no Vault (supabase_vault) com o nome exato abaixo, e o mesmo valor
-- configurado como Edge Function secret (INSTAGRAM_SYNC_CRON_SECRET). Ver Task 5 do plano de
-- implementacao para o passo a passo exato.
-- Roda as 10:00 UTC = 07:00 America/Sao_Paulo diariamente (1h depois do sync de Meta da marca,
-- para nao competir por rate limit do mesmo App Meta no mesmo minuto).
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'influenciador-instagram-sync-daily',
  '0 10 * * *',
  $$
  select net.http_post(
    url := 'https://ysreenjwihmwzockyrls.supabase.co/functions/v1/influenciador-instagram-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'influenciador_instagram_sync_cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);

commit;
```

- [ ] **Step 2: Criar o SQL de verificação**

Criar `supabase/checks/20260923_check_influenciadores_instagram_sync.sql`:

```sql
-- GTO Insights - Verificacao da migration 041 (colunas de sincronizacao Instagram + cron).
-- Rode no SQL Editor (role postgres), DEPOIS de aplicar 20260923_041_influenciadores_instagram_sync.sql.
--
-- SECAO A (estatica): rode sozinha. Toda linha deve terminar em 'ok'.
-- SECAO B (funcional): rode sozinha. Ela TERMINA PROPOSITALMENTE COM UM ERRO cujo texto e o
--   relatorio; esse erro e o rollback dos dados de teste (nada fica gravado).

-- ==================================== SECAO A ====================================
select 'coluna existe' as teste, column_name::text as objeto,
  case when count(*) = 1 then 'ok' else 'FALHA' end as resultado
from information_schema.columns
where table_schema = 'public' and table_name = 'influenciadores'
  and column_name in ('publicacoes_total', 'instagram_sincronizado_em', 'instagram_sync_erro')
group by column_name
union all
select 'cron job agendado', 'influenciador-instagram-sync-daily',
  case when count(*) = 1 then 'ok' else 'FALHA: ' || count(*) end
from cron.job
where jobname = 'influenciador-instagram-sync-daily'
order by 1, 2;

-- ==================================== SECAO B ====================================
-- Confirma que a constraint de nao-negativo funciona e que as colunas aceitam null (estado
-- inicial "nunca sincronizado"). Nao depende de nenhum usuario de teste - roda sempre.
do $$
declare
  v_marca public.bandeira_marca;
  v_inf uuid;
  v_res text[] := array[]::text[];
begin
  select m into v_marca from unnest(enum_range(null::public.bandeira_marca)) m limit 1;

  insert into public.influenciadores (marca, nome, handle, rede_social)
  values (v_marca, 'Fixture Sync', '@fixture_sync_041_rls', 'Instagram') returning id into v_inf;

  if (select publicacoes_total is null and instagram_sincronizado_em is null and instagram_sync_erro is null
      from public.influenciadores where id = v_inf) then
    v_res := v_res || 'ok T0: colunas nascem nulas (nunca sincronizado)'::text;
  else
    v_res := v_res || 'FALHA T0: colunas novas nao nasceram nulas'::text;
  end if;

  begin
    update public.influenciadores set publicacoes_total = -1 where id = v_inf;
    v_res := v_res || 'FALHA T1: publicacoes_total negativo foi aceito'::text;
  exception
    when check_violation then v_res := v_res || 'ok T1: publicacoes_total negativo rejeitado'::text;
    when others then v_res := v_res || 'FALHA T1: erro inesperado '::text || sqlstate::text;
  end;

  begin
    update public.influenciadores
    set publicacoes_total = 342, instagram_sincronizado_em = now(), instagram_sync_erro = null
    where id = v_inf;
    v_res := v_res || 'ok T2: colunas aceitam valores validos'::text;
  exception when others then
    v_res := v_res || 'FALHA T2: erro inesperado '::text || sqlstate::text;
  end;

  -- O erro abaixo desfaz a fixture (a instrucao DO e atomica).
  raise exception E'RELATORIO (este erro e o rollback dos dados de teste)\n%', array_to_string(v_res, E'\n');
end
$$;
```

- [ ] **Step 3: Revisão estática do SQL**

Conferir manualmente: as 3 colunas usam `add column if not exists` (idempotente); a constraint é `drop ... if exists` antes do `add constraint` (idempotente); o `cron.schedule` upserta por nome de job (idempotente, mesmo padrão de `20260802_014`); nenhuma tabela/policy existente é tocada.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260923_041_influenciadores_instagram_sync.sql supabase/checks/20260923_check_influenciadores_instagram_sync.sql
git commit -m "feat(influenciadores): migration para sincronizacao automatica via Instagram

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: `metaBusinessDiscovery` em `_shared/meta.ts`

**Files:**
- Modify: `supabase/functions/_shared/meta.ts`

**Interfaces:**
- Consumes: `metaGet(path, params)`, `getGraphVersion()` (já existentes no mesmo arquivo).
- Produces: `export async function metaBusinessDiscovery(instagramBusinessAccountId: string, handle: string, accessToken: string): Promise<{ followers_count: number; media_count: number; profile_picture_url: string } | null>` — devolve `null` (não lança) quando a conta não é encontrada/não é Business/Creator, para o chamador decidir a mensagem de erro; lança em qualquer outra falha de rede/API.

Sem teste automatizado (mesma convenção de todas as Edge Functions do projeto — sem chamada de rede real em nenhum teste). Verificação manual na Task 6.

- [ ] **Step 1: Adicionar a função**

No fim de `supabase/functions/_shared/meta.ts`, adicionar:

```ts
// Business Discovery: consulta dados publicos (foto, seguidores, total de posts) de OUTRA conta
// Instagram Business/Creator, sem essa conta autorizar nada - so exige que a CONTA CHAMADORA
// (instagramBusinessAccountId, ja conectada por OAuth via meta-oauth-callback) tenha o escopo
// instagram_basic. Devolve null (nao lanca) quando a conta-alvo nao existe, e privada, ou nao e
// Business/Creator - esses sao os casos de "cai para manual", nao um erro de infraestrutura.
export async function metaBusinessDiscovery(
  instagramBusinessAccountId: string,
  handle: string,
  accessToken: string,
): Promise<{ followers_count: number; media_count: number; profile_picture_url: string } | null> {
  const username = handle.replace(/^@/, "");
  const field = `business_discovery.username(${username}){followers_count,media_count,profile_picture_url}`;

  try {
    const body = await metaGet(`/${instagramBusinessAccountId}`, {
      fields: field,
      access_token: accessToken,
    });
    const discovery = body?.business_discovery;
    if (!discovery || typeof discovery.followers_count !== "number") return null;
    return {
      followers_count: discovery.followers_count,
      media_count: typeof discovery.media_count === "number" ? discovery.media_count : 0,
      profile_picture_url: String(discovery.profile_picture_url || ""),
    };
  } catch (error) {
    // Erro #100 com "does not exist" ou similar = conta nao encontrada/privada/pessoal.
    // Qualquer outro erro (rede, token expirado, rate limit) deve propagar para o chamador tratar.
    const message = error instanceof Error ? error.message : String(error);
    if (/does not exist|cannot be loaded|Unsupported get request/i.test(message)) return null;
    throw error;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/_shared/meta.ts
git commit -m "feat(influenciadores): adiciona metaBusinessDiscovery ao helper compartilhado

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Edge Function `influenciador-instagram-sync`

**Files:**
- Create: `supabase/functions/influenciador-instagram-sync/index.ts`

**Interfaces:**
- Consumes: `withCors`, `jsonResponse`, `getAdminClient`, `getAuthenticatedUser`, `assertAal2`, `getRequiredEnv`, `safeErrorMessage`, `metaBusinessDiscovery` (de `_shared/meta.ts`); `createClient` de `npm:@supabase/supabase-js@2`.
- Produces: rota HTTP `POST /functions/v1/influenciador-instagram-sync`. Corpo `{ influenciador_id: string }` (modo botão, requer `Authorization: Bearer <jwt do usuario>`) OU corpo vazio `{}` com header `x-cron-secret` (modo lote). Resposta de sucesso no modo botão: `{ ok: true, seguidores: number, publicacoes_total: number }`. Resposta de erro: `{ error: string }` com status 400/403.

Sem teste automatizado (mesma convenção do projeto). Verificação manual na Task 6.

- [ ] **Step 1: Criar o arquivo**

Criar `supabase/functions/influenciador-instagram-sync/index.ts`:

```ts
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  getAdminClient,
  getAuthenticatedUser,
  assertAal2,
  getRequiredEnv,
  jsonResponse,
  safeErrorMessage,
  metaBusinessDiscovery,
  withCors,
} from "../_shared/meta.ts";

type Influenciador = {
  id: string;
  marca: string;
  handle: string;
  rede_social: string;
};

type ContaMeta = {
  instagram_business_account_id: string | null;
  access_token: string;
};

// Sincroniza um influenciador: busca a conta Meta da marca, chama a Business Discovery, baixa e
// reenvia a foto, e atualiza influenciadores + influenciador_seguidores_historico. Nunca lanca -
// qualquer falha vira { erro } gravado na propria linha, para o chamador (botao ou lote) decidir
// o que fazer sem interromper os demais.
async function sincronizarUm(
  admin: ReturnType<typeof getAdminClient>,
  writeClient: ReturnType<typeof getAdminClient>,
  influenciador: Influenciador,
): Promise<{ erro: string | null; seguidores?: number; publicacoes_total?: number }> {
  if (influenciador.rede_social !== "Instagram") {
    return { erro: "Sincronizacao automatica so esta disponivel para Instagram." };
  }

  const { data: conta, error: contaError } = await admin
    .from("integracao_meta_contas")
    .select("instagram_business_account_id,access_token")
    .eq("marca", influenciador.marca)
    .eq("ativo", true)
    .not("instagram_business_account_id", "is", null)
    .maybeSingle<ContaMeta>();

  if (contaError) throw contaError;
  if (!conta?.instagram_business_account_id) {
    const erro = "Conecte o Instagram da marca em Conexoes antes de sincronizar.";
    await writeClient.from("influenciadores").update({ instagram_sync_erro: erro }).eq("id", influenciador.id);
    return { erro };
  }

  let dados;
  try {
    dados = await metaBusinessDiscovery(conta.instagram_business_account_id, influenciador.handle, conta.access_token);
  } catch (error) {
    const erro = safeErrorMessage(error, "Falha ao consultar o Instagram. Tente novamente mais tarde.");
    await writeClient.from("influenciadores").update({ instagram_sync_erro: erro }).eq("id", influenciador.id);
    return { erro };
  }

  if (!dados) {
    const erro = `Nao foi possivel sincronizar - verifique se ${influenciador.handle} e uma conta Business/Creator publica do Instagram.`;
    await writeClient.from("influenciadores").update({ instagram_sync_erro: erro }).eq("id", influenciador.id);
    return { erro };
  }

  let avatarPath: string | null = null;
  if (dados.profile_picture_url) {
    try {
      const imagem = await fetch(dados.profile_picture_url);
      if (imagem.ok) {
        const bytes = new Uint8Array(await imagem.arrayBuffer());
        const contentType = imagem.headers.get("content-type") || "image/jpeg";
        avatarPath = `${influenciador.id}/avatar`;
        const { error: uploadError } = await admin.storage
          .from("influenciadores-avatares")
          .upload(avatarPath, bytes, { upsert: true, contentType, cacheControl: "3600" });
        if (uploadError) avatarPath = null; // mantem avatar_path anterior, nao interrompe o resto
      }
    } catch {
      avatarPath = null; // falha de rede ao baixar a foto - mantem a foto anterior
    }
  }

  const atualizacao: Record<string, unknown> = {
    publicacoes_total: dados.media_count,
    instagram_sincronizado_em: new Date().toISOString(),
    instagram_sync_erro: null,
  };
  if (avatarPath) atualizacao.avatar_path = avatarPath;

  const { data: linhasAtualizadas, error: updateError } = await writeClient
    .from("influenciadores")
    .update(atualizacao)
    .eq("id", influenciador.id)
    .select("id");

  if (updateError) throw updateError;
  if (!linhasAtualizadas || linhasAtualizadas.length === 0) {
    return { erro: "Voce nao tem permissao para sincronizar este influenciador." };
  }

  const hoje = new Date().toISOString().slice(0, 10);
  const { error: seguidoresError } = await admin.from("influenciador_seguidores_historico").upsert(
    { influenciador_id: influenciador.id, marca: influenciador.marca, data: hoje, seguidores: dados.followers_count },
    { onConflict: "influenciador_id,data" },
  );
  if (seguidoresError) throw seguidoresError;

  return { erro: null, seguidores: dados.followers_count, publicacoes_total: dados.media_count };
}

Deno.serve(withCors(async (req) => {
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const cronSecret = req.headers.get("x-cron-secret");
  const modoLote = Boolean(cronSecret);

  try {
    const admin = getAdminClient();

    if (modoLote) {
      if (cronSecret !== getRequiredEnv("INSTAGRAM_SYNC_CRON_SECRET")) {
        return jsonResponse({ error: "Segredo de cron invalido." }, 403);
      }

      const { data: influenciadores, error } = await admin
        .from("influenciadores")
        .select("id,marca,handle,rede_social")
        .eq("rede_social", "Instagram");
      if (error) throw error;

      let sincronizados = 0;
      let comErro = 0;
      for (const influenciador of influenciadores || []) {
        const resultado = await sincronizarUm(admin, admin, influenciador as Influenciador);
        if (resultado.erro) comErro += 1;
        else sincronizados += 1;
      }
      return jsonResponse({ ok: true, sincronizados, com_erro: comErro });
    }

    const usuario = await getAuthenticatedUser(req);
    await assertAal2(req, usuario.id);

    const body = await req.json().catch(() => ({}));
    const influenciadorId = String(body.influenciador_id || "").trim();
    if (!influenciadorId) return jsonResponse({ error: "Informe influenciador_id." }, 400);

    const { data: influenciador, error: buscaError } = await admin
      .from("influenciadores")
      .select("id,marca,handle,rede_social")
      .eq("id", influenciadorId)
      .maybeSingle<Influenciador>();
    if (buscaError) throw buscaError;
    if (!influenciador) return jsonResponse({ error: "Influenciador nao encontrado." }, 404);

    // Client do proprio usuario (nao admin): a atualizacao final de influenciadores passa por
    // este client, entao a policy de escrita (cargo + gto_tem_acesso_marca) decide se o
    // chamador pode mesmo sincronizar este influenciador - sem duplicar essa logica aqui.
    const writeClient = createClient(
      getRequiredEnv("SUPABASE_URL"),
      getRequiredEnv("SUPABASE_ANON_KEY"),
      { global: { headers: { Authorization: req.headers.get("authorization") || "" } } },
    );

    const resultado = await sincronizarUm(admin, writeClient, influenciador);
    if (resultado.erro) return jsonResponse({ error: resultado.erro }, 400);
    return jsonResponse({ ok: true, seguidores: resultado.seguidores, publicacoes_total: resultado.publicacoes_total });
  } catch (error) {
    return jsonResponse({ error: safeErrorMessage(error, "Nao foi possivel sincronizar com o Instagram.") }, 400);
  }
}));
```

- [ ] **Step 2: Revisão manual do arquivo**

Confira: o modo lote nunca usa o client do usuário (não existe usuário); o modo botão sempre valida `assertAal2` antes de tocar em qualquer dado; a atualização final de `influenciadores` no modo botão usa `writeClient` (RLS do usuário), e todo o resto (leitura de `access_token`, upload no Storage, upsert de seguidores) usa `admin`; nenhuma falha de foto interrompe o restante da função (bloco `try/catch` isolado, `avatarPath` cai para `null`).

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/influenciador-instagram-sync/index.ts
git commit -m "feat(influenciadores): Edge Function de sincronizacao com Instagram

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: `service.js` — `sincronizarInstagram` (TDD)

**Files:**
- Modify: `public/modules/influenciadores/service.js`
- Test: `tests/influenciadores/service.test.js`

**Interfaces:**
- Consumes: `traduzirErro` (já existe no mesmo arquivo).
- Produces: `criarService(supabase).sincronizarInstagram(influenciadorId: string): Promise<{ seguidores: number, publicacoes_total: number }>` — lança `Error` traduzido em caso de falha (usa a mensagem devolvida pelo corpo `{ error }` da Edge Function quando disponível).

- [ ] **Step 1: Escrever o teste que falha**

Adicionar a `tests/influenciadores/service.test.js`, dentro do bloco de testes existente (o arquivo já importa `criarService`, `criarFake` e os helpers `op`/`doTabela`; usar exatamente esse padrão):

```js
test('sincronizarInstagram chama a Edge Function com o influenciador_id e devolve os dados', async () => {
  const chamadas = [];
  const supabase = {
    from: () => { throw new Error('nao deveria acessar tabelas diretamente'); },
    storage: { from: () => ({}) },
    functions: {
      invoke: async (nome, opcoes) => {
        chamadas.push({ nome, opcoes });
        return { data: { ok: true, seguidores: 15000, publicacoes_total: 342 }, error: null };
      }
    }
  };
  const resultado = await criarService(supabase).sincronizarInstagram('i1');
  assert.equal(chamadas.length, 1);
  assert.equal(chamadas[0].nome, 'influenciador-instagram-sync');
  assert.deepEqual(chamadas[0].opcoes, { body: { influenciador_id: 'i1' } });
  assert.deepEqual(resultado, { seguidores: 15000, publicacoes_total: 342 });
});

test('sincronizarInstagram traduz o erro devolvido pela Edge Function', async () => {
  // Formato real do SDK (@supabase/functions-js): invoke() devolve { data, error, response }, e o
  // corpo JSON de erro que a Edge Function respondeu fica em error.context.json() - nao existe um
  // campo "context" separado no retorno do invoke(). Confirmado lendo o pacote instalado
  // (node_modules/@supabase/functions-js/dist/module/FunctionsClient.js).
  const supabase = {
    functions: {
      invoke: async () => ({
        data: null,
        error: { message: 'Edge Function returned a non-2xx status code', context: { json: async () => ({ error: 'Conecte o Instagram da marca em Conexoes antes de sincronizar.' }) } },
        response: null
      })
    }
  };
  await assert.rejects(
    criarService(supabase).sincronizarInstagram('i1'),
    /Conecte o Instagram da marca/
  );
});

test('sincronizarInstagram cai na mensagem generica quando o corpo do erro nao tem JSON legivel', async () => {
  const supabase = {
    functions: {
      invoke: async () => ({ data: null, error: { message: 'Failed to send a request to the Edge Function', context: null }, response: null })
    }
  };
  await assert.rejects(
    criarService(supabase).sincronizarInstagram('i1'),
    /Nao foi possivel sincronizar com o Instagram\.|Não foi possível sincronizar com o Instagram\./
  );
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:influenciadores`
Expected: FAIL com `TypeError: criarService(...).sincronizarInstagram is not a function` (os demais testes continuam passando).

- [ ] **Step 3: Implementar**

Em `public/modules/influenciadores/service.js`, dentro da função `criarService(supabase)` (perto das outras funções como `registrarSeguidores`), adicionar:

```js
  // supabase.functions.invoke() devolve { data, error, response }. Quando a Edge Function responde
  // com status != 2xx, error e um FunctionsHttpError cujo error.context e o Response bruto; o corpo
  // JSON que a funcao devolveu (ex.: { error: "mensagem em pt-BR" }) so aparece chamando
  // error.context.json() - nao existe um campo "context" separado no retorno do invoke(). Formato
  // confirmado em node_modules/@supabase/functions-js/dist/module/FunctionsClient.js.
  async function sincronizarInstagram(influenciadorId) {
    const { data, error } = await supabase.functions.invoke("influenciador-instagram-sync", {
      body: { influenciador_id: influenciadorId }
    });
    if (error) {
      let mensagem = "Nao foi possivel sincronizar com o Instagram.";
      try {
        const corpo = error.context?.json ? await error.context.json() : null;
        if (corpo?.error) mensagem = corpo.error;
      } catch {
        // resposta sem JSON legivel - mantem a mensagem generica
      }
      throw new Error(mensagem);
    }
    return { seguidores: data.seguidores, publicacoes_total: data.publicacoes_total };
  }
```

E adicionar `sincronizarInstagram` ao objeto devolvido no `return` final de `criarService` (junto com `carregarTudo`, `salvarInfluenciador`, etc.).

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test:influenciadores`
Expected: todos os testes passam.

- [ ] **Step 5: Commit**

```bash
git add public/modules/influenciadores/service.js tests/influenciadores/service.test.js
git commit -m "feat(influenciadores): sincronizarInstagram no service

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: `calculos.js` — `formatSincronizadoEm` (TDD)

**Files:**
- Modify: `public/modules/influenciadores/calculos.js`
- Test: `tests/influenciadores/calculos.test.js`

**Interfaces:**
- Produces: `formatSincronizadoEm(timestamp: string | null, agora?: Date): string` — `null`/`undefined`/`""` → `"Nunca sincronizado"`; senão, texto relativo em pt-BR (`"agora mesmo"`, `"há N minuto(s)"`, `"há N hora(s)"`, `"há N dia(s)"`).

- [ ] **Step 1: Escrever o teste que falha**

Adicionar a `tests/influenciadores/calculos.test.js` (o arquivo já importa de `../../public/modules/influenciadores/calculos.js` — adicionar `formatSincronizadoEm` a essa lista de imports):

```js
test('formatSincronizadoEm', () => {
  const agora = new Date('2026-09-22T12:00:00Z');
  assert.equal(formatSincronizadoEm(null, agora), 'Nunca sincronizado');
  assert.equal(formatSincronizadoEm('', agora), 'Nunca sincronizado');
  assert.equal(formatSincronizadoEm('2026-09-22T11:59:50Z', agora), 'Sincronizado agora mesmo');
  assert.equal(formatSincronizadoEm('2026-09-22T11:45:00Z', agora), 'Sincronizado há 15 minutos');
  assert.equal(formatSincronizadoEm('2026-09-22T11:59:00Z', agora), 'Sincronizado há 1 minuto');
  assert.equal(formatSincronizadoEm('2026-09-22T09:00:00Z', agora), 'Sincronizado há 3 horas');
  assert.equal(formatSincronizadoEm('2026-09-22T11:00:00Z', agora), 'Sincronizado há 1 hora');
  assert.equal(formatSincronizadoEm('2026-09-20T12:00:00Z', agora), 'Sincronizado há 2 dias');
  assert.equal(formatSincronizadoEm('2026-09-21T12:00:00Z', agora), 'Sincronizado há 1 dia');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:influenciadores`
Expected: FAIL com `formatSincronizadoEm is not a function` (ou `not defined`).

- [ ] **Step 3: Implementar**

Em `public/modules/influenciadores/calculos.js`, adicionar (perto de `formatVariacao`):

```js
export function formatSincronizadoEm(timestamp, agora = new Date()) {
  if (!timestamp) return "Nunca sincronizado";
  const diffMs = agora.getTime() - new Date(timestamp).getTime();
  const minutos = Math.floor(diffMs / 60000);
  if (minutos < 1) return "Sincronizado agora mesmo";
  if (minutos < 60) return `Sincronizado há ${minutos} ${minutos === 1 ? "minuto" : "minutos"}`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `Sincronizado há ${horas} ${horas === 1 ? "hora" : "horas"}`;
  const dias = Math.floor(horas / 24);
  return `Sincronizado há ${dias} ${dias === 1 ? "dia" : "dias"}`;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test:influenciadores`
Expected: todos os testes passam.

- [ ] **Step 5: Commit**

```bash
git add public/modules/influenciadores/calculos.js tests/influenciadores/calculos.test.js
git commit -m "feat(influenciadores): formatSincronizadoEm

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Drawer — botão de sincronizar, status e `publicacoes_total` (TDD)

**Files:**
- Modify: `public/modules/influenciadores/influencer-drawer.js`
- Modify: `public/modules/influenciadores/index.js`
- Modify: `public/index.html` (CSS)
- Test: `tests/influenciadores/tabela-drawer.test.js`

**Interfaces:**
- Consumes: `formatSincronizadoEm`, `formatInt` (de `calculos.js`); `service.sincronizarInstagram` (Task 4).
- Produces: `influencerDrawerHtml(m)` passa a aceitar `m.influenciador.publicacoes_total`, `m.influenciador.instagram_sincronizado_em`, `m.influenciador.instagram_sync_erro`, `m.sincronizando` (booleano) no modelo; renderiza o botão com `data-acao="sincronizar-instagram"` só quando `m.influenciador.rede_social === "Instagram"` e `m.podeEditar`. `bindInfluencerDrawer(raiz, cb)` ganha `cb.aoSincronizarInstagram()`.

- [ ] **Step 1: Escrever os testes que falham**

Em `tests/influenciadores/tabela-drawer.test.js`, o objeto `influenciador`/`modeloDrawer` já existe — adicionar os testes abaixo depois do teste `'drawer mostra os blocos do prototipo'`:

```js
test('drawer mostra publicacoes_total e status de sincronizacao para influenciador do Instagram', () => {
  const html = influencerDrawerHtml({
    ...modeloDrawer,
    influenciador: { ...influenciador, publicacoes_total: 342, instagram_sincronizado_em: '2026-09-22T11:45:00Z', instagram_sync_erro: null }
  });
  assert.match(html, /342/);
  assert.match(html, /data-acao="sincronizar-instagram"/);
  assert.match(html, /Sincronizar com Instagram/);
});

test('drawer mostra a mensagem de erro da ultima sincronizacao, escapada', () => {
  const html = influencerDrawerHtml({
    ...modeloDrawer,
    influenciador: { ...influenciador, instagram_sync_erro: '<script>x</script> conecte o Instagram' }
  });
  assert.ok(!html.includes('<script>x</script>'));
  assert.match(html, /conecte o Instagram/);
});

test('drawer nao mostra botao de sincronizar para rede social diferente de Instagram ou quando nao pode editar', () => {
  const semInstagram = influencerDrawerHtml({ ...modeloDrawer, influenciador: { ...influenciador, rede_social: 'TikTok' } });
  assert.ok(!semInstagram.includes('data-acao="sincronizar-instagram"'));
  const semPermissao = influencerDrawerHtml({ ...modeloDrawer, podeEditar: false });
  assert.ok(!semPermissao.includes('data-acao="sincronizar-instagram"'));
});

test('botao de sincronizar fica desabilitado e com texto de progresso durante a sincronizacao', () => {
  const html = influencerDrawerHtml({ ...modeloDrawer, sincronizando: true });
  assert.match(html, /data-acao="sincronizar-instagram"[^>]*disabled/);
  assert.match(html, /Sincronizando…/);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:influenciadores`
Expected: FAIL nos 4 testes novos (os demais continuam passando).

- [ ] **Step 3: Implementar em `influencer-drawer.js`**

Abrir o arquivo. Na função `topoHtml(m)`, dentro do bloco que já mostra `i.handle`/`i.nicho`/`i.marca` (a `div` com `class="inf-tags"` e o que vem depois), adicionar logo após a `div.inf-tags` fechar (ainda dentro do bloco de identidade do influenciador, antes de `acordosHtml`) um novo bloco de estatísticas + sincronização. Localizar a função `topoHtml` e adicionar, entre o fechamento de `</div></div>` do cabeçalho e o retorno da função, o seguinte helper novo:

```js
function sincronizacaoHtml(m) {
  const i = m.influenciador;
  if (i.rede_social !== "Instagram" || !m.podeEditar) return "";
  const status = i.instagram_sync_erro
    ? `<span class="inf-sync-erro">${escapeHtml(i.instagram_sync_erro)}</span>`
    : `<span class="inf-sync-status">${escapeHtml(formatSincronizadoEm(i.instagram_sincronizado_em))}</span>`;
  return `<div class="inf-sync-linha">
      <button type="button" class="inf-btn-mini" data-acao="sincronizar-instagram"${m.sincronizando ? " disabled" : ""}>${m.sincronizando ? "Sincronizando…" : "Sincronizar com Instagram"}</button>
      ${status}
    </div>`;
}
```

Adicionar o import de `formatSincronizadoEm` e `formatInt` no topo do arquivo (junto ao import já existente de `formatBRLInteiro`, `formatInt`):

```js
import { formatBRLInteiro, formatInt, formatSincronizadoEm } from "./calculos.js";
```

Na função `topoHtml(m)`, dentro do bloco `<div><div class="flex items-center gap-1.5">...` que mostra nome/handle/tags (procure o trecho que termina em `</div></div>` logo antes de `${m.podeEditar ? ...}` dos botões de ação), adicionar `publicacoes_total` ao lado do nome/handle. Adicionar, logo depois da linha `<div class="inf-criador-handle">${escapeHtml(i.handle)}</div>` (dentro de `topoHtml`, procure o trecho correspondente — é a mesma estrutura usada em `linhaHtml` de `influencers-table.js`, mas aqui é dentro de `topoHtml`), o seguinte trecho de estatística:

```js
${i.publicacoes_total !== null && i.publicacoes_total !== undefined ? `<div class="inf-publicacoes">${formatInt(i.publicacoes_total)} publicações</div>` : ""}
```

E, no retorno de `influencerDrawerHtml(m)`, inserir a chamada a `sincronizacaoHtml(m)` logo após `${topoHtml(m)}` e antes de `${acordosHtml(m)}`:

```js
return `${topoHtml(m)}${sincronizacaoHtml(m)}${acordosHtml(m)}${campanhasHtml(m.campanhas)}${crescimentoHtml(m)}${midiasHtml(m)}
    ${m.podeEditar ? `<button type="button" class="inf-btn-cta" data-acao="nova-midia"><span class="material-symbols-outlined">add_link</span><span>+ Vincular Nova URL</span></button>` : ""}`;
```

Em `bindInfluencerDrawer(raiz, cb)`, adicionar junto às outras chamadas de `acao(...)`:

```js
acao("sincronizar-instagram", () => cb.aoSincronizarInstagram());
```

- [ ] **Step 4: Rodar e ver passar (drawer)**

Run: `npm run test:influenciadores`
Expected: todos os testes passam.

- [ ] **Step 5: Ligar em `index.js`**

Em `public/modules/influenciadores/index.js`:

1. No topo, adicionar `sincronizando: null,` ao objeto devolvido por `novoEstado()` (guarda o id do influenciador sendo sincronizado agora, ou `null`).
2. Na função `modeloDrawer()`, no objeto retornado, adicionar `sincronizando: estado.sincronizando === influenciador.id,` (ao lado de `podeEditar: podeEditar()`).
3. Em `bindInfluencerDrawer(raiz, { ... })` (dentro de `ligarEventos()`), adicionar o callback:

```js
    aoSincronizarInstagram: async () => {
      const influenciadorId = estado.abertoId;
      estado.sincronizando = influenciadorId;
      pintar();
      try {
        await service.sincronizarInstagram(influenciadorId);
        estado.sincronizando = null;
        await carregar();
      } catch (erro) {
        estado.sincronizando = null;
        estado.erro = deps.safeErrorMessage(erro, "Não foi possível sincronizar com o Instagram.");
        pintar();
      }
    },
```

- [ ] **Step 6: CSS em `public/index.html`**

No bloco `/* Modulo Influenciadores */` do `<style>`, adicionar:

```css
      .inf-publicacoes { font-size: 11px; color: #64748b; font-weight: 600; margin-top: 2px; }
      .inf-sync-linha { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 8px 0 14px; border-bottom: 1px solid #f1f5f9; margin-bottom: 14px; }
      .inf-sync-status { font-size: 11px; color: #64748b; }
      .inf-sync-erro { font-size: 11px; color: #b91c1c; font-weight: 600; }
```

- [ ] **Step 7: Verificação de sintaxe**

Run:
```bash
node -e "
const fs = require('node:fs');
const html = fs.readFileSync('public/index.html', 'utf8');
const m = html.match(/<script type=\"module\">([\s\S]*)<\/script>/);
fs.writeFileSync('inf-check-sync.mjs', m[1]);
"
node --check inf-check-sync.mjs
```
Expected: sem saída (sintaxe válida). Depois, apagar o arquivo: `rm inf-check-sync.mjs` (ou `del inf-check-sync.mjs` no PowerShell).

- [ ] **Step 8: Rodar a suíte completa e o check-contracts**

Run: `npm run test:influenciadores && node scripts/check-contracts.mjs`
Expected: todos os testes passam; `Contract check passed: ...`.

- [ ] **Step 9: Commit**

```bash
git add public/modules/influenciadores/influencer-drawer.js public/modules/influenciadores/index.js public/index.html tests/influenciadores/tabela-drawer.test.js
git commit -m "feat(influenciadores): botao de sincronizar, status e total de publicacoes no drawer

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: Aplicar a migration e fazer deploy da Edge Function (requer aprovação explícita do usuário)

**Files:** nenhum arquivo novo — esta task só executa SQL/deploy contra o ambiente real.

- [ ] **Step 1: Parar e pedir autorização**

Perguntar ao usuário, literalmente: "Posso aplicar a migration `20260923_041_influenciadores_instagram_sync.sql` no Supabase e fazer o deploy da Edge Function `influenciador-instagram-sync`? A migration só adiciona colunas e agenda um cron job (não altera nada existente); o deploy publica uma função nova, sem afetar as demais." **Não prosseguir sem um "sim" explícito.**

- [ ] **Step 2: Aplicar a migration**

Com autorização, aplicar `supabase/migrations/20260923_041_influenciadores_instagram_sync.sql` (mesmo mecanismo já usado nas migrations anteriores deste módulo — `supabase db query --linked --file ...` ou colar no SQL Editor do Supabase, dependendo do que o classificador de permissão do ambiente permitir no momento). Rodar a Seção A e a Seção B do arquivo de verificação (Task 1, Step 2) separadamente, e confirmar que todas as linhas terminam em `ok`.

- [ ] **Step 3: Configurar os segredos (passo manual do usuário, fora do meu alcance)**

Explicar ao usuário que ele precisa, fora desta sessão (painel do Supabase ou CLI com credenciais próprias, já que segredos nunca devem ser gerados/vistos por mim):
1. Gerar um valor aleatório longo (ex.: `openssl rand -hex 32` ou qualquer gerador de senha forte).
2. Inserir esse valor no Supabase Vault com o nome exato `influenciador_instagram_sync_cron_secret` (SQL Editor: `select vault.create_secret('<valor>', 'influenciador_instagram_sync_cron_secret');`).
3. Configurar o **mesmo valor** como Edge Function secret `INSTAGRAM_SYNC_CRON_SECRET` (painel do Supabase → Edge Functions → Secrets, ou `supabase secrets set INSTAGRAM_SYNC_CRON_SECRET=<valor> --project-ref ysreenjwihmwzockyrls`).

- [ ] **Step 4: Deploy da Edge Function**

Com autorização, rodar: `node_modules\.bin\supabase.cmd functions deploy influenciador-instagram-sync --project-ref ysreenjwihmwzockyrls` (a partir da raiz do projeto, não do worktree — copiar o arquivo `supabase/functions/influenciador-instagram-sync/index.ts` e o `_shared/meta.ts` atualizado para lá primeiro, ou apontar `--workdir` para o worktree, dependendo do que a versão da CLI aceitar).

- [ ] **Step 5: Reportar ao usuário**

Resumir o resultado (migration aplicada e verificada; segredos configurados por ele; função publicada) e perguntar se pode seguir para a Task 8 (verificação manual ponta a ponta).

---

### Task 8: Verificação manual ponta a ponta (requer um influenciador de teste real)

**Files:** nenhum.

- [ ] **Step 1: Pedir ao usuário um influenciador de teste**

Perguntar: "Para testar de verdade, preciso que você aponte um influenciador já cadastrado (ou cadastre um novo) cujo `@handle` seja de uma conta Instagram Business ou Creator pública de verdade. Qual usar?"

- [ ] **Step 2: Testar o botão**

Rodar o app localmente (`node scripts/serve-public.mjs`), abrir o influenciador indicado, clicar em "Sincronizar com Instagram".

Expected: o botão mostra "Sincronizando…", depois volta ao normal; a foto, `publicacoes_total` e o "Sincronizado há X" atualizam; o gráfico de Crescimento Semanal ganha um ponto novo para hoje.

- [ ] **Step 3: Testar o caso de falha**

Criar (ou usar) um influenciador com um `@handle` que não existe ou que seja de conta pessoal. Clicar em "Sincronizar com Instagram".

Expected: mensagem de erro clara aparece, os campos manuais continuam editáveis, nada quebra.

- [ ] **Step 4: Reportar ao usuário**

Resumir o que funcionou e o que não funcionou. Se algo falhar, usar superpowers:systematic-debugging antes de qualquer correção.

---

## Autorrevisão do plano

**1. Cobertura do spec:** §3 (escopo Instagram-only) → Task 2/3 (`metaBusinessDiscovery` só Instagram). §4 (colunas) → Task 1. §5 (Edge Function, 2 modos, fallback sem apagar avatar) → Task 3. §6 (frontend: service, drawer, sem mudança no formulário) → Tasks 4-6 (nenhuma task toca `influencer-form-modal.js`, conforme decidido). §7 (testes: service/calculos com `node --test`, Edge Function sem teste automatizado) → Tasks 4, 5 cobertas por TDD; Task 3 e Task 8 documentam a verificação manual. §8 (riscos: cobertura parcial, sem log histórico) → refletidos nas mensagens de erro da Task 3 e na ausência deliberada de uma tabela de log (YAGNI, já registrado no spec).

**2. Placeholders:** nenhum "TBD"/"implementar depois" encontrado; todo step de código tem o conteúdo completo do trecho a inserir e a localização exata dentro do arquivo já existente.

**3. Consistência de tipos e nomes:** `sincronizarInstagram` (service.js) devolve `{ seguidores, publicacoes_total }` — mesmos nomes que `index.js` (Task 6, Step 5) e o teste da Task 4 esperam. `formatSincronizadoEm` (calculos.js) é importada com esse nome exato em `influencer-drawer.js` (Task 6). O modelo `m` de `influencerDrawerHtml` ganha `m.sincronizando` e `m.influenciador.{publicacoes_total,instagram_sincronizado_em,instagram_sync_erro}` — os mesmos nomes usados nos testes da Task 6 e na migration da Task 1 (`publicacoes_total`, `instagram_sincronizado_em`, `instagram_sync_erro`). `cb.aoSincronizarInstagram()` é o nome usado tanto em `bindInfluencerDrawer` (Task 6, Step 3) quanto no callback passado por `index.js` (Task 6, Step 5).

**4. Ajuste feito durante a autorrevisão:** o rascunho inicial da Task 4 tratava `context` como um campo separado no retorno de `supabase.functions.invoke()`. Conferido contra o pacote `@supabase/functions-js` realmente instalado no projeto (`node_modules/@supabase/functions-js/dist/module/FunctionsClient.js`): o retorno é `{ data, error, response }`, e o corpo JSON de erro que a Edge Function devolveu só é acessível via `error.context.json()` (propriedade do próprio objeto de erro, um `FunctionsHttpError`). Corrigido tanto no teste quanto na implementação da Task 4, e adicionado um segundo teste cobrindo o caso em que `error.context` não tem corpo JSON legível (cai na mensagem genérica).
