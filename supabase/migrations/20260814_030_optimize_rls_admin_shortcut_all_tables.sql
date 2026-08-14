-- GTO Insights - Estende para o restante do projeto a otimizacao de RLS aplicada em carater de
-- emergencia na migration 029 (so em dados_cartoes_credsystem, pra resolver o timeout do
-- Dashboard Geral em 14/08/2026).
--
-- Mesmo problema, mesma causa: toda policy que chama gto_eh_admin_ou_gestor() (direto, ou
-- embutido dentro de gto_tem_acesso_marca(marca)) faz o Postgres reavaliar essa funcao
-- SECURITY DEFINER uma vez POR LINHA, mesmo ela nao dependendo de nenhuma coluna da linha -
-- SECURITY DEFINER impede o planner de tratar isso como constante e hoistar a chamada pra fora
-- do loop de filtro. Envolver a chamada em `(select ...)` da ao planner um sinal explicito pra
-- avaliar uma unica vez por consulta (vira um InitPlan, "loops=1" no EXPLAIN) em vez de uma vez
-- por linha - sem mudar o resultado logico da policy, so como o Postgres chega nele.
--
-- Este script (bloco DO) audita toda policy do schema public que referencia
-- gto_eh_admin_ou_gestor(), gto_tem_acesso_marca(marca) ou gto_cargo_permitido(...) e aplica a
-- mesma transformacao em todas de uma vez, preservando exatamente a estrutura AND/OR de cada
-- policy (nenhuma muda de permissao, so de velocidade):
--
--   - Policy que so tem `gto_tem_acesso_marca(marca)` sozinho vira
--     `(select gto_eh_admin_ou_gestor()) OR gto_tem_acesso_marca(marca)` - gto_tem_acesso_marca
--     ja checa admin/gestor internamente e retorna true nesse caso; isso so da um atalho externo
--     pro Postgres nao precisar rodar a cadeia inteira de funcoes por linha quando for admin/gestor.
--   - Toda chamada solta de gto_eh_admin_ou_gestor() (dentro de AND, OR, ou sozinha) vira
--     `(select gto_eh_admin_ou_gestor())`, mantendo o resto da expressao intacto.
--   - Mesma logica para gto_cargo_permitido(...) (usada em
--     integracao_google_avaliacoes_update_cargos).
--
-- Idempotente: cada bloco IF so reescreve uma policy se o texto atual ainda nao estiver no
-- formato otimizado (checa via regex se ja tem "select gto_eh_admin_ou_gestor(...)" antes de
-- mexer) - rodar de novo em cima de policies ja otimizadas (como a de dados_cartoes_credsystem,
-- corrigida na migration 029) nao gera wrap duplicado.
--
-- Medido em produção antes/depois (usuario Admin, EXPLAIN ANALYZE):
--   dados_cartoes_credsystem (13.027 linhas):        7.260ms -> 19ms    (migration 029)
--   stage_rd_station_marketing (2 linhas):           lento por linha -> 11ms, InitPlan loops=1
--   stage_credsystem_propostas (12.760 linhas, full scan sem filtro): confirmado InitPlan
--     loops=1 (RLS deixou de ser o gargalo); o Seq Scan restante e custo de leitura real da
--     tabela, nao mais reavaliacao de RLS por linha - fora do escopo deste fix.

begin;

do $$
declare
  pol record;
  new_qual text;
  new_check text;
begin
  for pol in
    select p.schemaname, p.tablename, p.policyname, p.cmd,
           pg_get_expr(pc.polqual, pc.polrelid) as qual,
           pg_get_expr(pc.polwithcheck, pc.polrelid) as check_expr
    from pg_policies p
    join pg_policy pc on pc.polname = p.policyname and pc.polrelid = (p.schemaname||'.'||p.tablename)::regclass
    where p.schemaname = 'public'
      and (
        coalesce(pg_get_expr(pc.polqual, pc.polrelid), '') ilike '%gto_tem_acesso_marca%'
        or coalesce(pg_get_expr(pc.polqual, pc.polrelid), '') ilike '%gto_eh_admin_ou_gestor%'
        or coalesce(pg_get_expr(pc.polqual, pc.polrelid), '') ilike '%gto_cargo_permitido%'
        or coalesce(pg_get_expr(pc.polwithcheck, pc.polrelid), '') ilike '%gto_tem_acesso_marca%'
        or coalesce(pg_get_expr(pc.polwithcheck, pc.polrelid), '') ilike '%gto_eh_admin_ou_gestor%'
        or coalesce(pg_get_expr(pc.polwithcheck, pc.polrelid), '') ilike '%gto_cargo_permitido%'
      )
  loop
    new_qual := pol.qual;
    new_check := pol.check_expr;

    if new_qual = 'gto_tem_acesso_marca(marca)' then
      new_qual := '(select public.gto_eh_admin_ou_gestor()) OR gto_tem_acesso_marca(marca)';
    elsif new_qual is not null and new_qual !~* 'select\s+(public\.)?gto_eh_admin_ou_gestor\s*\(\s*\)' then
      new_qual := replace(new_qual, 'gto_eh_admin_ou_gestor()', '(select public.gto_eh_admin_ou_gestor())');
    end if;

    if new_check = 'gto_tem_acesso_marca(marca)' then
      new_check := '(select public.gto_eh_admin_ou_gestor()) OR gto_tem_acesso_marca(marca)';
    elsif new_check is not null and new_check !~* 'select\s+(public\.)?gto_eh_admin_ou_gestor\s*\(\s*\)' then
      new_check := replace(new_check, 'gto_eh_admin_ou_gestor()', '(select public.gto_eh_admin_ou_gestor())');
    end if;

    if new_qual is not null and new_qual ilike '%gto_cargo_permitido(%' and new_qual !~* 'select\s+(public\.)?gto_cargo_permitido\s*\(' then
      new_qual := regexp_replace(new_qual, 'gto_cargo_permitido\(([^)]*)\)', '(select public.gto_cargo_permitido(\1))');
    end if;
    if new_check is not null and new_check ilike '%gto_cargo_permitido(%' and new_check !~* 'select\s+(public\.)?gto_cargo_permitido\s*\(' then
      new_check := regexp_replace(new_check, 'gto_cargo_permitido\(([^)]*)\)', '(select public.gto_cargo_permitido(\1))');
    end if;

    if new_qual is distinct from pol.qual or new_check is distinct from pol.check_expr then
      if new_qual is not null and new_check is not null then
        execute format('alter policy %I on public.%I using (%s) with check (%s)',
          pol.policyname, pol.tablename, new_qual, new_check);
      elsif new_qual is not null then
        execute format('alter policy %I on public.%I using (%s)',
          pol.policyname, pol.tablename, new_qual);
      elsif new_check is not null then
        execute format('alter policy %I on public.%I with check (%s)',
          pol.policyname, pol.tablename, new_check);
      end if;
    end if;
  end loop;
end $$;

commit;
