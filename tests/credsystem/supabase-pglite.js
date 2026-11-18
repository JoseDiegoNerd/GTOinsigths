// Adaptador minimo "supabase-js -> PGlite" para testes de UI: rpc() chama a funcao real no
// Postgres local como o usuario informado; from() le a tabela como esse usuario (RLS aplicada) e
// aplica no JS os filtros usados pelo modulo (eq, in, gte, lte, order, range, limit, count/head).
import { comoUsuario } from './pglite-harness.js';

export function criarSupabaseFake(db, userId) {
  const chamadas = [];

  async function rpc(nome, args = {}) {
    chamadas.push({ rpc: nome, args });
    try {
      const chaves = Object.keys(args);
      const valores = chaves.map((k) => {
        const v = args[k];
        if (k === 'p_abas' && Array.isArray(v)) return '{' + v.map((x) => '"' + String(x).replace(/"/g, '\\"') + '"').join(',') + '}';
        return v !== null && typeof v === 'object' ? JSON.stringify(v) : v;
      });
      const sql = `select public.${nome}(${chaves.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`;
      const r = await comoUsuario(db, userId, (tx) => tx.query(sql, valores));
      return { data: normalizar(r.rows[0].r), error: null };
    } catch (error) {
      return { data: null, error: { message: error.message, code: error.code } };
    }
  }

  function from(tabela) {
    const filtros = [];
    let ordem = [], intervalo = null, limite = null, contar = false, cabeca = false, upsertRow = null, upsertConflito = null;
    const b = {
      select(_cols, opts = {}) { contar = opts.count === 'exact'; cabeca = !!opts.head; return b; },
      eq(c, v) { filtros.push((r) => String(r[c]) === String(v)); return b; },
      in(c, vs) { filtros.push((r) => vs.map(String).includes(String(r[c]))); return b; },
      gte(c, v) { filtros.push((r) => r[c] !== null && String(r[c]).slice(0, 10) >= v); return b; },
      lte(c, v) { filtros.push((r) => r[c] !== null && String(r[c]).slice(0, 10) <= v); return b; },
      order(c, { ascending = true } = {}) { ordem.push([c, ascending]); return b; },
      range(a, z) { intervalo = [a, z]; return b; },
      limit(n) { limite = n; return b; },
      upsert(row, { onConflict } = {}) { upsertRow = row; upsertConflito = onConflict; return b; },
      then(resolve, reject) { return executar().then(resolve, reject); }
    };
    async function executar() {
      chamadas.push({ from: tabela, upsert: !!upsertRow });
      if (upsertRow) {
        try {
          const cols = Object.keys(upsertRow);
          const sql = `insert into public.${tabela} (${cols.join(", ")}) values (${cols.map((_, i) => "$" + (i + 1)).join(", ")}) on conflict (${upsertConflito}) do update set ${cols.map((c) => `${c} = excluded.${c}`).join(", ")}`;
          await comoUsuario(db, userId, (tx) => tx.query(sql, cols.map((c) => (upsertRow[c] !== null && typeof upsertRow[c] === "object" ? JSON.stringify(upsertRow[c]) : upsertRow[c]))));
          return { data: null, error: null };
        } catch (error) {
          return { data: null, error: { message: error.message, code: error.code } };
        }
      }
      try {
        const r = await comoUsuario(db, userId, (tx) => tx.query(`select * from public.${tabela}`));
        let rows = r.rows.map(normalizar).filter((x) => filtros.every((f) => f(x)));
        for (const [c, asc] of [...ordem].reverse()) rows.sort((x, y) => (String(x[c] ?? '') < String(y[c] ?? '') ? -1 : String(x[c] ?? '') > String(y[c] ?? '') ? 1 : 0) * (asc ? 1 : -1));
        const count = rows.length;
        if (intervalo) rows = rows.slice(intervalo[0], intervalo[1] + 1);
        if (limite !== null) rows = rows.slice(0, limite);
        return { data: cabeca ? null : rows, count: contar ? count : null, error: null };
      } catch (error) {
        return { data: null, error: { message: error.message, code: error.code } };
      }
    }
    return b;
  }

  return { rpc, from, chamadas };
}

// PGlite devolve Date para date/timestamp e string para numeric; o PostgREST devolve string ISO.
function normalizar(v) {
  if (v instanceof Date) return v.toISOString().slice(0, v.getUTCHours() || v.getUTCMinutes() ? 19 : 10);
  if (Array.isArray(v)) return v.map(normalizar);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, normalizar(x)]));
  return v;
}
