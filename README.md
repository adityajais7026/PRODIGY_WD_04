# PRODIGY_WD_04 — Personal Portfolio Website

A professional personal portfolio built for **Prodigy Infotech Web Development Internship — Task 04**.

> **Task 04 brief:** Build a personal portfolio website that showcases your skills, projects, and
> accomplishments as a web developer. Design an attractive and visually appealing layout that captures
> visitors' attention. Include a home page with a captivating headline, professional photo, and summary
> of your skills. Provide an "About Me" section with a detailed background, education, and professional
> experience.

The result is a lightweight, recruiter-friendly portfolio for **Aditya Prakash**, a B.Tech Computer
Science and Engineering student at Galgotias University and an aspiring software developer.

## Overview

The site is a single-page portfolio built with plain HTML5, CSS3 and vanilla JavaScript — no
frameworks, no build step and no external libraries. It presents a clear story: who I am, what I'm
studying, the tools I work with, the projects I've built or am building, and how to get in touch.

## Features

- **Sticky, responsive navigation** with smooth scrolling, scroll-spy active-section highlighting,
  a keyboard-accessible mobile hamburger menu (Escape to close) and a skip link.
- **Hero section** with headline, skill summary, introduction, profile photo, call-to-action buttons
  and GitHub / LinkedIn / LeetCode links.
- **About Me** with background, education card (B.Tech CSE, Galgotias University, 2024 – Present,
  CGPA 8.23 / 10) and quick facts.
- **Skills** grouped into Programming, Computer Science, Web Development, and Database & Tools.
- **Experience** timeline covering the Prodigy Infotech Web Development Internship and self-directed
  project work.
- **Projects** grid with MineGuardAI, the Food Recipe Sharing App and the Task 02 Stopwatch app
  (with working GitHub and Live Demo links).
- **Achievements** covering the 75 Days DSA Challenge, LeetCode practice and the internship.
- **Coding profiles** cards for GitHub, LinkedIn and LeetCode.
- **Contact** section with profile links and a front-end-only contact form (clearly labelled as not
  connected to a backend).
- **Accessibility**: semantic landmarks, correct heading order, visible focus states, alt text,
  `aria-expanded` / `aria-controls` on the menu button, labelled form fields and
  `prefers-reduced-motion` support.
- **Performance**: no libraries, no build step, one small CSS file, one small JS file and two
  optimised images (profile photo + a real screenshot of the live Task 02 app for its project card).
- **UI**: premium light design system — deep navy typography, indigo accent with one restrained
  violet gradient, subtle dot-texture hero, concept preview panels, refined cards, timeline,
  hover states and scroll-reveal animations (all disabled under `prefers-reduced-motion`).

## Technologies

- HTML5
- CSS3 (custom properties, grid, flexbox, container-free responsive layout)
- Vanilla JavaScript (IntersectionObserver for scroll-spy and reveal animations)
- Google Fonts (Manrope, display=swap) as the only external resource
- No frameworks, no build tools, no JS libraries

## Project structure

```text
PRODIGY_WD_04/
├── index.html      # Page markup and content
├── style.css       # Design system, layout and responsive rules
├── script.js       # Navigation, scroll-spy, reveal, form handling
├── assets/
│   ├── profile.jpg # Profile photo
│   └── stopwatch-preview.jpg # Real screenshot of the live Task 02 app
└── README.md
```

## Run locally

No installation or build step is required.

1. Clone the repository:

   ```bash
   git clone https://github.com/adityajais7026/PRODIGY_WD_04.git
   cd PRODIGY_WD_04
   ```

2. Open `index.html` in a browser, or serve the folder locally:

   ```bash
   python3 -m http.server 8000
   ```

3. Visit `http://localhost:8000`.

## Live Demo

GitHub Pages URL: [https://adityajais7026.github.io/PRODIGY_WD_04/](https://adityajais7026.github.io/PRODIGY_WD_04/)

> The site is deployed and served by GitHub Pages from the `main` branch root.

## Notes

- **Profile photo:** `assets/profile.jpg` currently holds a neutral "AP" placeholder image. Replace
  it with your own photo using the same filename; the layout will pick it up automatically.
- **Email address:** no email address is published yet, so the contact section shows
  "Email address to be added" and the form is a UI-only demo. It does not send messages.
- **Project links:** only links that actually exist are shown. MineGuardAI and the Food Recipe Sharing
  App do not have public repositories or live URLs listed yet.

## Author

**Aditya Prakash**
B.Tech Computer Science and Engineering, Galgotias University

- GitHub: [github.com/adityajais7026](https://github.com/adityajais7026)
- LinkedIn: [linkedin.com/in/adityaprakash7026](https://www.linkedin.com/in/adityaprakash7026/)
- LeetCode: [leetcode.com/u/adityajais7026](https://leetcode.com/u/adityajais7026/)

## License

This project is shared for portfolio and learning purposes. © 2026 Aditya Prakash.
