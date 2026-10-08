-- GTO Insights - Hub de Reputacao e Sentimento
-- Scope: tabela unificada de comentarios/avaliacoes (Meta, Google, Reclame Aqui) com a classificacao
-- feita por IA (sentimento, reclamacao de preco e categoria), mais o backfill das avaliacoes do Google
-- que ja estao em integracao_google_avaliacoes.
-- Safe to run multiple times.

begin;

create table if not exists public.comments_reputation (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('meta_instagram', 'meta_facebook', 'google_business', 'reclame_aqui')),
  external_id text not null,
  marca public.bandeira_marca not null,
  local_id uuid references public.integracao_google_locais(id) on delete cascade,
  store_id text,
  branch_name text,
  author_name text,
  content text,
  rating smallint check (rating is null or rating between 1 and 5),
  created_at timestamptz not null,
  sentiment text check (sentiment is null or sentiment in ('positivo', 'neutro', 'negativo')),
  is_price_complaint boolean,
  category_tag text check (category_tag is null or category_tag in ('preco', 'atendimento', 'qualidade_produto', 'trocas', 'outro')),
  content_hash text,
  ai_model text,
  classified_at timestamptz,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint comments_reputation_marca_source_ext_uniq unique (marca, source, external_id)
);

comment on table public.comments_reputation is
  'Comentarios e avaliacoes de todas as redes em um formato unico, com a classificacao de IA. Gravada apenas pelo service_role (Edge Functions).';

create index if not exists comments_reputation_marca_data_idx
  on public.comments_reputation (marca, created_at desc);

create index if not exists comments_reputation_sentimento_idx
  on public.comments_reputation (marca, sentiment);

create index if not exists comments_reputation_preco_idx
  on public.comments_reputation (marca, created_at desc)
  where is_price_complaint = true;

create index if not exists comments_reputation_hash_idx
  on public.comments_reputation (content_hash)
  where classified_at is not null;

alter table public.comments_reputation enable row level security;
alter table public.comments_reputation force row level security;

drop policy if exists comments_reputation_select_por_marca on public.comments_reputation;
create policy comments_reputation_select_por_marca on public.comments_reputation
  for select to authenticated
  using ((select public.gto_eh_admin_ou_gestor()) or public.gto_tem_acesso_marca(marca));

revoke all on public.comments_reputation from anon;
revoke insert, update, delete on public.comments_reputation from authenticated;

-- Backfill: avaliacoes do Google ja sincronizadas viram linhas da tabela unificada.
insert into public.comments_reputation (
  source, external_id, marca, local_id, store_id, branch_name, author_name,
  content, rating, created_at
)
select
  'google_business',
  av.review_id,
  av.marca,
  av.local_id,
  loc.location_id,
  loc.nome_loja,
  av.autor_nome,
  av.comentario,
  av.rating,
  coalesce(av.avaliado_em, av.criado_em, now())
from public.integracao_google_avaliacoes av
left join public.integracao_google_locais loc on loc.id = av.local_id
on conflict (marca, source, external_id) do nothing;

commit;
