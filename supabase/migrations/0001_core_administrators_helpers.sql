-- ============================================================================
-- 0001 — Core: helper schema, administrators allowlist, helper functions
-- Portfolio: Aditya Prakash (PRODIGY_WD_04)
--
-- Safe to run once. Re-running this file is harmless:
--   * every CREATE uses IF NOT EXISTS / CREATE OR REPLACE,
--   * indexes use IF NOT EXISTS,
--   * no data is inserted in this file.
--
-- SECURITY MODEL
--   * `administrators` is the single source of truth for who may manage the
--     portfolio. It is only ever written from the Supabase dashboard SQL
--     editor (by the project owner), never through any client API.
--   * The table and this file never contain credentials — only the auth
--     user id and the email Supabase Auth already knows about.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Helper schema for functions (separates logic from data tables)
-- ---------------------------------------------------------------------------
create schema if not exists app;

-- ---------------------------------------------------------------------------
-- 2. Administrators allowlist
--    RLS is enabled and NO client policies are created on this table, and
--    all anon/authenticated table privileges are revoked, so no public or
--    authenticated client can ever read, insert, update or delete rows.
--    The SECURITY DEFINER helper below is the only client-reachable reader.
-- ---------------------------------------------------------------------------
create table if not exists public.administrators (
  id         uuid        primary key references auth.users (id) on delete cascade,
  email      text        not null,
  note       text,                      -- optional label, e.g. "primary owner"
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint administrators_email_format
    check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  constraint administrators_uuid_key
    check (id <> '00000000-0000-0000-0000-000000000000'::uuid)
);

-- one row per email (case-insensitive), one row per auth user (PK above)
create unique index if not exists administrators_email_uniq
  on public.administrators (lower(email));

-- belt and braces: even if a future migration adds policies, table grants
-- stay revoked for API roles; only the SECURITY DEFINER function reads it.
revoke all on public.administrators from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. app.is_admin()
--    * SECURITY DEFINER: evaluates the allowlist with the function owner's
--      rights, so ordinary users cannot probe the table directly.
--    * Fixed, empty search_path: every referenced object is fully schema-
--      qualified, so a malicious object shadowing "administrators" in the
--      caller's search path can never hijack the check.
--    * STABLE: safe to use inside row-level-security policies, evaluated
--      once per statement's snapshot rather than per row.
--    * Execution is revoked from anon/public and granted only to
--      authenticated — anonymous visitors cannot call it at all.
-- ---------------------------------------------------------------------------
create or replace function app.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.administrators a
    where a.id = auth.uid()
  );
$$;

revoke all on function app.is_admin() from public, anon;
grant  execute on function app.is_admin() to authenticated;

-- USAGE on the helper schema is owner-only by default in Postgres, so
-- authenticated callers (including RLS policy evaluation on their behalf)
-- need an explicit USAGE grant; anon is explicitly denied.
revoke all on schema app from anon;
grant  usage on schema app to authenticated;

-- ---------------------------------------------------------------------------
-- 4. app.set_updated_at()
--    Standard trigger function: keeps `updated_at` truthful on every UPDATE.
--    SECURITY DEFINER + empty search_path for the same hardening reasons.
-- ---------------------------------------------------------------------------
create or replace function app.set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function app.set_updated_at() from public, anon;
