-- ============================================================================
-- 0004 — Storage buckets + object policies
--
-- Safe to run once; re-running is harmless (upsert + drop-if-exists).
--
-- BUCKETS
--   profile-photos  public read   JPEG/PNG/WebP                      ≤ 5 MB
--   project-shots   public read   JPEG/PNG/WebP                      ≤ 8 MB
--   certificates    public read   JPEG/PNG/WebP + PDF               ≤ 10 MB
--   resume          public read   PDF (portfolio download button)    ≤ 5 MB
--
-- `file_size_limit` and `allowed_mime_types` are enforced server-side by
-- Supabase Storage at upload time — not only client-side. Uploads through
-- any client that ignores validation are rejected by the storage service.
--
-- ACCESS MATRIX (storage.objects policies)
--   anon:                  SELECT only, in these four buckets.
--                          INSERT / UPDATE / DELETE: denied.
--   authenticated admin:   SELECT / INSERT / UPDATE / DELETE in these four
--                          buckets, gated by app.is_admin() (SECURITY
--                          DEFINER, fixed search_path).
--   authenticated visitor: identical to anon (SELECT only) — and since
--                          signups are disabled, only admins normally
--                          have an authenticated session at all.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Buckets (upsert keeps this migration repeatable and self-healing)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('profile-photos', 'profile-photos', true, 5242880,
   array['image/jpeg', 'image/png', 'image/webp']),
  ('project-shots',  'project-shots',  true, 8388608,
   array['image/jpeg', 'image/png', 'image/webp']),
  ('certificates',   'certificates',   true, 10485760,
   array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  ('resume',         'resume',         true, 5242880,
   array['application/pdf'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- 2. Object policies
-- ---------------------------------------------------------------------------
drop policy if exists "portfolio_public_read_assets" on storage.objects;
create policy "portfolio_public_read_assets"
  on storage.objects
  for select
  to anon, authenticated
  using (bucket_id in ('profile-photos', 'project-shots', 'certificates', 'resume'));

drop policy if exists "portfolio_admin_insert_assets" on storage.objects;
create policy "portfolio_admin_insert_assets"
  on storage.objects
  for insert
  to authenticated
  with check (
    app.is_admin()
    and bucket_id in ('profile-photos', 'project-shots', 'certificates', 'resume')
  );

drop policy if exists "portfolio_admin_update_assets" on storage.objects;
create policy "portfolio_admin_update_assets"
  on storage.objects
  for update
  to authenticated
  using (
    app.is_admin()
    and bucket_id in ('profile-photos', 'project-shots', 'certificates', 'resume')
  )
  with check (
    app.is_admin()
    and bucket_id in ('profile-photos', 'project-shots', 'certificates', 'resume')
  );

drop policy if exists "portfolio_admin_delete_assets" on storage.objects;
create policy "portfolio_admin_delete_assets"
  on storage.objects
  for delete
  to authenticated
  using (
    app.is_admin()
    and bucket_id in ('profile-photos', 'project-shots', 'certificates', 'resume')
  );
