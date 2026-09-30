# Módulo Influenciadores — Plano de Implementação

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: usar superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para executar este plano tarefa por tarefa. Os passos usam checkbox (`- [ ]`) para acompanhamento.

**Objetivo:** Entregar a tela Influenciadores (KPIs, tabela estilo Modash e drawer lateral) no app real, com dados no Supabase e RLS por marca.

**Arquitetura:** Módulos ES sem build em `public/modules/influenciadores/`, carregados por `import()` dinâmico a partir do `public/index.html`. Componentes são funções puras `xxxHtml(modelo) → string` (testáveis com `node --test`) mais funções `bindXxx(raiz, callbacks)` para eventos. Dados em 4 tabelas novas com RLS por marca (`gto_tem_acesso_marca`) e bucket privado de avatares.

**Stack:** JavaScript ES modules (navegador), Supabase JS 2.45 (já carregado no `index.html`), PostgreSQL 17, `node:test` (Node 24), TypeScript apenas como contrato em `src/types/`.

**Spec:** `docs/superpowers/specs/2026-09-21-modulo-influenciadores-design.md`

## Restrições Globais

- Idioma: 100% pt-BR na interface, mensagens e comentários. Comentários e strings de SQL sem acento (padrão dos arquivos `.sql` do projeto); JS pode ter acento.
- Cores: primário `#1D4ED8`, hover `#1E40AF`, sidebar `#0F172A` (já existente). O módulo usa o azul fixo, não o `--accent` dinâmico por marca.
- CSP do app: `script-src 'self' 'unsafe-inline' https://esm.sh ...`; `img-src 'self' data: https://ysreenjwihmwzockyrls.supabase.co`. Proibido CDN do Tailwind, imagens externas e libs novas.
- Sem build e sem dependências novas. O worktree não tem `node_modules`; nada neste plano precisa de `npm install`.
- Toda interpolação de dado em HTML passa por `escapeHtml` (`html.js`). URLs de mídia só `https://`.
- Migration: `supabase/migrations/20260921_039_influenciadores.sql` (a `main` termina em 037; a branch de Meta Ads usa 038).
- **Nunca** usar `supabase db push` (histórico remoto fora de sincronia). **Nunca** aplicar SQL no Supabase nem fazer `git push` sem OK explícito do usuário (Tasks 11 e 12).
- Trabalho no worktree `G:\GTO Insigths\.worktrees\influenciadores`, branch `feat/modulo-influenciadores`. Não tocar nas alterações não commitadas da pasta principal.
- Commits terminam com a linha `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.
- Testes ficam em `tests/influenciadores/*.test.js` (fora de `public/`, para não serem publicados). Comando: `npm run test:influenciadores`.

## Desvios em relação ao spec (todos pequenos e justificados)

1. **Testes em `tests/influenciadores/`**, não em `public/modules/...`, para não publicar arquivos de teste na Vercel.
2. **`html.js`** (6 linhas com `escapeHtml`) e **`avatar.js`** e **`validacao.js`** são arquivos extras. `escapeHtml` é duplicado do app para os componentes continuarem puros e testáveis sem injeção.
3. **FK de campanha em mídia** usa `(campanha_id, influenciador_id)` em vez de `(campanha_id, marca)`: além de manter a marca consistente, impede ligar uma mídia à campanha de *outro* influenciador.
4. **Storage sem extensão:** o avatar é gravado em `{influenciador_id}/avatar` (sem `.jpg`), evitando arquivo órfão ao trocar de formato.
5. **Harness de preview local** (`scripts/preview-influenciadores.mjs`), não publicado, com Supabase falso em memória. Permite ver a tela sem login e sem tocar no banco.

## Estrutura de arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `supabase/migrations/20260921_039_influenciadores.sql` | criar | 4 tabelas, constraints, RLS, triggers, bucket e policies de storage |
| `supabase/checks/20260921_check_influenciadores.sql` | criar | Verificação estática + teste funcional de isolamento (rollback) |
| `src/types/influenciadores.ts` | criar | Interfaces `Influencer`, `Campaign`, `MediaContent`, `FollowerSnapshot`, `Metrics` |
| `scripts/check-contracts.mjs` | modificar | Exigir arquivos, tabelas e colunas do módulo |
| `package.json` | modificar | Script `test:influenciadores` |
| `public/modules/influenciadores/html.js` | criar | `escapeHtml` |
| `public/modules/influenciadores/calculos.js` | criar | Formatação pt-BR, KPIs, agregados, busca, paginação |
| `public/modules/influenciadores/validacao.js` | criar | Validação e normalização de formulários |
| `public/modules/influenciadores/avatar.js` | criar | Avatar circular (foto ou iniciais) |
| `public/modules/influenciadores/growth-chart.js` | criar | Gráfico SVG de seguidores |
| `public/modules/influenciadores/kpi-cards.js` | criar | 4 cards de KPI |
| `public/modules/influenciadores/brand-filter-pills.js` | criar | Pílulas de bandeira |
| `public/modules/influenciadores/influencers-table.js` | criar | Tabela, busca, paginação |
| `public/modules/influenciadores/influencer-drawer.js` | criar | Painel lateral |
| `public/modules/influenciadores/service.js` | criar | Acesso ao Supabase (CRUD, avatar) |
| `public/modules/influenciadores/influencer-form-modal.js` | criar | Formulário de influenciador + campanhas |
| `public/modules/influenciadores/midia-form-modal.js` | criar | Formulário de mídia vinculada |
| `public/modules/influenciadores/index.js` | criar | Orquestrador (estado, eventos, modais) |
| `public/index.html` | modificar | Menu, rota, título, overlays, CSS `.inf-*` |
| `scripts/preview-influenciadores.mjs` | criar | Servidor de preview local com dados falsos |
| `tests/influenciadores/*.test.js` | criar | Testes unitários |

---

### Task 1: Migration e verificação SQL

**Files:**
- Create: `supabase/migrations/20260921_039_influenciadores.sql`
- Create: `supabase/checks/20260921_check_influenciadores.sql`

**Interfaces:**
- Produces: tabelas `public.influenciadores`, `public.influenciador_campanhas`, `public.influenciador_midias`, `public.influenciador_seguidores_historico`; bucket `influenciadores-avatares`. Nomes de colunas exatamente como na spec §4.1 (consumidos por `service.js` e `src/types/influenciadores.ts`).

Esta task não tem teste automatizado offline. A verificação real roda na Task 11, após aprovação do usuário. Aqui a disciplina é revisar o SQL linha a linha contra as convenções de `20260824_037_lojas_unidades.sql`.

- [ ] **Step 1: Criar a migration**

Criar `supabase/migrations/20260921_039_influenciadores.sql` com este conteúdo:

```sql
-- GTO Insights - Modulo Influenciadores (Marketing de Influencia).
-- Scope: cadastro de criadores, campanhas/acordos, midias vinculadas (URL + metricas manuais)
-- e historico de seguidores, tudo por marca com RLS.
--
-- Modelo: um influenciador pertence a UMA marca (RLS por linha). Quem atua para duas marcas vira
-- dois cadastros. Toda tabela filha carrega marca e usa FK composta com o pai, entao o banco
-- rejeita filho com marca diferente da do influenciador.
--
-- Metricas de midia e seguidores sao MANUAIS neste corte (coluna fonte = 'manual'): a sync da Meta
-- so le contas das marcas, nao de terceiros. fonte ja aceita meta_colab/business_discovery para
-- automatizar depois sem migrar dados.
--
-- Leitura: quem tem acesso a marca (gto_tem_acesso_marca) ou Admin/Gestor.
-- Escrita: mesma regra E cargo Admin, Gestor ou Coordenador. Analista so le.
--
-- Safe to run multiple times.

begin;

-- Tabelas ----------------------------------------------------------------------------------------
create table if not exists public.influenciadores (
  id uuid primary key default gen_random_uuid(),
  marca public.bandeira_marca not null,
  nome text not null,
  handle text not null,
  rede_social text not null,
  verificado boolean not null default false,
  nicho text,
  avatar_path text,
  cupom_codigo text,
  cupom_exclusivo boolean not null default false,
  status text not null default 'Ativo',
  criado_por uuid default auth.uid() references auth.users(id) on delete set null,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),

  constraint influenciadores_id_marca_key unique (id, marca),
  constraint influenciadores_marca_rede_handle_key unique (marca, rede_social, handle),
  constraint influenciadores_nome_chk check (char_length(btrim(nome)) between 2 and 120),
  constraint influenciadores_handle_chk check (handle ~ '^@[A-Za-z0-9._]{2,50}$'),
  constraint influenciadores_rede_chk check (rede_social in ('Instagram', 'TikTok', 'YouTube')),
  constraint influenciadores_nicho_chk check (nicho is null or char_length(nicho) <= 60),
  constraint influenciadores_avatar_path_chk check (avatar_path is null or char_length(avatar_path) <= 200),
  constraint influenciadores_cupom_chk check (cupom_codigo is null or cupom_codigo ~ '^[A-Z0-9_-]{2,30}$'),
  constraint influenciadores_cupom_exclusivo_chk check (not cupom_exclusivo or cupom_codigo is not null),
  constraint influenciadores_status_chk check (status in ('Ativo', 'Pausado', 'Encerrado'))
);

create table if not exists public.influenciador_campanhas (
  id uuid primary key default gen_random_uuid(),
  influenciador_id uuid not null,
  marca public.bandeira_marca not null,
  nome text not null,
  data_inicio date not null,
  data_fim date,
  cache_valor numeric(12,2) not null default 0,
  voucher_valor numeric(12,2) not null default 0,
  investimento_total numeric(12,2) generated always as (cache_valor + voucher_valor) stored,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),

  constraint influenciador_campanhas_id_influenciador_key unique (id, influenciador_id),
  constraint influenciador_campanhas_influenciador_fk
    foreign key (influenciador_id, marca) references public.influenciadores (id, marca) on delete cascade,
  constraint influenciador_campanhas_nome_chk check (char_length(btrim(nome)) between 1 and 120),
  constraint influenciador_campanhas_periodo_chk check (data_fim is null or data_fim >= data_inicio),
  constraint influenciador_campanhas_cache_chk check (cache_valor >= 0),
  constraint influenciador_campanhas_voucher_chk check (voucher_valor >= 0)
);

create table if not exists public.influenciador_midias (
  id uuid primary key default gen_random_uuid(),
  influenciador_id uuid not null,
  marca public.bandeira_marca not null,
  campanha_id uuid,
  titulo text not null,
  url text not null,
  plataforma text,
  formato text,
  publicada_em date not null,
  views bigint not null default 0,
  alcance bigint not null default 0,
  curtidas bigint not null default 0,
  comentarios bigint not null default 0,
  salvos bigint not null default 0,
  compartilhamentos bigint not null default 0,
  fonte text not null default 'manual',
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),

  constraint influenciador_midias_influenciador_fk
    foreign key (influenciador_id, marca) references public.influenciadores (id, marca) on delete cascade,
  -- Amarra a campanha ao MESMO influenciador. set null so na coluna campanha_id (PG 15+), senao
  -- o set null tentaria anular influenciador_id, que e not null.
  constraint influenciador_midias_campanha_fk
    foreign key (campanha_id, influenciador_id) references public.influenciador_campanhas (id, influenciador_id)
    on delete set null (campanha_id),
  constraint influenciador_midias_influenciador_url_key unique (influenciador_id, url),
  constraint influenciador_midias_titulo_chk check (char_length(btrim(titulo)) between 1 and 160),
  constraint influenciador_midias_url_chk check (url ~ '^https://[^[:space:]]+$' and char_length(url) <= 500),
  constraint influenciador_midias_plataforma_chk check (plataforma is null or plataforma in ('Instagram', 'TikTok', 'YouTube')),
  constraint influenciador_midias_formato_chk check (formato is null or formato in ('Reel', 'Feed', 'Story', 'Video', 'Short')),
  constraint influenciador_midias_metricas_chk check (
    views >= 0 and alcance >= 0 and curtidas >= 0 and comentarios >= 0 and salvos >= 0 and compartilhamentos >= 0
  ),
  constraint influenciador_midias_fonte_chk check (fonte in ('manual', 'meta_colab', 'business_discovery'))
);

create table if not exists public.influenciador_seguidores_historico (
  id uuid primary key default gen_random_uuid(),
  influenciador_id uuid not null,
  marca public.bandeira_marca not null,
  data date not null,
  seguidores bigint not null,
  criado_em timestamptz not null default now(),

  constraint influenciador_seguidores_influenciador_fk
    foreign key (influenciador_id, marca) references public.influenciadores (id, marca) on delete cascade,
  constraint influenciador_seguidores_dia_key unique (influenciador_id, data),
  constraint influenciador_seguidores_chk check (seguidores >= 0)
);

create index if not exists idx_influenciadores_marca on public.influenciadores(marca);
create index if not exists idx_influenciador_campanhas_marca_inicio on public.influenciador_campanhas(marca, data_inicio);
create index if not exists idx_influenciador_campanhas_influenciador on public.influenciador_campanhas(influenciador_id);
create index if not exists idx_influenciador_midias_marca_publicada on public.influenciador_midias(marca, publicada_em);
create index if not exists idx_influenciador_midias_influenciador on public.influenciador_midias(influenciador_id);
create index if not exists idx_influenciador_seguidores_marca on public.influenciador_seguidores_historico(marca);
create index if not exists idx_influenciador_seguidores_influenciador on public.influenciador_seguidores_historico(influenciador_id, data);

comment on table public.influenciadores is 'Criadores de conteudo contratados, por bandeira (RLS por marca).';
comment on table public.influenciador_campanhas is 'Campanhas/acordos por influenciador: cache + voucher = investimento_total.';
comment on table public.influenciador_midias is 'Posts vinculados por URL, com metricas informadas manualmente (fonte).';
comment on table public.influenciador_seguidores_historico is 'Snapshots de seguidores por dia, base do crescimento semanal.';

-- RLS + grants + triggers ------------------------------------------------------------------------
do $$
declare
  t text;
  cond_acesso constant text := '((select public.gto_eh_admin_ou_gestor()) or public.gto_tem_acesso_marca(marca))';
  cond_editor constant text := '(select public.gto_meu_cargo()) in (''Admin'', ''Gestor'', ''Coordenador'')';
begin
  foreach t in array array[
    'influenciadores',
    'influenciador_campanhas',
    'influenciador_midias',
    'influenciador_seguidores_historico'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);

    execute format('drop policy if exists %I on public.%I', t || '_select_por_marca', t);
    execute format('create policy %I on public.%I for select to authenticated using (%s)',
      t || '_select_por_marca', t, cond_acesso);

    execute format('drop policy if exists %I on public.%I', t || '_insert_editores', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (%s and %s)',
      t || '_insert_editores', t, cond_acesso, cond_editor);

    execute format('drop policy if exists %I on public.%I', t || '_update_editores', t);
    execute format('create policy %I on public.%I for update to authenticated using (%s and %s) with check (%s and %s)',
      t || '_update_editores', t, cond_acesso, cond_editor, cond_acesso, cond_editor);

    execute format('drop policy if exists %I on public.%I', t || '_delete_editores', t);
    execute format('create policy %I on public.%I for delete to authenticated using (%s and %s)',
      t || '_delete_editores', t, cond_acesso, cond_editor);

    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);

    execute format('drop trigger if exists %I on public.%I', 'trg_' || t || '_auditoria', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.gto_registrar_auditoria()',
      'trg_' || t || '_auditoria', t);
  end loop;

  foreach t in array array['influenciadores', 'influenciador_campanhas', 'influenciador_midias']
  loop
    execute format('drop trigger if exists %I on public.%I', 'trg_' || t || '_set_atualizado_em', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.gto_set_atualizado_em()',
      'trg_' || t || '_set_atualizado_em', t);
  end loop;
end
$$;

-- Storage: avatares (bucket PRIVADO) -------------------------------------------------------------
-- Diferente de avatars/sugestoes-anexos (publicos), aqui o acesso depende da marca do
-- influenciador, o que um bucket publico nao consegue expressar. Leitura por URL assinada.
-- Caminho: {influenciador_id}/avatar (sem marca no caminho: tem espaco e acento).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'influenciadores-avatares',
  'influenciadores-avatares',
  false,
  1048576,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "influenciadores_avatares_select" on storage.objects;
create policy "influenciadores_avatares_select" on storage.objects
for select to authenticated
using (
  bucket_id = 'influenciadores-avatares'
  and exists (
    select 1 from public.influenciadores i
    where i.id::text = (storage.foldername(name))[1]
      and ((select public.gto_eh_admin_ou_gestor()) or public.gto_tem_acesso_marca(i.marca))
  )
);

drop policy if exists "influenciadores_avatares_insert" on storage.objects;
create policy "influenciadores_avatares_insert" on storage.objects
for insert to authenticated
with check (
  bucket_id = 'influenciadores-avatares'
  and (select public.gto_meu_cargo()) in ('Admin', 'Gestor', 'Coordenador')
  and exists (
    select 1 from public.influenciadores i
    where i.id::text = (storage.foldername(name))[1]
      and ((select public.gto_eh_admin_ou_gestor()) or public.gto_tem_acesso_marca(i.marca))
  )
);

drop policy if exists "influenciadores_avatares_update" on storage.objects;
create policy "influenciadores_avatares_update" on storage.objects
for update to authenticated
using (
  bucket_id = 'influenciadores-avatares'
  and (select public.gto_meu_cargo()) in ('Admin', 'Gestor', 'Coordenador')
  and exists (
    select 1 from public.influenciadores i
    where i.id::text = (storage.foldername(name))[1]
      and ((select public.gto_eh_admin_ou_gestor()) or public.gto_tem_acesso_marca(i.marca))
  )
)
with check (
  bucket_id = 'influenciadores-avatares'
  and (select public.gto_meu_cargo()) in ('Admin', 'Gestor', 'Coordenador')
);

drop policy if exists "influenciadores_avatares_delete" on storage.objects;
create policy "influenciadores_avatares_delete" on storage.objects
for delete to authenticated
using (
  bucket_id = 'influenciadores-avatares'
  and (select public.gto_meu_cargo()) in ('Admin', 'Gestor', 'Coordenador')
  and exists (
    select 1 from public.influenciadores i
    where i.id::text = (storage.foldername(name))[1]
      and ((select public.gto_eh_admin_ou_gestor()) or public.gto_tem_acesso_marca(i.marca))
  )
);

notify pgrst, 'reload schema';

commit;
```

- [ ] **Step 2: Criar o SQL de verificação**

Criar `supabase/checks/20260921_check_influenciadores.sql`:

```sql
-- GTO Insights - Verificacao do modulo Influenciadores.
-- Rode no SQL Editor (role postgres), DEPOIS de aplicar a migration 039.
--
-- SECAO A (estatica): rode sozinha. Toda linha deve terminar em 'ok'.
-- SECAO B (funcional): rode sozinha. Ela TERMINA PROPOSITALMENTE COM UM ERRO cujo texto e o
--   relatorio; esse erro e o rollback dos dados de teste (nada fica gravado). Leia as linhas
--   'ok'/'FALHA' dentro da mensagem.

-- ==================================== SECAO A ====================================
select 'rls habilitado e forcado' as teste, c.relname::text as objeto,
  case when c.relrowsecurity and c.relforcerowsecurity then 'ok' else 'FALHA' end as resultado
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('influenciadores', 'influenciador_campanhas', 'influenciador_midias', 'influenciador_seguidores_historico')
union all
select 'quatro policies por tabela', p.tablename::text,
  case when count(*) = 4 then 'ok' else 'FALHA: ' || count(*) end
from pg_policies p
where p.schemaname = 'public'
  and p.tablename in ('influenciadores', 'influenciador_campanhas', 'influenciador_midias', 'influenciador_seguidores_historico')
group by p.tablename
union all
select 'sem grant para anon', g.table_name::text, 'FALHA: ' || g.privilege_type
from information_schema.role_table_grants g
where g.table_schema = 'public' and g.grantee = 'anon'
  and g.table_name in ('influenciadores', 'influenciador_campanhas', 'influenciador_midias', 'influenciador_seguidores_historico')
union all
select 'bucket privado com limite de 1 MB', b.id::text,
  case when b.public = false and b.file_size_limit = 1048576
        and b.allowed_mime_types @> array['image/jpeg', 'image/png', 'image/webp']::text[]
       then 'ok' else 'FALHA' end
from storage.buckets b
where b.id = 'influenciadores-avatares'
union all
select 'quatro policies de storage', 'influenciadores-avatares',
  case when count(*) = 4 then 'ok' else 'FALHA: ' || count(*) end
from pg_policies
where schemaname = 'storage' and tablename = 'objects' and policyname like 'influenciadores_avatares_%'
union all
select 'trigger de auditoria', c.relname::text,
  case when exists (select 1 from pg_trigger tg where tg.tgrelid = c.oid and tg.tgname = 'trg_' || c.relname || '_auditoria') then 'ok' else 'FALHA' end
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('influenciadores', 'influenciador_campanhas', 'influenciador_midias', 'influenciador_seguidores_historico')
order by 1, 2;

-- ==================================== SECAO B ====================================
-- Simula sessoes reais (role authenticated + JWT com aal2) de um Coordenador e de um Analista
-- existentes. Se nao houver Coordenador com marca vinculada, os testes que dependem dele saem
-- como 'PULADO'.
do $$
declare
  v_editor uuid;
  v_marca_a public.bandeira_marca;
  v_marca_b public.bandeira_marca;
  v_leitor uuid;
  v_inf_a uuid;
  v_inf_b uuid;
  v_res text[] := array[]::text[];
  v_n int;
begin
  select id, marca_vinculada into v_editor, v_marca_a
  from public.perfis
  where cargo = 'Coordenador' and ativo and marca_vinculada is not null
  limit 1;

  if v_editor is null then
    v_res := v_res || 'PULADO: nao ha Coordenador ativo com marca vinculada para simular escrita';
    raise exception E'RELATORIO\n%', array_to_string(v_res, E'\n');
  end if;

  select m into v_marca_b
  from unnest(enum_range(null::public.bandeira_marca)) m
  where m <> v_marca_a
  limit 1;

  select id into v_leitor
  from public.perfis
  where cargo = 'Analista' and ativo and marca_vinculada = v_marca_a
  limit 1;

  -- Fixtures (role postgres, ignora RLS). Tudo some com o erro final.
  insert into public.influenciadores (marca, nome, handle, rede_social)
  values (v_marca_a, 'Fixture A', '@fixture_a_rls', 'Instagram') returning id into v_inf_a;
  insert into public.influenciadores (marca, nome, handle, rede_social)
  values (v_marca_b, 'Fixture B', '@fixture_b_rls', 'Instagram') returning id into v_inf_b;

  -- Sessao do Coordenador da marca A
  perform set_config('request.jwt.claim.sub', v_editor::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_editor, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  set local role authenticated;

  select count(*) into v_n from public.influenciadores where id = v_inf_b;
  v_res := v_res || (case when v_n = 0 then 'ok' else 'FALHA' end) || ' T1: coordenador da marca A nao le influenciador da marca B';

  select count(*) into v_n from public.influenciadores where id = v_inf_a;
  v_res := v_res || (case when v_n = 1 then 'ok' else 'FALHA' end) || ' T2: coordenador le influenciador da propria marca';

  begin
    insert into public.influenciadores (marca, nome, handle, rede_social)
    values (v_marca_b, 'Invasor', '@invasor_rls', 'Instagram');
    v_res := v_res || 'FALHA T3: coordenador inseriu em outra marca';
  exception
    when insufficient_privilege then v_res := v_res || 'ok T3: insert em outra marca bloqueado';
    when others then v_res := v_res || 'FALHA T3: erro inesperado ' || sqlstate;
  end;

  begin
    insert into public.influenciadores (marca, nome, handle, rede_social)
    values (v_marca_a, 'Legitimo', '@legitimo_rls', 'TikTok');
    v_res := v_res || 'ok T4: coordenador insere na propria marca';
  exception when others then
    v_res := v_res || 'FALHA T4: coordenador nao conseguiu inserir na propria marca (' || sqlstate || ')';
  end;

  begin
    update public.influenciadores set nome = 'Hackeado' where id = v_inf_b;
    get diagnostics v_n = row_count;
    v_res := v_res || (case when v_n = 0 then 'ok' else 'FALHA' end) || ' T5: update em outra marca nao afeta linhas';
  exception when others then
    v_res := v_res || 'ok T5: update em outra marca bloqueado';
  end;

  reset role;

  -- Sessao do Analista da marca A (somente leitura)
  if v_leitor is null then
    v_res := v_res || 'PULADO T6/T7: nao ha Analista ativo na marca ' || v_marca_a;
  else
    perform set_config('request.jwt.claim.sub', v_leitor::text, true);
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_leitor, 'role', 'authenticated', 'aal', 'aal2')::text, true);
    set local role authenticated;

    select count(*) into v_n from public.influenciadores where id = v_inf_a;
    v_res := v_res || (case when v_n = 1 then 'ok' else 'FALHA' end) || ' T6: analista le a propria marca';

    begin
      insert into public.influenciadores (marca, nome, handle, rede_social)
      values (v_marca_a, 'Analista Escreve', '@analista_rls', 'Instagram');
      v_res := v_res || 'FALHA T7: analista conseguiu escrever';
    exception
      when insufficient_privilege then v_res := v_res || 'ok T7: analista nao escreve';
      when others then v_res := v_res || 'FALHA T7: erro inesperado ' || sqlstate;
    end;

    reset role;
  end if;

  -- Integridade (role postgres)
  begin
    insert into public.influenciador_campanhas (influenciador_id, marca, nome, data_inicio)
    values (v_inf_a, v_marca_b, 'Marca divergente', current_date);
    v_res := v_res || 'FALHA T8: campanha com marca diferente do pai foi aceita';
  exception
    when foreign_key_violation then v_res := v_res || 'ok T8: FK composta rejeita marca divergente';
    when others then v_res := v_res || 'FALHA T8: erro inesperado ' || sqlstate;
  end;

  begin
    insert into public.influenciador_midias (influenciador_id, marca, titulo, url, publicada_em)
    values (v_inf_a, v_marca_a, 'Post http', 'http://instagram.com/reel/x', current_date);
    v_res := v_res || 'FALHA T9: url http foi aceita';
  exception
    when check_violation then v_res := v_res || 'ok T9: url http rejeitada';
    when others then v_res := v_res || 'FALHA T9: erro inesperado ' || sqlstate;
  end;

  begin
    insert into public.influenciador_campanhas (influenciador_id, marca, nome, data_inicio, cache_valor)
    values (v_inf_a, v_marca_a, 'Negativa', current_date, -1);
    v_res := v_res || 'FALHA T10: cache negativo foi aceito';
  exception
    when check_violation then v_res := v_res || 'ok T10: cache negativo rejeitado';
    when others then v_res := v_res || 'FALHA T10: erro inesperado ' || sqlstate;
  end;

  begin
    update public.influenciadores set cupom_exclusivo = true, cupom_codigo = null where id = v_inf_a;
    v_res := v_res || 'FALHA T11: cupom exclusivo sem codigo foi aceito';
  exception
    when check_violation then v_res := v_res || 'ok T11: cupom exclusivo exige codigo';
    when others then v_res := v_res || 'FALHA T11: erro inesperado ' || sqlstate;
  end;

  begin
    insert into public.influenciador_campanhas (influenciador_id, marca, nome, data_inicio, cache_valor, voucher_valor)
    values (v_inf_a, v_marca_a, 'Soma', current_date, 10000, 5000);
    select investimento_total into v_n from public.influenciador_campanhas where nome = 'Soma' and influenciador_id = v_inf_a;
    v_res := v_res || (case when v_n = 15000 then 'ok' else 'FALHA' end) || ' T12: investimento_total = cache + voucher';
  exception when others then
    v_res := v_res || 'FALHA T12: ' || sqlstate;
  end;

  -- O erro abaixo desfaz TODAS as fixtures (a instrucao DO e atomica).
  raise exception E'RELATORIO (este erro e o rollback dos dados de teste)\n%', array_to_string(v_res, E'\n');
end
$$;
```

- [ ] **Step 3: Revisão estática do SQL**

Conferir manualmente, linha a linha:
- Cada tabela tem `enable` + `force row level security` (feito no loop `do $$`).
- Nenhuma tabela recebe grant para `anon`.
- Nomes de constraint não passam de 63 caracteres (`influenciador_seguidores_influenciador_fk` = 41, `influenciador_campanhas_id_influenciador_key` = 44).
- `on delete set null (campanha_id)` presente (exige PG 15+; o projeto é 17.6).
- `gto_set_atualizado_em` e `gto_registrar_auditoria` existem em `20260702_001_init_perfis_logs_rls.sql`.

Run: `Select-String -Path supabase\migrations\20260921_039_influenciadores.sql -Pattern "force row level security|set null \(campanha_id\)|revoke all"`
Expected: as 3 expressões aparecem.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260921_039_influenciadores.sql supabase/checks/20260921_check_influenciadores.sql
git commit -m "feat(influenciadores): migration 039 com RLS por marca e verificacao SQL

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Contrato TypeScript, check-contracts e script de teste

**Files:**
- Create: `src/types/influenciadores.ts`
- Modify: `scripts/check-contracts.mjs` (inserir antes da linha final `console.log('Contract check passed...`)
- Modify: `package.json` (bloco `scripts`)

**Interfaces:**
- Produces: tipos `Influencer`, `Campaign`, `MediaContent`, `FollowerSnapshot`, `Metrics`, `KpiValor`, `InfluencerAggregate` (documentam o formato consumido por `calculos.js`).

- [ ] **Step 1: Escrever o teste que falha (check-contracts estendido)**

No fim de `scripts/check-contracts.mjs`, **antes** da última linha `console.log('Contract check passed: ...')`, inserir:

```js
// --- Modulo Influenciadores -------------------------------------------------------------------
const influenciadoresMigrationPath = 'supabase/migrations/20260921_039_influenciadores.sql';
const influenciadoresRequiredFiles = [
  influenciadoresMigrationPath,
  'supabase/checks/20260921_check_influenciadores.sql',
  'src/types/influenciadores.ts',
  'public/modules/influenciadores/index.js',
  'public/modules/influenciadores/calculos.js',
  'public/modules/influenciadores/service.js'
];
const influenciadoresMissing = influenciadoresRequiredFiles.filter((file) => !existsSync(file));
if (influenciadoresMissing.length > 0) {
  console.error(`Influenciadores: arquivos ausentes: ${influenciadoresMissing.join(', ')}`);
  process.exit(1);
}

const influenciadoresSql = readFileSync(influenciadoresMigrationPath, 'utf8');
const influenciadoresTables = [
  'influenciadores',
  'influenciador_campanhas',
  'influenciador_midias',
  'influenciador_seguidores_historico'
];
for (const table of influenciadoresTables) {
  if (!influenciadoresSql.includes(`create table if not exists public.${table}`)) {
    console.error(`Influenciadores: tabela ausente na migration: ${table}`);
    process.exit(1);
  }
  if (!influenciadoresSql.includes(`'${table}'`)) {
    console.error(`Influenciadores: tabela sem bloco de RLS/policies na migration: ${table}`);
    process.exit(1);
  }
}
if (!influenciadoresSql.includes('public.gto_tem_acesso_marca(marca)')) {
  console.error('Influenciadores: policies nao usam public.gto_tem_acesso_marca(marca).');
  process.exit(1);
}

// Todo campo das interfaces de dominio precisa existir como coluna na migration.
const influenciadoresTypes = readFileSync('src/types/influenciadores.ts', 'utf8');
for (const nome of ['Influencer', 'Campaign', 'MediaContent', 'FollowerSnapshot']) {
  const bloco = influenciadoresTypes.match(new RegExp(`export interface ${nome} \\{([\\s\\S]*?)\\n\\}`));
  if (!bloco) {
    console.error(`Influenciadores: interface ausente em src/types/influenciadores.ts: ${nome}`);
    process.exit(1);
  }
  for (const [, campo] of bloco[1].matchAll(/^\s+(\w+)\??:/gm)) {
    if (!new RegExp(`\\b${campo}\\b`).test(influenciadoresSql)) {
      console.error(`Influenciadores: campo ${nome}.${campo} nao existe na migration.`);
      process.exit(1);
    }
  }
}
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node scripts/check-contracts.mjs`
Expected: FAIL com `Influenciadores: arquivos ausentes: src/types/influenciadores.ts, public/modules/influenciadores/index.js, ...` (os arquivos de `public/modules` só existem nas próximas tasks; esta falha persiste até a Task 9, e o check passa por completo só então).

Para validar esta task isoladamente, rode o check com os arquivos de módulo ainda ausentes e confirme que a mensagem lista **apenas** os 3 de `public/modules/`.

- [ ] **Step 3: Criar o contrato TypeScript**

Criar `src/types/influenciadores.ts`:

```ts
import type { Marca } from './gto';

// Contrato do modulo Influenciadores. Os campos de Influencer, Campaign, MediaContent e
// FollowerSnapshot espelham as colunas de supabase/migrations/20260921_039_influenciadores.sql
// (scripts/check-contracts.mjs confere isso). O front-end do modulo e JavaScript de navegador
// (public/modules/influenciadores/), entao estes tipos documentam o formato; o compilador nao
// checa o JS.

export type Bandeira = Exclude<Marca, 'Todas'>;
export type RedeSocial = 'Instagram' | 'TikTok' | 'YouTube';
export type StatusInfluenciador = 'Ativo' | 'Pausado' | 'Encerrado';
export type FormatoMidia = 'Reel' | 'Feed' | 'Story' | 'Video' | 'Short';
export type FonteMetrica = 'manual' | 'meta_colab' | 'business_discovery';

export interface Influencer {
  id: string;
  marca: Bandeira;
  nome: string;
  handle: string;
  rede_social: RedeSocial;
  verificado: boolean;
  nicho: string | null;
  avatar_path: string | null;
  cupom_codigo: string | null;
  cupom_exclusivo: boolean;
  status: StatusInfluenciador;
  criado_em: string;
  atualizado_em: string;
}

export interface Campaign {
  id: string;
  influenciador_id: string;
  marca: Bandeira;
  nome: string;
  data_inicio: string;
  data_fim: string | null;
  cache_valor: number;
  voucher_valor: number;
  investimento_total: number;
  criado_em: string;
  atualizado_em: string;
}

export interface MediaContent {
  id: string;
  influenciador_id: string;
  marca: Bandeira;
  campanha_id: string | null;
  titulo: string;
  url: string;
  plataforma: RedeSocial | null;
  formato: FormatoMidia | null;
  publicada_em: string;
  views: number;
  alcance: number;
  curtidas: number;
  comentarios: number;
  salvos: number;
  compartilhamentos: number;
  fonte: FonteMetrica;
  criado_em: string;
  atualizado_em: string;
}

export interface FollowerSnapshot {
  id: string;
  influenciador_id: string;
  marca: Bandeira;
  data: string;
  seguidores: number;
  criado_em: string;
}

// Agregados calculados no cliente (public/modules/influenciadores/calculos.js).
export interface KpiValor {
  atual: number | null;
  anterior: number | null;
  variacao: number | null;
}

export interface Metrics {
  investimento: KpiValor;
  alcance: KpiValor;
  engajamento: KpiValor;
  cpe: KpiValor;
  interacoes: KpiValor;
}

export interface InfluencerAggregate {
  seguidores: number | null;
  crescimentoAbs: number | null;
  crescimentoPct: number | null;
  campanhasAtivas: number;
  cacheTotal: number;
  voucherTotal: number;
  investimentoTotal: number;
  alcanceTotal: number;
  totalMidias: number;
}
```

- [ ] **Step 4: Adicionar o script de teste**

Em `package.json`, dentro de `"scripts"`, adicionar a linha (antes de `"sync:netlify"`):

```json
    "test:influenciadores": "node --test \"tests/influenciadores/*.test.js\"",
```

- [ ] **Step 5: Rodar o check e ver o estado esperado**

Run: `node scripts/check-contracts.mjs`
Expected: FAIL listando somente `public/modules/influenciadores/index.js, public/modules/influenciadores/calculos.js, public/modules/influenciadores/service.js` como ausentes (os demais arquivos já existem).

- [ ] **Step 6: Commit**

```bash
git add src/types/influenciadores.ts scripts/check-contracts.mjs package.json
git commit -m "feat(influenciadores): contrato TS, check-contracts e script de teste

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: `html.js` e `calculos.js` (funções puras, TDD)

**Files:**
- Create: `public/modules/influenciadores/html.js`
- Create: `public/modules/influenciadores/calculos.js`
- Test: `tests/influenciadores/html.test.js`
- Test: `tests/influenciadores/calculos.test.js`

**Interfaces:**
- Produces (`html.js`): `escapeHtml(valor: unknown): string`.
- Produces (`calculos.js`):
  - `formatBRL(v)`, `formatBRLInteiro(v)`, `formatInt(v)`, `formatPct(v, casas = 1)`, `formatVariacao(v)`: `string`; `null`/`undefined`/`""`/não-numérico → `"—"`.
  - `mesChave(dataISO): "YYYY-MM"`, `mesAnteriorChave(chave): "YYYY-MM"`, `hojeISO(agora = new Date()): "YYYY-MM-DD"`, `diasEntre(aISO, bISO): number`.
  - `campanhaAtiva(campanha, hojeISO): boolean`.
  - `calcularKpis({ campanhas, midias, mes }): Metrics` (ver `src/types/influenciadores.ts`).
  - `agregarInfluenciador({ campanhas, midias, snapshots }, hojeISO): InfluencerAggregate`.
  - `agruparPorInfluenciador({ influenciadores, campanhas, midias, snapshots }): Map<string, { campanhas, midias, snapshots }>`.
  - `pontosCrescimento(snapshots, quantidade = 7): Array<{ data: string, seguidores: number }>` (ordem crescente).
  - `iniciais(nome): string`, `normalizarTexto(t): string`, `filtrarInfluenciadores(lista, busca)`, `paginar(lista, pagina, tamanho): { itens, pagina, totalPaginas, total }`, `pluralCampanhas(n): string`.

- [ ] **Step 1: Escrever os testes que falham**

`tests/influenciadores/html.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml } from '../../public/modules/influenciadores/html.js';

test('escapeHtml escapa os cinco caracteres perigosos', () => {
  assert.equal(escapeHtml(`<img src=x onerror="a('b')">&`), '&lt;img src=x onerror=&quot;a(&#039;b&#039;)&quot;&gt;&amp;');
});

test('escapeHtml trata null e undefined como texto vazio', () => {
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
});

test('escapeHtml converte numeros em texto', () => {
  assert.equal(escapeHtml(42), '42');
});
```

`tests/influenciadores/calculos.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatBRL, formatBRLInteiro, formatInt, formatPct, formatVariacao,
  mesChave, mesAnteriorChave, hojeISO, diasEntre, campanhaAtiva,
  calcularKpis, agregarInfluenciador, agruparPorInfluenciador, pontosCrescimento,
  iniciais, normalizarTexto, filtrarInfluenciadores, paginar, pluralCampanhas
} from '../../public/modules/influenciadores/calculos.js';

const quase = (a, b, margem = 1e-9) => assert.ok(Math.abs(a - b) < margem, `${a} != ${b}`);

test('formatadores pt-BR', () => {
  assert.equal(formatBRL(45000), 'R$ 45.000,00');
  assert.equal(formatBRL(0.38), 'R$ 0,38');
  assert.equal(formatBRLInteiro(10000), 'R$ 10.000');
  assert.equal(formatInt(12850400), '12.850.400');
  assert.equal(formatPct(4.12, 2), '4,12%');
  assert.equal(formatPct(3.25), '3,3%');
});

test('formatadores devolvem travessao para valor ausente', () => {
  for (const f of [formatBRL, formatBRLInteiro, formatInt, formatPct, formatVariacao]) {
    assert.equal(f(null), '—');
    assert.equal(f(undefined), '—');
    assert.equal(f(''), '—');
    assert.equal(f('abc'), '—');
  }
});

test('formatVariacao usa sinal explicito', () => {
  assert.equal(formatVariacao(40.625), '+40,6%');
  assert.equal(formatVariacao(-15.5), '-15,5%');
  assert.equal(formatVariacao(0), '0,0%');
});

test('mesChave e mesAnteriorChave', () => {
  assert.equal(mesChave('2026-09-21'), '2026-09');
  assert.equal(mesAnteriorChave('2026-09'), '2026-08');
  assert.equal(mesAnteriorChave('2026-01'), '2025-12');
});

test('hojeISO usa a data local, nao UTC', () => {
  assert.equal(hojeISO(new Date(2026, 8, 21, 23, 30)), '2026-09-21');
  assert.equal(hojeISO(new Date(2026, 0, 5, 0, 5)), '2026-01-05');
});

test('diasEntre', () => {
  assert.equal(diasEntre('2026-09-14', '2026-09-21'), 7);
  assert.equal(diasEntre('2026-08-31', '2026-09-01'), 1);
});

test('campanhaAtiva respeita as bordas', () => {
  const c = (data_inicio, data_fim) => ({ data_inicio, data_fim });
  assert.equal(campanhaAtiva(c('2026-09-05', null), '2026-09-21'), true);
  assert.equal(campanhaAtiva(c('2026-09-21', '2026-09-21'), '2026-09-21'), true);
  assert.equal(campanhaAtiva(c('2026-09-01', '2026-09-20'), '2026-09-21'), false);
  assert.equal(campanhaAtiva(c('2026-09-22', null), '2026-09-21'), false);
});

const campanhas = [
  { influenciador_id: 'i1', data_inicio: '2026-09-05', data_fim: null, cache_valor: 20000, voucher_valor: 10000, investimento_total: 30000 },
  { influenciador_id: 'i1', data_inicio: '2026-09-20', data_fim: '2026-09-25', cache_valor: 10000, voucher_valor: 5000, investimento_total: 15000 },
  { influenciador_id: 'i2', data_inicio: '2026-08-10', data_fim: '2026-08-31', cache_valor: 30000, voucher_valor: 2000, investimento_total: 32000 }
];
const midias = [
  { influenciador_id: 'i1', publicada_em: '2026-09-10', alcance: 1000000, curtidas: 40000, comentarios: 2000, salvos: 5000, compartilhamentos: 3000 },
  { influenciador_id: 'i1', publicada_em: '2026-09-15', alcance: 3000000, curtidas: 60000, comentarios: 4000, salvos: 10000, compartilhamentos: 6000 },
  { influenciador_id: 'i2', publicada_em: '2026-08-12', alcance: 2000000, curtidas: 30000, comentarios: 3000, salvos: 4000, compartilhamentos: 3000 }
];

test('calcularKpis compara o mes com o anterior', () => {
  const k = calcularKpis({ campanhas, midias, mes: '2026-09' });
  assert.equal(k.investimento.atual, 45000);
  assert.equal(k.investimento.anterior, 32000);
  quase(k.investimento.variacao, 40.625);
  assert.equal(k.alcance.atual, 4000000);
  assert.equal(k.alcance.anterior, 2000000);
  quase(k.alcance.variacao, 100);
  assert.equal(k.interacoes.atual, 130000);
  quase(k.engajamento.atual, 3.25);
  quase(k.engajamento.anterior, 2);
  quase(k.engajamento.variacao, 62.5);
  quase(k.cpe.atual, 45000 / 130000);
  quase(k.cpe.anterior, 0.8);
  quase(k.cpe.variacao, ((45000 / 130000 - 0.8) / 0.8) * 100);
});

test('calcularKpis sem base anterior devolve variacao nula, nunca infinito', () => {
  const k = calcularKpis({ campanhas, midias, mes: '2026-08' });
  assert.equal(k.investimento.anterior, 0);
  assert.equal(k.investimento.variacao, null);
  assert.equal(k.alcance.variacao, null);
});

test('calcularKpis em mes sem dados nao gera NaN', () => {
  const k = calcularKpis({ campanhas, midias, mes: '2026-10' });
  assert.equal(k.investimento.atual, 0);
  assert.equal(k.alcance.atual, 0);
  assert.equal(k.engajamento.atual, null);
  assert.equal(k.cpe.atual, null);
  quase(k.investimento.variacao, -100);
  assert.equal(k.engajamento.variacao, null);
});

test('calcularKpis tolera listas vazias e valores em texto', () => {
  const k = calcularKpis({ campanhas: [], midias: [], mes: '2026-09' });
  assert.equal(k.investimento.atual, 0);
  const t = calcularKpis({
    campanhas: [{ data_inicio: '2026-09-01', investimento_total: '1500.50' }],
    midias: [], mes: '2026-09'
  });
  assert.equal(t.investimento.atual, 1500.5);
});

const snapshots = [
  { data: '2026-09-17', seguidores: 1432600 },
  { data: '2026-09-10', seguidores: 1400000 },
  { data: '2026-09-21', seguidores: 1450000 },
  { data: '2026-09-14', seguidores: 1420000 }
];

test('agregarInfluenciador calcula crescimento com base de pelo menos 7 dias', () => {
  const a = agregarInfluenciador({
    campanhas: campanhas.filter((c) => c.influenciador_id === 'i1'),
    midias: midias.filter((m) => m.influenciador_id === 'i1'),
    snapshots
  }, '2026-09-21');
  assert.equal(a.seguidores, 1450000);
  assert.equal(a.crescimentoAbs, 30000);
  quase(a.crescimentoPct, (30000 / 1420000) * 100);
  assert.equal(a.campanhasAtivas, 2);
  assert.equal(a.cacheTotal, 30000);
  assert.equal(a.voucherTotal, 15000);
  assert.equal(a.investimentoTotal, 45000);
  assert.equal(a.alcanceTotal, 4000000);
  assert.equal(a.totalMidias, 2);
});

test('agregarInfluenciador sem snapshot com 7 dias de distancia nao inventa crescimento', () => {
  const a = agregarInfluenciador({
    campanhas: [], midias: [],
    snapshots: [{ data: '2026-09-18', seguidores: 100 }, { data: '2026-09-21', seguidores: 130 }]
  }, '2026-09-21');
  assert.equal(a.seguidores, 130);
  assert.equal(a.crescimentoAbs, null);
  assert.equal(a.crescimentoPct, null);
});

test('agregarInfluenciador sem nenhum dado', () => {
  const a = agregarInfluenciador({ campanhas: [], midias: [], snapshots: [] }, '2026-09-21');
  assert.equal(a.seguidores, null);
  assert.equal(a.crescimentoPct, null);
  assert.equal(a.campanhasAtivas, 0);
  assert.equal(a.investimentoTotal, 0);
});

test('agruparPorInfluenciador distribui os dados por id', () => {
  const mapa = agruparPorInfluenciador({
    influenciadores: [{ id: 'i1' }, { id: 'i2' }, { id: 'i3' }],
    campanhas, midias,
    snapshots: [{ influenciador_id: 'i2', data: '2026-09-01', seguidores: 1 }]
  });
  assert.equal(mapa.get('i1').campanhas.length, 2);
  assert.equal(mapa.get('i2').midias.length, 1);
  assert.equal(mapa.get('i2').snapshots.length, 1);
  assert.deepEqual(mapa.get('i3'), { campanhas: [], midias: [], snapshots: [] });
});

test('pontosCrescimento ordena e limita aos ultimos N', () => {
  const p = pontosCrescimento(snapshots, 3);
  assert.deepEqual(p.map((x) => x.data), ['2026-09-14', '2026-09-17', '2026-09-21']);
  assert.equal(p[2].seguidores, 1450000);
});

test('iniciais', () => {
  assert.equal(iniciais('Isabela Lima'), 'IL');
  assert.equal(iniciais('Rodrigo de Albuquerque'), 'RA');
  assert.equal(iniciais('Camila'), 'CA');
  assert.equal(iniciais('  '), '?');
});

test('normalizarTexto remove acento e caixa', () => {
  assert.equal(normalizarTexto('  Calçados Ç  '), 'calcados c');
});

const lista = [
  { nome: 'Isabela Lima', handle: '@isabelalima.style', nicho: 'Moda & Varejo' },
  { nome: 'Lucas Martins', handle: '@lucasmartins.oficial', nicho: null },
  { nome: 'Mariana Souza', handle: '@mari.achadinhos', nicho: 'Achadinhos' }
];

test('filtrarInfluenciadores busca por nome, @ ou nicho sem acento', () => {
  assert.equal(filtrarInfluenciadores(lista, '').length, 3);
  assert.deepEqual(filtrarInfluenciadores(lista, 'ISABELA').map((i) => i.nome), ['Isabela Lima']);
  assert.deepEqual(filtrarInfluenciadores(lista, '@mari').map((i) => i.nome), ['Mariana Souza']);
  assert.deepEqual(filtrarInfluenciadores(lista, 'varejo').map((i) => i.nome), ['Isabela Lima']);
  assert.equal(filtrarInfluenciadores(lista, 'nao existe').length, 0);
});

test('paginar limita a pagina ao intervalo valido', () => {
  const itens = Array.from({ length: 18 }, (_, i) => i);
  const p1 = paginar(itens, 1, 5);
  assert.equal(p1.itens.length, 5);
  assert.equal(p1.totalPaginas, 4);
  assert.equal(p1.total, 18);
  assert.deepEqual(paginar(itens, 4, 5).itens, [15, 16, 17]);
  assert.equal(paginar(itens, 99, 5).pagina, 4);
  assert.equal(paginar(itens, 0, 5).pagina, 1);
  const vazio = paginar([], 3, 5);
  assert.equal(vazio.pagina, 1);
  assert.equal(vazio.totalPaginas, 1);
});

test('pluralCampanhas', () => {
  assert.equal(pluralCampanhas(0), '0 campanhas');
  assert.equal(pluralCampanhas(1), '1 campanha');
  assert.equal(pluralCampanhas(3), '3 campanhas');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:influenciadores`
Expected: FAIL com `Cannot find module '.../public/modules/influenciadores/html.js'`.

- [ ] **Step 3: Implementar `html.js`**

`public/modules/influenciadores/html.js`:

```js
// Copia do escapeHtml de public/index.html (mesmo comportamento) para manter os componentes do
// modulo puros e testaveis sem injecao de dependencia.
export function escapeHtml(valor) {
  return String(valor ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#039;");
}
```

- [ ] **Step 4: Implementar `calculos.js`**

`public/modules/influenciadores/calculos.js`:

```js
// Funcoes puras do modulo Influenciadores: formatacao pt-BR, KPIs, agregados, busca e paginacao.
// Sem acesso a DOM nem a rede - tudo testavel com node --test.

const ESPACOS = /[  ]/g;
const MENOS_UNICODE = /−/g;

function numeroOuNull(valor) {
  if (valor === null || valor === undefined || valor === "") return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

function paraNumero(valor) {
  return numeroOuNull(valor) ?? 0;
}

function limpar(texto) {
  return texto.replace(ESPACOS, " ").replace(MENOS_UNICODE, "-");
}

function soma(lista, campo) {
  return lista.reduce((total, item) => total + paraNumero(item[campo]), 0);
}

// Formatacao -------------------------------------------------------------------------------------
export function formatBRL(valor) {
  const n = numeroOuNull(valor);
  if (n === null) return "—";
  return limpar(new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n));
}

export function formatBRLInteiro(valor) {
  const n = numeroOuNull(valor);
  if (n === null) return "—";
  return limpar(new Intl.NumberFormat("pt-BR", {
    style: "currency", currency: "BRL", minimumFractionDigits: 0, maximumFractionDigits: 0
  }).format(n));
}

export function formatInt(valor) {
  const n = numeroOuNull(valor);
  if (n === null) return "—";
  return limpar(new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(n));
}

// valor ja em porcentagem (4.12 => "4,12%").
export function formatPct(valor, casas = 1) {
  const n = numeroOuNull(valor);
  if (n === null) return "—";
  return `${limpar(new Intl.NumberFormat("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas }).format(n))}%`;
}

export function formatVariacao(valor) {
  const n = numeroOuNull(valor);
  if (n === null) return "—";
  const texto = new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: "exceptZero"
  }).format(n);
  return `${limpar(texto)}%`;
}

// Datas (strings ISO YYYY-MM-DD) ------------------------------------------------------------------
export function mesChave(dataISO) {
  return String(dataISO ?? "").slice(0, 7);
}

export function mesAnteriorChave(chave) {
  const [ano, mes] = chave.split("-").map(Number);
  const anterior = new Date(Date.UTC(ano, mes - 2, 1));
  return `${anterior.getUTCFullYear()}-${String(anterior.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function hojeISO(agora = new Date()) {
  const mes = String(agora.getMonth() + 1).padStart(2, "0");
  const dia = String(agora.getDate()).padStart(2, "0");
  return `${agora.getFullYear()}-${mes}-${dia}`;
}

export function diasEntre(aISO, bISO) {
  return Math.round((Date.parse(`${bISO}T00:00:00Z`) - Date.parse(`${aISO}T00:00:00Z`)) / 86400000);
}

export function campanhaAtiva(campanha, hoje) {
  return campanha.data_inicio <= hoje && (!campanha.data_fim || campanha.data_fim >= hoje);
}

// KPIs do topo -----------------------------------------------------------------------------------
function variacao(atual, anterior) {
  if (atual === null || anterior === null || anterior === 0) return null;
  return ((atual - anterior) / anterior) * 100;
}

function totaisDoMes(campanhas, midias, mes) {
  const investimento = soma(campanhas.filter((c) => mesChave(c.data_inicio) === mes), "investimento_total");
  const doMes = midias.filter((m) => mesChave(m.publicada_em) === mes);
  const alcance = soma(doMes, "alcance");
  const interacoes = doMes.reduce(
    (total, m) => total + paraNumero(m.curtidas) + paraNumero(m.comentarios) + paraNumero(m.salvos) + paraNumero(m.compartilhamentos),
    0
  );
  return {
    investimento,
    alcance,
    interacoes,
    engajamento: alcance > 0 ? (interacoes / alcance) * 100 : null,
    cpe: interacoes > 0 ? investimento / interacoes : null
  };
}

export function calcularKpis({ campanhas, midias, mes }) {
  const atual = totaisDoMes(campanhas, midias, mes);
  const anterior = totaisDoMes(campanhas, midias, mesAnteriorChave(mes));
  const par = (chave) => ({ atual: atual[chave], anterior: anterior[chave], variacao: variacao(atual[chave], anterior[chave]) });
  return {
    investimento: par("investimento"),
    alcance: par("alcance"),
    engajamento: par("engajamento"),
    cpe: par("cpe"),
    interacoes: par("interacoes")
  };
}

// Por influenciador ------------------------------------------------------------------------------
function ordenarSnapshots(snapshots) {
  return [...snapshots].sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));
}

export function agregarInfluenciador({ campanhas, midias, snapshots }, hoje) {
  const ordenados = ordenarSnapshots(snapshots);
  const ultimo = ordenados.length > 0 ? ordenados[ordenados.length - 1] : null;

  // Base do crescimento: snapshot mais recente com >= 7 dias de distancia do ultimo.
  let base = null;
  if (ultimo) {
    for (let i = ordenados.length - 2; i >= 0; i -= 1) {
      if (diasEntre(ordenados[i].data, ultimo.data) >= 7) {
        base = ordenados[i];
        break;
      }
    }
  }

  const seguidores = ultimo ? paraNumero(ultimo.seguidores) : null;
  const baseSeguidores = base ? paraNumero(base.seguidores) : null;
  const crescimentoAbs = base ? seguidores - baseSeguidores : null;
  const crescimentoPct = base && baseSeguidores > 0 ? (crescimentoAbs / baseSeguidores) * 100 : null;

  return {
    seguidores,
    crescimentoAbs,
    crescimentoPct,
    campanhasAtivas: campanhas.filter((c) => campanhaAtiva(c, hoje)).length,
    cacheTotal: soma(campanhas, "cache_valor"),
    voucherTotal: soma(campanhas, "voucher_valor"),
    investimentoTotal: soma(campanhas, "investimento_total"),
    alcanceTotal: soma(midias, "alcance"),
    totalMidias: midias.length
  };
}

export function agruparPorInfluenciador({ influenciadores, campanhas, midias, snapshots }) {
  const mapa = new Map(influenciadores.map((i) => [i.id, { campanhas: [], midias: [], snapshots: [] }]));
  for (const c of campanhas) mapa.get(c.influenciador_id)?.campanhas.push(c);
  for (const m of midias) mapa.get(m.influenciador_id)?.midias.push(m);
  for (const s of snapshots) mapa.get(s.influenciador_id)?.snapshots.push(s);
  return mapa;
}

export function pontosCrescimento(snapshots, quantidade = 7) {
  return ordenarSnapshots(snapshots)
    .slice(-quantidade)
    .map((s) => ({ data: s.data, seguidores: paraNumero(s.seguidores) }));
}

// Texto, busca e paginacao -----------------------------------------------------------------------
export function iniciais(nome) {
  const partes = String(nome ?? "").trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "?";
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

export function normalizarTexto(texto) {
  return String(texto ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

export function filtrarInfluenciadores(lista, busca) {
  const termo = normalizarTexto(busca);
  if (!termo) return lista;
  return lista.filter((i) => normalizarTexto(`${i.nome} ${i.handle} ${i.nicho ?? ""}`).includes(termo));
}

export function paginar(lista, pagina, tamanho) {
  const total = lista.length;
  const totalPaginas = Math.max(1, Math.ceil(total / tamanho));
  const atual = Math.min(Math.max(1, Number(pagina) || 1), totalPaginas);
  return { itens: lista.slice((atual - 1) * tamanho, atual * tamanho), pagina: atual, totalPaginas, total };
}

export function pluralCampanhas(n) {
  return `${n} ${n === 1 ? "campanha" : "campanhas"}`;
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npm run test:influenciadores`
Expected: todos os testes de `html.test.js` e `calculos.test.js` passam (`fail 0`).

- [ ] **Step 6: Commit**

```bash
git add public/modules/influenciadores/html.js public/modules/influenciadores/calculos.js tests/influenciadores/html.test.js tests/influenciadores/calculos.test.js
git commit -m "feat(influenciadores): calculos puros de KPIs, agregados, busca e paginacao

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: `validacao.js` (TDD)

**Files:**
- Create: `public/modules/influenciadores/validacao.js`
- Test: `tests/influenciadores/validacao.test.js`

**Interfaces:**
- Produces:
  - Constantes: `REDES = ["Instagram","TikTok","YouTube"]`, `STATUS = ["Ativo","Pausado","Encerrado"]`, `FORMATOS = ["Reel","Feed","Story","Video","Short"]`, `MARCAS_VALIDAS = ["Tesoura de Ouro","Magazine da Economia","Free Center Calçados"]`.
  - `parseNumeroBR(texto): number` (`NaN` se inválido), `parseInteiro(texto): number` (`""` → `0`; inválido → `NaN`).
  - `detectarPlataforma(url): "Instagram"|"TikTok"|"YouTube"|null`.
  - `validarInfluenciador(dados, marcasValidas = MARCAS_VALIDAS): { ok, erros, valor }`.
  - `validarCampanha(dados): { ok, erros, valor }` com `valor = { nome, data_inicio, data_fim, cache_valor, voucher_valor }`.
  - `validarMidia(dados): { ok, erros, valor }`.
  - `validarSeguidores({ data, seguidores }, hoje): { ok, erros, valor }`.
  - `validarAvatar(arquivo): { ok, erro }` (espera `{ type, size }`).
  - `erros` é um objeto `{ campo: "mensagem em pt-BR" }`.

- [ ] **Step 1: Escrever os testes que falham**

`tests/influenciadores/validacao.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MARCAS_VALIDAS, parseNumeroBR, parseInteiro, detectarPlataforma,
  validarInfluenciador, validarCampanha, validarMidia, validarSeguidores, validarAvatar
} from '../../public/modules/influenciadores/validacao.js';

test('parseNumeroBR aceita formatos brasileiro e internacional', () => {
  assert.equal(parseNumeroBR('10.000,50'), 10000.5);
  assert.equal(parseNumeroBR('10.000'), 10000);
  assert.equal(parseNumeroBR('10000.5'), 10000.5);
  assert.equal(parseNumeroBR('1,5'), 1.5);
  assert.equal(parseNumeroBR('R$ 2.500,00'), 2500);
  assert.equal(parseNumeroBR('0'), 0);
  assert.ok(Number.isNaN(parseNumeroBR('abc')));
  assert.ok(Number.isNaN(parseNumeroBR('')));
});

test('parseInteiro aceita separador de milhar e vazio como zero', () => {
  assert.equal(parseInteiro('1.840.000'), 1840000);
  assert.equal(parseInteiro('  94200 '), 94200);
  assert.equal(parseInteiro(''), 0);
  assert.ok(Number.isNaN(parseInteiro('12,5')));
  assert.ok(Number.isNaN(parseInteiro('-3')));
});

test('detectarPlataforma pelo dominio', () => {
  assert.equal(detectarPlataforma('https://www.instagram.com/reel/C8x9L_p/'), 'Instagram');
  assert.equal(detectarPlataforma('https://vm.tiktok.com/abc'), 'TikTok');
  assert.equal(detectarPlataforma('https://youtu.be/abc'), 'YouTube');
  assert.equal(detectarPlataforma('https://www.youtube.com/shorts/abc'), 'YouTube');
  assert.equal(detectarPlataforma('https://exemplo.com/x'), null);
  assert.equal(detectarPlataforma('nao e url'), null);
});

const influenciadorValido = {
  marca: 'Tesoura de Ouro', nome: '  Isabela Lima ', handle: 'isabelalima.style', rede_social: 'Instagram',
  verificado: true, nicho: 'Moda & Varejo', cupom_codigo: 'tesoura10', cupom_exclusivo: true, status: 'Ativo'
};

test('validarInfluenciador normaliza handle, nome e cupom', () => {
  const r = validarInfluenciador(influenciadorValido);
  assert.equal(r.ok, true);
  assert.deepEqual(r.valor, {
    marca: 'Tesoura de Ouro', nome: 'Isabela Lima', handle: '@isabelalima.style', rede_social: 'Instagram',
    verificado: true, nicho: 'Moda & Varejo', cupom_codigo: 'TESOURA10', cupom_exclusivo: true, status: 'Ativo'
  });
});

test('validarInfluenciador transforma campos vazios opcionais em null', () => {
  const r = validarInfluenciador({ ...influenciadorValido, nicho: ' ', cupom_codigo: '', cupom_exclusivo: false });
  assert.equal(r.ok, true);
  assert.equal(r.valor.nicho, null);
  assert.equal(r.valor.cupom_codigo, null);
});

test('validarInfluenciador rejeita dados invalidos com mensagens em portugues', () => {
  const r = validarInfluenciador({
    marca: 'Outra', nome: 'A', handle: '@a b', rede_social: 'Kwai', status: 'X',
    nicho: 'x'.repeat(61), cupom_codigo: 'a', cupom_exclusivo: false
  });
  assert.equal(r.ok, false);
  for (const campo of ['marca', 'nome', 'handle', 'rede_social', 'status', 'nicho', 'cupom_codigo']) {
    assert.equal(typeof r.erros[campo], 'string', `esperava erro em ${campo}`);
  }
});

test('validarInfluenciador exige codigo quando o cupom e exclusivo', () => {
  const r = validarInfluenciador({ ...influenciadorValido, cupom_codigo: '', cupom_exclusivo: true });
  assert.equal(r.ok, false);
  assert.match(r.erros.cupom_codigo, /cupom/i);
});

test('validarCampanha converte valores e datas', () => {
  const r = validarCampanha({
    nome: ' Campanha dos Pais 2026 ', data_inicio: '2026-08-01', data_fim: '',
    cache_valor: '10.000,00', voucher_valor: '5000'
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.valor, {
    nome: 'Campanha dos Pais 2026', data_inicio: '2026-08-01', data_fim: null, cache_valor: 10000, voucher_valor: 5000
  });
});

test('validarCampanha trata valores vazios como zero', () => {
  const r = validarCampanha({ nome: 'X', data_inicio: '2026-08-01', data_fim: '', cache_valor: '', voucher_valor: '' });
  assert.equal(r.ok, true);
  assert.equal(r.valor.cache_valor, 0);
  assert.equal(r.valor.voucher_valor, 0);
});

test('validarCampanha rejeita periodo invertido, data inexistente e valor negativo', () => {
  assert.match(validarCampanha({ nome: 'X', data_inicio: '2026-08-10', data_fim: '2026-08-01', cache_valor: '0', voucher_valor: '0' }).erros.data_fim, /fim/i);
  assert.ok(validarCampanha({ nome: 'X', data_inicio: '2026-02-30', data_fim: '', cache_valor: '0', voucher_valor: '0' }).erros.data_inicio);
  assert.ok(validarCampanha({ nome: '', data_inicio: '2026-08-01', data_fim: '', cache_valor: '-5', voucher_valor: 'abc' }).erros.nome);
  const r = validarCampanha({ nome: 'X', data_inicio: '2026-08-01', data_fim: '', cache_valor: '-5', voucher_valor: 'abc' });
  assert.ok(r.erros.cache_valor);
  assert.ok(r.erros.voucher_valor);
});

const midiaValida = {
  titulo: 'Reel: Provador Tesoura de Ouro', url: 'https://www.instagram.com/reel/C8x9L_p/', plataforma: '',
  formato: 'Reel', publicada_em: '2026-09-10', campanha_id: '',
  views: '1.840.000', alcance: '4.230.000', curtidas: '94.200', comentarios: '', salvos: '14.800', compartilhamentos: '0'
};

test('validarMidia detecta a plataforma pela URL e converte metricas', () => {
  const r = validarMidia(midiaValida);
  assert.equal(r.ok, true);
  assert.equal(r.valor.plataforma, 'Instagram');
  assert.equal(r.valor.views, 1840000);
  assert.equal(r.valor.comentarios, 0);
  assert.equal(r.valor.campanha_id, null);
  assert.equal(r.valor.url, 'https://www.instagram.com/reel/C8x9L_p/');
});

test('validarMidia rejeita http, javascript: e URL invalida', () => {
  assert.ok(validarMidia({ ...midiaValida, url: 'http://instagram.com/reel/x' }).erros.url);
  assert.ok(validarMidia({ ...midiaValida, url: 'javascript:alert(1)' }).erros.url);
  assert.ok(validarMidia({ ...midiaValida, url: 'instagram.com/reel/x' }).erros.url);
  assert.ok(validarMidia({ ...midiaValida, url: 'https://a.com/' + 'x'.repeat(500) }).erros.url);
});

test('validarMidia exige plataforma quando o dominio nao e reconhecido', () => {
  const r = validarMidia({ ...midiaValida, url: 'https://blog.exemplo.com/post', plataforma: '' });
  assert.ok(r.erros.plataforma);
  assert.equal(validarMidia({ ...midiaValida, url: 'https://blog.exemplo.com/post', plataforma: 'YouTube' }).ok, true);
});

test('validarMidia rejeita metrica invalida e formato desconhecido', () => {
  const r = validarMidia({ ...midiaValida, views: '12,5', formato: 'Podcast', publicada_em: '' });
  assert.ok(r.erros.views);
  assert.ok(r.erros.formato);
  assert.ok(r.erros.publicada_em);
});

test('validarSeguidores', () => {
  assert.deepEqual(validarSeguidores({ data: '2026-09-21', seguidores: '1.450.000' }, '2026-09-21').valor, { data: '2026-09-21', seguidores: 1450000 });
  assert.ok(validarSeguidores({ data: '2026-09-22', seguidores: '10' }, '2026-09-21').erros.data);
  assert.ok(validarSeguidores({ data: '2026-09-21', seguidores: '' }, '2026-09-21').erros.seguidores);
  assert.ok(validarSeguidores({ data: '2026-09-21', seguidores: '-1' }, '2026-09-21').erros.seguidores);
});

test('validarAvatar limita tipo e tamanho', () => {
  assert.equal(validarAvatar({ type: 'image/png', size: 500000 }).ok, true);
  assert.equal(validarAvatar({ type: 'image/webp', size: 1048576 }).ok, true);
  assert.equal(validarAvatar({ type: 'image/gif', size: 100 }).ok, false);
  assert.equal(validarAvatar({ type: 'image/jpeg', size: 1048577 }).ok, false);
  assert.match(validarAvatar({ type: 'image/jpeg', size: 2000000 }).erro, /1 MB/);
});

test('MARCAS_VALIDAS lista as tres bandeiras', () => {
  assert.deepEqual(MARCAS_VALIDAS, ['Tesoura de Ouro', 'Magazine da Economia', 'Free Center Calçados']);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:influenciadores`
Expected: FAIL com `Cannot find module '.../validacao.js'` (os testes da Task 3 continuam passando).

- [ ] **Step 3: Implementar `validacao.js`**

`public/modules/influenciadores/validacao.js`:

```js
// Validacao e normalizacao dos formularios do modulo. Espelha as constraints da migration 039
// (o banco continua sendo a barreira real); aqui o objetivo e dar mensagem em portugues antes do
// round-trip. Funcoes puras.

export const REDES = ["Instagram", "TikTok", "YouTube"];
export const STATUS = ["Ativo", "Pausado", "Encerrado"];
export const FORMATOS = ["Reel", "Feed", "Story", "Video", "Short"];
export const MARCAS_VALIDAS = ["Tesoura de Ouro", "Magazine da Economia", "Free Center Calçados"];

const TIPOS_AVATAR = ["image/jpeg", "image/png", "image/webp"];
const LIMITE_AVATAR = 1048576;
const LIMITE_NUMERIC = 9999999999.99;

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function dataValida(texto) {
  if (!ISO.test(String(texto ?? ""))) return false;
  const [a, m, d] = texto.split("-").map(Number);
  const data = new Date(Date.UTC(a, m - 1, d));
  return data.getUTCFullYear() === a && data.getUTCMonth() === m - 1 && data.getUTCDate() === d;
}

// "10.000,50" -> 10000.5 | "10.000" -> 10000 (padrao de milhar) | "10000.5" -> 10000.5
export function parseNumeroBR(texto) {
  let t = String(texto ?? "").replace(/R\$/gi, "").replace(/\s/g, "");
  if (t === "") return NaN;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : NaN;
}

// Inteiro nao negativo; vazio conta como 0 (metricas sao opcionais).
export function parseInteiro(texto) {
  const t = String(texto ?? "").replace(/\s/g, "").replace(/\./g, "");
  if (t === "") return 0;
  return /^\d+$/.test(t) ? Number(t) : NaN;
}

export function detectarPlataforma(url) {
  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  const e = (dominio) => host === dominio || host.endsWith(`.${dominio}`);
  if (e("instagram.com")) return "Instagram";
  if (e("tiktok.com")) return "TikTok";
  if (e("youtube.com") || e("youtu.be")) return "YouTube";
  return null;
}

function resultado(erros, valor) {
  return { ok: Object.keys(erros).length === 0, erros, valor };
}

export function validarInfluenciador(dados, marcasValidas = MARCAS_VALIDAS) {
  const erros = {};
  const nome = String(dados.nome ?? "").trim();
  if (nome.length < 2 || nome.length > 120) erros.nome = "Informe o nome (2 a 120 caracteres).";

  let handle = String(dados.handle ?? "").trim();
  if (handle && !handle.startsWith("@")) handle = `@${handle}`;
  if (!/^@[A-Za-z0-9._]{2,50}$/.test(handle)) {
    erros.handle = "Use o @ do perfil com letras, números, ponto ou sublinhado (2 a 50 caracteres).";
  }

  if (!REDES.includes(dados.rede_social)) erros.rede_social = "Escolha a rede social.";
  if (!STATUS.includes(dados.status)) erros.status = "Escolha o status.";
  if (!marcasValidas.includes(dados.marca)) erros.marca = "Escolha a bandeira.";

  const nicho = String(dados.nicho ?? "").trim();
  if (nicho.length > 60) erros.nicho = "Máximo de 60 caracteres.";

  const cupom = String(dados.cupom_codigo ?? "").trim().toUpperCase();
  if (cupom && !/^[A-Z0-9_-]{2,30}$/.test(cupom)) {
    erros.cupom_codigo = "Use 2 a 30 letras, números, hífen ou sublinhado.";
  }
  const exclusivo = Boolean(dados.cupom_exclusivo);
  if (exclusivo && !cupom) erros.cupom_codigo = "Informe o código do cupom exclusivo.";

  return resultado(erros, {
    marca: dados.marca,
    nome,
    handle,
    rede_social: dados.rede_social,
    verificado: Boolean(dados.verificado),
    nicho: nicho || null,
    cupom_codigo: cupom || null,
    cupom_exclusivo: exclusivo,
    status: dados.status
  });
}

function valorMonetario(texto, erros, campo) {
  if (String(texto ?? "").trim() === "") return 0;
  const n = parseNumeroBR(texto);
  if (!Number.isFinite(n) || n < 0 || n > LIMITE_NUMERIC) {
    erros[campo] = "Informe um valor em reais maior ou igual a zero.";
    return 0;
  }
  return Math.round(n * 100) / 100;
}

export function validarCampanha(dados) {
  const erros = {};
  const nome = String(dados.nome ?? "").trim();
  if (nome.length < 1 || nome.length > 120) erros.nome = "Informe o nome da campanha (até 120 caracteres).";

  const inicio = String(dados.data_inicio ?? "").trim();
  if (!dataValida(inicio)) erros.data_inicio = "Informe uma data de início válida.";

  const fim = String(dados.data_fim ?? "").trim();
  if (fim && !dataValida(fim)) erros.data_fim = "Informe uma data de fim válida.";
  else if (fim && !erros.data_inicio && fim < inicio) erros.data_fim = "A data de fim não pode ser anterior ao início.";

  const cache_valor = valorMonetario(dados.cache_valor, erros, "cache_valor");
  const voucher_valor = valorMonetario(dados.voucher_valor, erros, "voucher_valor");

  return resultado(erros, { nome, data_inicio: inicio, data_fim: fim || null, cache_valor, voucher_valor });
}

const CAMPOS_METRICA = ["views", "alcance", "curtidas", "comentarios", "salvos", "compartilhamentos"];

export function validarMidia(dados) {
  const erros = {};
  const titulo = String(dados.titulo ?? "").trim();
  if (titulo.length < 1 || titulo.length > 160) erros.titulo = "Informe o título (até 160 caracteres).";

  const url = String(dados.url ?? "").trim();
  let urlOk = false;
  try {
    const u = new URL(url);
    urlOk = u.protocol === "https:" && url.length <= 500 && !/\s/.test(url);
  } catch {
    urlOk = false;
  }
  if (!urlOk) erros.url = "Informe uma URL https:// válida (até 500 caracteres).";

  let plataforma = String(dados.plataforma ?? "").trim();
  if (!plataforma && urlOk) plataforma = detectarPlataforma(url) ?? "";
  if (!REDES.includes(plataforma)) erros.plataforma = "Não reconheci a rede pela URL. Escolha a plataforma.";

  const formato = String(dados.formato ?? "").trim();
  if (!FORMATOS.includes(formato)) erros.formato = "Escolha o formato.";

  const publicada_em = String(dados.publicada_em ?? "").trim();
  if (!dataValida(publicada_em)) erros.publicada_em = "Informe a data de publicação.";

  const valor = { titulo, url, plataforma, formato, publicada_em, campanha_id: String(dados.campanha_id ?? "").trim() || null };
  for (const campo of CAMPOS_METRICA) {
    const n = parseInteiro(dados[campo]);
    if (!Number.isSafeInteger(n)) {
      erros[campo] = "Use apenas números inteiros.";
      valor[campo] = 0;
    } else {
      valor[campo] = n;
    }
  }
  return resultado(erros, valor);
}

export function validarSeguidores({ data, seguidores }, hoje) {
  const erros = {};
  const dia = String(data ?? "").trim();
  if (!dataValida(dia)) erros.data = "Informe uma data válida.";
  else if (dia > hoje) erros.data = "A data não pode ser futura.";

  const texto = String(seguidores ?? "").trim();
  const n = texto === "" ? NaN : parseInteiro(texto);
  if (!Number.isSafeInteger(n)) erros.seguidores = "Informe o total de seguidores (número inteiro).";

  return resultado(erros, { data: dia, seguidores: Number.isSafeInteger(n) ? n : 0 });
}

export function validarAvatar(arquivo) {
  if (!arquivo || !TIPOS_AVATAR.includes(arquivo.type)) {
    return { ok: false, erro: "Envie uma imagem JPG, PNG ou WebP." };
  }
  if (arquivo.size > LIMITE_AVATAR) {
    return { ok: false, erro: "A imagem deve ter no máximo 1 MB." };
  }
  return { ok: true, erro: "" };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test:influenciadores`
Expected: todos os testes passam (`fail 0`), incluindo os da Task 3.

- [ ] **Step 5: Commit**

```bash
git add public/modules/influenciadores/validacao.js tests/influenciadores/validacao.test.js
git commit -m "feat(influenciadores): validacao de formularios em pt-BR

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: Componentes básicos (avatar, gráfico, KPIs, pílulas)

**Files:**
- Create: `public/modules/influenciadores/avatar.js`
- Create: `public/modules/influenciadores/growth-chart.js`
- Create: `public/modules/influenciadores/kpi-cards.js`
- Create: `public/modules/influenciadores/brand-filter-pills.js`
- Test: `tests/influenciadores/componentes-basicos.test.js`

**Interfaces:**
- Consumes: `escapeHtml` (`html.js`); `iniciais`, `formatBRL`, `formatInt`, `formatPct`, `formatVariacao` (`calculos.js`).
- Produces:
  - `avatarHtml({ nome, url, tamanho = "md" | "lg", destaque = false }): string` e `corAvatar(nome): [fundo, texto]`.
  - `rotuloDiaSemana(dataISO): string`, `calcularPontosSvg(pontos, largura = 320, yMin = 15, yMax = 85): Array<{x, y}>`, `growthChartHtml(pontos): string`, `crescimentoBadgeHtml(pct): string` (usado pela tabela e pelo drawer).
  - `kpiCardsHtml(kpis: Metrics): string`, `KPI_DEFINICOES`.
  - `opcoesMarca(cargo, marcas): string[]`, `brandFilterPillsHtml({ opcoes, marcaAtual }): string`, `bindBrandFilterPills(raiz, aoSelecionar(marca))`.

- [ ] **Step 1: Escrever os testes que falham**

`tests/influenciadores/componentes-basicos.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { avatarHtml, corAvatar } from '../../public/modules/influenciadores/avatar.js';
import {
  rotuloDiaSemana, calcularPontosSvg, growthChartHtml, crescimentoBadgeHtml
} from '../../public/modules/influenciadores/growth-chart.js';
import { kpiCardsHtml } from '../../public/modules/influenciadores/kpi-cards.js';
import { opcoesMarca, brandFilterPillsHtml } from '../../public/modules/influenciadores/brand-filter-pills.js';

// avatar -----------------------------------------------------------------------------------------
test('avatarHtml usa a foto quando a URL e https', () => {
  const html = avatarHtml({ nome: 'Isabela Lima', url: 'https://ysreenjwihmwzockyrls.supabase.co/x?token=1', tamanho: 'lg', destaque: true });
  assert.match(html, /^<img class="inf-avatar inf-avatar-lg destaque"/);
  assert.match(html, /src="https:\/\/ysreenjwihmwzockyrls\.supabase\.co\/x\?token=1"/);
});

test('avatarHtml cai nas iniciais quando nao ha foto ou a URL nao e https', () => {
  for (const url of [undefined, null, '', 'http://x.com/a.png', 'javascript:alert(1)']) {
    const html = avatarHtml({ nome: 'Isabela Lima', url });
    assert.match(html, /^<span class="inf-avatar inf-avatar-md"/);
    assert.match(html, />IL<\/span>$/);
  }
});

test('avatarHtml escapa o nome', () => {
  const html = avatarHtml({ nome: '"><script>x</script>', url: '' });
  assert.ok(!html.includes('<script>'));
});

test('corAvatar e deterministica', () => {
  assert.deepEqual(corAvatar('Isabela Lima'), corAvatar('Isabela Lima'));
  assert.equal(corAvatar('Isabela Lima').length, 2);
});

// grafico ----------------------------------------------------------------------------------------
test('rotuloDiaSemana', () => {
  assert.equal(rotuloDiaSemana('2026-09-21'), 'Seg');
  assert.equal(rotuloDiaSemana('2026-09-20'), 'Dom');
  assert.equal(rotuloDiaSemana('2026-09-19'), 'Sáb');
});

test('calcularPontosSvg escala entre y=85 (minimo) e y=15 (maximo)', () => {
  assert.deepEqual(calcularPontosSvg([{ seguidores: 100 }, { seguidores: 200 }]), [{ x: 0, y: 85 }, { x: 320, y: 15 }]);
  assert.deepEqual(calcularPontosSvg([{ seguidores: 5 }, { seguidores: 5 }]).map((p) => p.y), [50, 50]);
});

test('growthChartHtml sem dados suficientes mostra orientacao', () => {
  assert.match(growthChartHtml([]), /Registre ao menos 2 dias/);
  assert.match(growthChartHtml([{ data: '2026-09-21', seguidores: 1 }]), /Registre ao menos 2 dias/);
});

test('growthChartHtml desenha linha, area, ponto final e dias da semana', () => {
  const html = growthChartHtml([
    { data: '2026-09-19', seguidores: 100 },
    { data: '2026-09-20', seguidores: 150 },
    { data: '2026-09-21', seguidores: 200 }
  ]);
  assert.match(html, /<polyline[^>]*points="0,85 160,50 320,15"/);
  assert.match(html, /<polygon[^>]*points="0,85 160,50 320,15 320,100 0,100"/);
  assert.match(html, /<circle cx="320" cy="15"/);
  assert.match(html, /<span>Sáb<\/span><span>Dom<\/span><span class="ultimo">Seg<\/span>/);
});

test('crescimentoBadgeHtml', () => {
  assert.match(crescimentoBadgeHtml(1.2), /inf-cresc sobe">▲ \+1,2%</);
  assert.match(crescimentoBadgeHtml(-0.5), /inf-cresc desce">▼ -0,5%</);
  assert.match(crescimentoBadgeHtml(null), /inf-cresc neutro">—</);
});

// KPIs -------------------------------------------------------------------------------------------
const kpis = {
  investimento: { atual: 45000, anterior: 32000, variacao: 40.625 },
  alcance: { atual: 12850400, anterior: 8100000, variacao: 58.6 },
  engajamento: { atual: 4.12, anterior: 3.2, variacao: 28.7 },
  cpe: { atual: 0.38, anterior: 0.45, variacao: -15.5 }
};

test('kpiCardsHtml renderiza os quatro cards com valores formatados', () => {
  const html = kpiCardsHtml(kpis);
  assert.equal(html.match(/<article/g).length, 4);
  for (const texto of ['INVESTIMENTO TOTAL', 'ALCANCE TOTAL GERADO', 'ENGAJAMENTO MÉDIO', 'CUSTO POR ENGAJAMENTO (CPE)',
    'R$ 45.000,00', '12.850.400', '4,12%', 'R$ 0,38', 'R$ 32.000,00']) {
    assert.ok(html.includes(texto), `faltou ${texto}`);
  }
});

test('kpiCardsHtml: para CPE, queda e favoravel; para os demais, alta e favoravel', () => {
  const html = kpiCardsHtml(kpis);
  assert.match(html, /inf-delta favoravel">▲ \+40,6%</);
  assert.match(html, /inf-delta favoravel">▼ -15,5%</);
  const ruim = kpiCardsHtml({ ...kpis, alcance: { atual: 1, anterior: 2, variacao: -10 }, cpe: { atual: 1, anterior: 0.5, variacao: 100 } });
  assert.match(ruim, /inf-delta desfavoravel">▼ -10,0%</);
  assert.match(ruim, /inf-delta desfavoravel">▲ \+100,0%</);
});

test('kpiCardsHtml sem base mostra travessao neutro', () => {
  const vazio = { atual: null, anterior: null, variacao: null };
  const html = kpiCardsHtml({ investimento: vazio, alcance: vazio, engajamento: vazio, cpe: vazio });
  assert.match(html, /inf-delta neutro">—</);
  assert.ok(!html.includes('NaN') && !html.includes('Infinity'));
});

// pilulas ----------------------------------------------------------------------------------------
const marcas = ['Todas', 'Tesoura de Ouro', 'Magazine da Economia', 'Free Center Calçados'];

test('opcoesMarca: so Admin e Gestor veem "Todas"', () => {
  assert.equal(opcoesMarca('Admin', marcas).length, 4);
  assert.equal(opcoesMarca('Gestor', marcas).length, 4);
  assert.deepEqual(opcoesMarca('Coordenador', marcas), marcas.slice(1));
  assert.deepEqual(opcoesMarca('Analista', marcas), marcas.slice(1));
});

test('brandFilterPillsHtml marca a ativa e rotula "Todas as Lojas"', () => {
  const html = brandFilterPillsHtml({ opcoes: marcas, marcaAtual: 'Todas' });
  assert.match(html, /class="inf-pill ativa" data-marca="Todas">Todas as Lojas</);
  assert.match(html, /class="inf-pill" data-marca="Tesoura de Ouro">Tesoura de Ouro</);
  assert.match(html, /Bandeira:/);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:influenciadores`
Expected: FAIL com `Cannot find module '.../avatar.js'`.

- [ ] **Step 3: Implementar `avatar.js`**

```js
import { escapeHtml } from "./html.js";
import { iniciais } from "./calculos.js";

// [fundo, texto] - familias de cor suaves para o circulo de iniciais.
const PALETA = [
  ["#dbeafe", "#1d4ed8"], ["#fce7f3", "#be185d"], ["#dcfce7", "#15803d"],
  ["#fef3c7", "#b45309"], ["#ede9fe", "#6d28d9"], ["#e0f2fe", "#0369a1"]
];

export function corAvatar(nome) {
  let hash = 0;
  for (const caractere of String(nome ?? "")) hash = (hash * 31 + caractere.codePointAt(0)) >>> 0;
  return PALETA[hash % PALETA.length];
}

// url vem de URL assinada do Supabase Storage. So aceita https:// (a CSP ja bloqueia o resto).
export function avatarHtml({ nome, url, tamanho = "md", destaque = false }) {
  const classes = `inf-avatar inf-avatar-${tamanho}${destaque ? " destaque" : ""}`;
  if (typeof url === "string" && url.startsWith("https://")) {
    return `<img class="${classes}" src="${escapeHtml(url)}" alt="${escapeHtml(nome)}" />`;
  }
  const [fundo, texto] = corAvatar(nome);
  return `<span class="${classes}" style="background:${fundo};color:${texto}" aria-label="${escapeHtml(nome)}">${escapeHtml(iniciais(nome))}</span>`;
}
```

- [ ] **Step 4: Implementar `growth-chart.js`**

```js
import { formatVariacao } from "./calculos.js";

const LARGURA = 320;
const DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const arredondar = (n) => Math.round(n * 10) / 10;

export function rotuloDiaSemana(dataISO) {
  const [ano, mes, dia] = dataISO.split("-").map(Number);
  return DIAS[new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay()];
}

// Mapeia seguidores para coordenadas do SVG (viewBox 0 0 320 100): minimo em yMax, maximo em yMin.
export function calcularPontosSvg(pontos, largura = LARGURA, yMin = 15, yMax = 85) {
  const valores = pontos.map((p) => p.seguidores);
  const min = Math.min(...valores);
  const max = Math.max(...valores);
  return pontos.map((p, i) => ({
    x: pontos.length === 1 ? largura : (i / (pontos.length - 1)) * largura,
    y: max === min ? 50 : yMax - ((p.seguidores - min) / (max - min)) * (yMax - yMin)
  }));
}

export function growthChartHtml(pontos) {
  if (pontos.length < 2) {
    return `<div class="inf-vazio-pequeno">Registre ao menos 2 dias de seguidores para ver o gráfico.</div>`;
  }
  const xy = calcularPontosSvg(pontos);
  const linha = xy.map((p) => `${arredondar(p.x)},${arredondar(p.y)}`).join(" ");
  const ultimo = xy[xy.length - 1];
  const dias = pontos
    .map((p, i) => `<span${i === pontos.length - 1 ? ' class="ultimo"' : ""}>${rotuloDiaSemana(p.data)}</span>`)
    .join("");
  return `<div class="inf-grafico"><svg class="inf-grafico-svg" viewBox="0 0 320 100" role="img" aria-label="Crescimento de seguidores nos últimos registros">
      <defs><linearGradient id="infGradCresc" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="#1D4ED8" stop-opacity="0.25"/><stop offset="100%" stop-color="#1D4ED8" stop-opacity="0"/></linearGradient></defs>
      <line stroke="#E2E8F0" stroke-dasharray="3 3" x1="0" x2="320" y1="20" y2="20"/>
      <line stroke="#E2E8F0" stroke-dasharray="3 3" x1="0" x2="320" y1="50" y2="50"/>
      <line stroke="#E2E8F0" stroke-dasharray="3 3" x1="0" x2="320" y1="80" y2="80"/>
      <polygon fill="url(#infGradCresc)" points="${linha} 320,100 0,100"/>
      <polyline fill="none" points="${linha}" stroke="#1D4ED8" stroke-linecap="round" stroke-linejoin="round" stroke-width="3"/>
      <circle cx="${arredondar(ultimo.x)}" cy="${arredondar(ultimo.y)}" r="4.5" fill="#FFFFFF" stroke="#1D4ED8" stroke-width="3"/>
    </svg></div><div class="inf-grafico-dias">${dias}</div>`;
}

// Selo de crescimento (tabela e drawer): verde quando sobe, vermelho quando desce.
export function crescimentoBadgeHtml(pct) {
  if (pct === null || pct === undefined) return `<span class="inf-cresc neutro">—</span>`;
  const classe = pct > 0 ? "sobe" : pct < 0 ? "desce" : "neutro";
  const seta = pct > 0 ? "▲ " : pct < 0 ? "▼ " : "";
  return `<span class="inf-cresc ${classe}">${seta}${formatVariacao(pct)}</span>`;
}
```

- [ ] **Step 5: Implementar `kpi-cards.js`**

```js
import { formatBRL, formatInt, formatPct, formatVariacao } from "./calculos.js";

// maiorEMelhor: para CPE a queda e o resultado favoravel (custo menor por interacao).
export const KPI_DEFINICOES = [
  { chave: "investimento", rotulo: "INVESTIMENTO TOTAL", icone: "payments", cor: "azul", formatar: formatBRL, maiorEMelhor: true },
  { chave: "alcance", rotulo: "ALCANCE TOTAL GERADO", icone: "groups", cor: "roxo", formatar: formatInt, maiorEMelhor: true },
  { chave: "engajamento", rotulo: "ENGAJAMENTO MÉDIO", icone: "favorite", cor: "ambar", formatar: (v) => formatPct(v, 2), maiorEMelhor: true },
  { chave: "cpe", rotulo: "CUSTO POR ENGAJAMENTO (CPE)", icone: "trending_down", cor: "verde", formatar: formatBRL, maiorEMelhor: false }
];

function deltaHtml(variacao, maiorEMelhor) {
  if (variacao === null || variacao === undefined) return `<span class="inf-delta neutro">—</span>`;
  const classe = variacao === 0 ? "neutro" : (variacao > 0) === maiorEMelhor ? "favoravel" : "desfavoravel";
  const seta = variacao > 0 ? "▲ " : variacao < 0 ? "▼ " : "";
  return `<span class="inf-delta ${classe}">${seta}${formatVariacao(variacao)}</span>`;
}

export function kpiCardsHtml(kpis) {
  return `<div class="inf-kpis">${KPI_DEFINICOES.map((d) => {
    const k = kpis[d.chave];
    return `<article class="inf-kpi">
      <div class="inf-kpi-topo"><span class="inf-kpi-rotulo">${d.rotulo}</span><span class="inf-kpi-icone ${d.cor}"><span class="material-symbols-outlined">${d.icone}</span></span></div>
      <div class="inf-kpi-valor">${d.formatar(k.atual)}</div>
      <div class="inf-kpi-rodape">${deltaHtml(k.variacao, d.maiorEMelhor)}<span class="inf-kpi-anterior">Mês anterior: <strong>${d.formatar(k.anterior)}</strong></span></div>
      <div class="inf-kpi-barra ${d.cor}"></div>
    </article>`;
  }).join("")}</div>`;
}
```

- [ ] **Step 6: Implementar `brand-filter-pills.js`**

```js
import { escapeHtml } from "./html.js";

// "Todas" so faz sentido para quem enxerga todas as marcas (Admin/Gestor); para os demais o RLS
// ja limita a marca vinculada, entao a opcao some.
export function opcoesMarca(cargo, marcas) {
  const veTodas = cargo === "Admin" || cargo === "Gestor";
  return marcas.filter((m) => m !== "Todas" || veTodas);
}

function rotulo(marca) {
  return marca === "Todas" ? "Todas as Lojas" : marca;
}

export function brandFilterPillsHtml({ opcoes, marcaAtual }) {
  const botoes = opcoes
    .map((m) => `<button type="button" class="inf-pill${m === marcaAtual ? " ativa" : ""}" data-marca="${escapeHtml(m)}">${escapeHtml(rotulo(m))}</button>`)
    .join("");
  return `<div class="inf-bandeira"><span class="inf-bandeira-rotulo"><span class="material-symbols-outlined" style="font-size:14px">store</span> Bandeira:</span>${botoes}</div>`;
}

export function bindBrandFilterPills(raiz, aoSelecionar) {
  raiz.querySelectorAll("[data-marca]").forEach((botao) => {
    botao.onclick = () => aoSelecionar(botao.dataset.marca);
  });
}
```

- [ ] **Step 7: Rodar e ver passar**

Run: `npm run test:influenciadores`
Expected: todos passam (`fail 0`).

- [ ] **Step 8: Commit**

```bash
git add public/modules/influenciadores/avatar.js public/modules/influenciadores/growth-chart.js public/modules/influenciadores/kpi-cards.js public/modules/influenciadores/brand-filter-pills.js tests/influenciadores/componentes-basicos.test.js
git commit -m "feat(influenciadores): avatar, grafico de seguidores, KPIs e filtro de bandeira

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Tabela e drawer (TDD)

**Files:**
- Create: `public/modules/influenciadores/influencers-table.js`
- Create: `public/modules/influenciadores/influencer-drawer.js`
- Test: `tests/influenciadores/tabela-drawer.test.js`

**Interfaces:**
- Consumes: `escapeHtml`; `avatarHtml`; `growthChartHtml`, `crescimentoBadgeHtml`; `formatBRL`, `formatBRLInteiro`, `formatInt`, `pluralCampanhas`.
- Produces:
  - `influencersTableHtml(modelo)` com `modelo = { linhas: Array<{ influenciador, agregado, avatarUrl }>, cadastrados, total, pagina, totalPaginas, busca, abertoId, selecionados: Set<string>, podeEditar }`.
  - `bindInfluencersTable(raiz, cb)` com `cb = { aoBuscar(texto), aoSelecionar(id), aoMarcar(id, marcado), aoMarcarTodos(marcado), aoPaginar(n), aoNovo() }`.
  - `influencerDrawerHtml(modelo)` com `modelo = { influenciador | null, avatarUrl, agregado, campanhas, midias, pontos, podeEditar, hoje }`.
  - `bindInfluencerDrawer(raiz, cb)` com `cb = { aoFechar(), aoEditar(), aoNovaMidia(), aoEditarMidia(id), aoExcluirMidia(id), aoCopiarCupom(codigo, botao), aoRegistrarSeguidores({ data, seguidores }) }`.
  - Hooks de DOM usados pelo `index.js`: `#infBusca`, `#infMarcarTodos`, `#infNovo`, `[data-check]`, `[data-detalhes]`, `[data-pagina]`, `tr[data-id]`, `[data-acao="fechar|editar|nova-midia"]`, `[data-editar-midia]`, `[data-excluir-midia]`, `[data-cupom]`, `#infSnapForm`.

- [ ] **Step 1: Escrever os testes que falham**

`tests/influenciadores/tabela-drawer.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { influencersTableHtml } from '../../public/modules/influenciadores/influencers-table.js';
import { influencerDrawerHtml } from '../../public/modules/influenciadores/influencer-drawer.js';

const influenciador = {
  id: 'i1', marca: 'Tesoura de Ouro', nome: 'Isabela Lima', handle: '@isabelalima.style', rede_social: 'Instagram',
  verificado: true, nicho: 'Moda & Varejo', cupom_codigo: 'TESOURA10', cupom_exclusivo: true, status: 'Ativo'
};
const agregado = {
  seguidores: 1450000, crescimentoAbs: 17400, crescimentoPct: 1.2, campanhasAtivas: 3,
  cacheTotal: 10000, voucherTotal: 5000, investimentoTotal: 15000, alcanceTotal: 4230000, totalMidias: 1
};
const base = {
  linhas: [{ influenciador, agregado, avatarUrl: null }], cadastrados: 18, total: 1, pagina: 1, totalPaginas: 1,
  busca: '', abertoId: null, selecionados: new Set(), podeEditar: true
};

// tabela -----------------------------------------------------------------------------------------
test('tabela mostra cabecalho, contagem e colunas do prototipo', () => {
  const html = influencersTableHtml(base);
  for (const texto of ['Influenciadores Ativos', '18 cadastrados', 'Criador', 'Seguidores', 'Crescimento Semanal',
    'Campanhas Ativas', 'Investimento Total', 'Alcance', 'Ações', 'Novo Influenciador']) {
    assert.ok(html.includes(texto), `faltou ${texto}`);
  }
});

test('tabela renderiza a linha com formatacao pt-BR', () => {
  const html = influencersTableHtml(base);
  for (const texto of ['Isabela Lima', '@isabelalima.style', '1.450.000', '▲ +1,2%', '3 campanhas',
    'R$ 15.000,00', '4.230.000', 'inf-rede ig', 'Ver Detalhes']) {
    assert.ok(html.includes(texto), `faltou ${texto}`);
  }
  assert.match(html, /material-symbols-outlined inf-verificado/);
  assert.match(html, /<span class="inf-avatar inf-avatar-md"[^>]*>IL<\/span>/);
});

test('tabela destaca a linha aberta e marca os checkboxes selecionados', () => {
  const html = influencersTableHtml({ ...base, abertoId: 'i1', selecionados: new Set(['i1']) });
  assert.match(html, /<tr class="inf-linha aberta" data-id="i1">/);
  assert.match(html, /data-check="i1" checked/);
  assert.match(html, /inf-btn-detalhes primario/);
});

test('tabela esconde "Novo Influenciador" para quem nao edita', () => {
  assert.ok(!influencersTableHtml({ ...base, podeEditar: false }).includes('Novo Influenciador'));
});

test('tabela mostra rodape e paginacao', () => {
  const html = influencersTableHtml({ ...base, total: 18, pagina: 1, totalPaginas: 4 });
  assert.match(html, /Mostrando <strong>1<\/strong> de <strong>18<\/strong> criadores contratados/);
  assert.match(html, /<button type="button" disabled>Anterior<\/button>/);
  assert.match(html, /class="ativa" data-pagina="1">1</);
  assert.match(html, /data-pagina="2">2</);
  assert.match(html, /data-pagina="2">Próximo</);
});

test('tabela distingue "nada cadastrado" de "busca sem resultado"', () => {
  const vazio = influencersTableHtml({ ...base, linhas: [], cadastrados: 0, total: 0 });
  assert.match(vazio, /Nenhum influenciador cadastrado nesta bandeira/);
  const semResultado = influencersTableHtml({ ...base, linhas: [], cadastrados: 18, total: 0, busca: 'zzz' });
  assert.match(semResultado, /Nenhum resultado para a busca/);
});

test('tabela escapa dados do usuario', () => {
  const malicioso = { ...influenciador, nome: '<img src=x onerror=alert(1)>', handle: '@"x' };
  const html = influencersTableHtml({ ...base, busca: '"><script>', linhas: [{ influenciador: malicioso, agregado, avatarUrl: null }] });
  assert.ok(!html.includes('<img src=x'));
  assert.ok(!html.includes('<script>'));
});

test('tabela sem dados de crescimento mostra travessao', () => {
  const html = influencersTableHtml({ ...base, linhas: [{ influenciador, agregado: { ...agregado, seguidores: null, crescimentoPct: null }, avatarUrl: null }] });
  assert.match(html, /inf-cresc neutro">—</);
});

// drawer -----------------------------------------------------------------------------------------
const midia = {
  id: 'm1', titulo: 'Reel: Provador Tesoura de Ouro', url: 'https://www.instagram.com/reel/C8x9L_p/', plataforma: 'Instagram',
  views: 1840000, curtidas: 94200, salvos: 14800
};
const modeloDrawer = {
  influenciador, avatarUrl: null, agregado,
  campanhas: [{ id: 'c1', nome: 'Campanha dos Pais 2026' }, { id: 'c2', nome: 'Dia das Crianças' }],
  midias: [midia],
  pontos: [{ data: '2026-09-19', seguidores: 100 }, { data: '2026-09-20', seguidores: 150 }, { data: '2026-09-21', seguidores: 200 }],
  podeEditar: true, hoje: '2026-09-21'
};

test('drawer sem selecao mostra estado vazio', () => {
  const html = influencerDrawerHtml({ ...modeloDrawer, influenciador: null });
  assert.match(html, /Selecione um influenciador/);
});

test('drawer mostra os blocos do prototipo', () => {
  const html = influencerDrawerHtml(modeloDrawer);
  for (const texto of ['Isabela Lima', '@isabelalima.style', 'Moda &amp; Varejo', 'Tesoura de Ouro',
    'Investimento &amp; Acordos', 'Cachê', 'R$ 10.000', 'Voucher / Permuta', 'R$ 5.000', 'Invest. Total', 'R$ 15.000',
    'Cupom Exclusivo:', 'SIM', 'TESOURA10',
    'Campanhas Realizadas', 'Campanha dos Pais 2026', 'Dia das Crianças',
    'Crescimento Semanal', '+17.400 novos seguidores', '▲ +1,2%', '<polyline',
    'Mídias Vinculadas (Meta API)', '1 posts', 'Reel: Provador Tesoura de Ouro', 'Views', '1.840.000', 'Curtidas', '94.200', 'Salvos', '14.800',
    'instagram.com/reel/C8x9L_p/', '+ Vincular Nova URL']) {
    assert.ok(html.includes(texto), `faltou ${texto}`);
  }
  assert.match(html, /inf-status ativo">Ativo</);
  assert.match(html, /href="https:\/\/www\.instagram\.com\/reel\/C8x9L_p\/" target="_blank" rel="noopener noreferrer"/);
});

test('drawer para quem nao edita nao oferece acoes de escrita', () => {
  const html = influencerDrawerHtml({ ...modeloDrawer, podeEditar: false });
  for (const acao of ['data-acao="editar"', 'data-acao="nova-midia"', 'data-editar-midia', 'data-excluir-midia', 'id="infSnapForm"']) {
    assert.ok(!html.includes(acao), `nao deveria ter ${acao}`);
  }
  assert.ok(html.includes('data-acao="fechar"'));
});

test('drawer para editor oferece editar, vincular, editar/excluir midia e registrar seguidores', () => {
  const html = influencerDrawerHtml(modeloDrawer);
  for (const acao of ['data-acao="editar"', 'data-acao="nova-midia"', 'data-editar-midia="m1"', 'data-excluir-midia="m1"', 'id="infSnapForm"', 'value="2026-09-21"']) {
    assert.ok(html.includes(acao), `faltou ${acao}`);
  }
});

test('drawer sem cupom exclusivo mostra NAO e nao mostra o botao de copiar', () => {
  const html = influencerDrawerHtml({ ...modeloDrawer, influenciador: { ...influenciador, cupom_exclusivo: false, cupom_codigo: null } });
  assert.match(html, /<strong class="nao">NÃO<\/strong>/);
  assert.ok(!html.includes('data-cupom='));
});

test('drawer trata ausencia de campanhas, midias e base de crescimento', () => {
  const html = influencerDrawerHtml({
    ...modeloDrawer, campanhas: [], midias: [], pontos: [],
    agregado: { ...agregado, crescimentoAbs: null, crescimentoPct: null, cacheTotal: 0, voucherTotal: 0, investimentoTotal: 0 }
  });
  assert.match(html, /Nenhuma campanha cadastrada/);
  assert.match(html, /Nenhuma mídia vinculada/);
  assert.match(html, /Sem base de 7 dias/);
  assert.match(html, /Registre ao menos 2 dias/);
});

test('drawer nao emite href perigoso e escapa dados do usuario', () => {
  const ruim = { ...midia, titulo: '<b>x</b>', url: 'javascript:alert(1)' };
  const html = influencerDrawerHtml({ ...modeloDrawer, midias: [ruim], campanhas: [{ id: 'c', nome: '<script>1</script>' }] });
  assert.ok(!html.includes('href="javascript:'));
  assert.ok(html.includes('href="#"'));
  assert.ok(!html.includes('<b>x</b>'));
  assert.ok(!html.includes('<script>1</script>'));
});

test('drawer mostra queda de seguidores sem "novos"', () => {
  const html = influencerDrawerHtml({ ...modeloDrawer, agregado: { ...agregado, crescimentoAbs: -500, crescimentoPct: -0.4 } });
  assert.match(html, /-500 seguidores/);
  assert.ok(!html.includes('-500 novos'));
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:influenciadores`
Expected: FAIL com `Cannot find module '.../influencers-table.js'`.

- [ ] **Step 3: Implementar `influencers-table.js`**

```js
import { escapeHtml } from "./html.js";
import { avatarHtml } from "./avatar.js";
import { crescimentoBadgeHtml } from "./growth-chart.js";
import { formatBRL, formatInt, pluralCampanhas } from "./calculos.js";

const CLASSE_REDE = { Instagram: "ig", TikTok: "tt", YouTube: "yt" };

function redeHtml(rede) {
  return `<span class="inf-rede ${CLASSE_REDE[rede] ?? "ig"}">${escapeHtml(rede)}</span>`;
}

function linhaHtml({ influenciador: i, agregado: a, avatarUrl }, { abertoId, selecionados }) {
  const aberta = i.id === abertoId;
  const id = escapeHtml(i.id);
  return `<tr class="inf-linha${aberta ? " aberta" : ""}" data-id="${id}">
    <td class="inf-col-check"><input type="checkbox" data-check="${id}" ${selecionados.has(i.id) ? "checked" : ""} aria-label="Selecionar ${escapeHtml(i.nome)}" /></td>
    <td><div class="inf-criador">${avatarHtml({ nome: i.nome, url: avatarUrl, tamanho: "md", destaque: aberta })}<div>
      <div class="inf-criador-nome">${escapeHtml(i.nome)}${i.verificado ? `<span class="material-symbols-outlined inf-verificado">verified</span>` : ""}${redeHtml(i.rede_social)}</div>
      <div class="inf-criador-handle">${escapeHtml(i.handle)}</div></div></div></td>
    <td class="inf-num">${formatInt(a.seguidores)}</td>
    <td>${crescimentoBadgeHtml(a.crescimentoPct)}</td>
    <td><span class="inf-chip-campanhas">${pluralCampanhas(a.campanhasAtivas)}</span></td>
    <td class="inf-num forte">${formatBRL(a.investimentoTotal)}</td>
    <td class="inf-num azul">${formatInt(a.alcanceTotal)}</td>
    <td class="inf-col-acoes"><button type="button" class="inf-btn-detalhes${aberta ? " primario" : ""}" data-detalhes="${id}">Ver Detalhes<span class="material-symbols-outlined">chevron_right</span></button></td>
  </tr>`;
}

function paginacaoHtml(pagina, totalPaginas) {
  const janela = 5;
  let inicio = Math.max(1, pagina - 2);
  const fim = Math.min(totalPaginas, inicio + janela - 1);
  inicio = Math.max(1, fim - janela + 1);
  const numeros = [];
  for (let n = inicio; n <= fim; n += 1) {
    numeros.push(`<button type="button"${n === pagina ? ' class="ativa"' : ""} data-pagina="${n}">${n}</button>`);
  }
  const anterior = pagina > 1
    ? `<button type="button" data-pagina="${pagina - 1}">Anterior</button>`
    : `<button type="button" disabled>Anterior</button>`;
  const proximo = pagina < totalPaginas
    ? `<button type="button" data-pagina="${pagina + 1}">Próximo</button>`
    : `<button type="button" disabled>Próximo</button>`;
  return `<div class="inf-paginacao">${anterior}${numeros.join("")}${proximo}</div>`;
}

export function influencersTableHtml(m) {
  const { linhas, cadastrados, total, pagina, totalPaginas, busca, abertoId, selecionados, podeEditar } = m;
  const todosMarcados = linhas.length > 0 && linhas.every((l) => selecionados.has(l.influenciador.id));
  const corpo = linhas.length > 0
    ? linhas.map((l) => linhaHtml(l, { abertoId, selecionados })).join("")
    : `<tr><td colspan="8" class="inf-vazio-linha">${cadastrados === 0
      ? "Nenhum influenciador cadastrado nesta bandeira."
      : "Nenhum resultado para a busca."}</td></tr>`;
  return `<div class="inf-tabela-topo">
      <div><div class="inf-tabela-titulo"><h3>Influenciadores Ativos</h3><span class="inf-badge-contagem">${cadastrados} cadastrados</span></div>
      <p class="muted">Gestão de criadores, métricas de crescimento e acompanhamento de entregas</p></div>
      <div class="inf-tabela-ferramentas">
        <div class="inf-busca"><span class="material-symbols-outlined">search</span><input id="infBusca" type="text" value="${escapeHtml(busca)}" placeholder="Buscar por nome, @ ou tag" autocomplete="off" /></div>
        ${podeEditar ? `<button type="button" id="infNovo" class="inf-btn-primario"><span class="material-symbols-outlined">person_add</span><span>Novo Influenciador</span></button>` : ""}
      </div>
    </div>
    <div class="table-wrap"><table class="inf-table"><thead><tr>
      <th class="inf-col-check"><input id="infMarcarTodos" type="checkbox" ${todosMarcados ? "checked" : ""} aria-label="Selecionar todos da página" /></th>
      <th>Criador</th><th>Seguidores</th><th>Crescimento Semanal</th><th>Campanhas Ativas</th><th>Investimento Total</th><th>Alcance</th><th class="inf-col-acoes">Ações</th>
    </tr></thead><tbody>${corpo}</tbody></table></div>
    <div class="inf-tabela-rodape"><div>Mostrando <strong>${linhas.length}</strong> de <strong>${total}</strong> criadores contratados</div>${paginacaoHtml(pagina, totalPaginas)}</div>`;
}

export function bindInfluencersTable(raiz, cb) {
  const busca = raiz.querySelector("#infBusca");
  if (busca) busca.oninput = () => cb.aoBuscar(busca.value);

  raiz.querySelectorAll("tr[data-id]").forEach((tr) => {
    tr.onclick = () => cb.aoSelecionar(tr.dataset.id);
  });
  raiz.querySelectorAll("[data-check]").forEach((caixa) => {
    caixa.onclick = (evento) => evento.stopPropagation();
    caixa.onchange = () => cb.aoMarcar(caixa.dataset.check, caixa.checked);
  });
  const todos = raiz.querySelector("#infMarcarTodos");
  if (todos) todos.onchange = () => cb.aoMarcarTodos(todos.checked);

  raiz.querySelectorAll("[data-detalhes]").forEach((botao) => {
    botao.onclick = (evento) => {
      evento.stopPropagation();
      cb.aoSelecionar(botao.dataset.detalhes);
    };
  });
  raiz.querySelectorAll("[data-pagina]").forEach((botao) => {
    botao.onclick = () => cb.aoPaginar(Number(botao.dataset.pagina));
  });
  const novo = raiz.querySelector("#infNovo");
  if (novo) novo.onclick = () => cb.aoNovo();
}
```

- [ ] **Step 4: Implementar `influencer-drawer.js`**

```js
import { escapeHtml } from "./html.js";
import { avatarHtml } from "./avatar.js";
import { growthChartHtml, crescimentoBadgeHtml } from "./growth-chart.js";
import { formatBRLInteiro, formatInt } from "./calculos.js";

const CLASSE_STATUS = { Ativo: "ativo", Pausado: "pausado", Encerrado: "encerrado" };
const CORES_CAMPANHA = ["#2563eb", "#f59e0b", "#10b981", "#ec4899", "#8b5cf6", "#06b6d4"];
const COR_PLATAFORMA = { Instagram: "#ec4899", TikTok: "#0f172a", YouTube: "#dc2626" };

function urlSegura(url) {
  return String(url ?? "").startsWith("https://") ? url : "#";
}

function urlCurta(url) {
  return String(url ?? "").replace(/^https?:\/\/(www\.)?/, "");
}

function topoHtml(m) {
  const i = m.influenciador;
  return `<div class="inf-drawer-topo"><div class="inf-drawer-id">
      ${avatarHtml({ nome: i.nome, url: m.avatarUrl, tamanho: "lg", destaque: true })}
      <div><div class="inf-drawer-nome"><h3>${escapeHtml(i.nome)}</h3>${i.verificado ? `<span class="material-symbols-outlined inf-verificado">verified</span>` : ""}</div>
        <div class="inf-criador-handle">${escapeHtml(i.handle)}</div>
        <div class="inf-tags">${i.nicho ? `<span class="inf-tag roxo">${escapeHtml(i.nicho)}</span>` : ""}<span class="inf-tag azul">${escapeHtml(i.marca)}</span></div></div></div>
    <div class="inf-drawer-acoes">
      ${m.podeEditar ? `<button type="button" class="inf-icone" data-acao="editar" title="Editar influenciador"><span class="material-symbols-outlined">edit</span></button>` : ""}
      <button type="button" class="inf-icone" data-acao="fechar" title="Fechar painel"><span class="material-symbols-outlined">close</span></button></div></div>`;
}

function acordosHtml(m) {
  const i = m.influenciador;
  const a = m.agregado;
  const cupom = i.cupom_codigo
    ? `<button type="button" class="inf-cupom-codigo" data-cupom="${escapeHtml(i.cupom_codigo)}" title="Copiar cupom"><span>${escapeHtml(i.cupom_codigo)}</span><span class="material-symbols-outlined">content_copy</span></button>`
    : "";
  return `<section class="inf-bloco">
      <div class="inf-bloco-topo"><span class="inf-bloco-titulo"><span class="material-symbols-outlined azul">handshake</span>Investimento &amp; Acordos</span>
        <span class="inf-status ${CLASSE_STATUS[i.status] ?? "ativo"}">${escapeHtml(i.status)}</span></div>
      <div class="inf-valores">
        <div class="inf-valor"><div class="rotulo">Cachê</div><div class="num">${formatBRLInteiro(a.cacheTotal)}</div></div>
        <div class="inf-valor"><div class="rotulo">Voucher / Permuta</div><div class="num">${formatBRLInteiro(a.voucherTotal)}</div></div>
        <div class="inf-valor destaque"><div class="rotulo">Invest. Total</div><div class="num">${formatBRLInteiro(a.investimentoTotal)}</div></div>
      </div>
      <div class="inf-cupom-linha"><div class="inf-cupom-status"><span class="inf-ponto ${i.cupom_exclusivo ? "on" : "off"}"></span>
        <span>Cupom Exclusivo: <strong class="${i.cupom_exclusivo ? "sim" : "nao"}">${i.cupom_exclusivo ? "SIM" : "NÃO"}</strong></span></div>${cupom}</div>
    </section>`;
}

function campanhasHtml(campanhas) {
  const chips = campanhas.length > 0
    ? campanhas.map((c, n) => `<span class="inf-chip"><span class="inf-ponto" style="background:${CORES_CAMPANHA[n % CORES_CAMPANHA.length]}"></span>${escapeHtml(c.nome)}</span>`).join("")
    : `<span class="muted">Nenhuma campanha cadastrada.</span>`;
  return `<section><div class="inf-bloco-titulo"><span class="material-symbols-outlined">campaign</span>Campanhas Realizadas</div><div class="inf-chips">${chips}</div></section>`;
}

function crescimentoHtml(m) {
  const abs = m.agregado.crescimentoAbs;
  const texto = abs === null
    ? "Sem base de 7 dias"
    : abs >= 0 ? `+${formatInt(abs)} novos seguidores` : `${formatInt(abs)} seguidores`;
  const form = m.podeEditar
    ? `<form id="infSnapForm" class="inf-snap-form">
        <input type="date" name="data" value="${escapeHtml(m.hoje)}" max="${escapeHtml(m.hoje)}" required aria-label="Data do registro" />
        <input type="text" name="seguidores" inputmode="numeric" placeholder="Total de seguidores" required aria-label="Total de seguidores" />
        <button type="submit" class="inf-btn-mini">Registrar</button></form>`
    : "";
  return `<section class="inf-bloco">
      <div class="inf-cresc-topo"><div><div class="inf-bloco-titulo">Crescimento Semanal</div><div class="inf-cresc-valor">${texto}</div></div>${crescimentoBadgeHtml(m.agregado.crescimentoPct)}</div>
      ${growthChartHtml(m.pontos)}${form}</section>`;
}

function midiaHtml(midia, podeEditar) {
  const id = escapeHtml(midia.id);
  return `<article class="inf-midia">
      <div class="inf-midia-topo"><div class="inf-midia-titulo"><span class="inf-ponto" style="background:${COR_PLATAFORMA[midia.plataforma] ?? "#94a3b8"}"></span><span>${escapeHtml(midia.titulo)}</span></div>
        <div class="inf-midia-acoes"><a href="${escapeHtml(urlSegura(midia.url))}" target="_blank" rel="noopener noreferrer" title="Abrir post"><span class="material-symbols-outlined">open_in_new</span></a>
        ${podeEditar ? `<button type="button" data-editar-midia="${id}" title="Editar mídia"><span class="material-symbols-outlined">edit</span></button><button type="button" data-excluir-midia="${id}" title="Excluir mídia"><span class="material-symbols-outlined">delete</span></button>` : ""}</div></div>
      <div class="inf-midia-url">${escapeHtml(urlCurta(midia.url))}</div>
      <div class="inf-midia-metricas">
        <div><div class="rotulo">Views</div><div class="num">${formatInt(midia.views)}</div></div>
        <div><div class="rotulo">Curtidas</div><div class="num">${formatInt(midia.curtidas)}</div></div>
        <div><div class="rotulo">Salvos</div><div class="num verde">${formatInt(midia.salvos)}</div></div></div>
    </article>`;
}

function midiasHtml(m) {
  const lista = m.midias.length > 0
    ? m.midias.map((x) => midiaHtml(x, m.podeEditar)).join("")
    : `<p class="muted">Nenhuma mídia vinculada.</p>`;
  return `<section class="inf-midias"><div class="inf-midias-topo"><span class="inf-bloco-titulo"><span class="material-symbols-outlined rosa">video_library</span>Mídias Vinculadas (Meta API)</span>
      <span class="muted">${m.midias.length} posts</span></div>${lista}</section>`;
}

export function influencerDrawerHtml(m) {
  if (!m.influenciador) {
    return `<div class="inf-drawer-vazio"><span class="material-symbols-outlined">person_search</span><strong>Selecione um influenciador</strong><p>Clique em uma linha da tabela para ver acordos, campanhas, crescimento e mídias vinculadas.</p></div>`;
  }
  return `${topoHtml(m)}${acordosHtml(m)}${campanhasHtml(m.campanhas)}${crescimentoHtml(m)}${midiasHtml(m)}
    ${m.podeEditar ? `<button type="button" class="inf-btn-cta" data-acao="nova-midia"><span class="material-symbols-outlined">add_link</span><span>+ Vincular Nova URL</span></button>` : ""}`;
}

export function bindInfluencerDrawer(raiz, cb) {
  const acao = (nome, funcao) => {
    const botao = raiz.querySelector(`[data-acao="${nome}"]`);
    if (botao) botao.onclick = funcao;
  };
  acao("fechar", () => cb.aoFechar());
  acao("editar", () => cb.aoEditar());
  acao("nova-midia", () => cb.aoNovaMidia());

  raiz.querySelectorAll("[data-editar-midia]").forEach((b) => { b.onclick = () => cb.aoEditarMidia(b.dataset.editarMidia); });
  raiz.querySelectorAll("[data-excluir-midia]").forEach((b) => { b.onclick = () => cb.aoExcluirMidia(b.dataset.excluirMidia); });
  raiz.querySelectorAll("[data-cupom]").forEach((b) => { b.onclick = () => cb.aoCopiarCupom(b.dataset.cupom, b); });

  const form = raiz.querySelector("#infSnapForm");
  if (form) {
    form.onsubmit = (evento) => {
      evento.preventDefault();
      cb.aoRegistrarSeguidores({ data: form.elements.data.value, seguidores: form.elements.seguidores.value });
    };
  }
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npm run test:influenciadores`
Expected: todos passam (`fail 0`).

Se `drawer mostra os blocos do prototipo` falhar em `'1 posts'`, ajustar o texto do contador para exatamente `${n} posts` (o protótipo usa "3 posts"; manter a mesma forma mesmo para 1).

- [ ] **Step 6: Commit**

```bash
git add public/modules/influenciadores/influencers-table.js public/modules/influenciadores/influencer-drawer.js tests/influenciadores/tabela-drawer.test.js
git commit -m "feat(influenciadores): tabela estilo Modash e drawer lateral

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: `service.js` (Supabase, TDD com cliente falso)

**Files:**
- Create: `public/modules/influenciadores/service.js`
- Test: `tests/influenciadores/service.test.js`

**Interfaces:**
- Consumes: cliente `supabase` injetado (o mesmo `createClient` do `index.html`). Sem imports.
- Produces:
  - `traduzirErro(error, { duplicado }?): Error | unknown` — mapeia códigos Postgres (`23505`, `23503`, `23514`, `42501`) para mensagens pt-BR.
  - `buscarTodas(supabase, tabela, marca, colunaOrdem, tamanho = 1000): Promise<object[]>` — pagina com `.range`; filtra `marca` exceto `"Todas"`.
  - `criarService(supabase)` devolve:
    - `carregarTudo(marca): Promise<{ influenciadores, campanhas, midias, snapshots, avatares: Map<string,string> }>`
    - `salvarInfluenciador({ id, valor, campanhas, removidas, avatar }): Promise<string>` — devolve o id; `campanhas: Array<{ id: string|null, valor }>`, `removidas: string[]`, `avatar: File|null`.
    - `excluirInfluenciador(id): Promise<void>`
    - `salvarMidia({ id, influenciadorId, marca, valor }): Promise<void>`
    - `excluirMidia(id): Promise<void>`
    - `registrarSeguidores({ influenciadorId, marca, data, seguidores }): Promise<void>`
  - Bucket `influenciadores-avatares`; caminho `{influenciador_id}/avatar`.

- [ ] **Step 1: Escrever os testes que falham**

`tests/influenciadores/service.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { criarService, buscarTodas, traduzirErro } from '../../public/modules/influenciadores/service.js';

// Cliente Supabase falso: cada from(tabela) devolve um encadeavel que registra as operacoes e,
// ao ser aguardado, responde com respostas[tabela] (valor ou funcao do registro).
function criarFake({ respostas = {}, falharAssinatura = false, falharRemocao = false } = {}) {
  const chamadas = [];
  const storage = { uploads: [], remocoes: [], assinaturas: [] };
  function from(tabela) {
    const registro = { tabela, ops: [] };
    chamadas.push(registro);
    const q = new Proxy({}, {
      get(_, prop) {
        if (prop === 'then') {
          return (resolve, reject) => {
            const r = respostas[tabela];
            const resposta = typeof r === 'function' ? r(registro) : (r ?? { data: null, error: null });
            return Promise.resolve(resposta).then(resolve, reject);
          };
        }
        return (...args) => { registro.ops.push([prop, ...args]); return q; };
      }
    });
    return q;
  }
  const supabase = {
    from,
    storage: {
      from: (bucket) => ({
        upload: async (caminho, arquivo, opcoes) => { storage.uploads.push({ bucket, caminho, opcoes }); return { error: null }; },
        remove: async (caminhos) => {
          if (falharRemocao) throw new Error('falha de rede');
          storage.remocoes.push({ bucket, caminhos });
          return { error: null };
        },
        createSignedUrls: async (caminhos, segundos) => {
          if (falharAssinatura) throw new Error('falha de rede');
          storage.assinaturas.push({ bucket, caminhos, segundos });
          return { data: caminhos.map((p) => ({ path: p, signedUrl: `https://assinada/${p}` })), error: null };
        }
      })
    }
  };
  return { supabase, chamadas, storage };
}

const op = (registro, nome) => registro.ops.find((o) => o[0] === nome);
const doTabela = (chamadas, tabela) => chamadas.filter((c) => c.tabela === tabela);
const ok = { data: [], error: null };

test('buscarTodas pagina com range e filtra por marca', async () => {
  let n = 0;
  const paginas = [[1, 2], [3]];
  const { supabase, chamadas } = criarFake({ respostas: { t: () => ({ data: paginas[n++], error: null }) } });
  const linhas = await buscarTodas(supabase, 't', 'Tesoura de Ouro', 'nome', 2);
  assert.deepEqual(linhas, [1, 2, 3]);
  assert.equal(chamadas.length, 2);
  assert.deepEqual(op(chamadas[0], 'range'), ['range', 0, 1]);
  assert.deepEqual(op(chamadas[1], 'range'), ['range', 2, 3]);
  assert.deepEqual(op(chamadas[0], 'eq'), ['eq', 'marca', 'Tesoura de Ouro']);
});

test('buscarTodas nao filtra quando a marca e "Todas"', async () => {
  const { supabase, chamadas } = criarFake({ respostas: { t: { data: [], error: null } } });
  await buscarTodas(supabase, 't', 'Todas', 'nome');
  assert.equal(op(chamadas[0], 'eq'), undefined);
});

test('buscarTodas propaga o erro do Supabase', async () => {
  const { supabase } = criarFake({ respostas: { t: { data: null, error: { message: 'x', code: '42501' } } } });
  await assert.rejects(buscarTodas(supabase, 't', 'Todas', 'nome'), { code: '42501' });
});

test('carregarTudo busca as quatro tabelas e assina os avatares por 1 hora', async () => {
  const { supabase, storage } = criarFake({
    respostas: {
      influenciadores: { data: [{ id: 'i1', avatar_path: 'i1/avatar' }, { id: 'i2', avatar_path: null }], error: null },
      influenciador_campanhas: ok, influenciador_midias: ok, influenciador_seguidores_historico: ok
    }
  });
  const dados = await criarService(supabase).carregarTudo('Todas');
  assert.equal(dados.influenciadores.length, 2);
  assert.equal(dados.avatares.get('i1/avatar'), 'https://assinada/i1/avatar');
  assert.deepEqual(storage.assinaturas, [{ bucket: 'influenciadores-avatares', caminhos: ['i1/avatar'], segundos: 3600 }]);
});

test('carregarTudo sem avatares nao chama o storage', async () => {
  const { supabase, storage } = criarFake({
    respostas: { influenciadores: { data: [{ id: 'i1', avatar_path: null }], error: null },
      influenciador_campanhas: ok, influenciador_midias: ok, influenciador_seguidores_historico: ok }
  });
  const dados = await criarService(supabase).carregarTudo('Todas');
  assert.equal(storage.assinaturas.length, 0);
  assert.equal(dados.avatares.size, 0);
});

test('carregarTudo nao quebra a tela se a assinatura de avatar falhar', async () => {
  const { supabase } = criarFake({
    falharAssinatura: true,
    respostas: { influenciadores: { data: [{ id: 'i1', avatar_path: 'i1/avatar' }], error: null },
      influenciador_campanhas: ok, influenciador_midias: ok, influenciador_seguidores_historico: ok }
  });
  const dados = await criarService(supabase).carregarTudo('Todas');
  assert.equal(dados.influenciadores.length, 1);
  assert.equal(dados.avatares.size, 0);
});

const valorInfluenciador = {
  marca: 'Tesoura de Ouro', nome: 'Isabela Lima', handle: '@isabelalima', rede_social: 'Instagram', verificado: true,
  nicho: null, cupom_codigo: null, cupom_exclusivo: false, status: 'Ativo'
};
const valorCampanha = { nome: 'Pais', data_inicio: '2026-08-01', data_fim: null, cache_valor: 10000, voucher_valor: 5000 };

test('salvarInfluenciador (novo) insere o pai e depois as campanhas com id e marca do pai', async () => {
  const { supabase, chamadas } = criarFake({
    respostas: { influenciadores: { data: { id: 'novo' }, error: null }, influenciador_campanhas: ok }
  });
  const id = await criarService(supabase).salvarInfluenciador({
    id: null, valor: valorInfluenciador, campanhas: [{ id: null, valor: valorCampanha }], removidas: [], avatar: null
  });
  assert.equal(id, 'novo');
  const [pai] = doTabela(chamadas, 'influenciadores');
  assert.deepEqual(op(pai, 'insert'), ['insert', valorInfluenciador]);
  const [camp] = doTabela(chamadas, 'influenciador_campanhas');
  assert.deepEqual(op(camp, 'insert'), ['insert', [{ ...valorCampanha, influenciador_id: 'novo', marca: 'Tesoura de Ouro' }]]);
});

test('salvarInfluenciador (edicao) nao altera a marca, remove, atualiza e envia avatar', async () => {
  const { supabase, chamadas, storage } = criarFake({ respostas: { influenciadores: ok, influenciador_campanhas: ok } });
  const arquivo = { type: 'image/png', size: 1000 };
  const id = await criarService(supabase).salvarInfluenciador({
    id: 'i1', valor: valorInfluenciador,
    campanhas: [{ id: 'c1', valor: valorCampanha }], removidas: ['c9'], avatar: arquivo
  });
  assert.equal(id, 'i1');
  const [atualizaPai, atualizaAvatar] = doTabela(chamadas, 'influenciadores');
  const { marca, ...semMarca } = valorInfluenciador;
  assert.deepEqual(op(atualizaPai, 'update'), ['update', semMarca]);
  assert.deepEqual(op(atualizaPai, 'eq'), ['eq', 'id', 'i1']);
  assert.deepEqual(op(atualizaAvatar, 'update'), ['update', { avatar_path: 'i1/avatar' }]);
  const camps = doTabela(chamadas, 'influenciador_campanhas');
  assert.deepEqual(op(camps[0], 'in'), ['in', 'id', ['c9']]);
  assert.ok(op(camps[0], 'delete'));
  assert.deepEqual(op(camps[1], 'update'), ['update', valorCampanha]);
  assert.deepEqual(op(camps[1], 'eq'), ['eq', 'id', 'c1']);
  assert.deepEqual(storage.uploads, [{
    bucket: 'influenciadores-avatares', caminho: 'i1/avatar',
    opcoes: { upsert: true, contentType: 'image/png', cacheControl: '3600' }
  }]);
});

test('salvarInfluenciador traduz handle duplicado', async () => {
  const { supabase } = criarFake({ respostas: { influenciadores: { data: null, error: { code: '23505' } } } });
  await assert.rejects(
    criarService(supabase).salvarInfluenciador({ id: null, valor: valorInfluenciador, campanhas: [], removidas: [], avatar: null }),
    /já existe um influenciador/i
  );
});

test('excluirInfluenciador remove a linha e tenta apagar o avatar sem falhar se o storage cair', async () => {
  const { supabase, chamadas, storage } = criarFake({ respostas: { influenciadores: ok } });
  await criarService(supabase).excluirInfluenciador('i1');
  assert.deepEqual(op(chamadas[0], 'eq'), ['eq', 'id', 'i1']);
  assert.deepEqual(storage.remocoes, [{ bucket: 'influenciadores-avatares', caminhos: ['i1/avatar'] }]);

  const { supabase: s2 } = criarFake({ respostas: { influenciadores: ok }, falharRemocao: true });
  await criarService(s2).excluirInfluenciador('i1');
});

test('salvarMidia insere com id e marca, atualiza sem eles e traduz URL duplicada', async () => {
  const valor = { titulo: 'Reel', url: 'https://instagram.com/reel/x', plataforma: 'Instagram', formato: 'Reel', publicada_em: '2026-09-10', campanha_id: null, views: 1, alcance: 2, curtidas: 3, comentarios: 4, salvos: 5, compartilhamentos: 6 };
  const a = criarFake({ respostas: { influenciador_midias: ok } });
  await criarService(a.supabase).salvarMidia({ id: null, influenciadorId: 'i1', marca: 'Tesoura de Ouro', valor });
  assert.deepEqual(op(a.chamadas[0], 'insert'), ['insert', { ...valor, influenciador_id: 'i1', marca: 'Tesoura de Ouro' }]);

  const b = criarFake({ respostas: { influenciador_midias: ok } });
  await criarService(b.supabase).salvarMidia({ id: 'm1', influenciadorId: 'i1', marca: 'Tesoura de Ouro', valor });
  assert.deepEqual(op(b.chamadas[0], 'update'), ['update', valor]);
  assert.deepEqual(op(b.chamadas[0], 'eq'), ['eq', 'id', 'm1']);

  const c = criarFake({ respostas: { influenciador_midias: { data: null, error: { code: '23505' } } } });
  await assert.rejects(
    criarService(c.supabase).salvarMidia({ id: null, influenciadorId: 'i1', marca: 'Tesoura de Ouro', valor }),
    /URL já está vinculada/i
  );
});

test('excluirMidia', async () => {
  const { supabase, chamadas } = criarFake({ respostas: { influenciador_midias: ok } });
  await criarService(supabase).excluirMidia('m1');
  assert.ok(op(chamadas[0], 'delete'));
  assert.deepEqual(op(chamadas[0], 'eq'), ['eq', 'id', 'm1']);
});

test('registrarSeguidores faz upsert por influenciador e dia', async () => {
  const { supabase, chamadas } = criarFake({ respostas: { influenciador_seguidores_historico: ok } });
  await criarService(supabase).registrarSeguidores({ influenciadorId: 'i1', marca: 'Tesoura de Ouro', data: '2026-09-21', seguidores: 1450000 });
  assert.deepEqual(op(chamadas[0], 'upsert'), [
    'upsert',
    { influenciador_id: 'i1', marca: 'Tesoura de Ouro', data: '2026-09-21', seguidores: 1450000 },
    { onConflict: 'influenciador_id,data' }
  ]);
});

test('traduzirErro', () => {
  assert.match(traduzirErro({ code: '23505' }, { duplicado: 'Repetido!' }).message, /Repetido!/);
  assert.match(traduzirErro({ code: '23505' }).message, /Já existe/);
  assert.match(traduzirErro({ code: '42501' }).message, /permissão/);
  assert.match(traduzirErro({ code: '23514' }).message, /fora do permitido/);
  const desconhecido = { code: 'XX000', message: 'boom' };
  assert.equal(traduzirErro(desconhecido), desconhecido);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:influenciadores`
Expected: FAIL com `Cannot find module '.../service.js'`.

- [ ] **Step 3: Implementar `service.js`**

```js
// Acesso ao Supabase do modulo Influenciadores. Recebe o cliente por parametro (o mesmo
// createClient do index.html); a autorizacao real e o RLS do banco, nao este arquivo.

const BUCKET = "influenciadores-avatares";
const TABELAS = {
  influenciadores: "influenciadores",
  campanhas: "influenciador_campanhas",
  midias: "influenciador_midias",
  seguidores: "influenciador_seguidores_historico"
};
const TAMANHO_PAGINA = 1000;
const URL_ASSINADA_SEGUNDOS = 3600;
const MSG_INFLUENCIADOR_DUPLICADO = "Já existe um influenciador com este @ nesta rede e bandeira.";
const MSG_URL_DUPLICADA = "Esta URL já está vinculada a este influenciador.";

// Mensagens pt-BR curtas e sem detalhes internos (o app so mostra o que passa por safeErrorMessage).
export function traduzirErro(error, { duplicado } = {}) {
  const codigo = error?.code;
  if (codigo === "23505" && duplicado) return new Error(duplicado);
  const mensagens = {
    "23505": "Já existe um registro com esses dados.",
    "23503": "Registro relacionado não encontrado.",
    "23514": "Algum valor está fora do permitido.",
    "42501": "Você não tem permissão para esta ação."
  };
  return mensagens[codigo] ? new Error(mensagens[codigo]) : error;
}

export async function buscarTodas(supabase, tabela, marca, colunaOrdem, tamanho = TAMANHO_PAGINA) {
  const linhas = [];
  for (let de = 0; ; de += tamanho) {
    let consulta = supabase.from(tabela).select("*")
      .order(colunaOrdem, { ascending: true })
      .order("id", { ascending: true })
      .range(de, de + tamanho - 1);
    if (marca && marca !== "Todas") consulta = consulta.eq("marca", marca);
    const { data, error } = await consulta;
    if (error) throw error;
    linhas.push(...data);
    if (data.length < tamanho) break;
  }
  return linhas;
}

export function criarService(supabase) {
  // Falha em avatar nao pode derrubar a tela: sem URL assinada o avatar cai nas iniciais.
  async function assinarAvatares(influenciadores) {
    const caminhos = influenciadores.map((i) => i.avatar_path).filter(Boolean);
    if (caminhos.length === 0) return new Map();
    try {
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUrls(caminhos, URL_ASSINADA_SEGUNDOS);
      if (error) throw error;
      return new Map(data.filter((d) => d.signedUrl).map((d) => [d.path, d.signedUrl]));
    } catch (erro) {
      console.error(erro);
      return new Map();
    }
  }

  async function carregarTudo(marca) {
    const [influenciadores, campanhas, midias, snapshots] = await Promise.all([
      buscarTodas(supabase, TABELAS.influenciadores, marca, "nome"),
      buscarTodas(supabase, TABELAS.campanhas, marca, "data_inicio"),
      buscarTodas(supabase, TABELAS.midias, marca, "publicada_em"),
      buscarTodas(supabase, TABELAS.seguidores, marca, "data")
    ]);
    const avatares = await assinarAvatares(influenciadores);
    return { influenciadores, campanhas, midias, snapshots, avatares };
  }

  // Nao e transacional (varias chamadas): se uma etapa falhar, o que ja foi gravado permanece e a
  // tela recarrega mostrando o estado real. A marca de um influenciador existente nunca muda.
  async function salvarInfluenciador({ id, valor, campanhas, removidas, avatar }) {
    let influenciadorId = id;
    if (id) {
      const { marca: _marca, ...semMarca } = valor;
      const { error } = await supabase.from(TABELAS.influenciadores).update(semMarca).eq("id", id);
      if (error) throw traduzirErro(error, { duplicado: MSG_INFLUENCIADOR_DUPLICADO });
    } else {
      const { data, error } = await supabase.from(TABELAS.influenciadores).insert(valor).select("id").single();
      if (error) throw traduzirErro(error, { duplicado: MSG_INFLUENCIADOR_DUPLICADO });
      influenciadorId = data.id;
    }

    if (removidas.length > 0) {
      const { error } = await supabase.from(TABELAS.campanhas).delete().in("id", removidas);
      if (error) throw traduzirErro(error);
    }
    const novas = campanhas
      .filter((c) => !c.id)
      .map((c) => ({ ...c.valor, influenciador_id: influenciadorId, marca: valor.marca }));
    if (novas.length > 0) {
      const { error } = await supabase.from(TABELAS.campanhas).insert(novas);
      if (error) throw traduzirErro(error);
    }
    for (const existente of campanhas.filter((c) => c.id)) {
      const { error } = await supabase.from(TABELAS.campanhas).update(existente.valor).eq("id", existente.id);
      if (error) throw traduzirErro(error);
    }

    if (avatar) {
      const caminho = `${influenciadorId}/avatar`;
      const { error: erroUpload } = await supabase.storage.from(BUCKET)
        .upload(caminho, avatar, { upsert: true, contentType: avatar.type, cacheControl: "3600" });
      if (erroUpload) throw erroUpload;
      const { error } = await supabase.from(TABELAS.influenciadores).update({ avatar_path: caminho }).eq("id", influenciadorId);
      if (error) throw traduzirErro(error);
    }
    return influenciadorId;
  }

  async function excluirInfluenciador(id) {
    const { error } = await supabase.from(TABELAS.influenciadores).delete().eq("id", id);
    if (error) throw traduzirErro(error);
    try {
      await supabase.storage.from(BUCKET).remove([`${id}/avatar`]);
    } catch (erro) {
      console.error(erro); // avatar orfao nao impede a exclusao
    }
  }

  async function salvarMidia({ id, influenciadorId, marca, valor }) {
    const consulta = id
      ? supabase.from(TABELAS.midias).update(valor).eq("id", id)
      : supabase.from(TABELAS.midias).insert({ ...valor, influenciador_id: influenciadorId, marca });
    const { error } = await consulta;
    if (error) throw traduzirErro(error, { duplicado: MSG_URL_DUPLICADA });
  }

  async function excluirMidia(id) {
    const { error } = await supabase.from(TABELAS.midias).delete().eq("id", id);
    if (error) throw traduzirErro(error);
  }

  async function registrarSeguidores({ influenciadorId, marca, data, seguidores }) {
    const { error } = await supabase.from(TABELAS.seguidores).upsert(
      { influenciador_id: influenciadorId, marca, data, seguidores },
      { onConflict: "influenciador_id,data" }
    );
    if (error) throw traduzirErro(error);
  }

  return { carregarTudo, salvarInfluenciador, excluirInfluenciador, salvarMidia, excluirMidia, registrarSeguidores };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test:influenciadores`
Expected: todos passam (`fail 0`).

- [ ] **Step 5: Commit**

```bash
git add public/modules/influenciadores/service.js tests/influenciadores/service.test.js
git commit -m "feat(influenciadores): service do Supabase com paginacao, avatar e traducao de erros

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: Formulários em modal (influenciador + campanhas, mídia)

**Files:**
- Create: `public/modules/influenciadores/influencer-form-modal.js`
- Create: `public/modules/influenciadores/midia-form-modal.js`
- Test: `tests/influenciadores/formularios.test.js`

**Interfaces:**
- Consumes: `escapeHtml`; `avatarHtml`; `REDES`, `STATUS`, `FORMATOS`, `MARCAS_VALIDAS`, `validarInfluenciador`, `validarCampanha`, `validarMidia`, `validarAvatar` (`validacao.js`).
- Produces (`influencer-form-modal.js`):
  - `campanhaVazia(hoje): { id: null, nome, data_inicio, data_fim, cache_valor, voucher_valor }` (valores como texto de formulário).
  - `estadoInicialInfluenciador({ influenciador, campanhas, marcaPadrao, avatarUrl }): EstadoInfluenciador`.
  - `influencerFormHtml(estado, { marcasEditaveis: string[], podeExcluir: boolean }): string` (conteúdo interno do `.modal-panel`).
  - `lerInfluencerForm(raiz, estado): EstadoInfluenciador` (lê o DOM de `raiz`; preserva `id`, `removidas`, `avatarFile`, `avatarUrl`).
  - `validarFormularioInfluenciador(estado, marcasValidas?): { ok, erros, valor, campanhas: Array<{ id, valor }> }` com `erros.campanhas?: { [indice]: { campo: msg } }` e `erros.avatar?`.
- Produces (`midia-form-modal.js`):
  - `estadoInicialMidia({ midia, influenciador, campanhas, hoje }): EstadoMidia`, `midiaFormHtml(estado): string`, `lerMidiaForm(raiz, estado): EstadoMidia`, `validarFormularioMidia(estado): { ok, erros, valor }`.
- Hooks de DOM: `#infForm`, `#infFAvatar`, `[data-fechar-modal]`, `[data-adicionar-camp]`, `[data-remover-camp="i"]`, `[data-excluir-influenciador]`, `[data-confirmar-exclusao]`, `[data-cancelar-exclusao]`, `#infMForm`.

- [ ] **Step 1: Escrever os testes que falham**

`tests/influenciadores/formularios.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  campanhaVazia, estadoInicialInfluenciador, influencerFormHtml, validarFormularioInfluenciador
} from '../../public/modules/influenciadores/influencer-form-modal.js';
import {
  estadoInicialMidia, midiaFormHtml, validarFormularioMidia
} from '../../public/modules/influenciadores/midia-form-modal.js';
import { MARCAS_VALIDAS } from '../../public/modules/influenciadores/validacao.js';

const influenciador = {
  id: 'i1', marca: 'Tesoura de Ouro', nome: 'Isabela Lima', handle: '@isabelalima.style', rede_social: 'Instagram',
  verificado: true, nicho: 'Moda', cupom_codigo: 'TESOURA10', cupom_exclusivo: true, status: 'Pausado'
};
const campanhas = [{ id: 'c1', nome: 'Pais 2026', data_inicio: '2026-08-01', data_fim: null, cache_valor: 10000.5, voucher_valor: 5000 }];

test('campanhaVazia usa a data de hoje e valores zerados', () => {
  assert.deepEqual(campanhaVazia('2026-09-21'), {
    id: null, nome: '', data_inicio: '2026-09-21', data_fim: '', cache_valor: '0', voucher_valor: '0'
  });
});

test('estadoInicialInfluenciador (novo) usa padroes e a marca sugerida', () => {
  const e = estadoInicialInfluenciador({ influenciador: null, campanhas: [], marcaPadrao: 'Magazine da Economia' });
  assert.equal(e.id, null);
  assert.equal(e.marca, 'Magazine da Economia');
  assert.equal(e.rede_social, 'Instagram');
  assert.equal(e.status, 'Ativo');
  assert.deepEqual(e.campanhas, []);
});

test('estadoInicialInfluenciador (edicao) carrega dados e converte valores para texto BR', () => {
  const e = estadoInicialInfluenciador({ influenciador, campanhas, marcaPadrao: 'x' });
  assert.equal(e.id, 'i1');
  assert.equal(e.marca, 'Tesoura de Ouro');
  assert.equal(e.status, 'Pausado');
  assert.deepEqual(e.campanhas[0], { id: 'c1', nome: 'Pais 2026', data_inicio: '2026-08-01', data_fim: '', cache_valor: '10000,5', voucher_valor: '5000' });
});

test('formulario de novo influenciador mostra a escolha de bandeira e nao mostra excluir', () => {
  const e = estadoInicialInfluenciador({ influenciador: null, campanhas: [], marcaPadrao: 'Tesoura de Ouro' });
  const html = influencerFormHtml(e, { marcasEditaveis: MARCAS_VALIDAS, podeExcluir: true });
  assert.match(html, /id="infFMarca"/);
  assert.match(html, /Novo influenciador/);
  assert.ok(!html.includes('data-excluir-influenciador'));
});

test('formulario de coordenador (uma marca) fixa a bandeira', () => {
  const e = estadoInicialInfluenciador({ influenciador: null, campanhas: [], marcaPadrao: 'Tesoura de Ouro' });
  const html = influencerFormHtml(e, { marcasEditaveis: ['Tesoura de Ouro'], podeExcluir: false });
  assert.ok(!html.includes('id="infFMarca"'));
  assert.match(html, /Tesoura de Ouro/);
});

test('formulario de edicao mostra valores, campanhas e o botao de excluir', () => {
  const e = estadoInicialInfluenciador({ influenciador, campanhas, marcaPadrao: 'x' });
  const html = influencerFormHtml(e, { marcasEditaveis: MARCAS_VALIDAS, podeExcluir: true });
  for (const texto of ['Editar influenciador', 'value="Isabela Lima"', 'value="@isabelalima.style"', 'value="TESOURA10"',
    'value="Pais 2026"', 'value="10000,5"', 'data-remover-camp="0"', 'data-adicionar-camp', 'data-excluir-influenciador']) {
    assert.ok(html.includes(texto), `faltou ${texto}`);
  }
  assert.ok(!html.includes('id="infFMarca"'), 'na edicao a bandeira nao muda');
});

test('formulario pede confirmacao antes de excluir', () => {
  const e = { ...estadoInicialInfluenciador({ influenciador, campanhas, marcaPadrao: 'x' }), confirmandoExclusao: true };
  const html = influencerFormHtml(e, { marcasEditaveis: MARCAS_VALIDAS, podeExcluir: true });
  assert.match(html, /data-confirmar-exclusao/);
  assert.match(html, /data-cancelar-exclusao/);
  assert.ok(!html.includes('data-excluir-influenciador'));
});

test('formulario mostra erros por campo e desabilita salvar enquanto salva', () => {
  const e = { ...estadoInicialInfluenciador({ influenciador: null, campanhas: [], marcaPadrao: 'Tesoura de Ouro' }),
    erros: { nome: 'Informe o nome (2 a 120 caracteres).' }, erroGeral: 'Falhou ao salvar', salvando: true };
  const html = influencerFormHtml(e, { marcasEditaveis: MARCAS_VALIDAS, podeExcluir: false });
  assert.match(html, /<small class="inf-erro">Informe o nome/);
  assert.match(html, /Falhou ao salvar/);
  assert.match(html, /type="submit"[^>]*disabled/);
});

test('formulario escapa dados do usuario', () => {
  const e = estadoInicialInfluenciador({ influenciador: { ...influenciador, nome: '"><script>1</script>' }, campanhas: [], marcaPadrao: 'x' });
  const html = influencerFormHtml(e, { marcasEditaveis: MARCAS_VALIDAS, podeExcluir: true });
  assert.ok(!html.includes('<script>1</script>'));
});

test('validarFormularioInfluenciador valida pai e campanhas juntos', () => {
  const e = estadoInicialInfluenciador({ influenciador, campanhas, marcaPadrao: 'x' });
  const r = validarFormularioInfluenciador(e);
  assert.equal(r.ok, true);
  assert.equal(r.valor.handle, '@isabelalima.style');
  assert.deepEqual(r.campanhas, [{ id: 'c1', valor: { nome: 'Pais 2026', data_inicio: '2026-08-01', data_fim: null, cache_valor: 10000.5, voucher_valor: 5000 } }]);
});

test('validarFormularioInfluenciador aponta a campanha invalida pelo indice', () => {
  const e = estadoInicialInfluenciador({ influenciador, campanhas, marcaPadrao: 'x' });
  e.campanhas.push({ ...campanhaVazia('2026-09-21'), nome: '', cache_valor: '-1' });
  const r = validarFormularioInfluenciador(e);
  assert.equal(r.ok, false);
  assert.ok(r.erros.campanhas[1].nome);
  assert.ok(r.erros.campanhas[1].cache_valor);
  assert.equal(r.erros.campanhas[0], undefined);
});

test('validarFormularioInfluenciador rejeita avatar invalido', () => {
  const e = { ...estadoInicialInfluenciador({ influenciador, campanhas: [], marcaPadrao: 'x' }), avatarFile: { type: 'image/gif', size: 10 } };
  const r = validarFormularioInfluenciador(e);
  assert.equal(r.ok, false);
  assert.ok(r.erros.avatar);
});

// midia ------------------------------------------------------------------------------------------
const midia = {
  id: 'm1', titulo: 'Reel: Provador', url: 'https://www.instagram.com/reel/C8x9L_p/', plataforma: 'Instagram', formato: 'Reel',
  publicada_em: '2026-09-10', campanha_id: 'c1', views: 1840000, alcance: 4230000, curtidas: 94200, comentarios: 0, salvos: 14800, compartilhamentos: 0
};

test('estadoInicialMidia (nova) usa hoje e formato Reel', () => {
  const e = estadoInicialMidia({ midia: null, influenciador, campanhas, hoje: '2026-09-21' });
  assert.equal(e.id, null);
  assert.equal(e.influenciadorId, 'i1');
  assert.equal(e.marca, 'Tesoura de Ouro');
  assert.equal(e.publicada_em, '2026-09-21');
  assert.equal(e.formato, 'Reel');
  assert.deepEqual(e.campanhas, [{ id: 'c1', nome: 'Pais 2026' }]);
});

test('formulario de midia mostra campos, campanhas e metricas', () => {
  const e = estadoInicialMidia({ midia, influenciador, campanhas, hoje: '2026-09-21' });
  const html = midiaFormHtml(e);
  for (const texto of ['Editar mídia', 'value="Reel: Provador"', 'value="https://www.instagram.com/reel/C8x9L_p/"',
    '<option value="c1" selected>Pais 2026</option>', 'value="1840000"', 'id="infMForm"', 'Métricas informadas manualmente']) {
    assert.ok(html.includes(texto), `faltou ${texto}`);
  }
});

test('formulario de midia nova mostra o titulo certo e escapa dados', () => {
  const e = estadoInicialMidia({ midia: null, influenciador: { ...influenciador, nome: '<b>x</b>' }, campanhas, hoje: '2026-09-21' });
  const html = midiaFormHtml({ ...e, titulo: '"><script>1</script>' });
  assert.match(html, /Vincular nova URL/);
  assert.ok(!html.includes('<script>1</script>'));
  assert.ok(!html.includes('<b>x</b>'));
});

test('validarFormularioMidia reaproveita as regras de validacao', () => {
  const e = estadoInicialMidia({ midia, influenciador, campanhas, hoje: '2026-09-21' });
  const r = validarFormularioMidia(e);
  assert.equal(r.ok, true);
  assert.equal(r.valor.plataforma, 'Instagram');
  assert.equal(r.valor.campanha_id, 'c1');
  assert.equal(validarFormularioMidia({ ...e, url: 'http://x.com/a' }).ok, false);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:influenciadores`
Expected: FAIL com `Cannot find module '.../influencer-form-modal.js'`.

- [ ] **Step 3: Implementar `influencer-form-modal.js`**

```js
import { escapeHtml } from "./html.js";
import { avatarHtml } from "./avatar.js";
import { REDES, STATUS, MARCAS_VALIDAS, validarInfluenciador, validarCampanha, validarAvatar } from "./validacao.js";

export function campanhaVazia(hoje) {
  return { id: null, nome: "", data_inicio: hoje, data_fim: "", cache_valor: "0", voucher_valor: "0" };
}

function textoBR(numero) {
  return String(numero ?? 0).replace(".", ",");
}

export function estadoInicialInfluenciador({ influenciador, campanhas = [], marcaPadrao, avatarUrl = null }) {
  return {
    id: influenciador?.id ?? null,
    marca: influenciador?.marca ?? marcaPadrao,
    nome: influenciador?.nome ?? "",
    handle: influenciador?.handle ?? "",
    rede_social: influenciador?.rede_social ?? "Instagram",
    verificado: influenciador?.verificado ?? false,
    nicho: influenciador?.nicho ?? "",
    cupom_codigo: influenciador?.cupom_codigo ?? "",
    cupom_exclusivo: influenciador?.cupom_exclusivo ?? false,
    status: influenciador?.status ?? "Ativo",
    avatarUrl,
    avatarFile: null,
    campanhas: campanhas.map((c) => ({
      id: c.id,
      nome: c.nome,
      data_inicio: c.data_inicio,
      data_fim: c.data_fim ?? "",
      cache_valor: textoBR(c.cache_valor),
      voucher_valor: textoBR(c.voucher_valor)
    })),
    removidas: [],
    erros: {},
    erroGeral: "",
    salvando: false,
    confirmandoExclusao: false
  };
}

const erroDe = (erros, campo) => (erros[campo] ? `<small class="inf-erro">${escapeHtml(erros[campo])}</small>` : "");
const opcoes = (lista, atual) => lista.map((o) => `<option value="${escapeHtml(o)}"${o === atual ? " selected" : ""}>${escapeHtml(o)}</option>`).join("");

function campanhaLinhaHtml(c, i, erros = {}) {
  return `<div class="inf-camp-linha" data-camp="${i}">
      <label class="inf-camp-nome">Campanha<input id="infFCampNome${i}" type="text" value="${escapeHtml(c.nome)}" maxlength="120" placeholder="Ex: Campanha dos Pais 2026" />${erroDe(erros, "nome")}</label>
      <label>Início<input id="infFCampInicio${i}" type="date" value="${escapeHtml(c.data_inicio)}" />${erroDe(erros, "data_inicio")}</label>
      <label>Fim (opcional)<input id="infFCampFim${i}" type="date" value="${escapeHtml(c.data_fim)}" />${erroDe(erros, "data_fim")}</label>
      <label>Cachê (R$)<input id="infFCampCache${i}" type="text" inputmode="decimal" value="${escapeHtml(c.cache_valor)}" />${erroDe(erros, "cache_valor")}</label>
      <label>Voucher (R$)<input id="infFCampVoucher${i}" type="text" inputmode="decimal" value="${escapeHtml(c.voucher_valor)}" />${erroDe(erros, "voucher_valor")}</label>
      <button type="button" class="inf-icone escuro" data-remover-camp="${i}" title="Remover campanha"><span class="material-symbols-outlined">delete</span></button>
    </div>`;
}

export function influencerFormHtml(e, { marcasEditaveis, podeExcluir }) {
  const novo = !e.id;
  const marca = novo && marcasEditaveis.length > 1
    ? `<label>Bandeira<select id="infFMarca">${opcoes(marcasEditaveis, e.marca)}</select>${erroDe(e.erros, "marca")}</label>`
    : `<label>Bandeira<div class="inf-fixo">${escapeHtml(e.marca)}</div></label>`;
  const campanhas = e.erros.campanhas ?? {};
  const exclusao = !podeExcluir || novo
    ? ""
    : e.confirmandoExclusao
      ? `<span class="inf-confirma">Excluir também campanhas, mídias e histórico?</span><button type="button" class="danger" data-confirmar-exclusao>Confirmar exclusão</button><button type="button" class="secondary" data-cancelar-exclusao>Voltar</button>`
      : `<button type="button" class="danger" data-excluir-influenciador>Excluir influenciador</button>`;

  return `<div class="modal-header"><div><h3>${novo ? "Novo influenciador" : "Editar influenciador"}</h3>
      <p class="muted">${novo ? "Cadastre o criador e, se já houver, o acordo de cada campanha." : "Atualize os dados, acordos e campanhas."}</p></div>
      <button type="button" class="modal-close" data-fechar-modal aria-label="Fechar"><span class="material-symbols-outlined">close</span></button></div>
    <form id="infForm" class="modal-body" novalidate>
      ${e.erroGeral ? `<div class="alert error">${escapeHtml(e.erroGeral)}</div>` : ""}
      <div class="inf-form-avatar">${avatarHtml({ nome: e.nome || "?", url: e.avatarUrl, tamanho: "lg" })}
        <label>Foto (JPG, PNG ou WebP, até 1 MB)<input id="infFAvatar" type="file" accept="image/jpeg,image/png,image/webp" />${erroDe(e.erros, "avatar")}</label></div>
      <div class="inf-form-grid">
        <label>Nome<input id="infFNome" type="text" value="${escapeHtml(e.nome)}" maxlength="120" />${erroDe(e.erros, "nome")}</label>
        <label>@ do perfil<input id="infFHandle" type="text" value="${escapeHtml(e.handle)}" maxlength="51" placeholder="@usuario" />${erroDe(e.erros, "handle")}</label>
        <label>Rede social<select id="infFRede">${opcoes(REDES, e.rede_social)}</select>${erroDe(e.erros, "rede_social")}</label>
        ${marca}
        <label>Nicho (opcional)<input id="infFNicho" type="text" value="${escapeHtml(e.nicho)}" maxlength="60" placeholder="Ex: Moda &amp; Varejo" />${erroDe(e.erros, "nicho")}</label>
        <label>Status<select id="infFStatus">${opcoes(STATUS, e.status)}</select>${erroDe(e.erros, "status")}</label>
        <label>Cupom (opcional)<input id="infFCupom" type="text" value="${escapeHtml(e.cupom_codigo)}" maxlength="30" placeholder="TESOURA10" />${erroDe(e.erros, "cupom_codigo")}</label>
        <div class="inf-form-checks">
          <label class="inf-check"><input id="infFVerificado" type="checkbox"${e.verificado ? " checked" : ""} /> Perfil verificado</label>
          <label class="inf-check"><input id="infFCupomExclusivo" type="checkbox"${e.cupom_exclusivo ? " checked" : ""} /> Cupom exclusivo</label>
        </div>
      </div>
      <div class="inf-form-campanhas"><div class="inf-form-campanhas-topo"><strong>Campanhas e acordos</strong>
        <button type="button" class="secondary" data-adicionar-camp><span class="material-symbols-outlined" style="font-size:16px">add</span> Adicionar campanha</button></div>
        ${e.campanhas.length === 0 ? `<p class="muted">Nenhuma campanha. Adicione uma para registrar cachê e voucher.</p>` : e.campanhas.map((c, i) => campanhaLinhaHtml(c, i, campanhas[i])).join("")}
      </div>
      <div class="inf-form-rodape"><div class="inf-form-exclusao">${exclusao}</div>
        <div class="inf-form-botoes"><button type="button" class="secondary" data-fechar-modal>Cancelar</button>
        <button type="submit"${e.salvando ? " disabled" : ""}>${e.salvando ? "Salvando…" : "Salvar"}</button></div></div>
    </form>`;
}

// Le o DOM do modal para o estado (preserva id, removidas, foto e URL do avatar).
export function lerInfluencerForm(raiz, estado) {
  const valor = (id) => raiz.querySelector(`#${id}`)?.value ?? "";
  const marcado = (id) => Boolean(raiz.querySelector(`#${id}`)?.checked);
  return {
    ...estado,
    marca: raiz.querySelector("#infFMarca")?.value ?? estado.marca,
    nome: valor("infFNome"),
    handle: valor("infFHandle"),
    rede_social: valor("infFRede"),
    nicho: valor("infFNicho"),
    status: valor("infFStatus"),
    cupom_codigo: valor("infFCupom"),
    verificado: marcado("infFVerificado"),
    cupom_exclusivo: marcado("infFCupomExclusivo"),
    campanhas: estado.campanhas.map((c, i) => ({
      ...c,
      nome: valor(`infFCampNome${i}`),
      data_inicio: valor(`infFCampInicio${i}`),
      data_fim: valor(`infFCampFim${i}`),
      cache_valor: valor(`infFCampCache${i}`),
      voucher_valor: valor(`infFCampVoucher${i}`)
    }))
  };
}

export function validarFormularioInfluenciador(estado, marcasValidas = MARCAS_VALIDAS) {
  const base = validarInfluenciador(estado, marcasValidas);
  const erros = { ...base.erros };

  const errosCampanhas = {};
  const campanhas = estado.campanhas.map((c, i) => {
    const r = validarCampanha(c);
    if (!r.ok) errosCampanhas[i] = r.erros;
    return { id: c.id, valor: r.valor };
  });
  if (Object.keys(errosCampanhas).length > 0) erros.campanhas = errosCampanhas;

  if (estado.avatarFile) {
    const avatar = validarAvatar(estado.avatarFile);
    if (!avatar.ok) erros.avatar = avatar.erro;
  }
  return { ok: Object.keys(erros).length === 0, erros, valor: base.valor, campanhas };
}
```

- [ ] **Step 4: Implementar `midia-form-modal.js`**

```js
import { escapeHtml } from "./html.js";
import { REDES, FORMATOS, validarMidia } from "./validacao.js";

const CAMPOS_METRICA = [
  ["views", "Views", "infMViews"],
  ["alcance", "Alcance", "infMAlcance"],
  ["curtidas", "Curtidas", "infMCurtidas"],
  ["comentarios", "Comentários", "infMComentarios"],
  ["salvos", "Salvos", "infMSalvos"],
  ["compartilhamentos", "Compartilhamentos", "infMCompart"]
];

export function estadoInicialMidia({ midia, influenciador, campanhas = [], hoje }) {
  const estado = {
    id: midia?.id ?? null,
    influenciadorId: influenciador.id,
    influenciadorNome: influenciador.nome,
    marca: influenciador.marca,
    titulo: midia?.titulo ?? "",
    url: midia?.url ?? "",
    plataforma: midia?.plataforma ?? "",
    formato: midia?.formato ?? "Reel",
    publicada_em: midia?.publicada_em ?? hoje,
    campanha_id: midia?.campanha_id ?? "",
    campanhas: campanhas.map((c) => ({ id: c.id, nome: c.nome })),
    erros: {},
    erroGeral: "",
    salvando: false
  };
  for (const [campo] of CAMPOS_METRICA) estado[campo] = midia ? String(midia[campo] ?? 0) : "";
  return estado;
}

const erroDe = (erros, campo) => (erros[campo] ? `<small class="inf-erro">${escapeHtml(erros[campo])}</small>` : "");

export function midiaFormHtml(e) {
  const novo = !e.id;
  const plataformas = [`<option value="">Detectar pela URL</option>`, ...REDES.map((r) => `<option value="${r}"${r === e.plataforma ? " selected" : ""}>${r}</option>`)].join("");
  const formatos = FORMATOS.map((f) => `<option value="${f}"${f === e.formato ? " selected" : ""}>${f}</option>`).join("");
  const campanhas = [`<option value="">Sem campanha</option>`, ...e.campanhas.map((c) => `<option value="${escapeHtml(c.id)}"${c.id === e.campanha_id ? " selected" : ""}>${escapeHtml(c.nome)}</option>`)].join("");
  const metricas = CAMPOS_METRICA.map(([campo, rotulo, id]) =>
    `<label>${rotulo}<input id="${id}" type="text" inputmode="numeric" value="${escapeHtml(e[campo])}" placeholder="0" />${erroDe(e.erros, campo)}</label>`).join("");

  return `<div class="modal-header"><div><h3>${novo ? "Vincular nova URL" : "Editar mídia"}</h3>
      <p class="muted">${escapeHtml(e.influenciadorNome)} · ${escapeHtml(e.marca)}</p></div>
      <button type="button" class="modal-close" data-fechar-modal aria-label="Fechar"><span class="material-symbols-outlined">close</span></button></div>
    <form id="infMForm" class="modal-body" novalidate>
      ${e.erroGeral ? `<div class="alert error">${escapeHtml(e.erroGeral)}</div>` : ""}
      <label>Título<input id="infMTitulo" type="text" value="${escapeHtml(e.titulo)}" maxlength="160" placeholder="Ex: Reel: Provador Tesoura de Ouro" />${erroDe(e.erros, "titulo")}</label>
      <label>URL do post<input id="infMUrl" type="url" value="${escapeHtml(e.url)}" maxlength="500" placeholder="https://www.instagram.com/reel/..." />${erroDe(e.erros, "url")}</label>
      <div class="inf-form-grid">
        <label>Plataforma<select id="infMPlataforma">${plataformas}</select>${erroDe(e.erros, "plataforma")}</label>
        <label>Formato<select id="infMFormato">${formatos}</select>${erroDe(e.erros, "formato")}</label>
        <label>Publicado em<input id="infMData" type="date" value="${escapeHtml(e.publicada_em)}" />${erroDe(e.erros, "publicada_em")}</label>
        <label>Campanha<select id="infMCampanha">${campanhas}</select></label>
      </div>
      <p class="muted" style="margin:0">Métricas informadas manualmente (copie do print de insights que o influenciador enviou).</p>
      <div class="inf-form-grid inf-form-grid-3">${metricas}</div>
      <div class="inf-form-rodape"><div></div><div class="inf-form-botoes"><button type="button" class="secondary" data-fechar-modal>Cancelar</button>
        <button type="submit"${e.salvando ? " disabled" : ""}>${e.salvando ? "Salvando…" : "Salvar"}</button></div></div>
    </form>`;
}

export function lerMidiaForm(raiz, estado) {
  const valor = (id) => raiz.querySelector(`#${id}`)?.value ?? "";
  const lido = {
    ...estado,
    titulo: valor("infMTitulo"),
    url: valor("infMUrl"),
    plataforma: valor("infMPlataforma"),
    formato: valor("infMFormato"),
    publicada_em: valor("infMData"),
    campanha_id: valor("infMCampanha")
  };
  for (const [campo, , id] of CAMPOS_METRICA) lido[campo] = valor(id);
  return lido;
}

export function validarFormularioMidia(estado) {
  return validarMidia(estado);
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npm run test:influenciadores`
Expected: todos passam (`fail 0`).

- [ ] **Step 6: Commit**

```bash
git add public/modules/influenciadores/influencer-form-modal.js public/modules/influenciadores/midia-form-modal.js tests/influenciadores/formularios.test.js
git commit -m "feat(influenciadores): formularios de influenciador, campanhas e midia

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 9: `index.js` (orquestrador) e integração no `index.html`

**Files:**
- Create: `public/modules/influenciadores/index.js`
- Modify: `public/index.html` (menu, rota, título, overlays, CSS `.inf-*`)

**Interfaces:**
- Consumes: todo o restante do módulo (`calculos.js`, `validacao.js`, `avatar.js`, `growth-chart.js`, `kpi-cards.js`, `brand-filter-pills.js`, `influencers-table.js`, `influencer-drawer.js`, `service.js`, `influencer-form-modal.js`, `midia-form-modal.js`). Do `index.html`: `supabase`, `state`, `escapeHtml`, `marcas`, `safeErrorMessage`.
- Produces: `export async function renderInfluenciadores({ supabase, state, escapeHtml, marcas, safeErrorMessage })`, chamada pelo `index.html` a cada `render()` com `state.page === "influenciadores"`.

Esta task não tem teste automatizado por rodar em DOM de navegador real (sem jsdom no projeto). A verificação é manual, no Step 6, e cobre exatamente os fluxos que os testes das tasks anteriores não alcançam: montagem do DOM, encadeamento de eventos e o round-trip com o Supabase real.

- [ ] **Step 1: Criar `index.js`**

`public/modules/influenciadores/index.js`:

```js
// Orquestrador do modulo Influenciadores: mantem o estado da tela, busca os dados, decide o que
// renderizar e liga os eventos dos componentes. Chamado por public/index.html via import()
// dinamico quando state.page === "influenciadores".

import { escapeHtml as escapeHtmlLocal } from "./html.js";
import {
  agruparPorInfluenciador, agregarInfluenciador, calcularKpis, filtrarInfluenciadores,
  paginar, pontosCrescimento, hojeISO
} from "./calculos.js";
import { kpiCardsHtml } from "./kpi-cards.js";
import { opcoesMarca, brandFilterPillsHtml, bindBrandFilterPills } from "./brand-filter-pills.js";
import { influencersTableHtml, bindInfluencersTable } from "./influencers-table.js";
import { influencerDrawerHtml, bindInfluencerDrawer } from "./influencer-drawer.js";
import { criarService } from "./service.js";
import {
  campanhaVazia, estadoInicialInfluenciador, influencerFormHtml, lerInfluencerForm, validarFormularioInfluenciador
} from "./influencer-form-modal.js";
import {
  estadoInicialMidia, midiaFormHtml, lerMidiaForm, validarFormularioMidia
} from "./midia-form-modal.js";

const TAMANHO_PAGINA = 5;
const SUBABAS = [
  ["geral", "Visão Geral"],
  ["parcerias", "Desempenho de Parcerias"],
  ["vincular", "Vincular Conteúdo (URL)"],
  ["comparativo", "Comparativo"]
];

let deps = null;
let service = null;
let estado = null;

function podeEditar() {
  const cargo = deps.state.perfil?.cargo;
  return cargo === "Admin" || cargo === "Gestor" || cargo === "Coordenador";
}

function novoEstado() {
  return {
    carregando: true,
    erro: "",
    dados: { influenciadores: [], campanhas: [], midias: [], snapshots: [], avatares: new Map() },
    busca: "",
    pagina: 1,
    abertoId: null,
    selecionados: new Set(),
    subaba: "geral",
    modal: null // { tipo: "influenciador" | "midia", ...estadoDoFormulario }
  };
}

export async function initInfluenciadores(dependencias) {
  deps = dependencias;
  service = criarService(deps.supabase);
}

async function carregar() {
  estado.carregando = true;
  estado.erro = "";
  pintar();
  try {
    estado.dados = await service.carregarTudo(deps.state.marca);
    if (estado.abertoId && !estado.dados.influenciadores.some((i) => i.id === estado.abertoId)) {
      estado.abertoId = null;
    }
  } catch (erro) {
    estado.erro = deps.safeErrorMessage(erro, "Não foi possível carregar os influenciadores.");
  } finally {
    estado.carregando = false;
    pintar();
  }
}

function modeloTabela() {
  const hoje = hojeISO();
  const grupos = agruparPorInfluenciador({ influenciadores: estado.dados.influenciadores, ...estado.dados });
  const filtrados = filtrarInfluenciadores(estado.dados.influenciadores, estado.busca);
  const pagina = paginar(filtrados, estado.pagina, TAMANHO_PAGINA);
  const linhas = pagina.itens.map((influenciador) => ({
    influenciador,
    agregado: agregarInfluenciador(grupos.get(influenciador.id), hoje),
    avatarUrl: influenciador.avatar_path ? estado.dados.avatares.get(influenciador.avatar_path) ?? null : null
  }));
  return {
    linhas, cadastrados: estado.dados.influenciadores.length, total: pagina.total,
    pagina: pagina.pagina, totalPaginas: pagina.totalPaginas, busca: estado.busca,
    abertoId: estado.abertoId, selecionados: estado.selecionados, podeEditar: podeEditar()
  };
}

function modeloDrawer() {
  const influenciador = estado.dados.influenciadores.find((i) => i.id === estado.abertoId) ?? null;
  if (!influenciador) return { influenciador: null };
  const hoje = hojeISO();
  const grupos = agruparPorInfluenciador({ influenciadores: estado.dados.influenciadores, ...estado.dados });
  const grupo = grupos.get(influenciador.id);
  return {
    influenciador,
    avatarUrl: influenciador.avatar_path ? estado.dados.avatares.get(influenciador.avatar_path) ?? null : null,
    agregado: agregarInfluenciador(grupo, hoje),
    campanhas: grupo.campanhas,
    midias: grupo.midias,
    pontos: pontosCrescimento(grupo.snapshots),
    podeEditar: podeEditar(),
    hoje
  };
}

function subabasHtml() {
  return `<div class="inf-subabas">${SUBABAS.map(([chave, rotulo]) =>
    `<button type="button" class="${chave === estado.subaba ? "ativa" : ""}"${chave === "geral" ? "" : " disabled title=\"Em breve\""} data-subaba="${chave}">${rotulo}</button>`
  ).join("")}</div>`;
}

function pintar() {
  const raiz = deps.state.contentEl;
  if (estado.carregando && estado.dados.influenciadores.length === 0) {
    raiz.innerHTML = `<div class="page-head"><div><div class="eyebrow">Meta Business &amp; Creators</div><h2>Influenciadores</h2></div></div><p class="muted">Carregando…</p>`;
    return;
  }
  const kpis = calcularKpis({ campanhas: estado.dados.campanhas, midias: estado.dados.midias, mes: hojeISO().slice(0, 7) });
  raiz.innerHTML = `
    <div class="page-head"><div><div class="eyebrow">Meta Business &amp; Creators</div><h2>Influenciadores</h2></div>
      ${brandFilterPillsHtml({ opcoes: opcoesMarca(deps.state.perfil?.cargo, deps.marcas), marcaAtual: deps.state.marca })}
    </div>
    ${subabasHtml()}
    ${estado.erro ? `<div class="alert error">${deps.escapeHtml(estado.erro)}</div>` : ""}
    ${estado.subaba !== "geral" ? `<p class="muted">Esta aba estará disponível em breve.</p>` : `
      ${kpiCardsHtml(kpis)}
      <div class="inf-layout">
        <section class="card inf-tabela">${influencersTableHtml(modeloTabela())}</section>
        <section class="card inf-drawer">${influencerDrawerHtml(modeloDrawer())}</section>
      </div>`}
    <div class="modal-overlay" id="infModal" hidden></div>`;
  ligarEventos();
}

function ligarEventos() {
  const raiz = deps.state.contentEl;
  bindBrandFilterPills(raiz, (marca) => {
    deps.state.marca = marca;
    estado.pagina = 1;
    estado.abertoId = null;
    estado.selecionados = new Set();
    carregar();
  });
  raiz.querySelectorAll("[data-subaba]").forEach((botao) => {
    if (botao.disabled) return;
    botao.onclick = () => { estado.subaba = botao.dataset.subaba; pintar(); };
  });
  if (estado.subaba !== "geral") return;

  bindInfluencersTable(raiz, {
    aoBuscar: (texto) => { estado.busca = texto; estado.pagina = 1; pintar(); },
    aoSelecionar: (id) => { estado.abertoId = estado.abertoId === id ? null : id; pintar(); },
    aoMarcar: (id, marcado) => { marcado ? estado.selecionados.add(id) : estado.selecionados.delete(id); pintar(); },
    aoMarcarTodos: (marcado) => {
      const pagina = paginar(filtrarInfluenciadores(estado.dados.influenciadores, estado.busca), estado.pagina, TAMANHO_PAGINA);
      for (const i of pagina.itens) marcado ? estado.selecionados.add(i.id) : estado.selecionados.delete(i.id);
      pintar();
    },
    aoPaginar: (n) => { estado.pagina = n; pintar(); },
    aoNovo: () => abrirModalInfluenciador(null)
  });

  bindInfluencerDrawer(raiz, {
    aoFechar: () => { estado.abertoId = null; pintar(); },
    aoEditar: () => abrirModalInfluenciador(estado.dados.influenciadores.find((i) => i.id === estado.abertoId)),
    aoNovaMidia: () => abrirModalMidia(null),
    aoEditarMidia: (id) => abrirModalMidia(estado.dados.midias.find((m) => m.id === id)),
    aoExcluirMidia: async (id) => {
      if (!window.confirm("Excluir esta mídia vinculada?")) return;
      try {
        await service.excluirMidia(id);
        await carregar();
      } catch (erro) {
        estado.erro = deps.safeErrorMessage(erro, "Não foi possível excluir a mídia.");
        pintar();
      }
    },
    aoCopiarCupom: async (codigo, botao) => {
      try {
        await navigator.clipboard.writeText(codigo);
        const original = botao.innerHTML;
        botao.innerHTML = `<span>Copiado!</span>`;
        setTimeout(() => { botao.innerHTML = original; }, 1500);
      } catch {
        /* clipboard indisponivel (ex: contexto sem foco) - falha silenciosa, nao e critico */
      }
    },
    aoRegistrarSeguidores: async ({ data, seguidores }) => {
      const influenciador = estado.dados.influenciadores.find((i) => i.id === estado.abertoId);
      try {
        await service.registrarSeguidores({
          influenciadorId: influenciador.id, marca: influenciador.marca,
          data, seguidores: Number(String(seguidores).replace(/\D/g, ""))
        });
        await carregar();
      } catch (erro) {
        estado.erro = deps.safeErrorMessage(erro, "Não foi possível registrar os seguidores.");
        pintar();
      }
    }
  });
}

function marcasEditaveisPara(cargo) {
  if (cargo === "Admin" || cargo === "Gestor") return deps.marcas.filter((m) => m !== "Todas");
  return deps.state.perfil?.marca_vinculada ? [deps.state.perfil.marca_vinculada] : [];
}

function marcaPadrao() {
  if (deps.state.marca !== "Todas") return deps.state.marca;
  return marcasEditaveisPara(deps.state.perfil?.cargo)[0] ?? "Tesoura de Ouro";
}

function pintarModal() {
  const overlay = deps.state.contentEl.querySelector("#infModal");
  if (!overlay || !estado.modal) return;
  const html = estado.modal.tipo === "influenciador"
    ? influencerFormHtml(estado.modal, { marcasEditaveis: marcasEditaveisPara(deps.state.perfil?.cargo), podeExcluir: Boolean(estado.modal.id) })
    : midiaFormHtml(estado.modal);
  overlay.innerHTML = `<div class="modal-panel">${html}</div>`;
  overlay.hidden = false;
  ligarModal(overlay);
}

function fecharModal() {
  estado.modal = null;
  const overlay = deps.state.contentEl.querySelector("#infModal");
  if (overlay) { overlay.hidden = true; overlay.innerHTML = ""; }
}

function abrirModalInfluenciador(influenciador) {
  const grupo = influenciador
    ? agruparPorInfluenciador({ influenciadores: [influenciador], ...estado.dados }).get(influenciador.id)
    : { campanhas: [] };
  const avatarUrl = influenciador?.avatar_path ? estado.dados.avatares.get(influenciador.avatar_path) ?? null : null;
  estado.modal = { tipo: "influenciador", ...estadoInicialInfluenciador({ influenciador, campanhas: grupo.campanhas, marcaPadrao: marcaPadrao(), avatarUrl }) };
  pintarModal();
}

function abrirModalMidia(midia) {
  const influenciador = estado.dados.influenciadores.find((i) => i.id === (midia?.influenciador_id ?? estado.abertoId));
  const campanhas = agruparPorInfluenciador({ influenciadores: [influenciador], ...estado.dados }).get(influenciador.id).campanhas;
  estado.modal = { tipo: "midia", ...estadoInicialMidia({ midia, influenciador, campanhas, hoje: hojeISO() }) };
  pintarModal();
}

function ligarModal(overlay) {
  overlay.querySelectorAll("[data-fechar-modal]").forEach((b) => { b.onclick = fecharModal; });

  if (estado.modal.tipo === "influenciador") {
    overlay.querySelector("[data-adicionar-camp]")?.addEventListener("click", () => {
      estado.modal = lerInfluencerForm(overlay, estado.modal);
      estado.modal.campanhas.push(campanhaVazia(hojeISO()));
      pintarModal();
    });
    overlay.querySelectorAll("[data-remover-camp]").forEach((b) => {
      b.onclick = () => {
        estado.modal = lerInfluencerForm(overlay, estado.modal);
        const i = Number(b.dataset.removerCamp);
        const removida = estado.modal.campanhas.splice(i, 1)[0];
        if (removida.id) estado.modal.removidas.push(removida.id);
        pintarModal();
      };
    });
    overlay.querySelector("[data-excluir-influenciador]")?.addEventListener("click", () => {
      estado.modal.confirmandoExclusao = true;
      pintarModal();
    });
    overlay.querySelector("[data-cancelar-exclusao]")?.addEventListener("click", () => {
      estado.modal.confirmandoExclusao = false;
      pintarModal();
    });
    overlay.querySelector("[data-confirmar-exclusao]")?.addEventListener("click", async () => {
      try {
        await service.excluirInfluenciador(estado.modal.id);
        fecharModal();
        await carregar();
      } catch (erro) {
        estado.modal.erroGeral = deps.safeErrorMessage(erro, "Não foi possível excluir o influenciador.");
        estado.modal.confirmandoExclusao = false;
        pintarModal();
      }
    });
    const avatarInput = overlay.querySelector("#infFAvatar");
    if (avatarInput) avatarInput.onchange = () => {
      estado.modal = lerInfluencerForm(overlay, estado.modal);
      estado.modal.avatarFile = avatarInput.files[0] ?? null;
    };

    overlay.querySelector("#infForm").onsubmit = async (evento) => {
      evento.preventDefault();
      estado.modal = lerInfluencerForm(overlay, estado.modal);
      const r = validarFormularioInfluenciador(estado.modal, marcasEditaveisPara(deps.state.perfil?.cargo));
      if (!r.ok) { estado.modal.erros = r.erros; pintarModal(); return; }
      estado.modal.erros = {};
      estado.modal.salvando = true;
      pintarModal();
      try {
        await service.salvarInfluenciador({
          id: estado.modal.id, valor: r.valor, campanhas: r.campanhas,
          removidas: estado.modal.removidas, avatar: estado.modal.avatarFile
        });
        fecharModal();
        await carregar();
      } catch (erro) {
        estado.modal.erroGeral = deps.safeErrorMessage(erro, "Não foi possível salvar o influenciador.");
        estado.modal.salvando = false;
        pintarModal();
      }
    };
    return;
  }

  overlay.querySelector("#infMForm").onsubmit = async (evento) => {
    evento.preventDefault();
    estado.modal = lerMidiaForm(overlay, estado.modal);
    const r = validarFormularioMidia(estado.modal);
    if (!r.ok) { estado.modal.erros = r.erros; pintarModal(); return; }
    estado.modal.erros = {};
    estado.modal.salvando = true;
    pintarModal();
    try {
      await service.salvarMidia({ id: estado.modal.id, influenciadorId: estado.modal.influenciadorId, marca: estado.modal.marca, valor: r.valor });
      fecharModal();
      await carregar();
    } catch (erro) {
      estado.modal.erroGeral = deps.safeErrorMessage(erro, "Não foi possível salvar a mídia.");
      estado.modal.salvando = false;
      pintarModal();
    }
  };
}

export async function renderInfluenciadores() {
  if (!estado) estado = novoEstado();
  if (estado.dados.influenciadores.length === 0 && !estado.carregando) await carregar();
  else pintar();
}
```

- [ ] **Step 2: Adicionar o menu, a rota e os overlays em `public/index.html`**

Adicionar o item de menu logo após "Redes Sociais" (perto da linha 1495-1496 identificada na exploração do projeto):

```html
              <button id="navInfluenciadores" class="${state.page === "influenciadores" ? "active" : ""}"><span class="material-symbols-outlined">group</span>Influenciadores</button>
```

No bloco de `onclick` dos botões de navegação (perto da linha 1537-1538), adicionar:

```js
        document.querySelector("#navInfluenciadores").onclick = () => { state.page = "influenciadores"; render(); };
```

No `render()`, no bloco de `if (state.page === ...)` (perto da linha 1552-1564), adicionar antes de `if (state.page === "ads")`:

```js
        if (state.page === "influenciadores") await renderInfluenciadoresPagina();
```

Em `pageTitle()` (perto da linha 1567-1578), adicionar:

```js
        if (state.page === "influenciadores") return "Influenciadores";
```

No bloco de `<div class="modal-overlay" ...>` do template de `render()` (perto da linha 1521-1530), **não** adicionar nada ali — o overlay `#infModal` é criado pelo próprio `index.js` dentro do conteúdo da página (`#content`), não precisa de outro overlay fixo no shell.

Perto de `escapeHtml` (fim do arquivo, na área das funções utilitárias já existentes, ex.: logo após a declaração de `escapeHtml`), adicionar a função de ponte que carrega o módulo sob demanda:

```js
      let influenciadoresModulo = null;
      async function renderInfluenciadoresPagina() {
        const content = document.querySelector("#content");
        state.contentEl = content;
        if (!influenciadoresModulo) {
          influenciadoresModulo = await import("./modules/influenciadores/index.js");
          await influenciadoresModulo.initInfluenciadores({ supabase, state, escapeHtml, marcas, safeErrorMessage });
        }
        await influenciadoresModulo.renderInfluenciadores();
      }
```

- [ ] **Step 3: Adicionar o bloco de CSS `.inf-*`**

No `<style>` existente, logo antes do fechamento `</style>` (perto da linha 328-329 identificada na exploração), adicionar:

```css
      /* Modulo Influenciadores ------------------------------------------------------------------ */
      .inf-bandeira { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .inf-bandeira-rotulo { display: inline-flex; align-items: center; gap: 4px; color: #94a3b8; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; }
      .inf-pill { background: #f1f5f9; color: #475569; border: 1px solid #e2e8f0; border-radius: 999px; padding: 6px 14px; font-size: 12px; font-weight: 600; }
      .inf-pill.ativa { background: #1D4ED8; color: white; border-color: #1D4ED8; }
      .inf-subabas { display: inline-flex; background: #f1f5f9; border-radius: 12px; padding: 4px; gap: 2px; flex-wrap: wrap; }
      .inf-subabas button { background: transparent; color: #475569; padding: 6px 14px; border-radius: 8px; font-size: 12px; font-weight: 700; }
      .inf-subabas button.ativa { background: white; color: #0f172a; box-shadow: 0 1px 3px rgba(15,23,42,.12); }
      .inf-subabas button:disabled { color: #cbd5e1; cursor: not-allowed; }
      .inf-kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; }
      .inf-kpi { background: white; border: 1px solid #e2e8f0; border-radius: 16px; padding: 18px; position: relative; overflow: hidden; }
      .inf-kpi-topo { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
      .inf-kpi-rotulo { font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: .04em; }
      .inf-kpi-icone { width: 32px; height: 32px; border-radius: 10px; display: inline-flex; align-items: center; justify-content: center; }
      .inf-kpi-icone.azul { background: #eff6ff; color: #1D4ED8; }
      .inf-kpi-icone.roxo { background: #f5f3ff; color: #7c3aed; }
      .inf-kpi-icone.ambar { background: #fffbeb; color: #b45309; }
      .inf-kpi-icone.verde { background: #ecfdf5; color: #059669; }
      .inf-kpi-valor { font-size: 26px; font-weight: 800; color: #0f172a; margin-bottom: 8px; }
      .inf-kpi-rodape { display: flex; align-items: center; gap: 8px; font-size: 11px; flex-wrap: wrap; }
      .inf-kpi-anterior { color: #94a3b8; }
      .inf-delta { font-weight: 700; padding: 2px 8px; border-radius: 6px; }
      .inf-delta.favoravel { color: #059669; background: #ecfdf5; }
      .inf-delta.desfavoravel { color: #b91c1c; background: #fef2f2; }
      .inf-delta.neutro { color: #94a3b8; background: #f1f5f9; }
      .inf-kpi-barra { position: absolute; bottom: 0; left: 0; right: 0; height: 4px; }
      .inf-kpi-barra.azul { background: linear-gradient(90deg,#3b82f6,#1D4ED8); }
      .inf-kpi-barra.roxo { background: linear-gradient(90deg,#a78bfa,#7c3aed); }
      .inf-kpi-barra.ambar { background: linear-gradient(90deg,#fbbf24,#b45309); }
      .inf-kpi-barra.verde { background: linear-gradient(90deg,#34d399,#059669); }
      .inf-layout { display: grid; grid-template-columns: minmax(0,7fr) minmax(320px,4fr); gap: 24px; align-items: start; }
      .inf-tabela, .inf-drawer { padding: 0; overflow: hidden; }
      .inf-drawer { padding: 24px; }
      .inf-tabela-topo { padding: 20px; border-bottom: 1px solid #e2e8f0; display: flex; flex-wrap: wrap; justify-content: space-between; gap: 14px; align-items: center; }
      .inf-tabela-titulo { display: flex; align-items: center; gap: 8px; }
      .inf-tabela-titulo h3 { margin: 0; font-size: 17px; }
      .inf-badge-contagem { padding: 2px 8px; border-radius: 999px; background: #eff6ff; color: #1D4ED8; font-size: 11px; font-weight: 700; }
      .inf-tabela-ferramentas { display: flex; align-items: center; gap: 10px; }
      .inf-busca { position: relative; }
      .inf-busca .material-symbols-outlined { position: absolute; left: 10px; top: 9px; color: #94a3b8; font-size: 15px; }
      .inf-busca input { padding: 7px 10px 7px 32px; font-size: 12px; background: #f8fafc; width: 190px; }
      .inf-btn-primario { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; }
      .inf-table { font-size: 12px; }
      .inf-table th, .inf-table td { padding: 12px 10px; }
      .inf-col-check { width: 36px; }
      .inf-col-acoes { text-align: right; }
      .inf-linha { cursor: pointer; }
      .inf-linha.aberta { background: #eff6ff; border-left: 4px solid #1D4ED8; }
      .inf-criador { display: flex; align-items: center; gap: 10px; }
      .inf-avatar { border-radius: 50%; object-fit: cover; display: inline-flex; align-items: center; justify-content: center; font-weight: 800; flex: none; }
      .inf-avatar-md { width: 40px; height: 40px; font-size: 13px; }
      .inf-avatar-lg { width: 56px; height: 56px; font-size: 17px; }
      .inf-avatar.destaque { box-shadow: 0 0 0 2px #1D4ED8; }
      .inf-criador-nome { font-weight: 700; color: #0f172a; font-size: 13px; display: flex; align-items: center; gap: 6px; }
      .inf-verificado { color: #1D4ED8 !important; font-size: 14px !important; }
      .inf-criador-handle { color: #94a3b8; font-size: 11px; font-weight: 600; }
      .inf-rede { padding: 1px 6px; border-radius: 999px; font-size: 9px; font-weight: 800; border: 1px solid transparent; }
      .inf-rede.ig { background: #fdf2f8; color: #db2777; border-color: #fbcfe8; }
      .inf-rede.tt { background: #0f172a; color: white; }
      .inf-rede.yt { background: #fef2f2; color: #dc2626; border-color: #fecaca; }
      .inf-num { font-weight: 600; color: #1e293b; }
      .inf-num.forte { font-weight: 800; color: #0f172a; }
      .inf-num.azul { font-weight: 800; color: #1D4ED8; }
      .inf-cresc { display: inline-flex; align-items: center; gap: 2px; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 800; }
      .inf-cresc.sobe { background: #d1fae5; color: #065f46; }
      .inf-cresc.desce { background: #fee2e2; color: #991b1b; }
      .inf-cresc.neutro { background: #f1f5f9; color: #94a3b8; }
      .inf-chip-campanhas { background: #f1f5f9; color: #334155; font-weight: 700; padding: 2px 8px; border-radius: 6px; }
      .inf-btn-detalhes { display: inline-flex; align-items: center; gap: 4px; background: #f1f5f9; color: #334155; font-size: 11px; font-weight: 700; padding: 6px 10px; border-radius: 8px; }
      .inf-btn-detalhes.primario { background: #1D4ED8; color: white; }
      .inf-vazio-linha { text-align: center; color: #94a3b8; padding: 32px 0 !important; }
      .inf-tabela-rodape { padding: 14px 20px; border-top: 1px solid #e2e8f0; background: #f8fafc; display: flex; flex-wrap: wrap; justify-content: space-between; gap: 10px; font-size: 12px; color: #64748b; }
      .inf-paginacao { display: flex; gap: 4px; }
      .inf-paginacao button { background: white; border: 1px solid #cbd5e1; color: #334155; font-weight: 600; padding: 4px 10px; font-size: 12px; }
      .inf-paginacao button.ativa { background: #1D4ED8; color: white; border-color: #1D4ED8; }
      .inf-paginacao button:disabled { opacity: .5; cursor: not-allowed; }
      .inf-drawer-vazio { display: grid; justify-items: center; gap: 8px; padding: 48px 12px; color: #94a3b8; text-align: center; }
      .inf-drawer-vazio .material-symbols-outlined { font-size: 40px; }
      .inf-drawer-topo { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 12px; border-bottom: 1px solid #f1f5f9; margin-bottom: 16px; }
      .inf-drawer-id { display: flex; gap: 12px; align-items: center; }
      .inf-drawer-nome { display: flex; align-items: center; gap: 6px; }
      .inf-drawer-nome h3 { margin: 0; font-size: 16px; }
      .inf-tags { margin-top: 6px; display: flex; gap: 6px; flex-wrap: wrap; }
      .inf-tag { padding: 2px 8px; border-radius: 6px; font-size: 10px; font-weight: 800; }
      .inf-tag.roxo { background: #f5f3ff; color: #6d28d9; }
      .inf-tag.azul { background: #eff6ff; color: #1D4ED8; }
      .inf-drawer-acoes { display: flex; gap: 4px; }
      .inf-icone { width: 30px; height: 30px; padding: 0; border-radius: 8px; background: #f1f5f9; color: #64748b; display: inline-flex; align-items: center; justify-content: center; }
      .inf-icone.escuro { background: transparent; color: #94a3b8; }
      .inf-bloco { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 14px 16px; margin-bottom: 16px; }
      .inf-bloco-topo { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
      .inf-bloco-titulo { font-size: 11px; font-weight: 800; color: #64748b; text-transform: uppercase; letter-spacing: .04em; display: flex; align-items: center; gap: 6px; }
      .inf-bloco-titulo .material-symbols-outlined.azul { color: #1D4ED8; }
      .inf-status { padding: 2px 8px; border-radius: 999px; font-size: 10px; font-weight: 800; }
      .inf-status.ativo { background: #d1fae5; color: #065f46; }
      .inf-status.pausado { background: #fef3c7; color: #92400e; }
      .inf-status.encerrado { background: #f1f5f9; color: #64748b; }
      .inf-valores { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
      .inf-valor { background: white; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px; text-align: center; }
      .inf-valor.destaque { background: #eff6ff; border-color: #bfdbfe; }
      .inf-valor .rotulo { font-size: 10px; color: #94a3b8; text-transform: uppercase; font-weight: 700; }
      .inf-valor.destaque .rotulo { color: #1D4ED8; }
      .inf-valor .num { font-size: 13px; font-weight: 800; color: #1e293b; margin-top: 2px; }
      .inf-valor.destaque .num { color: #1D4ED8; }
      .inf-cupom-linha { display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; padding-top: 10px; margin-top: 8px; border-top: 1px solid #e2e8f0; font-size: 11px; }
      .inf-cupom-status { display: flex; align-items: center; gap: 6px; }
      .inf-ponto { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
      .inf-ponto.on { background: #10b981; }
      .inf-ponto.off { background: #cbd5e1; }
      strong.sim { color: #047857; }
      strong.nao { color: #94a3b8; }
      .inf-cupom-codigo { background: white; border: 1px dashed #93c5fd; color: #1D4ED8; font-family: monospace; font-weight: 800; font-size: 11px; padding: 4px 10px; display: inline-flex; align-items: center; gap: 6px; border-radius: 8px; }
      .inf-chips { display: flex; flex-wrap: wrap; gap: 6px; }
      .inf-chip { background: #f1f5f9; color: #334155; border: 1px solid #e2e8f0; border-radius: 8px; padding: 4px 10px; font-size: 12px; font-weight: 600; display: inline-flex; align-items: center; gap: 6px; }
      .inf-cresc-topo { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px; }
      .inf-cresc-valor { font-size: 13px; font-weight: 800; color: #1e293b; }
      .inf-grafico { height: 96px; margin-top: 8px; }
      .inf-grafico-svg { width: 100%; height: 100%; overflow: visible; }
      .inf-grafico-dias { display: flex; justify-content: space-between; font-size: 10px; color: #94a3b8; font-weight: 600; margin-top: 4px; }
      .inf-grafico-dias .ultimo { font-weight: 800; color: #334155; }
      .inf-vazio-pequeno { color: #94a3b8; font-size: 12px; padding: 24px 0; text-align: center; }
      .inf-snap-form { display: flex; gap: 6px; margin-top: 10px; }
      .inf-snap-form input { flex: 1; padding: 6px 8px; font-size: 11px; }
      .inf-btn-mini { font-size: 11px; padding: 6px 10px; }
      .inf-midias-topo { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
      .inf-midias .inf-bloco-titulo .material-symbols-outlined.rosa { color: #db2777; }
      .inf-midia { background: white; border: 1px solid #e2e8f0; border-radius: 10px; padding: 10px 12px; margin-bottom: 8px; }
      .inf-midia-topo { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 4px; }
      .inf-midia-titulo { display: flex; align-items: center; gap: 6px; font-weight: 700; font-size: 12px; color: #1e293b; max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .inf-midia-acoes { display: flex; gap: 6px; align-items: center; }
      .inf-midia-acoes a, .inf-midia-acoes button { color: #64748b; display: inline-flex; }
      .inf-midia-acoes a .material-symbols-outlined, .inf-midia-acoes button .material-symbols-outlined { font-size: 15px; }
      .inf-midia-acoes button { background: transparent; padding: 0; }
      .inf-midia-url { font-family: monospace; font-size: 11px; color: #94a3b8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-bottom: 6px; }
      .inf-midia-metricas { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; background: #f8fafc; border-radius: 8px; padding: 8px; text-align: center; }
      .inf-midia-metricas .rotulo { font-size: 9px; color: #94a3b8; text-transform: uppercase; font-weight: 700; }
      .inf-midia-metricas .num { font-size: 12px; font-weight: 800; color: #1e293b; }
      .inf-midia-metricas .num.verde { color: #059669; }
      .inf-btn-cta { width: 100%; padding: 10px 14px; display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 12px; border-radius: 10px; }
      .inf-form-avatar { display: flex; align-items: center; gap: 14px; }
      .inf-form-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
      .inf-form-grid-3 { grid-template-columns: repeat(3, 1fr); }
      .inf-form-checks { grid-column: 1 / -1; display: flex; gap: 16px; }
      .inf-check { display: flex; flex-direction: row; align-items: center; gap: 6px; text-transform: none; font-weight: 500; color: #334155; }
      .inf-fixo { padding: 10px 12px; background: #f1f5f9; border-radius: 8px; font-weight: 700; color: #334155; font-size: 13px; }
      .inf-erro { color: #b91c1c; font-weight: 600; text-transform: none; }
      .inf-form-campanhas { border-top: 1px solid #e2e8f0; padding-top: 12px; }
      .inf-form-campanhas-topo { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
      .inf-camp-linha { display: grid; grid-template-columns: 2fr 1fr 1fr 1fr 1fr auto; gap: 8px; align-items: end; margin-bottom: 8px; }
      .inf-form-rodape { display: flex; justify-content: space-between; align-items: center; gap: 12px; border-top: 1px solid #e2e8f0; padding-top: 12px; flex-wrap: wrap; }
      .inf-form-exclusao { display: flex; align-items: center; gap: 8px; }
      .inf-form-botoes { display: flex; gap: 8px; margin-left: auto; }
      .inf-confirma { font-size: 12px; color: #b91c1c; font-weight: 600; }
      @media (max-width: 980px) {
        .inf-layout, .inf-form-grid, .inf-camp-linha { grid-template-columns: 1fr; }
        .inf-kpis { grid-template-columns: repeat(2, minmax(0,1fr)); }
      }
```

- [ ] **Step 4: Rodar o check de contratos (deve passar por completo agora)**

Run: `node scripts/check-contracts.mjs`
Expected: `Contract check passed: ...` (o texto final de sempre, sem nenhuma mensagem de "Influenciadores: ...").

- [ ] **Step 5: Rodar toda a suíte de testes**

Run: `npm run test:influenciadores`
Expected: `fail 0` em todos os arquivos de `tests/influenciadores/`.

- [ ] **Step 6: Verificação manual guiada (sem Supabase real ainda)**

Abrir `public/index.html` num navegador **direto do arquivo** (sem servidor) só para checar que não há erro de sintaxe grosseiro no console (o login vai falhar por causa da CSP/CORS — isso é esperado; o objetivo aqui é só sintaxe). A verificação de comportamento real acontece na Task 10, com o preview local.

Run: `node --check public/index.html 2>&1 || true` — na verdade `node --check` não entende HTML; em vez disso, extrair e checar o JS embutido:

```bash
node -e "
const fs = require('node:fs');
const html = fs.readFileSync('public/index.html', 'utf8');
const m = html.match(/<script type=\"module\">([\s\S]*)<\/script>/);
fs.writeFileSync('/tmp/inf-check.mjs', m[1]);
"
node --check /tmp/inf-check.mjs
```

Expected: nenhuma saída (sintaxe válida). Se houver erro de sintaxe, corrigir antes de prosseguir.

- [ ] **Step 7: Commit**

```bash
git add public/modules/influenciadores/index.js public/index.html
git commit -m "feat(influenciadores): orquestrador do modulo e integracao no app real

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 10: Preview local com dados falsos (harness não publicado)

**Files:**
- Create: `scripts/preview-influenciadores.mjs`

**Interfaces:**
- Produces: servidor HTTP em `http://127.0.0.1:5183/` servindo uma página que carrega o módulo com um `supabase` falso em memória (sem rede, sem login), permitindo ver a tela sem tocar no banco real e sem esperar a migration ser aplicada.

Este arquivo não é publicado: fica em `scripts/`, fora de `public/`, e não é referenciado por `vercel.json` nem `netlify.toml`.

- [ ] **Step 1: Criar o harness de preview**

`scripts/preview-influenciadores.mjs`:

```js
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

// Cliente Supabase falso minimo, com a mesma forma usada por public/modules/influenciadores/service.js.
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
          if (prop === 'single') return async () => ({ data: dados[0] ?? { id: `novo-${Date.now()}` }, error: null });
          if (prop === 'insert') return (valor) => { const linha = { id: `novo-${Date.now()}`, ...valor }; banco[tabela] = [...(banco[tabela] ?? []), linha]; dados = [linha]; return q; };
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
        import { initInfluenciadores, renderInfluenciadores } from '/modules/influenciadores/index.js';
        const perfis = { Admin: { cargo: 'Admin' }, Coordenador: { cargo: 'Coordenador', marca_vinculada: 'Tesoura de Ouro' } };
        const state = { marca: 'Todas', perfil: perfis[new URLSearchParams(location.search).get('cargo') ?? 'Admin'], contentEl: document.querySelector('#content') };
        function escapeHtml(v) { return String(v ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;'); }
        function safeErrorMessage(e, fallback) { console.error(e); return fallback; }
        await initInfluenciadores({ supabase: window.__supabaseFalso, state, escapeHtml, marcas: ['Todas','Tesoura de Ouro','Magazine da Economia','Free Center Calçados'], safeErrorMessage });
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

// window.__supabaseFalso precisa existir antes do modulo carregar - injeta via variavel global no
// processo Node nao funciona no browser, entao o cliente falso e definido inline na pagina servida
// acima; esta linha so documenta a intencao para quem ler o arquivo.
```

Nota de implementação: como `window.__supabaseFalso` precisa existir no navegador (não no processo Node), mover `criarClienteFalso` para dentro do `<script type="module">` da página HTML servida, definido *antes* do `import`. Ajustar o Step 1 assim: incluir o corpo de `criarClienteFalso` (adaptado para rodar no browser, sem `require`) como uma function declaration dentro do template string do HTML, chamada logo antes de `initInfluenciadores`, e passar `supabase: criarClienteFalso()` no lugar de `window.__supabaseFalso`. Isso evita depender de uma variável global implícita.

- [ ] **Step 2: Rodar e verificar visualmente**

Run: `node scripts/preview-influenciadores.mjs` (roda em foreground; abrir `http://127.0.0.1:5183/` no navegador enquanto o processo roda, depois `Ctrl+C` para parar).

Expected: a tela mostra os 4 KPIs, a tabela com Isabela Lima (e Lucas Martins se marca = Todas), o drawer abre ao clicar na linha, mostra Investimento & Acordos (R$ 10.000 / R$ 5.000 / R$ 15.000), Campanhas Realizadas, o gráfico de crescimento com 2 pontos e a mídia vinculada com as métricas do exemplo. Testar também `?cargo=Coordenador`: só marca Tesoura de Ouro aparece no filtro, sem opção "Todas".

- [ ] **Step 3: Commit**

```bash
git add scripts/preview-influenciadores.mjs
git commit -m "chore(influenciadores): harness de preview local com dados de exemplo

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 11: Aplicar a migration no Supabase (requer aprovação explícita do usuário)

**Files:** nenhum arquivo novo — esta task só executa SQL contra o banco vinculado.

**Interfaces:** nenhuma nova; consome a migration da Task 1.

- [ ] **Step 1: Parar e pedir autorização**

Antes de qualquer coisa nesta task, perguntar ao usuário, literalmente: "Posso aplicar a migration `20260921_039_influenciadores.sql` no banco Supabase do projeto (compartilhado com produção)? Ela só cria tabelas novas, não altera nada existente." **Não prosseguir sem um "sim" explícito.**

- [ ] **Step 2: Aplicar a migration**

Com autorização, rodar (do diretório raiz do projeto, não do worktree, já que o `.temp/` do link Supabase vive na pasta principal — copiar a migration para lá antes se necessário, ou apontar `--file` para o caminho do worktree):

```bash
node_modules/.bin/supabase.cmd db execute --file "supabase/migrations/20260921_039_influenciadores.sql" --linked
```

Se este subcomando não existir nesta versão da CLI (2.114.0), usar o SQL Editor do painel do Supabase como alternativa: colar o conteúdo do arquivo e rodar manualmente. Confirmar qual caminho existe antes de tentar, com `node_modules/.bin/supabase.cmd db --help`.

Expected: sem erros; ao final, a mensagem do `notify pgrst, 'reload schema'` confirma que a migration rodou até o fim.

- [ ] **Step 3: Rodar a verificação SQL**

Colar `supabase/checks/20260921_check_influenciadores.sql` no SQL Editor do Supabase (não dá para automatizar por CLI, pois a Seção B depende de simular sessões de usuários reais). Rodar a Seção A e a Seção B **separadamente** (cada uma é um `select`/`do $$` independente).

Expected: Seção A com todas as linhas `ok`. Seção B: ler o texto do erro `RELATORIO (...)` e confirmar que todas as linhas começam com `ok` (ou `PULADO` se não houver Coordenador/Analista de teste cadastrado).

- [ ] **Step 4: Reportar ao usuário**

Resumir o resultado das duas seções e perguntar se pode seguir para a Task 12 (push da branch).

---

### Task 12: Push da branch e preview na Vercel (requer aprovação explícita do usuário)

**Files:** nenhum arquivo novo.

**Interfaces:** nenhuma nova.

- [ ] **Step 1: Parar e pedir autorização**

Perguntar: "A migration está aplicada e verificada. Posso enviar a branch `feat/modulo-influenciadores` para o GitHub? Isso deve gerar uma URL de preview na Vercel, sem afetar `gtoinsights.vercel.app` (que só muda com merge na `main`)." **Não prosseguir sem um "sim" explícito.**

- [ ] **Step 2: Push**

```bash
git push -u origin feat/modulo-influenciadores
```

Expected: push aceito sem `force`.

- [ ] **Step 3: Localizar o preview**

Run: `gh pr create --title "Módulo Influenciadores" --body "Ver docs/superpowers/specs/2026-09-21-modulo-influenciadores-design.md" --base main 2>&1 || echo "gh indisponível ou sem auth — abrir o PR manualmente no GitHub"`

Se `gh` não estiver disponível ou autenticado, informar ao usuário que ele precisa abrir o Pull Request manualmente em `https://github.com/JoseDiegoNerd/GTOinsigths/compare/main...feat/modulo-influenciadores` para a Vercel comentar a URL de preview (o comportamento exato depende de como a integração Vercel↔GitHub está configurada nesse repositório, o que não foi possível confirmar sem acesso ao painel).

- [ ] **Step 4: Reportar ao usuário**

Passar a URL do PR e/ou do preview assim que disponível, e perguntar se o usuário quer validar antes de decidir sobre o merge na `main` (fora do escopo deste plano — decisão separada).

---

## Autorrevisão do plano

**1. Cobertura do spec:** todas as seções do spec (§4 dados, §5 contrato TS, §6 front-end, §7 cálculos, §8 segurança, §9 testes, §10 entrega) têm task correspondente — Tasks 1, 2, 3–8, 9, 3 (cálculos), 8 (segurança nos formulários/service), 3–8 (testes) e 11–12 (entrega). §11 (riscos) está refletido nas notas de cada task (ex.: crescimento semanal em "—", numeração de migration).

**2. Placeholders:** nenhum "TBD"/"implementar depois" encontrado; todo step de código tem o conteúdo completo do arquivo ou o trecho exato a inserir com a localização (linha aproximada já confirmada na exploração do `index.html`).

**3. Consistência de tipos e nomes:** conferido manualmentes os pontos de fricção mais prováveis:
- `service.js` usa `TABELAS.campanhas = "influenciador_campanhas"` etc., e `index.js`/testes usam as mesmas chaves de retorno (`influenciadores, campanhas, midias, snapshots, avatares`).
- `calculos.js` exporta exatamente os nomes que `index.js`, `kpi-cards.js`, `influencers-table.js` e `influencer-drawer.js` importam (`agruparPorInfluenciador`, `agregarInfluenciador`, `calcularKpis`, `pontosCrescimento`, `filtrarInfluenciadores`, `paginar`, `hojeISO`).
- `validacao.js` exporta `REDES`, `STATUS`, `FORMATOS`, `MARCAS_VALIDAS` e as 5 funções `validarX`, usadas por `influencer-form-modal.js` e `midia-form-modal.js` com os mesmos nomes.
- `influencer-form-modal.js` e `midia-form-modal.js` expõem `estadoInicialX`, `xFormHtml`, `lerXForm`, `validarFormularioX` — nomenclatura espelhada entre os dois, e é exatamente o que `index.js` chama.
- Task 9 corrige a suposição inicial da Task 3 (o app usa `state.page`/`render()`, não roteamento por hash) confirmada na exploração de `public/index.html` linhas 1494-1578.

**4. Ajuste feito durante a autorrevisão:** a Task 9 originalmente previa reaproveitar `state.contentEl` sem defini-lo; adicionado `state.contentEl = content;` dentro de `renderInfluenciadoresPagina()` no `index.html`, e o `preview-influenciadores.mjs` (Task 10) replica esse mesmo contrato (`state.contentEl`) para poder rodar o módulo fora do app real.

