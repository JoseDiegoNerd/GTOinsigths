-- GTO Insights - Restringe atribuicao de cargo/marca a Admin (nao mais Admin OU Gestor)
-- Scope: ate aqui, tanto o trigger trg_perfis_bloquear_campos_sensiveis (mudanca de coluna
-- "cargo" em perfis) quanto as policies de insert/delete em perfis_marcas liberavam Admin E
-- Gestor. Isso significava que: (1) um Gestor podia, pelo proprio modal "Perfil do usuario",
-- se auto-promover a Admin (auto-edicao de cargo liberada para "privilegiado" = Admin/Gestor);
-- e (2) um Gestor podia, via chamada direta a API REST do Supabase (fora da tela de Gestao de
-- Usuarios, que ja e Admin-only no front), atribuir/revogar marcas e cargo de qualquer usuario.
-- A partir desta migration, atribuicao de cargo e marcas passa a ser decisao exclusiva de Admin.
-- Email/status da conta (ativo) continuam liberados para Admin OU Gestor - nao fazem parte
-- deste pedido e Gestor segue precisando bloquear/desbloquear contas no dia a dia.
--
-- gto_eh_admin_ou_gestor() NAO e redefinida aqui: ela e a funcao-base usada por praticamente
-- toda policy de dados do projeto (BI views, data-stage tables, integracoes) para dar a
-- Admin/Gestor visao completa entre marcas - mudar a definicao dela derrubaria o acesso de
-- Gestor a dados legitimos, o que nao foi pedido. Em vez disso, uma funcao nova e mais estrita
-- (gto_eh_admin) e usada so nos pontos especificos de atribuicao de cargo/marca.

begin;

-- 1. Funcao auxiliar: Admin, e so Admin -----------------------------------------------------

create or replace function public.gto_eh_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.gto_meu_cargo() = 'Admin', false);
$$;

comment on function public.gto_eh_admin() is
  'true somente para cargo = Admin (diferente de gto_eh_admin_ou_gestor). Usada nos pontos de atribuicao de cargo/marca, que passam a ser decisao exclusiva de Admin.';

-- 2. Trigger de auto-edicao de perfis: cargo agora exige Admin -----------------------------
-- (email/ativo/marca_vinculada legada continuam Admin-ou-Gestor, igual antes; origem_convite
-- continua imutavel apos o primeiro valor, para qualquer ator - regra da migration
-- 20260817104800, preservada abaixo.)

create or replace function public.gto_perfis_bloquear_campos_sensiveis()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.gto_eh_admin() then
    new.cargo := old.cargo;
  end if;

  if not public.gto_eh_admin_ou_gestor() then
    new.email := old.email;
    new.ativo := old.ativo;
    new.marca_vinculada := old.marca_vinculada;
  end if;

  if old.origem_convite is not null then
    new.origem_convite := old.origem_convite;
  end if;

  return new;
end;
$$;

-- 3. perfis_marcas: insert/delete agora exigem Admin -----------------------------------------
-- Renomeadas (antes "..._admin_gestor") para refletir a nova regra e evitar qualquer leitura
-- equivocada do nome da policy no futuro.

drop policy if exists "perfis_marcas_insert_admin_gestor" on public.perfis_marcas;
drop policy if exists "perfis_marcas_insert_admin" on public.perfis_marcas;
create policy "perfis_marcas_insert_admin"
on public.perfis_marcas
for insert
to authenticated
with check (
  (select public.gto_eh_admin())
);

drop policy if exists "perfis_marcas_delete_admin_gestor" on public.perfis_marcas;
drop policy if exists "perfis_marcas_delete_admin" on public.perfis_marcas;
create policy "perfis_marcas_delete_admin"
on public.perfis_marcas
for delete
to authenticated
using (
  (select public.gto_eh_admin())
);

commit;
