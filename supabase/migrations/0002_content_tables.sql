-- ============================================================================
-- 0002 — Content tables: profiles, education, skills, projects, experience,
--        achievements, social_links
--
-- Safe to run once. Re-running is harmless: IF NOT EXISTS everywhere, and
-- trigger/index creation is guarded by drop-if-exists + create.
-- No data rows are inserted here, so content is never duplicated.
--
-- Conventions shared by every content table:
--   * uuid primary key (gen_random_uuid) — dashboards insert without ids,
--   * `published` boolean        — anonymous visitors only ever see true,
--   * `display_order` integer    — admin-controlled sorting,
--   * `created_at` / `updated_at` maintained automatically (trigger in 0001),
--   * https-only checks on URLs,
--   * indexes tuned for the public queries: (published, display_order).
--
-- Special guarantee (Profile Management):
--   * `profiles` is a singleton — at most ONE row can ever exist (partial
--     unique index on constant TRUE below), so duplicate profiles are
--     impossible at the database level, not only in the UI.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. profiles — single primary portfolio profile
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id                  uuid        primary key default gen_random_uuid(),
  full_name           text        not null check (char_length(full_name) between 1 and 120),
  title               text        check (title is null or char_length(title) <= 160),
  intro               text        check (intro is null or char_length(intro) <= 400),
  about               text        check (about is null or char_length(about) <= 8000),
  avatar_url          text        check (avatar_url is null or avatar_url like 'https://%'),
  email               text        check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  location            text        check (location is null or char_length(location) <= 160),
  resume_url          text        check (resume_url is null or resume_url like 'https://%'),
  availability_status text        not null default 'available'
                                  check (availability_status in ('available', 'open_to_work', 'busy', 'unavailable')),
  published           boolean     not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- Singleton: no second profile row can be inserted (per table, not per user).
create unique index if not exists profiles_singleton
  on public.profiles ((true));

create index if not exists profiles_published_idx
  on public.profiles (published);
create index if not exists profiles_updated_idx
  on public.profiles (updated_at desc);

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. education
-- ---------------------------------------------------------------------------
create table if not exists public.education (
  id                 uuid        primary key default gen_random_uuid(),
  institution        text        not null check (char_length(institution) between 1 and 200),
  degree             text        not null check (char_length(degree) between 1 and 200),
  start_date         date        check (start_date is null or start_date <= current_date),
  end_date           date        check (end_date   is null or end_date   <= current_date),
  currently_enrolled boolean     not null default false,
  grade              text        check (grade is null or char_length(grade) <= 60),  -- e.g. CGPA 8.9
  description        text        check (description is null or char_length(description) <= 2000),
  display_order      integer     not null default 0 check (display_order >= 0),
  published          boolean     not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint education_dates_order
    check (start_date is null or end_date is null or start_date <= end_date),
  constraint education_not_future_enrolled
    check (not currently_enrolled or end_date is null)
);

create index if not exists education_public_idx
  on public.education (published, display_order, start_date desc);

drop trigger if exists education_touch_updated_at on public.education;
create trigger education_touch_updated_at
  before update on public.education
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. skills — categorised, proficiency 1–5, admin-controlled order
-- ---------------------------------------------------------------------------
create table if not exists public.skills (
  id             uuid        primary key default gen_random_uuid(),
  name           text        not null check (char_length(name) between 1 and 80),
  category       text        not null default 'Tools'
                             check (category in ('Languages', 'Frameworks & Libraries', 'Databases', 'Tools', 'Concepts')),
  proficiency    smallint    not null default 3 check (proficiency between 1 and 5),
  display_order  integer     not null default 0 check (display_order >= 0),
  published      boolean     not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists skills_public_idx
  on public.skills (published, category, display_order);
create index if not exists skills_write_idx
  on public.skills (category, display_order);

drop trigger if exists skills_touch_updated_at on public.skills;
create trigger skills_touch_updated_at
  before update on public.skills
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. projects
-- ---------------------------------------------------------------------------
create table if not exists public.projects (
  id             uuid        primary key default gen_random_uuid(),
  name           text        not null check (char_length(name) between 1 and 160),
  description    text        check (description is null or char_length(description) <= 4000),
  technologies   text[]      not null default '{}' check (array_length(technologies, 1) is null or array_length(technologies, 1) <= 24),
  github_url     text        check (github_url is null or github_url like 'https://%'),
  live_url       text        check (live_url   is null or live_url   like 'https://%'),
  image_url      text        check (image_url  is null or image_url  like 'https://%'),
  featured       boolean     not null default false,
  display_order  integer     not null default 0 check (display_order >= 0),
  published      boolean     not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists projects_public_idx
  on public.projects (published, featured desc, display_order, created_at desc);
create index if not exists projects_write_idx
  on public.projects (featured desc, display_order);

drop trigger if exists projects_touch_updated_at on public.projects;
create trigger projects_touch_updated_at
  before update on public.projects
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- 5. experience
-- ---------------------------------------------------------------------------
create table if not exists public.experience (
  id             uuid        primary key default gen_random_uuid(),
  organization   text        not null check (char_length(organization) between 1 and 200),
  role           text        not null check (char_length(role) between 1 and 200),
  period         text        not null check (char_length(period) between 1 and 80),  -- e.g. "2024 — Present"
  description    text        check (description is null or char_length(description) <= 4000),
  display_order  integer     not null default 0 check (display_order >= 0),
  published      boolean     not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists experience_public_idx
  on public.experience (published, display_order, created_at desc);
create index if not exists experience_write_idx
  on public.experience (display_order);

drop trigger if exists experience_touch_updated_at on public.experience;
create trigger experience_touch_updated_at
  before update on public.experience
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- 6. achievements & certificates
-- ---------------------------------------------------------------------------
create table if not exists public.achievements (
  id             uuid        primary key default gen_random_uuid(),
  title          text        not null check (char_length(title) between 1 and 200),
  description    text        check (description is null or char_length(description) <= 2000),
  achieved_on    date        check (achieved_on is null or achieved_on <= current_date),
  image_url      text        check (image_url is null or image_url like 'https://%'),
  display_order  integer     not null default 0 check (display_order >= 0),
  published      boolean     not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists achievements_public_idx
  on public.achievements (published, display_order, achieved_on desc);
create index if not exists achievements_write_idx
  on public.achievements (display_order);

drop trigger if exists achievements_touch_updated_at on public.achievements;
create trigger achievements_touch_updated_at
  before update on public.achievements
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- 7. social_links
-- ---------------------------------------------------------------------------
create table if not exists public.social_links (
  id            uuid        primary key default gen_random_uuid(),
  platform      text        not null check (platform in ('github', 'linkedin', 'leetcode', 'other')),
  label         text        check (label is null or char_length(label) <= 80),
  url           text        not null check (url like 'https://%'),
  display_order integer     not null default 0 check (display_order >= 0),
  published     boolean     not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists social_links_public_idx
  on public.social_links (published, display_order);
create index if not EXISTS social_links_write_idx
  on public.social_links (platform, display_order);

drop trigger if exists social_links_touch_updated_at on public.social_links;
create trigger social_links_touch_updated_at
  before update on public.social_links
  for each row execute function app.set_updated_at();
