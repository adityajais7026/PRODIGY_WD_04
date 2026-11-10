/* ==========================================================================
   Aditya Prakash — Personal Portfolio
   Minimal vanilla JavaScript: navigation, active-section highlighting,
   scroll reveal, image fallback and a front-end-only contact form.
   ========================================================================== */

(function () {
  "use strict";

  var root = document.documentElement;
  root.classList.add("js");

  var prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------------------------------------------------------------- Header */
  var header = document.getElementById("site-header");

  function onScroll() {
    if (!header) return;
    header.classList.toggle("is-scrolled", window.scrollY > 8);
  }

  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  /* ------------------------------------------------------- Mobile menu --- */
  var toggle = document.getElementById("nav-toggle");
  var nav = document.getElementById("primary-navigation");
  var navLinks = nav ? Array.prototype.slice.call(nav.querySelectorAll(".nav-link")) : [];
  var mq = window.matchMedia("(max-width: 900px)");

  function isMenuOpen() {
    return toggle && toggle.getAttribute("aria-expanded") === "true";
  }

  function openMenu() {
    if (!toggle || !nav) return;
    toggle.setAttribute("aria-expanded", "true");
    toggle.setAttribute("aria-label", "Close navigation menu");
    nav.classList.add("is-open");
    document.body.classList.add("menu-open");
  }

  function closeMenu(returnFocus) {
    if (!toggle || !nav) return;
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-label", "Open navigation menu");
    nav.classList.remove("is-open");
    document.body.classList.remove("menu-open");
    if (returnFocus) toggle.focus();
  }

  if (toggle && nav) {
    toggle.addEventListener("click", function () {
      if (isMenuOpen()) {
        closeMenu(false);
      } else {
        openMenu();
      }
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && isMenuOpen()) {
        closeMenu(true);
      }
    });

    document.addEventListener("click", function (event) {
      if (!isMenuOpen()) return;
      if (nav.contains(event.target) || toggle.contains(event.target)) return;
      closeMenu(false);
    });

    nav.addEventListener("click", function (event) {
      if (event.target.closest(".nav-link")) closeMenu(false);
    });

    var onDesktop = function (event) {
      if (!event.matches) closeMenu(false);
    };

    if (typeof mq.addEventListener === "function") {
      mq.addEventListener("change", onDesktop);
    } else if (typeof mq.addListener === "function") {
      mq.addListener(onDesktop);
    }
  }

  /* ------------------------------------------- Active section highlight --- */
  var sections = Array.prototype.slice
    .call(document.querySelectorAll("main section[id]"))
    .filter(function (section) {
      return navLinks.some(function (link) {
        return link.getAttribute("href") === "#" + section.id;
      });
    });

  function setActiveLink(id) {
    navLinks.forEach(function (link) {
      var isActive = link.getAttribute("href") === "#" + id;
      link.classList.toggle("is-active", isActive);
      if (isActive) {
        link.setAttribute("aria-current", "true");
      } else {
        link.removeAttribute("aria-current");
      }
    });
  }

  if (sections.length && "IntersectionObserver" in window) {
    var visible = {};

    var navObserver = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          visible[entry.target.id] = entry.isIntersecting ? entry.intersectionRatio : 0;
        });

        var bestId = null;
        var bestRatio = 0;
        sections.forEach(function (section) {
          var ratio = visible[section.id] || 0;
          if (ratio > bestRatio) {
            bestRatio = ratio;
            bestId = section.id;
          }
        });

        if (bestId) setActiveLink(bestId);
      },
      {
        rootMargin: "-" + (header ? header.offsetHeight + 8 : 76) + "px 0px -45% 0px",
        threshold: [0, 0.15, 0.35, 0.6, 0.85]
      }
    );

    sections.forEach(function (section) {
      navObserver.observe(section);
    });
  }

  /* ------------------------------------------------------ Scroll reveal --- */
  // Exposed as a hook so dynamically rendered content (app-data.js) is
  // revealed with the same animation instead of staying invisible.
  function setupReveal() {
    var revealItems = Array.prototype.slice.call(
      document.querySelectorAll("[data-reveal]:not([data-reveal-bound])")
    );

    if (!revealItems.length) return;

    revealItems.forEach(function (item) {
      item.setAttribute("data-reveal-bound", "true");
    });

    if (prefersReducedMotion || !("IntersectionObserver" in window)) {
      revealItems.forEach(function (item) {
        item.classList.add("is-visible");
      });
      return;
    }

    // Stagger items that share a grid container.
    revealItems.forEach(function (item) {
      var siblings = item.parentElement
        ? Array.prototype.slice.call(
            item.parentElement.querySelectorAll(":scope > [data-reveal]")
          )
        : [];
      var index = siblings.indexOf(item);
      if (index > 0) {
        item.style.setProperty("--reveal-delay", Math.min(index, 3) * 70 + "ms");
      }
    });

    var revealObserver = new IntersectionObserver(
      function (entries, observer) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        });
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 }
    );

    revealItems.forEach(function (item) {
      revealObserver.observe(item);
    });
  }

  setupReveal();
  window.portfolioRefreshReveal = setupReveal;
  document.addEventListener("portfolio:content-updated", setupReveal);

  /* --------------------------------------------- Profile photo fallback --- */
  var portraitImg = document.querySelector(".portrait img");

  if (portraitImg) {
    var useFallback = function () {
      var portrait = portraitImg.closest(".portrait");
      if (portrait) portrait.classList.add("is-fallback");
    };

    portraitImg.addEventListener("error", useFallback);

    if (portraitImg.complete && portraitImg.naturalWidth === 0) {
      useFallback();
    }
  }

  /* ------------------------------------------------------ Contact form --- */
  var form = document.getElementById("contact-form");
  var status = document.getElementById("form-status");

  if (form) {
    var fields = Array.prototype.slice.call(form.querySelectorAll("input, textarea"));

    var clearFieldState = function (field) {
      field.removeAttribute("aria-invalid");
    };

    fields.forEach(function (field) {
      field.addEventListener("input", function () {
        clearFieldState(field);
        if (status) {
          status.textContent = "";
          status.className = "form-status";
        }
      });
    });

    form.addEventListener("submit", function (event) {
      event.preventDefault();

      var firstInvalid = null;

      fields.forEach(function (field) {
        if (field.checkValidity()) {
          clearFieldState(field);
        } else {
          field.setAttribute("aria-invalid", "true");
          if (!firstInvalid) firstInvalid = field;
        }
      });

      if (!status) return;

      if (firstInvalid) {
        status.textContent = "Please fill in your name, a valid email address and a message.";
        status.className = "form-status is-error";
        firstInvalid.focus();
        return;
      }

      status.textContent =
        "This form isn't connected to a backend yet, so your message was not sent. Please reach out through LinkedIn or GitHub.";
      status.className = "form-status is-notice";
    });
  }
})();
