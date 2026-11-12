-- ============================================================================
-- 0005 — Public RPC probe so the admin dashboard can verify administrator rights
--
-- Run this once in the Supabase SQL editor, after 0001–0004.
-- Safe to re-run (create or replace + revoke/grant only; no tables touched).
--
-- WHY THIS EXISTS
--   PostgREST only exposes the `public` schema. `app.is_admin()` lives in the
--   private `app` schema, so the browser cannot call it directly. This thin
--   SECURITY DEFINER wrapper answers exactly one yes/no question for the
--   caller and never exposes the allowlist itself.
--
-- SECURITY
--   * SECURITY DEFINER + fixed empty search_path (objects fully qualified),
--   * anonymous visitors cannot execute it (revoked from public, anon),
--   * it returns only a boolean — no emails, ids or row data.
-- ============================================================================

create or replace function public.current_admin_state()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_admin();
$$;

revoke all on function public.current_admin_state() from public, anon;
grant  execute on function public.current_admin_state() to authenticated;

comment on function public.current_admin_state() is
  'True when the signed-in auth user is in public.administrators. Used by the admin dashboard to gate its UI; the real enforcement is RLS.';
