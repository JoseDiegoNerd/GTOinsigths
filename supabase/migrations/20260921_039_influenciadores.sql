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
  and exists (
    select 1 from public.influenciadores i
    where i.id::text = (storage.foldername(name))[1]
      and ((select public.gto_eh_admin_ou_gestor()) or public.gto_tem_acesso_marca(i.marca))
  )
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
