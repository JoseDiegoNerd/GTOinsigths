-- GTO Insights - Perfil do Usuario: edicao completa (avatar, marcas multiplas, notificacoes)
-- Scope: da suporte ao modal "Perfil do Usuario" adicionado no front:
--   1. Colunas novas em perfis: avatar, cargo_oficial (cargo de negocio em texto livre, ex.
--      "Analista de Trafego" - distinto da coluna "cargo" existente, que e o Nivel de Acesso
--      usado pelo RLS: Admin/Gestor/Coordenador/Analista) e preferencias de notificacao.
--   2. Tabela perfis_marcas para substituir marca_vinculada (coluna unica) por um
--      relacionamento N:N, permitindo Coordenador/Analista com mais de uma marca.
--      gto_tem_acesso_marca() e redefinida para consultar essa tabela; como todas as
--      policies de dados (20260702_002 em diante) chamam essa funcao em vez de ler a
--      coluna marca_vinculada diretamente, nenhuma outra migration precisa mudar.
--   3. Trigger de validacao: Coordenador/Analista ativo precisa de >=1 marca atribuida,
--      substituindo o antigo check constraint (perfis_marca_obrigatoria_para_operacao_chk)
--      que so enxergava uma marca por vez.
--   4. Policy de UPDATE em perfis passa a permitir o proprio usuario editar seu registro
--      (antes so Admin/Gestor podia); um trigger BEFORE UPDATE reverte silenciosamente
--      qualquer tentativa de alterar email/cargo/ativo por quem nao for Admin/Gestor, para
--      que a edicao do proprio perfil nao vire escalonamento de privilegio.
--   5. Bucket de Storage "avatars" (publico para leitura) com policies restringindo
--      upload/update/delete a arquivos dentro da pasta `${auth.uid()}/...` do proprio usuario.

begin;

-- 1. Colunas novas -----------------------------------------------------------

alter table public.perfis
  add column if not exists avatar_url text,
  add column if not exists cargo_oficial text,
  add column if not exists notif_resumo_semanal boolean not null default true,
  add column if not exists notif_alerta_performance boolean not null default true;

comment on column public.perfis.avatar_url is 'URL publica no bucket de Storage "avatars".';
comment on column public.perfis.cargo_oficial is 'Cargo de negocio em texto livre (ex.: "Analista de Trafego"), so exibicao - nao tem papel no RLS. Ver coluna "cargo" para o nivel de acesso.';
comment on column public.perfis.notif_resumo_semanal is 'Recebe resumo semanal de performance por e-mail.';
comment on column public.perfis.notif_alerta_performance is 'Recebe alerta por e-mail quando uma metrica cai fora do esperado.';

-- 2. Marcas multiplas ---------------------------------------------------------

create table if not exists public.perfis_marcas (
  perfil_id uuid not null references public.perfis(id) on delete cascade,
  marca public.bandeira_marca not null,
  criado_em timestamptz not null default now(),
  primary key (perfil_id, marca)
);

comment on table public.perfis_marcas is
  'Marcas atribuidas a um perfil operacional (Coordenador/Analista). Admin/Gestor enxerga todas as marcas independente do conteudo desta tabela.';

create index if not exists perfis_marcas_perfil_id_idx
  on public.perfis_marcas (perfil_id);

-- Backfill a partir da coluna antiga (marca_vinculada continua existindo, mas deixa de
-- ser a fonte de verdade para controle de acesso a partir desta migration).
insert into public.perfis_marcas (perfil_id, marca)
select id, marca_vinculada
from public.perfis
where marca_vinculada is not null
on conflict do nothing;

alter table public.perfis_marcas enable row level security;
alter table public.perfis_marcas force row level security;

drop policy if exists "perfis_marcas_select" on public.perfis_marcas;
create policy "perfis_marcas_select"
on public.perfis_marcas
for select
to authenticated
using (
  auth.uid() = perfil_id
  or public.gto_eh_admin_ou_gestor()
);

-- Atribuir/remover marca de um perfil e uma decisao de acesso, nao de auto-edicao:
-- fica restrita a Admin/Gestor mesmo depois da policy de UPDATE de perfis liberar
-- o proprio usuario a editar seu registro.
drop policy if exists "perfis_marcas_insert_admin_gestor" on public.perfis_marcas;
create policy "perfis_marcas_insert_admin_gestor"
on public.perfis_marcas
for insert
to authenticated
with check (
  public.gto_eh_admin_ou_gestor()
);

drop policy if exists "perfis_marcas_delete_admin_gestor" on public.perfis_marcas;
create policy "perfis_marcas_delete_admin_gestor"
on public.perfis_marcas
for delete
to authenticated
using (
  public.gto_eh_admin_ou_gestor()
);

revoke all on public.perfis_marcas from anon;
grant select, insert, delete on public.perfis_marcas to authenticated;

-- Redefine a funcao central de acesso por marca para consultar perfis_marcas em vez da
-- coluna unica marca_vinculada. Assinatura e comportamento externo inalterados, entao
-- todas as policies existentes (data-stage, BI views, Meta/Google integrations) que
-- chamam gto_tem_acesso_marca(marca) continuam funcionando sem qualquer alteracao.
create or replace function public.gto_tem_acesso_marca(marca_alvo public.bandeira_marca)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.uid() is null then false
    when public.gto_eh_admin_ou_gestor() then true
    when marca_alvo is null then false
    else exists (
      select 1
      from public.perfis_marcas pm
      join public.perfis p on p.id = pm.perfil_id
      where pm.perfil_id = auth.uid()
        and pm.marca = marca_alvo
        and p.ativo = true
    )
  end;
$$;

-- 3. Validacao: Coordenador/Analista ativo precisa de ao menos uma marca ------

alter table public.perfis
  drop constraint if exists perfis_marca_obrigatoria_para_operacao_chk;

create or replace function public.gto_validar_marcas_perfil(p_perfil_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cargo public.cargo_usuario;
  v_ativo boolean;
  v_qtd int;
begin
  select cargo, ativo into v_cargo, v_ativo
  from public.perfis
  where id = p_perfil_id;

  if v_cargo is null then
    return;
  end if;

  if v_cargo in ('Coordenador', 'Analista') and v_ativo = true then
    select count(*) into v_qtd
    from public.perfis_marcas
    where perfil_id = p_perfil_id;

    if v_qtd = 0 then
      raise exception 'Perfil ativo de Coordenador/Analista precisa de ao menos uma marca atribuida.';
    end if;
  end if;
end;
$$;

create or replace function public.gto_validar_marcas_perfil_trigger()
returns trigger
language plpgsql
as $$
begin
  perform public.gto_validar_marcas_perfil(coalesce(new.id, old.id));
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_perfis_validar_marcas on public.perfis;
create trigger trg_perfis_validar_marcas
after insert or update of cargo, ativo on public.perfis
for each row
execute function public.gto_validar_marcas_perfil_trigger();

create or replace function public.gto_validar_marcas_perfil_delete_trigger()
returns trigger
language plpgsql
as $$
begin
  perform public.gto_validar_marcas_perfil(old.perfil_id);
  return old;
end;
$$;

drop trigger if exists trg_perfis_marcas_validar_delete on public.perfis_marcas;
create trigger trg_perfis_marcas_validar_delete
after delete on public.perfis_marcas
for each row
execute function public.gto_validar_marcas_perfil_delete_trigger();

-- 4. Auto-edicao do proprio perfil ---------------------------------------------

-- Reverte silenciosamente qualquer tentativa de mudar email/cargo/ativo por quem nao
-- for Admin/Gestor, para que liberar UPDATE para o proprio usuario nao vire uma forma
-- de auto-promocao ("Analista" virando "Admin" via PATCH direto na tabela).
create or replace function public.gto_perfis_bloquear_campos_sensiveis()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.gto_eh_admin_ou_gestor() then
    new.email := old.email;
    new.cargo := old.cargo;
    new.ativo := old.ativo;
    new.marca_vinculada := old.marca_vinculada;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_perfis_bloquear_campos_sensiveis on public.perfis;
create trigger trg_perfis_bloquear_campos_sensiveis
before update on public.perfis
for each row
execute function public.gto_perfis_bloquear_campos_sensiveis();

drop policy if exists "perfis_update_admin_gestor" on public.perfis;
drop policy if exists "perfis_update_proprio_ou_admin_gestor" on public.perfis;
create policy "perfis_update_proprio_ou_admin_gestor"
on public.perfis
for update
to authenticated
using (
  auth.uid() = id
  or public.gto_eh_admin_ou_gestor()
)
with check (
  auth.uid() = id
  or public.gto_eh_admin_ou_gestor()
);

-- 5. Storage: bucket de avatares -----------------------------------------------

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

drop policy if exists "avatars_select_public" on storage.objects;
create policy "avatars_select_public"
on storage.objects
for select
using (bucket_id = 'avatars');

drop policy if exists "avatars_insert_own" on storage.objects;
create policy "avatars_insert_own"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "avatars_update_own" on storage.objects;
create policy "avatars_update_own"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "avatars_delete_own" on storage.objects;
create policy "avatars_delete_own"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

commit;
