-- GTO Insights - RPC de acesso por marca parametrizada por usuario
-- Scope: cria public.gto_tem_acesso_marca_para(p_user_id, p_marca), uma variante de
-- public.gto_tem_acesso_marca(marca) que recebe o usuario como parametro explicito em vez de
-- ler auth.uid().
--
-- Por que precisa de uma funcao nova em vez de so chamar a que ja existe via .rpc():
-- gto_tem_acesso_marca(marca) decide o acesso lendo auth.uid() - isso funciona dentro de uma
-- policy RLS ou de uma chamada autenticada via PostgREST, onde o Postgres sabe qual usuario
-- fez a requisicao (via o JWT validado). As Edge Functions do Google (google-gbp-location-
-- update, google-gbp-review-reply) chamam supabase/functions/_shared/google.ts:
-- assertAcessoMarca(userId, marca) usando o client de service_role (getAdminClient()) - esse
-- client nao carrega o JWT de ninguem, entao auth.uid() dentro de uma RPC chamada por ele
-- sempre resolve pra null. Chamar gto_tem_acesso_marca(marca) dali sempre devolveria false,
-- negando acesso a todo mundo (fail-closed, mas quebrado). Por isso assertAcessoMarca hoje
-- reimplementa a query em TypeScript direto contra perfis/perfis_marcas - funciona, mas duplica
-- a logica da fonte de verdade em SQL, com risco de as duas divergirem de novo no futuro (foi
-- exatamente isso que aconteceu com a coluna legada marca_vinculada, corrigido na sessao
-- anterior). Esta funcao fecha esse gap: mesma logica de gto_tem_acesso_marca, mas com o
-- usuario alvo como argumento, chamavel via supabase.rpc(...) a partir do client de
-- service_role.
--
-- Seguranca: EXECUTE e revogado de public/authenticated e concedido so a service_role. Um
-- usuario autenticado comum nao tem motivo legitimo pra perguntar "o usuario X tem acesso a
-- marca Y" sobre QUALQUER uuid - so o backend (Edge Functions, sempre com service_role) precisa
-- disso. UUIDs sao inadivinhaveis, entao o vazamento pratico de expor isso pra authenticated
-- seria baixo mesmo assim, mas nao ha motivo pra conceder mais privilegio do que o necessario.
--
-- Safe to run multiple times (create or replace + grants idempotentes).

begin;

create or replace function public.gto_tem_acesso_marca_para(p_user_id uuid, p_marca public.bandeira_marca)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_user_id is null then false
    when exists (
      select 1
      from public.perfis p
      where p.id = p_user_id
        and p.ativo = true
        and p.cargo in ('Admin', 'Gestor')
    ) then true
    when p_marca is null then false
    else exists (
      select 1
      from public.perfis_marcas pm
      join public.perfis p on p.id = pm.perfil_id
      where pm.perfil_id = p_user_id
        and pm.marca = p_marca
        and p.ativo = true
    )
  end;
$$;

comment on function public.gto_tem_acesso_marca_para(uuid, public.bandeira_marca) is
  'Variante de gto_tem_acesso_marca(marca) parametrizada por usuario, para uso via supabase.rpc() '
  'a partir de clients de service_role (Edge Functions) - auth.uid() nao resolve nesse contexto. '
  'Mesma logica/fonte de verdade (perfis + perfis_marcas), so muda de onde vem o usuario alvo.';

revoke all on function public.gto_tem_acesso_marca_para(uuid, public.bandeira_marca) from public;
revoke all on function public.gto_tem_acesso_marca_para(uuid, public.bandeira_marca) from authenticated;
grant execute on function public.gto_tem_acesso_marca_para(uuid, public.bandeira_marca) to service_role;

commit;
