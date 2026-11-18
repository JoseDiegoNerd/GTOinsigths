// Harness de testes SQL: sobe um Postgres em WASM (PGlite), cria stubs minimos do Supabase
// (schema auth, roles anon/authenticated/service_role, pgcrypto em "extensions") e aplica as
// migrations REAIS do projeto que o modulo CredSystem usa, seguidas da migration nova. Permite
// testar RLS, RPCs SECURITY DEFINER e idempotencia sem tocar no banco de producao.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const MIGRATIONS_DIR = resolve('supabase/migrations');

// Ordem importa: so o que o modulo CredSystem precisa (perfis/RLS, tabelas de cartoes/propostas,
// views antigas, dedupe de emissoes, perfis_marcas, MFA aal2, gto_eh_admin) + a migration nova.
export const MIGRATIONS = [
  '20260702_001_init_perfis_logs_rls.sql',
  '20260702_002_data_stage_tables_rls.sql',
  '20260706_003_stage_credsystem_propostas.sql',
  '20260706_004_credsystem_bi_views.sql',
  '20260718_012_credsystem_emissoes_dedupe.sql',
  '20260807_021_perfil_edicao_completa.sql',
  '20260813_027_enforce_mfa_aal2_rls.sql',
  '20260817104800_convite_telefone_origem.sql.sql',
  '20260819_034_restringe_cargo_marca_admin.sql',
  '20261113_045_credsystem_importacao_inteligente.sql'
];

const BOOTSTRAP = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema extensions;
  create extension pgcrypto schema extensions;
  grant usage on schema extensions to anon, authenticated, service_role;
  create schema auth;
  grant usage on schema auth to anon, authenticated, service_role;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb not null default '{}', raw_app_meta_data jsonb not null default '{}');
  create table auth.mfa_factors (id uuid primary key default gen_random_uuid(), user_id uuid, status text);
  grant select on auth.users, auth.mfa_factors to authenticated;
  create function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
  $$;
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(auth.jwt() ->> 'sub', '')::uuid
  $$;
  grant execute on all functions in schema auth to anon, authenticated, service_role;
  grant usage on schema public to anon, authenticated, service_role;
  -- storage (so o necessario para a migration 021 de avatares rodar)
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language sql immutable as $$
    select string_to_array(name, '/')
  $$;
`;

export const USERS = {
  admin: '00000000-0000-0000-0000-00000000000a',
  ouro: '00000000-0000-0000-0000-0000000000b1',     // Analista so da Tesoura de Ouro
  economia: '00000000-0000-0000-0000-0000000000b2', // Analista so da Magazine da Economia
  semPerfil: '00000000-0000-0000-0000-0000000000ff'
};

export async function criarBanco({ antesDaMigrationNova = null } = {}) {
  const db = await PGlite.create({ extensions: { pgcrypto } });
  await db.exec(BOOTSTRAP);
  for (const file of MIGRATIONS) {
    if (file === MIGRATIONS[MIGRATIONS.length - 1] && antesDaMigrationNova) await antesDaMigrationNova(db);
    const sql = readFileSync(resolve(MIGRATIONS_DIR, file), 'utf8');
    try {
      await db.exec(sql);
    } catch (error) {
      error.message = `[${file}] ${error.message}`;
      throw error;
    }
  }
  // triggers de protecao de perfis (so Admin altera cargo/ativo) desligados SO na semeadura
  await db.exec(`
    set session_replication_role = replica;
    insert into auth.users (id, email) values
      ('${USERS.admin}', 'admin@gto.test'), ('${USERS.ouro}', 'ouro@gto.test'),
      ('${USERS.economia}', 'economia@gto.test'), ('${USERS.semPerfil}', 'x@gto.test');
    insert into public.perfis (id, email, cargo, marca_vinculada) values
      ('${USERS.admin}', 'admin@gto.test', 'Admin', null),
      ('${USERS.ouro}', 'ouro@gto.test', 'Analista', 'Tesoura de Ouro'),
      ('${USERS.economia}', 'economia@gto.test', 'Analista', 'Magazine da Economia')
      on conflict (id) do update set cargo = excluded.cargo, marca_vinculada = excluded.marca_vinculada, ativo = true;
    insert into public.perfis_marcas (perfil_id, marca) values
      ('${USERS.ouro}', 'Tesoura de Ouro'), ('${USERS.economia}', 'Magazine da Economia')
      on conflict do nothing;
    set session_replication_role = origin;
  `);
  return db;
}

// Executa fn como um usuario autenticado (role authenticated + JWT com sub), dentro de uma
// transacao para o SET LOCAL nao vazar entre testes. Erros propagam (a transacao e desfeita).
export async function comoUsuario(db, userId, fn) {
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: userId, aal: 'aal1', role: 'authenticated' })]);
    await tx.exec('set local role authenticated');
    return fn(tx);
  });
}

// Chama uma funcao com notacao nomeada. Objetos/arrays viram JSON (jsonb), exceto parametros
// listados em textArrays (text[]), enviados como literal de array do Postgres.
export async function rpc(tx, nome, args, { textArrays = ["p_abas"] } = {}) {
  const chaves = Object.keys(args);
  const params = chaves.map((k, i) => `${k} => $${i + 1}`).join(", ");
  const valores = chaves.map((k) => {
    const v = args[k];
    if (textArrays.includes(k) && Array.isArray(v)) return "{" + v.map((x) => '"' + String(x).replace(/"/g, '\\"') + '"').join(",") + "}";
    return v !== null && typeof v === "object" ? JSON.stringify(v) : v;
  });
  const { rows } = await tx.query(`select public.${nome}(${params}) as r`, valores);
  return rows[0].r;
}
