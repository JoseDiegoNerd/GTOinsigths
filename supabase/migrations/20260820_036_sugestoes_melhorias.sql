-- Modulo "Sugestoes & Melhorias": mural onde qualquer usuario autenticado registra uma sugestao,
-- vota nas sugestoes dos colegas e o Admin gerencia o status/resposta. user_name/user_email ficam
-- denormalizados na propria linha (preenchidos pelo client a partir de state.perfil no insert) em
-- vez de um embed pra perfis/auth.users - evita repetir o problema ja visto em campanhas_email
-- (perfis:criado_por falhava porque criado_por tem FK pra auth.users, nao pra perfis, e o
-- PostgREST so resolve embeds com FK direta entre as duas tabelas do schema cache).
begin;

create table if not exists public.sugestoes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  user_name text,
  user_email text,
  modulo text,
  titulo text not null,
  descricao text,
  nivel_impacto text check (nivel_impacto in ('Baixo', 'Médio', 'Alto')),
  anexo_url text,
  status text not null default 'Aguardando Análise'
    check (status in ('Aguardando Análise', 'Em Análise', 'No Roadmap', 'Em Desenvolvimento', 'Concluído', 'Arquivado')),
  votos_count integer not null default 0,
  resposta_admin text,
  created_at timestamptz not null default now()
);

create index if not exists idx_sugestoes_status on public.sugestoes(status);
create index if not exists idx_sugestoes_created_at on public.sugestoes(created_at desc);

-- Tabela de votos separada (1 linha por usuario/sugestao) em vez de so incrementar votos_count
-- direto: sem isso, nada impede um usuario de clicar "+1" varias vezes na mesma sugestao. A PK
-- composta (sugestao_id, user_id) garante 1 voto por pessoa; o trigger abaixo mantem
-- sugestoes.votos_count sincronizado automaticamente (mesmo padrao de coluna denormalizada
-- mantida por trigger ja usado em campanha_disparos.marca).
create table if not exists public.sugestoes_votos (
  sugestao_id uuid not null references public.sugestoes(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (sugestao_id, user_id)
);

create or replace function public.gto_sync_sugestao_votos_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update public.sugestoes set votos_count = votos_count + 1 where id = new.sugestao_id;
    return new;
  elsif tg_op = 'DELETE' then
    update public.sugestoes set votos_count = greatest(0, votos_count - 1) where id = old.sugestao_id;
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_sugestoes_votos_sync on public.sugestoes_votos;
create trigger trg_sugestoes_votos_sync
after insert or delete on public.sugestoes_votos
for each row execute function public.gto_sync_sugestao_votos_count();

-- RLS ------------------------------------------------------------------------------------------
-- Mural e visivel para toda a equipe autenticada (nao e filtrado por marca, ao contrario da
-- maioria das outras tabelas do app); qualquer autenticado registra a propria sugestao; so o
-- Admin estrito (gto_eh_admin(), nao gto_eh_admin_ou_gestor()) atualiza status/resposta_admin -
-- mesma funcao usada em 20260819_034 pra restringir acoes administrativas sensiveis a Admin de
-- verdade, nao Gestor.
alter table public.sugestoes enable row level security;
alter table public.sugestoes force row level security;

drop policy if exists "sugestoes_select_todos" on public.sugestoes;
create policy "sugestoes_select_todos" on public.sugestoes
for select to authenticated using (true);

drop policy if exists "sugestoes_insert_proprio" on public.sugestoes;
create policy "sugestoes_insert_proprio" on public.sugestoes
for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "sugestoes_update_admin" on public.sugestoes;
create policy "sugestoes_update_admin" on public.sugestoes
for update to authenticated using (public.gto_eh_admin()) with check (public.gto_eh_admin());

alter table public.sugestoes_votos enable row level security;
alter table public.sugestoes_votos force row level security;

drop policy if exists "sugestoes_votos_select_todos" on public.sugestoes_votos;
create policy "sugestoes_votos_select_todos" on public.sugestoes_votos
for select to authenticated using (true);

drop policy if exists "sugestoes_votos_insert_proprio" on public.sugestoes_votos;
create policy "sugestoes_votos_insert_proprio" on public.sugestoes_votos
for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "sugestoes_votos_delete_proprio" on public.sugestoes_votos;
create policy "sugestoes_votos_delete_proprio" on public.sugestoes_votos
for delete to authenticated using (user_id = auth.uid());

revoke all on public.sugestoes from anon;
revoke all on public.sugestoes_votos from anon;
grant select, insert, update on public.sugestoes to authenticated;
grant select, insert, delete on public.sugestoes_votos to authenticated;

-- Storage: bucket de anexos (prints/referencias) --------------------------------------------------
-- Mesmo padrao do bucket "avatars" (migration 20260807_021): bucket publico (getPublicUrl sem URL
-- assinada, ja que o Mural exibe o anexo pra qualquer usuario autenticado da equipe), insert restrito
-- a pasta do proprio usuario (storage.foldername(name)[1] = auth.uid()).
insert into storage.buckets (id, name, public)
values ('sugestoes-anexos', 'sugestoes-anexos', true)
on conflict (id) do nothing;

drop policy if exists "sugestoes_anexos_select_public" on storage.objects;
create policy "sugestoes_anexos_select_public"
on storage.objects
for select
using (bucket_id = 'sugestoes-anexos');

drop policy if exists "sugestoes_anexos_insert_own" on storage.objects;
create policy "sugestoes_anexos_insert_own"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'sugestoes-anexos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "sugestoes_anexos_delete_own" on storage.objects;
create policy "sugestoes_anexos_delete_own"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'sugestoes-anexos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

notify pgrst, 'reload schema';

commit;
