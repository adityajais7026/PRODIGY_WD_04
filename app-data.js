/* ==========================================================================
   Aditya Prakash — Portfolio public data layer
   --------------------------------------------------------------------------
   Fetches *published* content from Supabase (PostgREST, publishable key only)
   and renders it into the existing markup. Nothing is restyled: the markup
   written here reuses the portfolio's own classes.

   Behaviour:
     * all tables are requested in parallel; any failed request keeps the
       static content exactly as shipped (graceful fallback),
     * if the database is reachable but contains no published rows at all,
       the static content is also kept (a fresh install is not an empty site),
     * once the database has content, it becomes the source of truth — so
       deletions and unpublishing are reflected on the next page load,
     * row-level security remains the enforcement: this uses the anon key and
       only ever asks for `published=eq.true`.
   ========================================================================== */

(function () {
  "use strict";

  var CFG = window.PORTFOLIO_CONFIG || {};
  var BASE = String(CFG.supabaseUrl || "").replace(/\/+$/, "");
  var KEY = CFG.supabaseKey || "";
  if (!BASE || !KEY || typeof window.fetch !== "function") return;

  var TIMEOUT_MS = 8000;
  var HEADERS = {
    apikey: KEY,
    Authorization: "Bearer " + KEY,
    Accept: "application/json",
  };

  var QUERIES = {
    profile: "profiles?select=*&published=eq.true&limit=1",
    education: "education?select=*&published=eq.true&order=display_order.asc,start_date.desc.nullslast",
    skills: "skills?select=*&published=eq.true&order=display_order.asc,name.asc",
    projects: "projects?select=*&published=eq.true&order=featured.desc,display_order.asc,created_at.desc",
    experience: "experience?select=*&published=eq.true&order=display_order.asc,created_at.desc",
    achievements: "achievements?select=*&published=eq.true&order=display_order.asc,achieved_on.desc.nullslast",
    social_links: "social_links?select=*&published=eq.true&order=display_order.asc",
  };

  var AVAILABILITY = {
    available: "Available for work",
    open_to_work: "Open to work",
    busy: "Busy right now",
    unavailable: "Not available",
  };

  var ICONS = {
    github:
      '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 .5C5.73.5.5 5.73.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.55v-2.17c-3.2.7-3.88-1.54-3.88-1.54-.52-1.33-1.28-1.68-1.28-1.68-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.23-1.28-5.23-5.7 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .96-.31 3.14 1.18a10.9 10.9 0 0 1 2.86-.38c.97 0 1.95.13 2.86.38 2.18-1.49 3.14-1.18 3.14-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.43-2.69 5.41-5.25 5.69.41.36.78 1.06.78 2.14v3.17c0 .3.21.67.8.55A11.51 11.51 0 0 0 23.5 12C23.5 5.73 18.27.5 12 .5z" /></svg>',
    linkedin:
      '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.13 1.45-2.13 2.94v5.67H9.35V9h3.42v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.45v6.29ZM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12ZM7.12 20.45H3.55V9h3.57v11.45ZM22.22 0H1.77C.79 0 0 .77 0 1.72v20.56C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.72V1.72C24 .77 23.2 0 22.22 0Z" /></svg>',
    leetcode:
      '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M9.4 16.6 4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4Zm5.2 0 4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4Z" /></svg>',
    other:
      '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1" /><path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1" /></svg>',
  };

  // Keep the published order of skill groups stable and design-led.
  var CATEGORY_ORDER = ["Languages", "Frameworks & Libraries", "Databases", "Tools", "Concepts"];

  var SKILL_ICONS = {
    Languages:
      '<svg viewBox="0 0 24 24"><path d="m6 17-4-5 4-5" /><path d="m18 7 4 5-4 5" /><path d="M13 4 11 20" /></svg>',
    "Frameworks & Libraries":
      '<svg viewBox="0 0 24 24"><path d="m12 2 9 5-9 5-9-5 9-5Z" /><path d="m3 12 9 5 9-5" /><path d="m3 17 9 5 9-5" /></svg>',
    Databases:
      '<svg viewBox="0 0 24 24"><ellipse cx="12" cy="5.5" rx="8" ry="3" /><path d="M4 5.5V12c0 1.66 3.58 3 8 3s8-1.34 8-3V5.5" /><path d="M4 12v6.5c0 1.66 3.58 3 8 3s8-1.34 8-3V12" /></svg>',
    Tools:
      '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18" /><path d="M10 10v10" /></svg>',
    Concepts:
      '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 8v4l3 2" /></svg>',
  };

  /* ---------------------------------- utils -------------------------------- */
  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function setText(selector, text, root) {
    if (!text) return;
    var node = (root || document).querySelector(selector);
    if (node) node.textContent = text;
  }

  function emptyNote(text) {
    return '<p class="db-empty">' + esc(text) + "</p>";
  }

  function yearOf(date) {
    return date ? String(date).slice(0, 4) : "";
  }

  function dateRange(row) {
    var start = yearOf(row.start_date);
    var end = row.currently_enrolled ? "Present" : yearOf(row.end_date);
    if (start && end) return start + " – " + end;
    return start || end;
  }

  function handleFor(url) {
    try {
      var parsed = new URL(url);
      var path = parsed.pathname.replace(/\/+$/, "").replace(/^\//, "");
      if (parsed.hostname.indexOf("github.com") > -1) return "@" + path;
      if (parsed.hostname.indexOf("leetcode.com") > -1) return path;
      if (parsed.hostname.indexOf("linkedin.com") > -1) return path;
      return parsed.hostname + (path ? "/" + path : "");
    } catch (error) {
      return url;
    }
  }

  function labelsFor(link) {
    var platform = String(link.platform || "other");
    var label = link.label || platform.charAt(0).toUpperCase() + platform.slice(1);
    return { platform: platform, label: label, icon: ICONS[platform] || ICONS.other };
  }

  function initialsOf(text) {
    var words = String(text || "").trim().split(/\s+/).filter(Boolean);
    if (!words.length) return "PR";
    var first = words[0].charAt(0);
    var second = words.length > 1 ? words[1].charAt(0) : words[0].charAt(1) || "";
    return (first + second).toUpperCase();
  }

  function fetchTable(path, signal) {
    return fetch(BASE + "/rest/v1/" + path, { headers: HEADERS, signal: signal }).then(function (response) {
      if (!response.ok) throw new Error("Supabase responded " + response.status + " for " + path);
      return response.json();
    });
  }

  /* -------------------------------- rendering ------------------------------ */
  function applyProfile(profile) {
    if (!profile) return;

    setText(".brand-name", profile.full_name);
    setText(".brand-role", profile.title);
    setText(".footer-name", profile.full_name);
    setText("#hero-title", profile.full_name);
    setText(".hero-headline", profile.title);
    setText(".hero-intro", profile.intro);
    setText(".contact-name", profile.full_name);
    setText(".contact-role", profile.title);

    if (profile.avatar_url) {
      var portrait = document.querySelector(".portrait img");
      if (portrait) {
        portrait.src = profile.avatar_url;
        portrait.alt = profile.full_name || portrait.alt;
      }
    }

    var badge = document.querySelector(".hero-badge-value");
    if (badge && AVAILABILITY[profile.availability_status]) {
      badge.textContent = AVAILABILITY[profile.availability_status];
    }

    var actions = document.querySelector(".hero-actions");
    if (actions) {
      var resume = actions.querySelector("#hero-resume");
      if (profile.resume_url) {
        if (!resume) {
          resume = document.createElement("a");
          resume.id = "hero-resume";
          resume.className = "btn btn-ghost";
          resume.target = "_blank";
          resume.rel = "noopener noreferrer";
          actions.appendChild(resume);
        }
        resume.href = profile.resume_url;
        resume.textContent = "Résumé";
        resume.hidden = false;
      } else if (resume) {
        resume.remove();
      }
    }

    var emailValue = document.querySelector(".contact-email-value");
    if (emailValue && profile.email) {
      emailValue.innerHTML =
        '<a href="mailto:' + esc(profile.email) + '">' + esc(profile.email) + "</a>";
    }

    var copy = document.querySelector(".about-copy");
    if (copy && profile.about) {
      var paragraphs = String(profile.about)
        .split(/\n{2,}/)
        .map(function (part) {
          return part.trim();
        })
        .filter(Boolean)
        .slice(0, 3);

      if (paragraphs.length) {
        Array.prototype.slice.call(copy.querySelectorAll(":scope > p")).forEach(function (node) {
          if (!node.classList.contains("about-note")) node.remove();
        });
        var anchor = copy.querySelector(".about-points");
        paragraphs.forEach(function (text) {
          var paragraph = document.createElement("p");
          paragraph.textContent = text;
          copy.insertBefore(paragraph, anchor || null);
        });
      }
    }
  }

  function educationCard(row) {
    var meta = [];
    if (row.grade) {
      meta.push(
        '<div><span class="meta-label">CGPA / Grade</span><span class="meta-value">' +
          esc(row.grade) +
          "</span></div>"
      );
    }
    meta.push(
      '<div><span class="meta-label">Status</span><span class="meta-value">' +
        (row.currently_enrolled ? "Currently pursuing" : "Completed") +
        "</span></div>"
    );

    return (
      '<div class="card education-card">' +
      '<p class="card-label">Education</p>' +
      '<h3 class="card-title">' +
      esc(row.degree) +
      "</h3>" +
      '<p class="edu-school">' +
      esc(row.institution) +
      "</p>" +
      '<p class="edu-dates">' +
      esc(dateRange(row)) +
      "</p>" +
      '<div class="edu-meta">' +
      meta.join("") +
      "</div></div>"
    );
  }

  function applyEducation(rows) {
    var side = document.querySelector(".about-side");
    if (!side) return;
    var facts = side.querySelector(".facts-card");

    Array.prototype.slice.call(side.querySelectorAll(".education-card")).forEach(function (node) {
      node.remove();
    });
    var note = side.querySelector(".db-empty");
    if (note) note.remove();

    if (!rows.length) {
      var empty = document.createElement("div");
      empty.innerHTML = emptyNote("Education entries will appear here once published.");
      if (facts) side.insertBefore(empty.firstChild, facts);
      return;
    }

    rows.slice(0, 3).forEach(function (row) {
      var wrapper = document.createElement("div");
      wrapper.innerHTML = educationCard(row);
      side.insertBefore(wrapper.firstChild, facts || null);
    });
  }

  function applySkills(rows) {
    var grid = document.querySelector("#skills .grid");
    if (!grid) return;

    if (!rows.length) {
      grid.innerHTML = emptyNote("Skills will appear here once published.");
      return;
    }

    var groups = [];
    var byCategory = {};
    rows.forEach(function (row) {
      if (!byCategory[row.category]) {
        byCategory[row.category] = [];
        groups.push(row.category);
      }
      byCategory[row.category].push(row);
    });

    groups.sort(function (a, b) {
      var ai = CATEGORY_ORDER.indexOf(a);
      var bi = CATEGORY_ORDER.indexOf(b);
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
    });

    grid.innerHTML = groups
      .map(function (category) {
        var chips = byCategory[category]
          .map(function (skill) {
            return '<li class="chip">' + esc(skill.name) + "</li>";
          })
          .join("");
        return (
          '<article class="card skill-card" data-reveal>' +
          '<h3 class="skill-title"><span class="skill-icon" aria-hidden="true">' +
          (SKILL_ICONS[category] || SKILL_ICONS.Tools) +
          "</span>" +
          esc(category) +
          "</h3>" +
          '<ul class="chip-list">' +
          chips +
          "</ul></article>"
        );
      })
      .join("");
  }

  function applyExperience(rows) {
    var timeline = document.querySelector("#experience .timeline");
    if (!timeline) return;

    if (!rows.length) {
      timeline.innerHTML = '<li class="db-empty">Experience entries will appear here once published.</li>';
      return;
    }

    timeline.innerHTML = rows
      .map(function (row) {
        return (
          '<li class="timeline-item" data-reveal>' +
          '<span class="timeline-marker" aria-hidden="true"></span>' +
          '<div class="card timeline-card">' +
          '<div class="timeline-top"><h3 class="timeline-role">' +
          esc(row.role) +
          '</h3><span class="pill pill-soft">' +
          esc(row.period) +
          "</span></div>" +
          '<p class="timeline-org">' +
          esc(row.organization) +
          "</p>" +
          (row.description ? '<p class="timeline-desc">' + esc(row.description) + "</p>" : "") +
          "</div></li>"
        );
      })
      .join("");
  }

  function projectPreview(row) {
    if (row.image_url) {
      return (
        '<div class="project-preview"><img src="' +
        esc(row.image_url) +
        '" alt="' +
        esc(row.name + " preview") +
        '" width="1280" height="720" loading="lazy" /></div>'
      );
    }
    return (
      '<div class="project-preview project-preview--concept project-preview--db" aria-hidden="true">' +
      '<span class="preview-chrome"><i></i><i></i><i></i></span>' +
      '<span class="preview-letter">' +
      esc(initialsOf(row.name)) +
      "</span>" +
      '<span class="preview-scanline">Project</span></div>'
    );
  }

  function applyProjects(rows) {
    var grid = document.querySelector("#projects .project-grid");
    if (!grid) return;

    if (!rows.length) {
      grid.innerHTML = emptyNote("Projects will appear here once published.");
      return;
    }

    grid.innerHTML = rows
      .map(function (row) {
        var chips = (row.technologies || []).length
          ? '<ul class="chip-list chip-list-sm" aria-label="Technologies">' +
            row.technologies
              .map(function (tech) {
                return '<li class="chip">' + esc(tech) + "</li>";
              })
              .join("") +
            "</ul>"
          : "";

        var actions = [];
        if (row.github_url) {
          actions.push(
            '<a class="btn btn-small btn-ghost" href="' +
              esc(row.github_url) +
              '" target="_blank" rel="noopener noreferrer">' +
              ICONS.github +
              " GitHub</a>"
          );
        }
        if (row.live_url) {
          actions.push(
            '<a class="btn btn-small btn-primary" href="' +
              esc(row.live_url) +
              '" target="_blank" rel="noopener noreferrer">Live Demo' +
              '<svg class="btn-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg></a>'
          );
        }

        return (
          '<article class="card project-card" data-reveal>' +
          projectPreview(row) +
          '<div class="project-top"><span class="pill ' +
          (row.featured ? "pill-status" : "pill-soft") +
          '">' +
          (row.featured ? "Featured" : "Project") +
          "</span></div>" +
          '<h3 class="project-title">' +
          esc(row.name) +
          "</h3>" +
          (row.description ? '<p class="project-desc">' + esc(row.description) + "</p>" : "") +
          chips +
          '<div class="project-actions">' +
          (actions.length ? actions.join("") : '<span class="link-muted">Repository not published yet</span>') +
          "</div></article>"
        );
      })
      .join("");
  }

  function applyAchievements(rows) {
    var grids = document.querySelectorAll("#achievements .grid");
    var grid = grids[grids.length - 1];
    if (!grid) return;

    if (!rows.length) {
      grid.innerHTML = emptyNote("Achievements will appear here once published.");
      return;
    }

    grid.innerHTML = rows
      .map(function (row) {
        var link = row.image_url
          ? '<a class="text-link" href="' +
            esc(row.image_url) +
            '" target="_blank" rel="noopener noreferrer">View certificate<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 17 17 7M9 7h8v8" /></svg></a>'
          : "";
        return (
          '<article class="card achievement-card" data-reveal>' +
          '<span class="achievement-mark" aria-hidden="true">' +
          esc(initialsOf(row.title)) +
          "</span>" +
          '<h3 class="achievement-title">' +
          esc(row.title) +
          "</h3>" +
          (row.description ? '<p class="achievement-desc">' + esc(row.description) + "</p>" : "") +
          (row.achieved_on ? '<p class="achievement-desc">' + esc(yearOf(row.achieved_on)) + "</p>" : "") +
          link +
          "</article>"
        );
      })
      .join("");
  }

  function applySocialLinks(rows) {
    if (!rows.length) return;

    var pills = document.querySelector(".social-pills");
    if (pills) {
      pills.innerHTML = rows
        .map(function (link) {
          var meta = labelsFor(link);
          return (
            '<li><a class="social-pill" href="' +
            esc(link.url) +
            '" target="_blank" rel="noopener noreferrer">' +
            meta.icon +
            "<span>" +
            esc(meta.label) +
            "</span></a></li>"
          );
        })
        .join("");
    }

    var profiles = document.querySelectorAll("#profiles .grid");
    var profileGrid = profiles[profiles.length - 1];
    if (profileGrid) {
      profileGrid.innerHTML = rows
        .map(function (link) {
          var meta = labelsFor(link);
          return (
            '<a class="card profile-card" href="' +
            esc(link.url) +
            '" target="_blank" rel="noopener noreferrer" data-reveal>' +
            '<span class="profile-icon" aria-hidden="true">' +
            meta.icon +
            "</span>" +
            '<span class="profile-body"><span class="profile-name">' +
            esc(meta.label) +
            '</span><span class="profile-handle">' +
            esc(handleFor(link.url)) +
            "</span></span>" +
            '<svg class="profile-arrow" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 17 17 7M9 7h8v8" /></svg></a>'
          );
        })
        .join("");
    }

    var contactLinks = document.querySelector(".contact-links");
    if (contactLinks) {
      contactLinks.innerHTML = rows
        .map(function (link) {
          var meta = labelsFor(link);
          return (
            '<li><a href="' +
            esc(link.url) +
            '" target="_blank" rel="noopener noreferrer">' +
            meta.icon +
            esc(meta.label) +
            "</a></li>"
          );
        })
        .join("");
    }

    var footerLinks = document.querySelector(".footer-links");
    if (footerLinks) {
      footerLinks.innerHTML = rows
        .map(function (link) {
          var meta = labelsFor(link);
          return (
            '<li><a href="' +
            esc(link.url) +
            '" target="_blank" rel="noopener noreferrer">' +
            meta.icon +
            esc(meta.label) +
            "</a></li>"
          );
        })
        .join("");
    }
  }

  /* ----------------------------------- boot -------------------------------- */
  function load() {
    var controller = new AbortController();
    var timer = setTimeout(function () {
      controller.abort();
    }, TIMEOUT_MS);

    var keys = Object.keys(QUERIES);
    var requests = keys.map(function (key) {
      return fetchTable(QUERIES[key], controller.signal);
    });

    Promise.all(requests)
      .then(function (results) {
        clearTimeout(timer);
        var data = {};
        keys.forEach(function (key, index) {
          data[key] = results[index];
        });

        var profile = Array.isArray(data.profile) ? data.profile[0] || null : null;
        var hasContent =
          Boolean(profile) ||
          keys.some(function (key) {
            return key !== "profile" && Array.isArray(data[key]) && data[key].length > 0;
          });

        if (!hasContent) return; // fresh install: keep the static content

        applyProfile(profile);
        applyEducation(data.education || []);
        applySkills(data.skills || []);
        applyExperience(data.experience || []);
        applyProjects(data.projects || []);
        applyAchievements(data.achievements || []);
        applySocialLinks(data.social_links || []);

        document.documentElement.setAttribute("data-content-source", "supabase");
        document.dispatchEvent(new CustomEvent("portfolio:content-updated"));
      })
      .catch(function (error) {
        clearTimeout(timer);
        // Static content stays in place; the site never depends on Supabase.
        if (window.console && console.warn) {
          console.warn("[portfolio] Supabase content unavailable — showing static content.", error);
        }
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", load);
  } else {
    load();
  }
})();
