/* ==========================================================================
   Portfolio admin dashboard — vanilla JS + supabase-js v2 (UMD)
   --------------------------------------------------------------------------
   Security model:
     * the browser only ever holds the publishable (anon) key,
     * sign-in is email + password (no public sign-up exists),
     * every screen loads only after the server confirms the signed-in user
       is in public.administrators (SECURITY DEFINER RPC `current_admin_state`),
     * the real enforcement is Postgres row-level security — the UI is a
       convenience layer, not the security boundary,
     * the dashboard deliberately shows no credentials and stores none.
   ========================================================================== */

(() => {
  "use strict";

  const CFG = window.PORTFOLIO_CONFIG || {};
  const SUPABASE_URL = CFG.supabaseUrl;
  const SUPABASE_KEY = CFG.supabaseKey;

  const BUCKETS = ["profile-photos", "project-shots", "certificates", "resume"];

  const ROUTES = {
    overview: "Overview",
    profile: "Profile",
    education: "Education",
    skills: "Skills",
    projects: "Projects",
    experience: "Experience",
    achievements: "Achievements",
    social: "Social Links",
    settings: "Settings",
    logout: "Logout",
  };

  const state = {
    session: null,
    user: null,
    isAdmin: false,
    route: "overview",
    collection: null,
    rows: [],
    uploads: 0,
    saving: false,
    renderSeq: 0,
  };

  /* ------------------------------- DOM refs ------------------------------- */
  const authView = document.getElementById("auth-view");
  const appView = document.getElementById("app-view");
  const view = document.getElementById("view");
  const crumb = document.getElementById("crumb");
  const toastHost = document.getElementById("toasts");
  const modalHost = document.getElementById("modal-host");
  const sidebar = document.getElementById("sidebar");
  const scrim = document.getElementById("scrim");
  const menuToggle = document.getElementById("menu-toggle");
  const loginForm = document.getElementById("login-form");
  const loginError = document.getElementById("auth-error");
  const loginSubmit = document.getElementById("login-submit");

  /* -------------------------------- Helpers ------------------------------- */
  const $ = (sel, root = document) => root.querySelector(sel);

  function esc(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function cap(text) {
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : "";
  }

  function todayISO() {
    const now = new Date();
    const offset = now.getTimezoneOffset();
    return new Date(now.getTime() - offset * 60000).toISOString().slice(0, 10);
  }

  function fmtDate(value) {
    if (!value) return "";
    const iso = String(value);
    const date = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  }

  function relative(value) {
    if (!value) return "never";
    const mins = Math.round((Date.now() - new Date(value).getTime()) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins} min ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours} h ago`;
    const days = Math.round(hours / 24);
    if (days < 30) return `${days} d ago`;
    return fmtDate(value);
  }

  function truncate(text, max) {
    const clean = String(text || "").replace(/\s+/g, " ").trim();
    return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
  }

  function fmtSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function initials(source) {
    const parts = String(source || "AP")
      .split(/[\s.@_-]+/)
      .filter(Boolean);
    return (parts[0]?.[0] || "A").concat(parts[1]?.[0] || "P").toUpperCase();
  }

  function friendly(error) {
    const msg = (error && (error.message || error.error_description)) || "Something went wrong.";
    if (/permission denied/i.test(msg))
      return "Your account is not permitted to do that. Check that it is in the administrators allowlist.";
    if (/row-level security/i.test(msg))
      return "Blocked by row-level security — sign in with an administrator account.";
    if (/duplicate key/i.test(msg)) return "That record already exists — only one is allowed here.";
    if (/violates check constraint/i.test(msg))
      return `The database rejected a value${error.details ? ` (${error.details})` : ""}.`;
    if (/failed to fetch|networkerror|load failed/i.test(msg))
      return "Cannot reach Supabase — check your internet connection.";
    if (/jwt|token is expired|invalid claim/i.test(msg)) return "Your session expired — please sign in again.";
    return msg;
  }

  function toast(message, kind = "success") {
    const el = document.createElement("div");
    el.className = `toast toast-${kind}`;
    el.setAttribute("role", kind === "error" ? "alert" : "status");
    el.textContent = message;
    toastHost.appendChild(el);
    setTimeout(() => {
      el.style.transition = "opacity .18s ease, transform .18s ease";
      el.style.opacity = "0";
      el.style.transform = "translateY(6px)";
      setTimeout(() => el.remove(), 200);
    }, kind === "error" ? 6500 : 4200);
  }

  function loading(text) {
    return `<div class="loading"><span class="spinner" aria-hidden="true"></span><span>${esc(text)}</span></div>`;
  }

  /* --------------------------------- Setup -------------------------------- */
  if (!window.supabase || typeof window.supabase.createClient !== "function" || !SUPABASE_URL || !SUPABASE_KEY) {
    authView.innerHTML = `<main class="auth-card"><h1>Configuration missing</h1>
      <p class="auth-sub">The Supabase client library or <code>config.js</code> could not be loaded.
      Check that <code>../config.js</code> exists and that the Supabase CDN is reachable.</p></main>`;
    return;
  }

  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });

  class SetupNeeded extends Error {
    constructor(cause) {
      super("The dashboard helper function is missing from the database.");
      this.cause = cause;
    }
  }

  const SETUP_SQL = `create or replace function public.current_admin_state()
returns boolean language sql stable security definer
set search_path = ''
as $$ select app.is_admin(); $$;

revoke all on function public.current_admin_state() from public, anon;
grant  execute on function public.current_admin_state() to authenticated;`;

  async function checkAdmin() {
    const { data, error } = await sb.rpc("current_admin_state");
    if (error) {
      const text = `${error.message || ""} ${error.details || ""} ${error.code || ""}`;
      if (/PGRST202|could not find the function|does not exist|404/i.test(text)) throw new SetupNeeded(error);
      throw error;
    }
    return data === true;
  }

  /* ---------------------------------- Auth -------------------------------- */
  function authError(message) {
    loginError.hidden = !message;
    loginError.textContent = message || "";
  }

  function setLoginBusy(busy) {
    loginSubmit.disabled = busy;
    const spinner = loginSubmit.querySelector(".spinner");
    const label = loginSubmit.querySelector(".btn-label");
    if (spinner) spinner.hidden = !busy;
    if (label) label.textContent = busy ? "Signing in…" : "Sign in";
  }

  function showLogin() {
    appView.hidden = true;
    authView.hidden = false;
    state.isAdmin = false;
    state.session = null;
    state.user = null;
    closeNav();
    setLoginBusy(false);
  }

  document.getElementById("toggle-password")?.addEventListener("click", (event) => {
    const input = document.getElementById("login-password");
    const button = event.currentTarget;
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    button.textContent = show ? "Hide" : "Show";
    button.setAttribute("aria-pressed", String(show));
    button.setAttribute("aria-label", show ? "Hide password" : "Show password");
  });

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = document.getElementById("login-email").value.trim();
    const password = document.getElementById("login-password").value;

    if (!email || !password) {
      authError("Enter both your email address and password.");
      return;
    }

    authError("");
    setLoginBusy(true);

    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) {
      setLoginBusy(false);
      authError(/invalid login/i.test(error.message) ? "Incorrect email or password." : friendly(error));
      return;
    }

    try {
      const isAdmin = await checkAdmin();
      if (!isAdmin) {
        await sb.auth.signOut();
        setLoginBusy(false);
        authError("This account is not on the administrator allowlist. Ask the site owner to add it.");
        return;
      }
    } catch (err) {
      setLoginBusy(false);
      if (err instanceof SetupNeeded) {
        showSetupNeeded();
        return;
      }
      authError(friendly(err));
      return;
    }

    setLoginBusy(false);
    await startApp(data.session);
  });

  function showSetupNeeded() {
    authView.hidden = false;
    appView.hidden = true;
    loginError.hidden = false;
    loginError.innerHTML = `<strong>One database step is missing.</strong> The dashboard needs the small helper
      function from <code>supabase/migrations/0005_admin_rpc.sql</code>. Run this once in the Supabase SQL
      editor, then reload this page:
      <pre>${esc(SETUP_SQL)}</pre>`;
  }

  async function signOut() {
    try {
      await sb.auth.signOut();
    } catch (_) {
      /* ignore network errors while signing out */
    }
    showLogin();
    authError("");
    const password = document.getElementById("login-password");
    if (password) password.value = "";
    document.getElementById("login-email")?.focus();
  }

  async function startApp(session) {
    state.session = session;
    state.user = session.user;
    state.isAdmin = true;
    authView.hidden = true;
    appView.hidden = false;
    const email = session.user.email || "administrator";
    document.getElementById("account-email").textContent = email;
    document.getElementById("account-initials").textContent = initials(email);
    if (!location.hash || !ROUTES[routeFromHash()]) {
      history.replaceState(null, "", "#/overview");
    }
    await renderRoute();
  }

  sb.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT") {
      if (!appView.hidden) showLogin();
      return;
    }
    if (session) state.session = session;
  });

  /* -------------------------------- Navigation ----------------------------- */
  function routeFromHash() {
    const raw = location.hash.replace(/^#\/?/, "").split(/[?/]/)[0];
    return ROUTES[raw] ? raw : "overview";
  }

  function setActiveNav(route) {
    document.querySelectorAll("#sidebar-nav .nav-link").forEach((link) => {
      const active = link.dataset.route === route;
      link.classList.toggle("active", active);
      if (active) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
  }

  function closeNav() {
    appView.classList.remove("nav-open");
    if (menuToggle) menuToggle.setAttribute("aria-expanded", "false");
    if (scrim) scrim.hidden = true;
  }

  function openNav() {
    appView.classList.add("nav-open");
    if (scrim) scrim.hidden = false;
    menuToggle?.setAttribute("aria-expanded", "true");
  }

  menuToggle?.addEventListener("click", () => {
    if (appView.classList.contains("nav-open")) closeNav();
    else openNav();
  });
  scrim?.addEventListener("click", closeNav);
  document.getElementById("sidebar-logout")?.addEventListener("click", () => signOut());

  const mobileQuery = window.matchMedia("(max-width: 980px)");
  mobileQuery.addEventListener?.("change", () => {
    if (!mobileQuery.matches) closeNav();
  });

  async function renderRoute() {
    if (!state.session) return showLogin();
    const route = routeFromHash();

    if (route === "logout") {
      setActiveNav("logout");
      await signOut();
      toast("You have been signed out.", "info");
      return;
    }

    state.route = route;
    setActiveNav(route);
    crumb.textContent = ROUTES[route];
    closeNav();
    window.scrollTo(0, 0);

    try {
      if (!state.isAdmin) {
        const ok = await checkAdmin();
        if (!ok) {
          await signOut();
          authError("This account is not on the administrator allowlist.");
          return;
        }
        state.isAdmin = true;
      }

      if (route === "overview") await renderOverview();
      else if (route === "profile") await renderProfile();
      else if (route === "settings") await renderSettings();
      else if (route === "social") await renderCollection("social_links");
      else await renderCollection(route);
    } catch (err) {
      renderError(err);
    }
  }

  window.addEventListener("hashchange", () => {
    if (state.session) renderRoute();
  });

  function renderError(err) {
    state.collection = null;
    if (err instanceof SetupNeeded) {
      view.innerHTML = `<section class="panel"><div class="banner" style="margin:0">
        <h2>One database step is missing</h2>
        <p>Run <code>supabase/migrations/0005_admin_rpc.sql</code> in the Supabase SQL editor, then reload.</p>
        <pre>${esc(SETUP_SQL)}</pre>
      </div></section>`;
      return;
    }
    view.innerHTML = `<section class="panel"><div class="empty">
      <h3>Could not load this section</h3>
      <p>${esc(friendly(err))}</p>
      <button class="btn btn-primary btn-sm" type="button" data-retry>Try again</button>
    </div></section>`;
  }

  /* -------------------------------- Data API ------------------------------- */
  async function fetchRows(cfg) {
    let query = sb.from(cfg.table).select("*");
    for (const rule of cfg.order || []) {
      query = query.order(rule.column, { ascending: rule.ascending !== false, nullsFirst: false });
    }
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  async function countRows(table, published) {
    let query = sb.from(table).select("id", { count: "exact", head: true });
    if (published !== undefined) query = query.eq("published", published);
    const { count, error } = await query;
    if (error) throw error;
    return count || 0;
  }

  /* ------------------------------- Modal / UI ------------------------------ */
  function openModal({ title, subtitle = "", body = "", footer = "", wide = false, onClose }) {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = `
      <section class="modal${wide ? " modal-wide" : ""}" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <header class="modal-head">
          <div>
            <h2 id="modal-title">${esc(title)}</h2>
            ${subtitle ? `<p>${esc(subtitle)}</p>` : ""}
          </div>
          <button class="icon-btn" type="button" data-close aria-label="Close dialog">✕</button>
        </header>
        <div class="modal-body">${body}</div>
        ${footer ? `<footer class="modal-foot">${footer}</footer>` : ""}
      </section>`;
    modalHost.appendChild(backdrop);
    document.body.classList.add("modal-open");

    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      document.removeEventListener("keydown", onKey);
      backdrop.remove();
      document.body.classList.remove("modal-open");
      if (typeof onClose === "function") onClose();
    };
    function onKey(event) {
      if (event.key === "Escape") close();
    }
    document.addEventListener("keydown", onKey);
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop || event.target.closest("[data-close]")) close();
    });

    const first = backdrop.querySelector("input:not([type=file]), textarea, select");
    if (first) setTimeout(() => first.focus(), 40);
    return { backdrop, close };
  }

  function confirmAction({ title, message, confirmLabel = "Confirm", danger = false }) {
    return new Promise((resolve) => {
      let settled = false;
      let close = () => {};
      const finish = (value) => {
        if (settled) return;
        settled = true;
        close();
        resolve(value);
      };
      const footer = `<button type="button" class="btn btn-ghost" data-close>Cancel</button>
        <button type="button" class="btn ${danger ? "btn-danger" : "btn-primary"}" data-confirm>${esc(confirmLabel)}</button>`;
      const modal = openModal({ title, body: `<p class="confirm-body">${message}</p>`, footer, onClose: () => finish(false) });
      close = modal.close;
      modal.backdrop.querySelector("[data-confirm]").addEventListener("click", () => finish(true));
    });
  }

  /* --------------------------------- Fields -------------------------------- */
  function previewMarkup(url, isImage) {
    if (!url) return "<span>No file</span>";
    const isPdf = /\.pdf($|\?)/i.test(url);
    if (isImage && !isPdf) return `<img src="${esc(url)}" alt="" loading="lazy" />`;
    return "<span>PDF</span>";
  }

  function fieldMarkup(field, value) {
    const id = `f-${field.name}`;
    const span = field.span === 2 ? " span-2" : "";
    const raw = Array.isArray(value) ? value.join(", ") : value ?? "";
    const valueText = String(raw);
    const help = field.help ? `<p class="help">${esc(field.help)}</p>` : "";

    if (field.type === "checkbox") {
      return `<div class="field${span}">
        <label class="check" for="${id}"><input type="checkbox" id="${id}" name="${field.name}" ${value ? "checked" : ""} /><span>${esc(field.label)}</span></label>
        ${help}
      </div>`;
    }

    if (field.type === "select") {
      const options = field.options
        .map((option) => {
          const [optionValue, optionLabel] = Array.isArray(option) ? option : [option, option];
          const selected = String(valueText) === String(optionValue) ? " selected" : "";
          return `<option value="${esc(optionValue)}"${selected}>${esc(optionLabel)}</option>`;
        })
        .join("");
      return `<div class="field${span}">
        <label for="${id}">${esc(field.label)}</label>
        <select class="select" id="${id}" name="${field.name}">${options}</select>
        ${help}
      </div>`;
    }

    if (field.type === "textarea") {
      return `<div class="field${span}">
        <label for="${id}">${esc(field.label)}</label>
        <textarea class="textarea" id="${id}" name="${field.name}" rows="${field.rows || 4}"${field.maxlength ? ` maxlength="${field.maxlength}"` : ""} placeholder="${esc(field.placeholder || "")}">${esc(valueText)}</textarea>
        ${help}
      </div>`;
    }

    if (field.type === "upload") {
      const upload = field.upload;
      return `<div class="field${span}" data-upload-wrap="${field.name}">
        <label for="${id}">${esc(field.label)}</label>
        <div class="upload">
          <div class="upload-preview" data-preview>${previewMarkup(valueText, upload.kind === "image")}</div>
          <div class="upload-controls">
            <input class="input" id="${id}" name="${field.name}" type="url" placeholder="https://…" value="${esc(valueText)}" />
            <div class="upload-actions">
              <span class="btn btn-ghost btn-sm file-btn">Upload file
                <input type="file" accept="${esc(upload.types.join(","))}" data-upload-input="${field.name}" aria-label="${esc(field.label)} file" />
              </span>
              <button type="button" class="btn btn-ghost btn-sm" data-clear>Remove</button>
            </div>
            <div class="progress" hidden><span></span></div>
            <p class="upload-status" data-upload-status></p>
            ${help}
            <p class="field-error" data-field-error hidden></p>
          </div>
        </div>
      </div>`;
    }

    const inputType =
      field.type === "email" ? "email"
        : field.type === "date" ? "date"
          : field.type === "number" ? "number"
            : field.type === "url" ? "url"
              : "text";
    const attrs = [
      field.maxlength ? `maxlength="${field.maxlength}"` : "",
      field.type === "number" ? `min="${field.min ?? 0}" step="1"` : "",
      field.type === "date" ? `max="${todayISO()}"` : "",
      field.placeholder ? `placeholder="${esc(field.placeholder)}"` : "",
    ]
      .filter(Boolean)
      .join(" ");

    return `<div class="field${span}">
      <label for="${id}">${esc(field.label)}</label>
      <input class="input" id="${id}" name="${field.name}" type="${inputType}" value="${esc(valueText)}" ${attrs} />
      ${help}
    </div>`;
  }

  function collectForm(form, fields) {
    const out = {};
    for (const field of fields) {
      const element = form.elements[field.name];
      if (!element) continue;
      if (field.type === "checkbox") out[field.name] = element.checked;
      else if (field.type === "number") out[field.name] = element.value === "" ? "" : Number(element.value);
      else out[field.name] = element.value;
    }
    return out;
  }

  function validateField(field, value) {
    const text = typeof value === "string" ? value.trim() : value;
    const empty = text === "" || text === null || text === undefined;
    if (field.required && empty) return `${field.label} is required.`;
    if (empty) return "";
    if ((field.type === "url" || field.name.endsWith("_url")) && !/^https:\/\/\S+$/i.test(String(text)))
      return `${field.label} must be a full https:// URL.`;
    if (field.type === "email" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(text)))
      return "Enter a valid email address.";
    if (field.maxlength && String(text).length > field.maxlength)
      return `${field.label} must be ${field.maxlength} characters or fewer.`;
    if (field.type === "number" && (Number.isNaN(Number(text)) || Number(text) < (field.min ?? 0)))
      return `${field.label} must be ${field.min ?? 0} or more.`;
    if (field.type === "tags") {
      const items = String(text).split(",").map((part) => part.trim()).filter(Boolean);
      if (items.length > (field.maxItems || 24)) return `${field.label} allows at most ${field.maxItems || 24} items.`;
    }
    if (field.type === "date" && String(text) > todayISO()) return `${field.label} cannot be in the future.`;
    return "";
  }

  function validateFields(fields, values) {
    for (const field of fields) {
      const problem = validateField(field, values[field.name]);
      if (problem) return problem;
    }
    return "";
  }

  function buildPayload(fields, values) {
    const out = {};
    for (const field of fields) {
      let value = values[field.name];
      if (field.type === "tags") {
        value = String(value || "")
          .split(",")
          .map((part) => part.trim())
          .filter(Boolean);
      } else if (field.type === "checkbox") {
        value = Boolean(value);
      } else if (field.type === "number") {
        value = value === "" || value === null || value === undefined ? 0 : Number(value);
      } else if (typeof value === "string") {
        value = value.trim();
        if (value === "" && field.name !== "published") value = null;
      }
      out[field.name] = value;
    }
    return out;
  }

  function showFormError(form, message) {
    const box = form.querySelector("[data-form-error]");
    if (!box) return;
    box.hidden = !message;
    box.textContent = message || "";
    if (message) box.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  /* -------------------------------- Uploads -------------------------------- */
  function uploadToStorage(file, config, onProgress) {
    return sb.auth.getSession().then(({ data }) => {
      const token = data?.session?.access_token;
      if (!token) throw new Error("Your session expired — sign in again.");

      const extension = (file.name.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
      const path = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}.${extension}`;
      const endpoint = `${SUPABASE_URL}/storage/v1/object/${config.bucket}/${path}`;

      return new Promise((resolve, reject) => {
        const request = new XMLHttpRequest();
        request.open("POST", endpoint, true);
        request.setRequestHeader("Authorization", `Bearer ${token}`);
        request.setRequestHeader("x-upsert", "false");
        request.setRequestHeader("cache-control", "max-age=3600");

        request.upload.addEventListener("progress", (event) => {
          if (event.lengthComputable) onProgress(event.loaded / event.total);
        });

        request.onload = () => {
          if (request.status >= 200 && request.status < 300) {
            resolve(`${SUPABASE_URL}/storage/v1/object/public/${config.bucket}/${path}`);
            return;
          }
          let detail = `HTTP ${request.status}`;
          try {
            const parsed = JSON.parse(request.responseText);
            if (parsed.message) detail = parsed.message;
          } catch (_) {
            /* keep the status code */
          }
          reject(new Error(`Upload failed: ${detail}`));
        };
        request.onerror = () => reject(new Error("Network error while uploading."));
        request.send(file);
      });
    });
  }

  function bindUploads(scope, fields) {
    for (const field of fields.filter((item) => item.type === "upload")) {
      const wrap = scope.querySelector(`[data-upload-wrap="${field.name}"]`);
      if (!wrap) continue;

      const urlInput = wrap.querySelector(`input[name="${field.name}"]`);
      const fileInput = wrap.querySelector('input[type="file"]');
      const preview = wrap.querySelector("[data-preview]");
      const progress = wrap.querySelector(".progress");
      const fill = progress.querySelector("span");
      const status = wrap.querySelector("[data-upload-status]");
      const errorBox = wrap.querySelector("[data-field-error]");
      const isImage = field.upload.kind === "image";

      const sync = () => {
        preview.innerHTML = previewMarkup(urlInput.value.trim(), isImage);
      };
      const setError = (message) => {
        errorBox.hidden = !message;
        errorBox.textContent = message || "";
      };

      urlInput.addEventListener("input", () => {
        setError("");
        sync();
      });

      wrap.querySelector("[data-clear]").addEventListener("click", () => {
        urlInput.value = "";
        setError("");
        sync();
      });

      fileInput.addEventListener("change", async () => {
        const file = fileInput.files && fileInput.files[0];
        if (!file) return;
        setError("");
        status.textContent = "";

        const limit = field.upload.maxMB * 1024 * 1024;
        if (file.size > limit) {
          setError(`That file is ${fmtSize(file.size)} — the limit is ${field.upload.maxMB} MB.`);
          fileInput.value = "";
          return;
        }
        if (!field.upload.types.includes(file.type)) {
          setError(`Unsupported type (${file.type || "unknown"}). Allowed: ${field.upload.types.join(", ")}.`);
          fileInput.value = "";
          return;
        }

        progress.hidden = false;
        fill.style.width = "0%";
        status.textContent = "Uploading…";
        state.uploads += 1;

        try {
          const url = await uploadToStorage(file, field.upload, (ratio) => {
            fill.style.width = `${Math.max(2, Math.round(ratio * 100))}%`;
          });
          urlInput.value = url;
          sync();
          status.textContent = "Upload complete.";
          toast(`${field.label} uploaded.`);
        } catch (error) {
          status.textContent = "";
          setError(friendly(error));
        } finally {
          state.uploads -= 1;
          progress.hidden = true;
          fileInput.value = "";
        }
      });
    }
  }

  function bindConditionals(scope) {
    const enrolled = scope.querySelector('[name="currently_enrolled"]');
    const endDate = scope.querySelector('[name="end_date"]');
    if (!enrolled || !endDate) return;
    const sync = () => {
      endDate.disabled = enrolled.checked;
      if (enrolled.checked) endDate.value = "";
    };
    enrolled.addEventListener("change", sync);
    sync();
  }

  function openForm({ title, subtitle, fields, values = {}, submitLabel = "Save" }) {
    return new Promise((resolve) => {
      let settled = false;
      let close = () => {};
      const finish = (value) => {
        if (settled) return;
        settled = true;
        close();
        resolve(value);
      };

      const body = `<form id="record-form" class="form-grid" novalidate>
        <div class="form-error span-2" data-form-error role="alert" hidden></div>
        ${fields.map((field) => fieldMarkup(field, values[field.name])).join("")}
      </form>`;
      const footer = `<button type="button" class="btn btn-ghost" data-close>Cancel</button>
        <button type="submit" class="btn btn-primary" form="record-form">${esc(submitLabel)}</button>`;

      const modal = openModal({ title, subtitle, body, footer, wide: true, onClose: () => finish(null) });
      close = modal.close;

      const form = modal.backdrop.querySelector("#record-form");
      bindUploads(modal.backdrop, fields);
      bindConditionals(modal.backdrop);

      form.addEventListener("submit", (event) => {
        event.preventDefault();
        const valuesNow = collectForm(form, fields);
        const problem = validateFields(fields, valuesNow);
        if (problem) return showFormError(form, problem);
        if (state.uploads > 0)
          return showFormError(form, "An upload is still in progress — wait for it to finish, then save.");
        finish(valuesNow);
      });
    });
  }

  /* -------------------------------- Sections ------------------------------- */
  const PROFILE_FIELDS = [
    { name: "full_name", label: "Full name", type: "text", required: true, maxlength: 120, span: 2, placeholder: "Aditya Prakash" },
    { name: "title", label: "Professional title", type: "text", maxlength: 160, placeholder: "Aspiring Software Developer" },
    { name: "location", label: "Location", type: "text", maxlength: 160, placeholder: "India" },
    { name: "email", label: "Contact email", type: "email", placeholder: "you@example.com" },
    {
      name: "availability_status",
      label: "Availability",
      type: "select",
      options: [
        ["available", "Available"],
        ["open_to_work", "Open to work"],
        ["busy", "Busy"],
        ["unavailable", "Unavailable"],
      ],
    },
    { name: "intro", label: "Hero introduction", type: "textarea", rows: 3, maxlength: 400, span: 2, help: "One or two lines shown under your name in the hero." },
    { name: "about", label: "About text", type: "textarea", rows: 7, maxlength: 8000, span: 2 },
    {
      name: "avatar_url",
      label: "Profile photo",
      type: "upload",
      span: 2,
      upload: { bucket: "profile-photos", kind: "image", maxMB: 5, types: ["image/jpeg", "image/png", "image/webp"], hint: "JPEG, PNG or WebP up to 5 MB." },
    },
    {
      name: "resume_url",
      label: "Résumé (PDF)",
      type: "upload",
      span: 2,
      upload: { bucket: "resume", kind: "pdf", maxMB: 5, types: ["application/pdf"], hint: "PDF up to 5 MB — powers the download button on the public site." },
    },
    { name: "published", label: "Profile visible on the public site", type: "checkbox", span: 2 },
  ];

  const COLLECTIONS = {
    education: {
      table: "education",
      title: "Education",
      singular: "education entry",
      subtitle: "Degrees and programmes shown in the public about section.",
      order: [{ column: "display_order" }, { column: "start_date", ascending: false }],
      primary: (row) => row.institution,
      secondary: (row) => row.degree,
      meta: (row) => [dateRange(row.start_date, row.end_date, row.currently_enrolled), row.grade, truncate(row.description, 110)],
      badges: (row) => (row.currently_enrolled ? ["Currently enrolled"] : []),
      empty: { title: "No education entries yet", text: "Add a degree, college or programme so it appears on the portfolio." },
      defaults: { published: true, display_order: 0, currently_enrolled: false },
      fields: [
        { name: "institution", label: "Institution", type: "text", required: true, maxlength: 200, span: 2, placeholder: "ABC University" },
        { name: "degree", label: "Degree / programme", type: "text", required: true, maxlength: 200, span: 2, placeholder: "B.Tech in Computer Science" },
        { name: "start_date", label: "Start date", type: "date" },
        { name: "end_date", label: "End date", type: "date", help: "Leave empty while you are still enrolled." },
        { name: "currently_enrolled", label: "Currently enrolled", type: "checkbox" },
        { name: "grade", label: "Grade / CGPA", type: "text", maxlength: 60, placeholder: "e.g. 8.9 CGPA" },
        { name: "description", label: "Description", type: "textarea", rows: 4, maxlength: 2000, span: 2 },
        { name: "display_order", label: "Display order", type: "number", min: 0 },
        { name: "published", label: "Published", type: "checkbox" },
      ],
    },
    skills: {
      table: "skills",
      title: "Skills",
      singular: "skill",
      subtitle: "Grouped by category on the public site; proficiency drives the meter.",
      order: [{ column: "display_order" }, { column: "name" }],
      primary: (row) => row.name,
      secondary: (row) => row.category,
      meta: (row) => [`Proficiency ${row.proficiency}/5`],
      empty: { title: "No skills yet", text: "Add the languages, frameworks and tools you want to show." },
      defaults: { published: true, display_order: 0, proficiency: 3, category: "Languages" },
      fields: [
        { name: "name", label: "Skill", type: "text", required: true, maxlength: 80, span: 2, placeholder: "JavaScript" },
        { name: "category", label: "Category", type: "select", options: ["Languages", "Frameworks & Libraries", "Databases", "Tools", "Concepts"] },
        {
          name: "proficiency",
          label: "Proficiency",
          type: "select",
          options: [
            [1, "1 — Beginner"],
            [2, "2 — Basic"],
            [3, "3 — Comfortable"],
            [4, "4 — Advanced"],
            [5, "5 — Expert"],
          ],
        },
        { name: "display_order", label: "Display order", type: "number", min: 0 },
        { name: "published", label: "Published", type: "checkbox" },
      ],
    },
    projects: {
      table: "projects",
      title: "Projects",
      singular: "project",
      subtitle: "Cards in the projects section, with links, screenshots and technology tags.",
      order: [{ column: "featured", ascending: false }, { column: "display_order" }],
      thumb: "image_url",
      primary: (row) => row.name,
      secondary: (row) => truncate(row.description, 130),
      meta: (row) => [
        (row.technologies || []).join(", "),
        row.live_url ? "Live demo" : "",
        row.github_url ? "Source code" : "",
      ],
      badges: (row) => (row.featured ? ["Featured"] : []),
      empty: { title: "No projects yet", text: "Add a project with a screenshot, tech tags and links." },
      defaults: { published: true, display_order: 0, featured: false, technologies: [] },
      fields: [
        { name: "name", label: "Project name", type: "text", required: true, maxlength: 160, span: 2, placeholder: "Stopwatch web app" },
        { name: "description", label: "Description", type: "textarea", rows: 4, maxlength: 4000, span: 2 },
        { name: "technologies", label: "Technologies", type: "tags", span: 2, maxlength: 600, maxItems: 24, placeholder: "HTML, CSS, JavaScript", help: "Comma-separated, up to 24 items." },
        { name: "github_url", label: "Repository URL", type: "url", placeholder: "https://github.com/…" },
        { name: "live_url", label: "Live demo URL", type: "url", placeholder: "https://…" },
        {
          name: "image_url",
          label: "Screenshot",
          type: "upload",
          span: 2,
          upload: { bucket: "project-shots", kind: "image", maxMB: 8, types: ["image/jpeg", "image/png", "image/webp"], hint: "JPEG, PNG or WebP up to 8 MB." },
        },
        { name: "featured", label: "Featured project", type: "checkbox" },
        { name: "display_order", label: "Display order", type: "number", min: 0 },
        { name: "published", label: "Published", type: "checkbox" },
      ],
    },
    experience: {
      table: "experience",
      title: "Experience",
      singular: "experience entry",
      subtitle: "Internships, roles and responsibilities shown in the experience timeline.",
      order: [{ column: "display_order" }],
      primary: (row) => row.role,
      secondary: (row) => row.organization,
      meta: (row) => [row.period, truncate(row.description, 120)],
      empty: { title: "No experience yet", text: "Add internships, roles or responsibilities you want to highlight." },
      defaults: { published: true, display_order: 0 },
      fields: [
        { name: "role", label: "Role", type: "text", required: true, maxlength: 200, span: 2, placeholder: "Web Development Intern" },
        { name: "organization", label: "Organisation", type: "text", required: true, maxlength: 200, span: 2, placeholder: "Prodigy Infotech" },
        { name: "period", label: "Period", type: "text", required: true, maxlength: 80, placeholder: "Jun 2025 — Present" },
        { name: "display_order", label: "Display order", type: "number", min: 0 },
        { name: "description", label: "Description", type: "textarea", rows: 4, maxlength: 4000, span: 2 },
        { name: "published", label: "Published", type: "checkbox" },
      ],
    },
    achievements: {
      table: "achievements",
      title: "Achievements",
      singular: "achievement",
      subtitle: "Awards, certificates and milestones shown in the achievements section.",
      order: [{ column: "display_order" }, { column: "achieved_on", ascending: false }],
      thumb: "image_url",
      primary: (row) => row.title,
      secondary: (row) => truncate(row.description, 130),
      meta: (row) => [row.achieved_on ? fmtDate(row.achieved_on) : ""],
      empty: { title: "No achievements yet", text: "Add certificates, awards or milestones, with an optional image." },
      defaults: { published: true, display_order: 0 },
      fields: [
        { name: "title", label: "Title", type: "text", required: true, maxlength: 200, span: 2 },
        { name: "description", label: "Description", type: "textarea", rows: 4, maxlength: 2000, span: 2 },
        { name: "achieved_on", label: "Date achieved", type: "date" },
        {
          name: "image_url",
          label: "Certificate / image",
          type: "upload",
          span: 2,
          upload: { bucket: "certificates", kind: "image", maxMB: 10, types: ["image/jpeg", "image/png", "image/webp", "application/pdf"], hint: "JPEG, PNG, WebP or PDF up to 10 MB." },
        },
        { name: "display_order", label: "Display order", type: "number", min: 0 },
        { name: "published", label: "Published", type: "checkbox" },
      ],
    },
    social_links: {
      table: "social_links",
      title: "Social Links",
      singular: "social link",
      subtitle: "Profile links shown on the public site, in the order you set.",
      order: [{ column: "display_order" }],
      primary: (row) => row.label || cap(row.platform),
      secondary: (row) => row.url,
      meta: (row) => [cap(row.platform)],
      empty: { title: "No social links yet", text: "Add GitHub, LinkedIn, LeetCode or any other profile link." },
      defaults: { published: true, display_order: 0, platform: "github" },
      fields: [
        {
          name: "platform",
          label: "Platform",
          type: "select",
          options: [
            ["github", "GitHub"],
            ["linkedin", "LinkedIn"],
            ["leetcode", "LeetCode"],
            ["other", "Other"],
          ],
        },
        { name: "label", label: "Label", type: "text", maxlength: 80, placeholder: "Optional, e.g. CodeChef" },
        { name: "url", label: "URL", type: "url", required: true, span: 2, placeholder: "https://github.com/username" },
        { name: "display_order", label: "Display order", type: "number", min: 0 },
        { name: "published", label: "Published", type: "checkbox" },
      ],
    },
  };

  function dateRange(start, end, current) {
    const from = start ? fmtDate(start) : "";
    const to = current ? "Present" : end ? fmtDate(end) : "";
    if (from && to) return `${from} — ${to}`;
    return from || to;
  }

  /* -------------------------------- Overview ------------------------------- */
  async function renderOverview() {
    const token = ++state.renderSeq;
    state.collection = null;
    state.rows = [];
    view.innerHTML = loading("Loading overview…");

    const tables = [
      ["projects", "Projects"],
      ["skills", "Skills"],
      ["education", "Education"],
      ["experience", "Experience"],
      ["achievements", "Achievements"],
      ["social_links", "Social links"],
    ];

    const { data: profile, error: profileError } = await sb.from("profiles").select("*").limit(1).maybeSingle();
    if (profileError) throw profileError;

    const counts = Object.fromEntries(
      await Promise.all(
        tables.map(async ([table, label]) => [
          table,
          { label, total: await countRows(table), published: await countRows(table, true) },
        ])
      )
    );

    const recentSources = [
      ["projects", "Project", (row) => row.name],
      ["education", "Education", (row) => row.institution],
      ["achievements", "Achievement", (row) => row.title],
      ["experience", "Experience", (row) => row.role],
    ];
    const recent = (
      await Promise.all(
        recentSources.map(async ([table, kind, title]) => {
          const { data } = await sb.from(table).select("*").order("updated_at", { ascending: false }).limit(3);
          return (data || []).map((row) => ({ kind, title: title(row), when: row.updated_at }));
        })
      )
    )
      .flat()
      .sort((a, b) => new Date(b.when) - new Date(a.when))
      .slice(0, 5);

    if (token !== state.renderSeq) return;

    const publishedTotal = Object.values(counts).reduce((sum, entry) => sum + entry.published, 0);
    const draftTotal = Object.values(counts).reduce((sum, entry) => sum + (entry.total - entry.published), 0);
    const email = state.user?.email || "";
    const firstName = (profile?.full_name || email.split("@")[0] || "there").split(" ")[0];

    const checks = [
      ["Profile created", Boolean(profile)],
      ["Profile photo uploaded", Boolean(profile?.avatar_url)],
      ["Résumé linked", Boolean(profile?.resume_url)],
      ["At least one published project", counts.projects.published > 0],
      ["At least one published skill", counts.skills.published > 0],
      ["At least one social link", counts.social_links.published > 0],
    ];

    view.innerHTML = `
      <div class="section-head">
        <div>
          <h1 class="section-title">Welcome back, ${esc(firstName)}</h1>
          <p class="section-sub">Manage every piece of content on the public portfolio. Changes go live as soon as they are saved and published.</p>
        </div>
        <div class="section-actions">
          <a class="btn btn-ghost btn-sm" href="#/profile">Edit profile</a>
          <a class="btn btn-primary btn-sm" href="#/projects">Manage projects</a>
        </div>
      </div>

      <div class="stat-grid">
        <div class="stat-card"><p class="stat-label">Published items</p><p class="stat-value">${publishedTotal}</p><p class="stat-foot">Visible on the public site</p></div>
        <div class="stat-card"><p class="stat-label">Drafts</p><p class="stat-value">${draftTotal}</p><p class="stat-foot">Hidden from visitors</p></div>
        <div class="stat-card"><p class="stat-label">Projects</p><p class="stat-value">${counts.projects.total}</p><p class="stat-foot">${counts.projects.published} published</p></div>
        <div class="stat-card"><p class="stat-label">Skills</p><p class="stat-value">${counts.skills.total}</p><p class="stat-foot">${counts.skills.published} published</p></div>
      </div>

      <div class="overview-grid">
        <section class="panel">
          <header class="panel-head"><h2>Profile snapshot</h2><a class="btn btn-ghost btn-sm" href="#/profile">Edit</a></header>
          <div class="panel-body">
            ${
              profile
                ? `<div class="profile-snap">
                    ${profile.avatar_url ? `<img src="${esc(profile.avatar_url)}" alt="" loading="lazy" />` : `<div class="placeholder">${esc(initials(profile.full_name))}</div>`}
                    <div>
                      <h3>${esc(profile.full_name)}</h3>
                      <p>${esc(profile.title || "No title set")}</p>
                      <div class="record-meta">
                        <span class="chip ${profile.published ? "ok" : "warn"}">${profile.published ? "Published" : "Draft"}</span>
                        <span class="chip info">${esc(profile.availability_status.replace(/_/g, " "))}</span>
                      </div>
                    </div>
                  </div>`
                : `<div class="empty" style="padding:20px 0"><h3>No profile yet</h3><p>Create it to power the hero, about and contact sections.</p><a class="btn btn-primary btn-sm" href="#/profile">Create profile</a></div>`
            }
          </div>
        </section>

        <section class="panel">
          <header class="panel-head"><h2>Content health</h2><span class="chip ${checks.every(([, done]) => done) ? "ok" : "warn"}">${checks.filter(([, done]) => done).length}/${checks.length} ready</span></header>
          <div class="panel-body">
            <ul class="checklist">
              ${checks.map(([label, done]) => `<li class="${done ? "done" : ""}"><span class="dot">${done ? "✓" : "•"}</span>${esc(label)}</li>`).join("")}
            </ul>
          </div>
        </section>
      </div>

      <div class="overview-grid">
        <section class="panel">
          <header class="panel-head"><h2>Recent updates</h2></header>
          <div class="panel-body">
            ${
              recent.length
                ? `<ul class="activity">${recent
                    .map(
                      (item) =>
                        `<li><span class="chip info">${esc(item.kind)}</span><span>${esc(truncate(item.title, 48))}</span><span class="when">${esc(relative(item.when))}</span></li>`
                    )
                    .join("")}</ul>`
                : `<p class="help">Nothing has been edited yet.</p>`
            }
          </div>
        </section>

        <section class="panel">
          <header class="panel-head"><h2>Content sections</h2></header>
          <div class="panel-body tight">
            <ul class="activity">
              ${Object.entries(counts)
                .map(
                  ([key, entry]) =>
                    `<li><a href="#/${key === "social_links" ? "social" : key}">${esc(entry.label)}</a><span class="when">${entry.published}/${entry.total} published</span></li>`
                )
                .join("")}
            </ul>
          </div>
        </section>
      </div>`;
  }

  /* --------------------------------- Profile ------------------------------- */
  async function renderProfile() {
    const token = ++state.renderSeq;
    state.collection = null;
    view.innerHTML = loading("Loading profile…");

    const { data: profile, error } = await sb.from("profiles").select("*").limit(1).maybeSingle();
    if (error) throw error;
    if (token !== state.renderSeq) return;

    if (!profile) {
      view.innerHTML = `
        <div class="section-head">
          <div>
            <h1 class="section-title">Profile</h1>
            <p class="section-sub">The single profile record that powers the hero, about and contact areas.</p>
          </div>
        </div>
        <section class="panel">
          <div class="empty">
            <h3>No profile yet</h3>
            <p>Create the one profile record allowed by the database. Every public section reads from it.</p>
            <button class="btn btn-primary" type="button" data-create-profile>Create profile</button>
          </div>
        </section>`;
      return;
    }

    view.innerHTML = `
      <div class="section-head">
        <div>
          <h1 class="section-title">Profile</h1>
          <p class="section-sub">Shown in the hero, about and contact areas. Saved changes appear on the public site immediately when published.</p>
        </div>
        <div class="section-actions">
          <span class="chip ${profile.published ? "ok" : "warn"}">${profile.published ? "Published" : "Draft"}</span>
          <span class="chip">Updated ${esc(relative(profile.updated_at))}</span>
        </div>
      </div>
      <section class="panel">
        <header class="panel-head"><h2>Identity &amp; introduction</h2></header>
        <div class="panel-body">
          <form id="profile-form" class="form-grid" novalidate>
            <div class="form-error span-2" data-form-error role="alert" hidden></div>
            ${PROFILE_FIELDS.map((field) => fieldMarkup(field, profile[field.name])).join("")}
          </form>
        </div>
        <div class="panel-foot">
          <span class="help">Photos and the résumé are stored in Supabase Storage.</span>
          <div class="section-actions">
            <button class="btn btn-danger" type="button" data-delete-profile>Delete profile</button>
            <button class="btn btn-primary" type="submit" form="profile-form">Save profile</button>
          </div>
        </div>
      </section>`;

    bindUploads(view, PROFILE_FIELDS);
    const form = view.querySelector("#profile-form");
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (state.saving) return;
      showFormError(form, "");
      const values = collectForm(form, PROFILE_FIELDS);
      const problem = validateFields(PROFILE_FIELDS, values);
      if (problem) return showFormError(form, problem);
      if (state.uploads > 0) return showFormError(form, "Wait for the upload to finish, then save.");

      state.saving = true;
      const button = view.querySelector('.panel-foot .btn-primary');
      if (button) button.disabled = true;
      const { error: saveError } = await sb.from("profiles").update(buildPayload(PROFILE_FIELDS, values)).eq("id", profile.id);
      state.saving = false;
      if (button) button.disabled = false;
      if (saveError) return showFormError(form, friendly(saveError));
      toast("Profile saved.");
      renderProfile().catch(renderError);
    });
  }

  async function deleteProfile() {
    const ok = await confirmAction({
      title: "Delete profile?",
      message:
        "The single profile record — name, bio, avatar, résumé link and availability — will be removed. The public site falls back to its static content until a new profile is created.",
      confirmLabel: "Delete profile",
      danger: true,
    });
    if (!ok) return;
    const { error } = await sb.from("profiles").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    if (error) return toast(friendly(error), "error");
    toast("Profile deleted.");
    renderProfile().catch(renderError);
  }

  async function openProfileForm() {
    const values = { availability_status: "available", published: true };
    const result = await openForm({
      title: "Create profile",
      subtitle: "Only one profile can exist — the database enforces it.",
      fields: PROFILE_FIELDS,
      values,
      submitLabel: "Create profile",
    });
    if (!result) return;
    const { error } = await sb.from("profiles").insert(buildPayload(PROFILE_FIELDS, result));
    if (error) return toast(friendly(error), "error");
    toast("Profile created.");
    renderProfile().catch(renderError);
  }

  /* ------------------------------ Collections ----------------------------- */
  async function renderCollection(key) {
    const cfg = COLLECTIONS[key];
    if (!cfg) return;
    state.collection = key;
    state.rows = [];
    const token = ++state.renderSeq;
    view.innerHTML = loading(`Loading ${cfg.title.toLowerCase()}…`);

    const rows = await fetchRows(cfg);
    if (token !== state.renderSeq) return;
    state.rows = rows;

    const published = rows.filter((row) => row.published).length;
    view.innerHTML = `
      <div class="section-head">
        <div>
          <h1 class="section-title">${esc(cfg.title)}</h1>
          <p class="section-sub">${esc(cfg.subtitle)}</p>
        </div>
        <div class="section-actions">
          <span class="chip ok">${published} published</span>
          <span class="chip warn">${rows.length - published} drafts</span>
          <button class="btn btn-primary" type="button" data-new>+ New ${esc(cfg.singular)}</button>
        </div>
      </div>
      ${
        rows.length
          ? `<section>${rows.map((row) => recordMarkup(row, cfg)).join("")}</section>`
          : `<section class="panel"><div class="empty">
              <h3>${esc(cfg.empty.title)}</h3>
              <p>${esc(cfg.empty.text)}</p>
              <button class="btn btn-primary btn-sm" type="button" data-new>Add ${esc(cfg.singular)}</button>
            </div></section>`
      }`;
  }

  function recordMarkup(row, cfg) {
    const thumbUrl = cfg.thumb ? row[cfg.thumb] : "";
    const pdfThumb = Boolean(thumbUrl) && /\.pdf($|\?)/i.test(thumbUrl);
    const meta = (cfg.meta ? cfg.meta(row) : []).filter(Boolean);
    return `<article class="record">
      ${pdfThumb ? `<span class="record-thumb record-thumb-file" aria-hidden="true">PDF</span>` : thumbUrl ? `<img class="record-thumb" src="${esc(thumbUrl)}" alt="" loading="lazy" />` : ""}
      <div class="record-main">
        <div class="record-top">
          <h2 class="record-title">${esc(cfg.primary(row))}</h2>
          <span class="chip ${row.published ? "ok" : "warn"}">${row.published ? "Published" : "Draft"}</span>
          ${(cfg.badges ? cfg.badges(row) : []).map((badge) => `<span class="chip info">${esc(badge)}</span>`).join("")}
        </div>
        ${cfg.secondary && cfg.secondary(row) ? `<p class="record-sub">${esc(cfg.secondary(row))}</p>` : ""}
        ${meta.length ? `<div class="record-meta">${meta.map((item) => `<span>${esc(item)}</span>`).join("")}</div>` : ""}
      </div>
      <div class="record-actions">
        <button class="btn btn-ghost btn-sm" type="button" data-edit="${row.id}">Edit</button>
        <button class="btn btn-ghost btn-sm" type="button" data-toggle="${row.id}">${row.published ? "Unpublish" : "Publish"}</button>
        <button class="btn btn-danger btn-sm" type="button" data-delete="${row.id}">Delete</button>
      </div>
    </article>`;
  }

  function nextOrder() {
    return (state.rows || []).reduce((max, row) => Math.max(max, Number(row.display_order) || 0), 0) + 1;
  }

  async function openRecordForm(key, row) {
    const cfg = COLLECTIONS[key];
    const values = row
      ? { ...row }
      : { ...cfg.defaults, display_order: nextOrder() };
    const result = await openForm({
      title: row ? `Edit ${cfg.singular}` : `New ${cfg.singular}`,
      subtitle: row ? undefined : cfg.subtitle,
      fields: cfg.fields,
      values,
      submitLabel: row ? "Save changes" : `Add ${cfg.singular}`,
    });
    if (!result) return;

    const payload = buildPayload(cfg.fields, result);
    const { error } = row
      ? await sb.from(cfg.table).update(payload).eq("id", row.id)
      : await sb.from(cfg.table).insert(payload);
    if (error) return toast(friendly(error), "error");
    toast(row ? `${cap(cfg.singular)} updated.` : `${cap(cfg.singular)} added.`);
    renderCollection(key).catch(renderError);
  }

  view.addEventListener("click", async (event) => {
    const button = event.target.closest("button");
    if (!button) return;

    if (button.hasAttribute("data-retry")) return renderRoute();
    if (button.hasAttribute("data-create-profile")) return openProfileForm();
    if (button.hasAttribute("data-delete-profile")) return deleteProfile();

    const key = state.collection;
    const cfg = key && COLLECTIONS[key];
    if (!cfg) return;

    if (button.hasAttribute("data-new")) {
      openRecordForm(key, null);
      return;
    }

    const id = button.dataset.edit || button.dataset.toggle || button.dataset.delete;
    const row = (state.rows || []).find((item) => item.id === id);
    if (!row) return;

    if (button.dataset.edit) {
      openRecordForm(key, row);
      return;
    }

    if (button.dataset.toggle) {
      button.disabled = true;
      const { error } = await sb.from(cfg.table).update({ published: !row.published }).eq("id", row.id);
      if (error) {
        button.disabled = false;
        return toast(friendly(error), "error");
      }
      toast(row.published ? `${cap(cfg.singular)} unpublished.` : `${cap(cfg.singular)} published.`);
      renderCollection(key).catch(renderError);
      return;
    }

    if (button.dataset.delete) {
      const ok = await confirmAction({
        title: `Delete ${cfg.singular}?`,
        message: `<strong>${esc(cfg.primary(row))}</strong> will be permanently removed. This cannot be undone.`,
        confirmLabel: "Delete",
        danger: true,
      });
      if (!ok) return;
      const { error } = await sb.from(cfg.table).delete().eq("id", row.id);
      if (error) return toast(friendly(error), "error");
      toast(`${cap(cfg.singular)} deleted.`);
      renderCollection(key).catch(renderError);
    }
  });

  /* -------------------------------- Settings ------------------------------- */
  const RESUME_FIELD = {
    name: "resume_url",
    label: "Résumé (PDF)",
    type: "upload",
    span: 2,
    upload: {
      bucket: "resume",
      kind: "pdf",
      maxMB: 5,
      types: ["application/pdf"],
      hint: "PDF up to 5 MB. Uploading a new file updates the résumé linked from the portfolio.",
    },
  };

  async function renderSettings() {
    const token = ++state.renderSeq;
    state.collection = null;
    view.innerHTML = loading("Loading settings…");

    const { data: profile } = await sb.from("profiles").select("*").limit(1).maybeSingle();
    const bucketChecks = await Promise.all(
      BUCKETS.map(async (bucket) => {
        const { error } = await sb.storage.from(bucket).list("", { limit: 1 });
        return { bucket, ok: !error, detail: error ? friendly(error) : "Ready" };
      })
    );
    if (token !== state.renderSeq) return;

    const user = state.user || {};
    const lastSignIn = user.last_sign_in_at ? relative(user.last_sign_in_at) : "this session";

    view.innerHTML = `
      <div class="section-head">
        <div>
          <h1 class="section-title">Settings</h1>
          <p class="section-sub">Account security, storage health and session controls for this dashboard.</p>
        </div>
      </div>

      <section class="panel">
        <header class="panel-head"><h2>Account</h2><span class="chip ok">Administrator</span></header>
        <div class="panel-body">
          <dl class="kv">
            <div><dt>Email</dt><dd>${esc(user.email || "—")}</dd></div>
            <div><dt>User id</dt><dd><code>${esc(user.id || "—")}</code></dd></div>
            <div><dt>Last sign-in</dt><dd>${esc(lastSignIn)}</dd></div>
            <div><dt>Allowlist check</dt><dd>Verified · <code>app.is_admin()</code></dd></div>
          </dl>
        </div>
      </section>

      <section class="panel">
        <header class="panel-head"><h2>Change password</h2></header>
        <div class="panel-body">
          <form id="password-form" class="stack" novalidate>
            <input type="text" name="username" autocomplete="username" value="${esc(user.email || "")}" hidden />
            <div class="field">
              <label for="new-password">New password</label>
              <input class="input" id="new-password" type="password" autocomplete="new-password" minlength="8" placeholder="At least 8 characters" />
            </div>
            <div class="field">
              <label for="confirm-password">Confirm new password</label>
              <input class="input" id="confirm-password" type="password" autocomplete="new-password" minlength="8" />
            </div>
            <div class="form-error" id="password-error" role="alert" hidden></div>
            <div><button class="btn btn-primary" type="submit">Update password</button></div>
          </form>
        </div>
      </section>

      <section class="panel">
        <header class="panel-head"><h2>Résumé</h2>${profile?.resume_url ? `<a class="btn btn-ghost btn-sm" href="${esc(profile.resume_url)}" target="_blank" rel="noopener">Open current</a>` : ""}</header>
        <div class="panel-body">
          ${
            profile
              ? `<form id="resume-form" class="form-grid" novalidate>
                  <div class="form-error span-2" data-form-error role="alert" hidden></div>
                  ${fieldMarkup(RESUME_FIELD, profile.resume_url)}
                </form>
                <div class="panel-foot" style="border:0;background:transparent;padding:16px 0 0">
                  <span class="help">Stored in the private-write <code>resume</code> bucket.</span>
                  <button class="btn btn-primary" type="submit" form="resume-form">Save résumé</button>
                </div>`
              : `<p class="help">Create the profile first, then a résumé can be attached to it.</p>`
          }
        </div>
      </section>

      <section class="panel">
        <header class="panel-head"><h2>Storage buckets</h2></header>
        <div class="panel-body">
          <dl class="kv">
            ${bucketChecks
              .map(
                (check) =>
                  `<div><dt><code>${esc(check.bucket)}</code></dt><dd><span class="chip ${check.ok ? "ok" : "warn"}">${esc(check.detail)}</span></dd></div>`
              )
              .join("")}
          </dl>
          <p class="help" style="margin-top:12px">Public read, admin-only writes, with file-type and size limits enforced by Supabase Storage.</p>
        </div>
      </section>

      <section class="panel">
        <header class="panel-head"><h2>Sessions</h2></header>
        <div class="panel-body stack">
          <p class="help">Signing out everywhere ends this session and every other device signed in as you.</p>
          <div class="section-actions">
            <button class="btn btn-ghost" type="button" id="signout-here">Sign out of this device</button>
            <button class="btn btn-danger" type="button" id="signout-all">Sign out of all devices</button>
          </div>
        </div>
      </section>`;

    if (profile) {
      bindUploads(view, [RESUME_FIELD]);
      const resumeForm = view.querySelector("#resume-form");
      resumeForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        showFormError(resumeForm, "");
        const value = resumeForm.elements.resume_url.value.trim();
        const problem = validateField(RESUME_FIELD, value);
        if (problem) return showFormError(resumeForm, problem);
        if (state.uploads > 0) return showFormError(resumeForm, "Wait for the upload to finish, then save.");
        const { error } = await sb
          .from("profiles")
          .update({ resume_url: value || null })
          .eq("id", profile.id);
        if (error) return showFormError(resumeForm, friendly(error));
        toast("Résumé saved.");
        renderSettings().catch(renderError);
      });
    }

    const passwordForm = view.querySelector("#password-form");
    const passwordError = view.querySelector("#password-error");
    passwordForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      passwordError.hidden = true;
      const next = view.querySelector("#new-password").value;
      const confirm = view.querySelector("#confirm-password").value;
      const fail = (message) => {
        passwordError.hidden = false;
        passwordError.textContent = message;
      };
      if (next.length < 8) return fail("Use at least 8 characters.");
      if (next !== confirm) return fail("The two passwords do not match.");
      const submit = passwordForm.querySelector("button[type=submit]");
      submit.disabled = true;
      const { error } = await sb.auth.updateUser({ password: next });
      submit.disabled = false;
      if (error) return fail(friendly(error));
      passwordForm.reset();
      toast("Password updated.");
    });

    view.querySelector("#signout-here").addEventListener("click", () => signOut());

    view.querySelector("#signout-all").addEventListener("click", async () => {
      const ok = await confirmAction({
        title: "Sign out of all devices?",
        message: "Every session for this account will end, including this one. You will need to sign in again.",
        confirmLabel: "Sign out everywhere",
        danger: true,
      });
      if (!ok) return;
      try {
        await sb.auth.signOut({ scope: "global" });
      } catch (_) {
        /* fall through to local sign-out */
      }
      showLogin();
      toast("Signed out of all devices.", "info");
    });
  }

  /* ---------------------------------- Boot --------------------------------- */
  (async function boot() {
    const { data } = await sb.auth.getSession();
    if (!data.session) {
      authView.hidden = false;
      return;
    }
    try {
      const isAdmin = await checkAdmin();
      if (!isAdmin) {
        await sb.auth.signOut();
        authView.hidden = false;
        authError("This account is not on the administrator allowlist.");
        return;
      }
      await startApp(data.session);
    } catch (err) {
      authView.hidden = false;
      if (err instanceof SetupNeeded) return showSetupNeeded();
      authError(friendly(err));
    }
  })();
})();
