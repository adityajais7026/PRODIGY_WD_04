-- ============================================================================
-- 0003 — Row Level Security for all content tables
--
-- Safe to run once; re-running is harmless (drop-if-exists then create).
--
-- ACCESS MATRIX
--   anonymous visitor (anon):
--     * SELECT: only `published = true` rows,
--     * INSERT / UPDATE / DELETE: impossible — write privileges are revoked
--       at the privilege level AND there is no permissive write policy.
--   authenticated + allowlisted admin (app.is_admin()):
--     * SELECT: everything (published and unpublished),
--     * INSERT / UPDATE / DELETE: allowed via the permissive ALL policy and
--       mirrored explicit UPDATE/DELETE policies (see the hardening note).
--   authenticated + allowlisted admin (app.is_admin()):
--     * SELECT: everything (published and unpublished),
--     * INSERT / UPDATE / DELETE: allowed via the permissive ALL policy.
--   authenticated but NOT allowlisted:
--     * only the public `published = true` reads (and signup is disabled in
--       the Auth settings, so this role should not exist in practice).
--
-- administrators itself:
--   * RLS enabled, NO policies, and all API-role privileges were revoked in
--     0001 — the allowlist is invisible and untouchable from any client.
--   * app.is_admin() is SECURITY DEFINER with a fixed empty search_path,
--     so RLS predicates cannot be spoofed and the table grants are moot.
--   * Membership changes happen ONLY in the dashboard SQL editor.
-- ============================================================================

-- Turn on RLS everywhere.
alter table public.profiles     enable row level security;
alter table public.education    enable row level security;
alter table public.skills       enable row level security;
alter table public.projects     enable row level security;
alter table public.experience   enable row level security;
alter table public.achievements enable row level security;
alter table public.social_links enable row level security;

-- Note: RLS is deliberately NOT forced (FORCE ROW LEVEL SECURITY): forcing it
-- would also restrict the dashboard SQL editor's owner role without adding
-- any protection for anon/authenticated, who are already restricted above.

-- ---------------------------------------------------------------------------
-- HARDENING (defense in depth at both layers).
-- Postgres RLS nuance: when an UPDATE/DELETE policy does not exist for a
-- role, Postgres borrows the visibility (USING) of the SELECT policy, which
-- — combined with Supabase's broad default table grants — would let a
-- client UPDATE or DELETE rows it can merely SEE. So both layers are closed:
--   1. privilege layer: anon loses all write privileges outright;
--   2. policy layer: explicit UPDATE/DELETE policies for authenticated that
--      require app.is_admin(), so WITH CHECK governs instead of defaulting
--      to the SELECT-policy USING.
-- ---------------------------------------------------------------------------
revoke insert, update, delete, truncate on
  public.profiles, public.education, public.skills, public.projects,
  public.experience, public.achievements, public.social_links
from anon;

do $$
declare
  t text;
  tables text[] := array[
    'profiles', 'education', 'skills', 'projects',
    'experience', 'achievements', 'social_links'
  ];
begin
  foreach t in array tables loop
    -- --------------------------------------------------------------
    -- Public readers: published rows only.
    -- --------------------------------------------------------------
    execute format('drop policy if exists "public_read_published" on public.%I;', t);
    execute format($f$
      create policy "public_read_published" on public.%I
        for select
        to anon, authenticated
        using (published = true);
    $f$, t);

    -- --------------------------------------------------------------
    -- Admin: full row CRUD, gated by the secure allowlist function.
    -- A malicious/forged client request can never satisfy the check,
    -- because app.is_admin() runs server-side as SECURITY DEFINER.
    --
    -- In addition to the ALL policy, UPDATE and DELETE get their own
    -- explicit policies so their WITH CHECK / USING cannot default to the
    -- broad SELECT-policy USING for non-admin authenticated clients.
    -- --------------------------------------------------------------
    execute format('drop policy if exists "admin_manage_all" on public.%I;', t);
    execute format($f$
      create policy "admin_manage_all" on public.%I
        for all
        to authenticated
        using (app.is_admin())
        with check (app.is_admin());
    $f$, t);

    execute format('drop policy if exists "admin_update_all" on public.%I;', t);
    execute format($f$
      create policy "admin_update_all" on public.%I
        for update
        to authenticated
        using (app.is_admin())
        with check (app.is_admin());
    $f$, t);

    execute format('drop policy if exists "admin_delete_all" on public.%I;', t);
    execute format($f$
      create policy "admin_delete_all" on public.%I
        for delete
        to authenticated
        using (app.is_admin());
    $f$, t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- administrators: no client access at all (defense in depth on top of the
-- revoked grants in 0001 — with RLS enabled and no policies, clients see
-- and change nothing even if grants were ever re-added).
-- ---------------------------------------------------------------------------
alter table public.administrators enable row level security;

-- Explicit deny is implicit with no policies, but document the intent:
comment on table public.administrators is
  'Admin allowlist. Managed ONLY via Supabase dashboard SQL. No client RLS policies on purpose.';
