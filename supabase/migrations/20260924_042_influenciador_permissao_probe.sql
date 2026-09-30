-- GTO Insights - Funcao de checagem de permissao para influenciadores, sem gravar nada.
-- Scope: corrige achado da revisao do sync automatico de Instagram - a Edge Function
-- influenciador-instagram-sync checava permissao de escrita fazendo um UPDATE real (mesmo que
-- para um valor ja nulo) antes de qualquer efeito colateral privilegiado (chamada a Meta API,
-- upload de foto). Isso funcionava (RLS bloqueava o update quando sem permissao), mas gravava uma
-- linha de auditoria (trg_influenciadores_auditoria) a cada sincronizacao, mesmo quando nada
-- muda de fato.
--
-- Esta funcao espelha exatamente o cond_editor das policies de insert/update/delete definidas em
-- 20260922_040_influenciadores_acesso_amplo.sql (Admin/Gestor em qualquer marca; Coordenador/
-- Analista so na propria marca vinculada). E so leitura (stable, sem side effect) - a gravacao
-- final em sincronizarUm continua protegida pela RLS de verdade, que e a garantia de seguranca
-- real; esta funcao e so para evitar o update no-op usado como probe.
--
-- Se cond_editor mudar de novo no futuro, atualizar esta funcao junto (ela nao le a policy
-- dinamicamente, so replica a mesma condicao em SQL).
--
-- Safe to run multiple times.

begin;

create or replace function public.gto_pode_editar_influenciador(p_marca public.bandeira_marca)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select (select public.gto_meu_cargo()) in ('Admin', 'Gestor')
    or ((select public.gto_meu_cargo()) in ('Coordenador', 'Analista') and public.gto_tem_acesso_marca(p_marca));
$$;

comment on function public.gto_pode_editar_influenciador(public.bandeira_marca) is
  'Espelha o cond_editor das RLS de influenciadores (20260922_040) sem gravar nada. Usada pela '
  'Edge Function influenciador-instagram-sync para checar permissao antes de efeitos colaterais '
  'privilegiados, sem gerar linha de auditoria via update no-op.';

grant execute on function public.gto_pode_editar_influenciador(public.bandeira_marca) to authenticated;

commit;
