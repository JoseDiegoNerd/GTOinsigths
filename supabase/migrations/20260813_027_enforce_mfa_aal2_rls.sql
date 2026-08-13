-- GTO Insights - Exige AAL2 nas policies RLS para usuarios com MFA (TOTP) ativado
-- Scope: a UI de ativacao/desafio de MFA (supabase.auth.mfa.*) adicionada em public/index.html
-- so gateia a TELA (init() decide se mostra o dashboard ou a tela de codigo). Isso e so uma
-- camada de UX: um access token aal1 valido (ex.: sessao antiga em outro dispositivo, token
-- roubado antes do usuario terminar de configurar o desafio) continua passando por qualquer
-- policy RLS ou RPC normalmente, porque nenhuma policy checava o "aal" do JWT. MFA sem
-- enforcement no banco e decorativo - este script fecha esse gap na fonte de verdade real
-- (RLS), sem exigir MFA de quem nunca ativou (opt-in continua opcional).
--
-- Estrategia: um unico helper (gto_aal2_ok) reaproveitado nos dois pontos onde toda policy do
-- projeto converge - gto_meu_cargo() e gto_minha_marca() (ambas leem public.perfis direto por
-- auth.uid()) - mais um reforco explicito em gto_tem_acesso_marca() para cobrir o branch que
-- consulta perfis_marcas diretamente sem passar por nenhuma das duas. gto_eh_admin_ou_gestor()
-- nao precisa de mudanca: ja depende de gto_meu_cargo().
--
-- gto_tem_acesso_marca_para(p_user_id, p_marca) (migration 026) fica de fora de proposito: e
-- chamada por Edge Functions via client de service_role, que nao carrega JWT de usuario nenhum
-- (auth.jwt() resolve null nesse contexto) - o conceito de AAL da sessao do usuario final nao
-- se aplica a essa chamada.
--
-- perfis_select_autenticado (auth.uid() = id) continua sem gate: um usuario sempre pode ler o
-- proprio perfil (necessario para a tela de desafio MFA descobrir o cargo/estado antes mesmo
-- de completar o desafio), e esse self-read nunca expoe dado de outra conta.
--
-- Safe to run multiple times (create or replace idempotente).

begin;

create or replace function public.gto_aal2_ok()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.uid() is null then false
    when (auth.jwt() ->> 'aal') = 'aal2' then true
    -- aal1: so libera se o usuario nunca ativou nenhum fator TOTP verificado (MFA opcional) -
    -- quem tem fator verificado e esta em aal1 significa que logou com senha mas ainda nao
    -- completou o desafio de 2FA nesta sessao, e deve ser negado ate completar.
    else not exists (
      select 1
      from auth.mfa_factors
      where user_id = auth.uid()
        and status = 'verified'
    )
  end;
$$;

comment on function public.gto_aal2_ok() is
  'Retorna true se a sessao atual satisfaz aal2, ou se o usuario nunca ativou MFA (aal2 nao se aplica). '
  'Usada como gate dentro de gto_meu_cargo/gto_minha_marca/gto_tem_acesso_marca para tornar a '
  'ativacao de MFA (2FA) do usuario um controle real de RLS, nao so uma tela client-side.';

create or replace function public.gto_meu_cargo()
returns public.cargo_usuario
language sql
stable
security definer
set search_path = public
as $$
  select p.cargo
  from public.perfis p
  where p.id = auth.uid()
    and p.ativo = true
    and public.gto_aal2_ok()
  limit 1;
$$;

create or replace function public.gto_minha_marca()
returns public.bandeira_marca
language sql
stable
security definer
set search_path = public
as $$
  select p.marca_vinculada
  from public.perfis p
  where p.id = auth.uid()
    and p.ativo = true
    and public.gto_aal2_ok()
  limit 1;
$$;

create or replace function public.gto_tem_acesso_marca(marca_alvo public.bandeira_marca)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.uid() is null then false
    when not public.gto_aal2_ok() then false
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

commit;
