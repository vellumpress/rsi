import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

/**
 * Docker is not available in this environment, so `supabase start` cannot boot.
 * This applies the migrations the project ships, on embedded Postgres, with the
 * auth hooks a local Supabase stack would already have: auth.users, auth.uid,
 * auth.jwt, and the anon / authenticated / service_role / supabase_auth_admin roles.
 * service_role bypasses row security, matching the hosted project.
 */
export async function bootRsiDatabase(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(`
    create schema if not exists auth;
    create table if not exists auth.users (
      id uuid primary key,
      email text
    );
    create or replace function auth.uid() returns uuid
    language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    create or replace function auth.jwt() returns jsonb
    language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
    $$;
    do $$
    begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
      if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then create role supabase_auth_admin nologin; end if;
    end $$;
    grant usage on schema public to anon, authenticated, service_role, supabase_auth_admin;
    grant usage on schema auth to anon, authenticated, service_role, supabase_auth_admin;
  `);
  const dir = "supabase/migrations";
  const files = readdirSync(dir).filter((name) => name.endsWith(".sql")).sort();
  for (const name of files) {
    await db.exec(readFileSync(join(dir, name), "utf8"));
  }
  return db;
}

export async function asUser(db: PGlite, userId: string, email: string): Promise<void> {
  await db.exec("reset role");
  await db.exec("set role authenticated");
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId]);
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: userId, email })]);
}
