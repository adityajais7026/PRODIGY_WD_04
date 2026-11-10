# PRODIGY_WD_04 — Personal Portfolio Website

A professional personal portfolio built for **Prodigy Infotech Web Development Internship — Task 04**.

> **Task 04 brief:** Build a personal portfolio website that showcases your skills, projects, and
> accomplishments as a web developer. Design an attractive and visually appealing layout that captures
> visitors' attention. Include a home page with a captivating headline, professional photo, and summary
> of your skills. Provide an "About Me" section with a detailed background, education, and professional
> experience.

The result is a recruiter-friendly portfolio for **Aditya Prakash**, a B.Tech Computer Science and
Engineering student at Galgotias University and an aspiring software developer.

- **Live site:** https://adityajais7026.github.io/PRODIGY_WD_04/
- **Admin dashboard:** https://adityajais7026.github.io/PRODIGY_WD_04/admin/

## Overview

The public site is a single page built with plain HTML5, CSS3 and vanilla JavaScript — no framework,
no build step and no bundler. All portfolio content (profile, education, skills, projects, experience,
achievements and social links) is managed from the admin dashboard, stored in **Supabase**
(PostgreSQL + PostgREST + Auth + Storage), and read at runtime by `app-data.js`.

The markup in `index.html` ships with the current published content, so the page is complete even if
the API is slow or unreachable: any failed request, or a database with no published rows, leaves the
static content exactly as it is.

## Sections

Home (hero) → About → Skills → Experience → Projects → Achievements → Coding profiles → Contact.

- **Hero** — name, headline, skill summary line, introduction, availability badge, "View Projects",
  "About Me", an optional **Résumé** button (shown only when a résumé is uploaded) and GitHub /
  LinkedIn / LeetCode links.
- **About** — background paragraphs from the profile record, focus points, an education card
  (degree, institution, dates, CGPA, status) and quick facts.
- **Skills** — published skills grouped by category (Languages, Frameworks & Libraries, Databases,
  Tools, Concepts), each group rendered with an icon.
- **Experience** — timeline of roles with organization, period label and description.
- **Projects** — cards with preview image (or a concept panel when no screenshot exists),
  description, technology chips and GitHub / Live Demo buttons for the links that actually exist.
- **Achievements** — cards for practice milestones and internship work, with an optional certificate
  link and year when supplied.
- **Coding profiles** — cards generated from the published social links.
- **Contact** — email address, profile links and a clearly labelled front-end-only demo form.

## Features

- **Sticky, responsive navigation** with smooth scrolling, scroll-spy active-section highlighting, a
  keyboard-accessible mobile menu (Escape to close) and a skip link.
- **Content management** — every section above is editable from `/admin/` without touching code.
- **Graceful degradation** — a failed or empty Supabase response keeps the built-in static content; a
  broken image URL falls back to a concept panel (projects) or the initials portrait (hero).
- **Accessibility** — semantic landmarks, correct heading order, visible focus states, alt text,
  `aria-expanded` / `aria-controls` on the menu button, labelled form fields and
  `prefers-reduced-motion` support for all reveal animations.
- **Performance** — no libraries and no build step; one stylesheet, one small page script, one data
  layer and two images. Google Fonts (Manrope, `display=swap`) is the only external resource.
- **Design system** — deep navy typography, indigo accent with a restrained violet gradient, subtle
  dot-texture hero, concept preview panels, refined cards, timeline and hover states.

## How content is loaded

`config.js` holds the Supabase project URL and the **publishable** (anon) key — the only credential
shipped to the browser. `app-data.js` then requests every table in parallel and only ever asks for
`published=eq.true`; row-level security is the enforcement, so drafts and unpublished rows are not
readable by the public.

```
index.html  →  config.js (URL + publishable key)
            →  app-data.js  →  Supabase PostgREST  →  profiles / education / skills /
                                                     projects / experience / achievements /
                                                     social_links
```

- Content becomes the source of truth once the database has rows: deleting or unpublishing a record is
  reflected on the next page load.
- Queries are ordered (`display_order`, `featured`, dates) so the visual order stays intentional.
- Project cards reuse the status label declared in their own markup (for example *In Development*) and
  the screenshot bundled in `assets/`, unless the record has an uploaded `image_url`.

## Admin dashboard (`/admin/`)

A single-page dashboard, served from the same repository, for managing the published content.

- **Sign-in** with Supabase Auth email + password. Public sign-up is disabled on the project, so
  accounts are created in the Supabase dashboard; every write is additionally restricted by RLS to
  administrators.
- **Sections:** Overview, Profile, Education, Skills, Experience, Projects, Achievements, Social links
  and Settings (résumé upload, password change, sign out of this device or all devices).
- **CRUD** for every content table, with publish/unpublish, display order and a featured flag for
  projects.
- **Uploads** to Supabase Storage buckets: `project-shots` (project screenshots), `profile-photos`,
  `resume` (PDF) and `certificates`.
- The dashboard exposes no credentials: it uses the same publishable key and the signed-in session,
  and the database policies do the authorising.

## Database

Seven content tables — `profiles`, `education`, `skills`, `projects`, `experience`, `achievements`,
`social_links` — plus administrator helpers and storage policies. The SQL used to provision them lives
in `supabase/migrations/` (`0001` core helpers, `0002` content tables, `0003` RLS policies, `0004`
storage buckets and policies, `0005` admin RPC). These scripts are kept alongside the project for
reference and are not part of the deployed page.

## Project structure

```text
PRODIGY_WD_04/
├── index.html              # Public page markup and fallback content
├── style.css               # Design system, layout and responsive rules
├── script.js               # Navigation, scroll-spy, reveal, image fallback, form handling
├── app-data.js             # Public data layer: reads published rows and renders them
├── config.js               # Supabase URL + publishable key
├── admin/
│   ├── index.html          # Dashboard shell
│   ├── admin.css           # Dashboard styles
│   └── admin.js            # Auth, routing, CRUD, uploads
├── assets/
│   ├── profile.jpg         # Portrait fallback (neutral placeholder)
│   └── stopwatch-preview.jpg  # Screenshot of the live Task 02 app
├── supabase/migrations/    # Local SQL scripts for the schema and policies
└── README.md
```

## Run locally

No installation or build step is required.

```bash
git clone https://github.com/adityajais7026/PRODIGY_WD_04.git
cd PRODIGY_WD_04
python3 -m http.server 8000
```

- Public site: `http://localhost:8000/`
- Dashboard: `http://localhost:8000/admin/` (requires a dashboard account on the Supabase project)

## Deployment

The site is served by **GitHub Pages** from the `main` branch root. Pushing to `main` republishes the
public page and the dashboard; content changes made in `/admin/` appear on the next page load and need
no deployment.

## Current content status

Kept explicit so nothing on the site overstates what exists:

- **Profile photo** — managed from the dashboard: an avatar is uploaded, so the hero shows the
  uploaded photo. `assets/profile.jpg` remains a neutral placeholder used only when no avatar is set
  or the content API is unavailable.
- **Résumé** — uploaded through Settings (PDF). The hero Résumé button appears automatically while
  `resume_url` is set and stays hidden otherwise.
- **Project screenshots** — the Stopwatch card uses `assets/stopwatch-preview.jpg` and falls back to
  it whenever no `image_url` is stored. MineGuardAI and the Food Recipe Sharing App have no
  screenshots yet and render concept panels.
- **Project links** — only links that exist are shown. MineGuardAI and the Food Recipe Sharing App do
  not have public repositories or live URLs listed yet.
- **MineGuardAI** is marked *In Development*; its description describes intended scope, not released
  functionality.
- **Experience** entries use labels ("Internship", "Ongoing") rather than date ranges.
- **Achievements** have no dates or certificate images attached yet.
- **Contact form** is a front-end demo only — it validates input and explains that nothing was sent;
  the email address and profile links are the working contact routes.

## Technologies

HTML5 · CSS3 (custom properties, grid, flexbox) · vanilla JavaScript (IntersectionObserver) ·
Supabase (PostgreSQL, PostgREST, Auth, Storage, Row Level Security) · GitHub Pages ·
Google Fonts. No frameworks, no build tools, no JS libraries.

## Author

**Aditya Prakash**
B.Tech Computer Science and Engineering, Galgotias University

- GitHub: [github.com/adityajais7026](https://github.com/adityajais7026)
- LinkedIn: [linkedin.com/in/adityaprakash7026](https://www.linkedin.com/in/adityaprakash7026/)
- LeetCode: [leetcode.com/u/adityajais7026](https://leetcode.com/u/adityajais7026/)

## License

This project is shared for portfolio and learning purposes. © 2026 Aditya Prakash.
