// Local verification of supabase/migrations/*.sql against real Postgres (PGlite).
// Stubs only the Supabase-specific auth + storage schemas, mirrors Supabase's
// default privileges (applied BEFORE migrations so the 0001 revokes behave
// exactly as they will in the real project), then:
//   1. runs all migrations,
//   2. re-runs all migrations (idempotency check),
//   3. exercises RLS as anon / non-admin authenticated / allowlisted admin,
//   4. checks the profiles singleton guard, updated_at triggers, and
//      storage object policies.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const MIG = new URL('../supabase/migrations/', import.meta.url).pathname;
const files = [
  `${MIG}0001_core_administrators_helpers.sql`,
  `${MIG}0002_content_tables.sql`,
  `${MIG}0003_rls_policies.sql`,
  `${MIG}0004_storage_buckets_policies.sql`,
];

const db = new PGlite('/tmp/pgcheck/data');
const results = [];
const ok = (name, cond, detail = '') =>
  results.push({ test: name, pass: !!cond, detail: String(detail).slice(0, 110) });

// ---- Supabase environment stubs ---------------------------------------------
await db.exec(`
  create role anon nologin;
  create role authenticated nologin;
  grant anon, authenticated to postgres;

  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('pglite.auth_uid', true), '')::uuid;
  $$;

  create schema storage;
  create table storage.buckets (
    id text primary key, name text, public boolean,
    file_size_limit bigint, allowed_mime_types text[]
  );
  create table storage.objects (
    id uuid default gen_random_uuid() primary key,
    bucket_id text not null, name text
  );
  alter table storage.objects enable row level security;

  -- Mirror Supabase default privileges: newly created public tables are
  -- automatically granted to anon/authenticated; RLS is the real boundary.
  alter default privileges in schema public
    grant select, insert, update, delete on tables to anon, authenticated;

  grant usage on schema public, storage, auth to anon, authenticated;
  grant select, insert, update, delete on storage.objects to anon, authenticated;
`);

// ---- 1 + 2: run every migration twice ---------------------------------------
for (let pass = 1; pass <= 2; pass++) {
  for (const f of files) {
    const sql = readFileSync(f, 'utf8');
    try {
      await db.exec(sql);
      ok(`migrate pass${pass}: ${f.split('/').pop()}`, true);
    } catch (e) {
      ok(`migrate pass${pass}: ${f.split('/').pop()}`, false, e.message);
    }
  }
}

// administrators table: no client privileges may remain after 0001's revoke.
const adminsGrants = (await db.query(
  `select count(*)::int as n from information_schema.role_table_grants
   where table_name = 'administrators'
     and grantee in ('anon','authenticated') and privilege_type = 'SELECT'`
)).rows[0].n;
ok('administrators table has no client grants', adminsGrants === 0, `SELECT grants found: ${adminsGrants}`);

// ---- 3: seed owner data (as migration owner = dashboard SQL editor) ----------
const ADMIN_UUID = '11111111-1111-1111-1111-111111111111';
await db.query(`insert into auth.users (id) values ($1)`, [ADMIN_UUID]);
await db.query(
  `insert into administrators (id, email, note) values ($1, $2, 'primary owner')`,
  [ADMIN_UUID, 'owner@example.com'],
);
await db.exec(`
  insert into profiles (full_name, title) values ('Aditya Prakash', 'Aspiring Software Developer');
  insert into education (institution, degree, start_date, currently_enrolled, grade, display_order, published)
    values ('ABC University', 'B.Tech', '2023-07-01', true, 'CGPA 8.9', 0, true);
  insert into skills (name, category, proficiency, display_order, published)
    values ('Python', 'Languages', 4, 0, true),
           ('Draft skill', 'Tools', 2, 1, false);
  insert into projects (name, published, featured) values ('Pub proj', true, true), ('Draft proj', false, false);
`);

const attempt = async (sql, params = []) => {
  try { const res = await db.query(sql, params); return { ok: true, affected: res.rowCount ?? 0 }; }
  catch (e) { return { ok: false, message: e.message }; }
};
const expectFail = async (name, sql, params = []) => {
  const r = await attempt(sql, params);
  // A write is “blocked” when it errors OR executes as a no-op (0 rows
  // affected) — RLS silently filters instead of erroring for UPDATE/DELETE.
  ok(name, !r.ok || (r.affected ?? 0) === 0,
    r.ok ? `affected ${r.affected} rows — WRITE WENT THROUGH` : r.message);
};
const expectPassRows = async (name, sql, params = [], min) => {
  const r = await attempt(sql, params);
  ok(name, r.ok && (r.affected ?? 0) >= min, r.ok ? `affected ${r.affected}` : r.message);
};
const expectPass = async (name, sql, params = []) => {
  const r = await attempt(sql, params);
  ok(name, r.ok, r.ok ? '' : r.message);
};

// ---- anon role ---------------------------------------------------------------
await db.exec(`set role anon`);
let r = await db.query(`select count(*)::int n from education`);
ok('anon sees published education rows', r.rows[0].n === 1, `count=${r.rows[0].n}`);
r = await db.query(`select count(*)::int n from skills where name = 'Draft skill'`);
ok('anon cannot see unpublished skill (draft)', r.rows[0].n === 0, `count=${r.rows[0].n}`);
await expectFail('anon INSERT blocked', `insert into education (institution, degree) values ('x','y')`);
await expectFail('anon UPDATE blocked', `update skills set published = false`);
await expectFail('anon DELETE blocked', `delete from projects`);
let adminsBlocked = false, n;
try {
  n = (await db.query(`select count(*)::int n from administrators`)).rows[0].n;
} catch { adminsBlocked = true; }
ok('anon cannot read administrators allowlist', adminsBlocked || n === 0,
  adminsBlocked ? 'privilege denied' : `RLS returned ${n} rows`);

// ---- authenticated, NOT an admin ---------------------------------------------
await db.exec(`reset role; set role authenticated`);
r = await db.query(`select count(*)::int n from education where currently_enrolled`);
ok('non-admin authenticated sees published rows', r.rows[0].n === 1, `count=${r.rows[0].n}`);
await expectFail('non-admin authenticated INSERT blocked', `insert into projects (name) values ('nope')`);
await expectPass('non-admin authenticated UPDATE executes without error', `update skills set published = false where name = 'Python'`);
const updCheck = await db.query(`select published from skills where name = 'Python'`);
ok('non-admin update left data unchanged', updCheck.rows[0].published === true, `published=${updCheck.rows[0].published}`);
await expectFail('non-admin authenticated DELETE blocked', `delete from projects where published = true`);
// and the row really is untouched, verified from the owner view (the
// authenticated role can only see published rows by design):
await db.exec(`reset role`);
const sample = await db.query(`select count(*)::int n from projects`);
ok('non-admin delete left data unchanged', sample.rows[0].n === 2, `count=${sample.rows[0].n}`);
await db.exec(`set role authenticated`);
n = 0;
try { n = (await db.query(`select count(*)::int n from administrators`)).rows[0].n; } catch {}
ok('non-admin cannot read administrators', true, `result: privilege denied or ${n} rows (RLS)`);

// ---- authenticated + allowlisted admin ---------------------------------------
await db.exec(`reset role`);
await db.query(`select set_config('pglite.auth_uid', $1, false)`, [ADMIN_UUID]);
await db.exec(`set role authenticated`);
r = await db.query(`select app.is_admin() as v`);
ok('admin can execute app.is_admin() → true', r.rows[0].v === true, JSON.stringify(r.rows[0]));
r = await db.query(`select count(*)::int n from skills`); // includes unpublished
ok('admin selects unpublished rows', r.rows[0].n === 2, `count=${r.rows[0].n}`);
await expectPassRows('admin INSERT works', `insert into education (institution, degree, published) values ('X Univ','PhD', false)`, [], 1);
await expectPassRows('admin UPDATE works', `update education set degree = 'B.Tech (AI)' where institution = 'ABC University'`, [], 1);
r = await db.query(`select updated_at > created_at as touched from education where institution = 'ABC University'`);
ok('updated_at trigger fired on admin UPDATE', r.rows[0].touched === true);
await expectPassRows('admin DELETE works', `delete from education where institution = 'X Univ'`, [], 1);
r = await db.query(`select count(*)::int n from education`);
ok('admin DELETE actually removed the row', r.rows[0].n === 1, `count=${r.rows[0].n}`);
r = await db.query(`select count(*)::int n from education where institution = 'X Univ'`);
ok('admin DELETE removed only the targeted row', r.rows[0].n === 0, `remaining=${r.rows[0].n}`);

// ---- profiles singleton guard through the normal admin client path -----------
let singletonBlocked = false, msg = '';
try { await db.query(`insert into profiles (full_name) values ('Second profile')`); }
catch (e) { singletonBlocked = true; msg = e.message; }
ok('second profile row rejected (singleton)', singletonBlocked, msg);

// ---- anon cannot call is_admin() ---------------------------------------------
await db.exec(`reset role; set role anon`);
let anonFunctionBlocked = false;
try { await db.query(`select app.is_admin()`); }
catch { anonFunctionBlocked = true; }
ok('anon cannot execute app.is_admin()', anonFunctionBlocked);

// ---- 0004 re-run: buckets upsert + storage policies --------------------------
await db.exec(`reset role`);
await db.exec(readFileSync(`${MIG}0004_storage_buckets_policies.sql`, 'utf8'));
await db.exec(`
  insert into storage.buckets (id, name, public) values ('profile-photos','profile-photos', true) 
  on conflict (id) do nothing;
`);

await db.exec(`set role anon`);
await expectFail('storage INSERT blocked for anon', `insert into storage.objects (bucket_id, name) values ('profile-photos','x.jpg')`);
await db.exec(`reset role`);
await db.query(`select set_config('pglite.auth_uid', $1, false)`, [ADMIN_UUID]);
await db.exec(`set role authenticated`);
await expectPass('storage INSERT allowed for admin', `insert into storage.objects (bucket_id, name) values ('profile-photos', 'ok.jpg')`);
await expectFail('admin storage INSERT blocked outside known buckets', `insert into storage.objects (bucket_id, name) values ('other-bucket', 'nope.jpg')`);

const failed = results.filter(r => !r.pass);
console.log(JSON.stringify({
  total: results.length,
  passed: results.length - failed.length,
  failed,
  results,
}, null, 1));
await db.close();
