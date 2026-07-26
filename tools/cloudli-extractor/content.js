(async function () {
  // ============================================================================
  // Cloudli Mapper Pro — functional UI extractor
  //
  // Goal: produce a per-page FUNCTIONAL model (what can a user DO here?), rich
  // enough that a coding agent can turn each page into a natural-language spec
  // and diff it against the Carameli front-end. We capture intent-bearing
  // structure (forms, filters, tables, actions, tabs, dialogs) — not pixels.
  //
  // Messaging / storage contract is unchanged so background.js & popup.js keep
  // working: storage keys {isMapping, urlQueue, queueIndex, results} and the
  // messages "page_failed" / "mapping_complete".
  // ============================================================================

  const sleep = (ms) => new Promise((res) => setTimeout(res, ms + Math.random() * 1500));
  const CAPS = { descriptions: 40, actions: 60, fields: 80, options: 25, sampleRows: 3, excerpt: 1500, modals: 8, sitemap: 300 };

  // --- small DOM helpers ------------------------------------------------------
  const clean = (t) => (t || "").replace(/\s+/g, " ").trim();
  const cssEscape = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/["\\#.:>~+\[\]()]/g, "\\$&"));
  const uniq = (arr) => Array.from(new Set(arr.filter(Boolean)));
  const isVisible = (el) => !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length));

  // Resolve a human label for a form control, in priority order.
  const labelFor = (el) => {
    if (el.id) {
      const l = document.querySelector(`label[for="${cssEscape(el.id)}"]`);
      if (l && clean(l.innerText)) return clean(l.innerText);
    }
    const wrap = el.closest("label");
    if (wrap) {
      const txt = clean(wrap.innerText);
      if (txt) return txt;
    }
    if (el.getAttribute("aria-label")) return clean(el.getAttribute("aria-label"));
    const labelledby = el.getAttribute("aria-labelledby");
    if (labelledby) {
      const ref = document.getElementById(labelledby);
      if (ref) return clean(ref.innerText);
    }
    // label sitting immediately before the control
    const prev = el.previousElementSibling;
    if (prev && /label|span|strong/i.test(prev.tagName) && clean(prev.innerText)) return clean(prev.innerText);
    return clean(el.placeholder) || clean(el.getAttribute("title")) || clean(el.name) || "";
  };

  // Derive a label for an action element, including icon-only buttons.
  const actionLabel = (el) => {
    let txt = clean(el.innerText) || clean(el.value) || clean(el.getAttribute("aria-label")) || clean(el.getAttribute("title"));
    if (txt) return txt;
    // icon-only: derive from icon class e.g. "fa-trash", "icon-export", "mdi-pencil"
    const icon = el.querySelector('[class*="icon"], [class*="fa-"], i, svg');
    if (icon) {
      const cls = (icon.getAttribute("class") || "").match(/(?:fa-|icon-|mdi-|glyphicon-)([a-z0-9-]+)/i);
      if (cls) return `(icon: ${cls[1]})`;
      const aria = icon.getAttribute("aria-label") || icon.getAttribute("title");
      if (aria) return clean(aria);
    }
    return "";
  };

  const fieldKind = (el) => {
    const tag = el.tagName.toLowerCase();
    if (tag === "select") return "select";
    if (tag === "textarea") return "textarea";
    return (el.getAttribute("type") || "text").toLowerCase();
  };

  // ---------------------------------------------------------------------------
  // Wait until the page has loaded AND the DOM stops mutating for a quiet period.
  // Avoids capturing half-rendered SPA pages (the old fixed sleep missed data).
  // ---------------------------------------------------------------------------
  const waitForSettle = (maxMs = 7000, quietMs = 700) =>
    new Promise((resolve) => {
      const start = () => {
        let done = false;
        let quietTimer;
        const finish = () => {
          if (done) return;
          done = true;
          clearTimeout(quietTimer);
          clearTimeout(hardTimer);
          try { obs.disconnect(); } catch (_) {}
          resolve();
        };
        const obs = new MutationObserver(() => {
          clearTimeout(quietTimer);
          quietTimer = setTimeout(finish, quietMs);
        });
        try { obs.observe(document.body, { childList: true, subtree: true, attributes: true }); } catch (_) {}
        const hardTimer = setTimeout(finish, maxMs);
        quietTimer = setTimeout(finish, quietMs);
      };
      if (document.readyState === "complete" || document.readyState === "interactive") start();
      else window.addEventListener("DOMContentLoaded", start, { once: true });
    });

  // ============================================================================
  // 0. Access / permission guard
  // ============================================================================
  if (document.body.innerText.includes("Permission denied") || document.body.innerText.includes("You are not allowed")) {
    console.warn("⚠️ Access Denied. Skipping page...");
    chrome.runtime.sendMessage({ action: "page_failed" });
    return;
  }

  const state = await chrome.storage.local.get(["isMapping", "urlQueue", "queueIndex", "results"]);
  if (!state.isMapping) return;

  let queue = state.urlQueue || [];
  let index = state.queueIndex || 0;
  let results = state.results || [];

  // ============================================================================
  // PHASE 1: DISCOVERY — build the queue + a navigation sitemap (runs once)
  // ============================================================================
  if (queue.length === 0) {
    console.log("🔍 Building navigation map...");
    const navAnchors = Array.from(document.querySelectorAll('.menu a, .sidebar a, nav a, ul.collapse a, [role="navigation"] a, aside a'));

    const sitemap = [];
    const urls = new Set();
    const skip = /(logout|sign[\s-]?out|log[\s-]?off)/i; // never crawl logout — it kills the session

    navAnchors.forEach((a) => {
      const href = a.href || "";
      const label = clean(a.innerText) || clean(a.getAttribute("title")) || clean(a.getAttribute("aria-label"));
      if (!href.startsWith("http")) return;            // skip mailto:/tel:/javascript:/#
      if (!href.includes("connect.cloudli.com")) return; // stay in-app
      if (href.replace(/#.*$/, "") === window.location.href.replace(/#.*$/, "") && href.includes("#") && href.split("#")[1] === "") return; // bare same-page anchor
      if (skip.test(href) || skip.test(label)) return;
      // group = nearest section header in the menu
      const group = clean(
        (a.closest("li, .menu-section, .nav-item, details")?.querySelector(".menu-header, .nav-header, summary, h2, h3")?.innerText) || ""
      );
      sitemap.push({ label: label || "(unlabeled)", href, group });
      urls.add(href);
    });

    queue = Array.from(urls).slice(0, CAPS.sitemap);
    index = 0;

    if (queue.length === 0) {
      console.error("Could not find any navigation links. Ensure you are logged in.");
      return;
    }

    // Sitemap rides along as the first result entry so background.js still just
    // downloads `results` unchanged.
    results.push({
      url: "__sitemap__",
      title: "Navigation Sitemap",
      capturedAt: new Date().toISOString(),
      pageCount: queue.length,
      sitemap: sitemap.slice(0, CAPS.sitemap),
    });

    await chrome.storage.local.set({ urlQueue: queue, queueIndex: index, results });
    console.log(`🎯 Map ready: ${queue.length} pages. Beginning functional extraction...`);
  }

  // ============================================================================
  // PHASE 2: FUNCTIONAL EXTRACTION
  // ============================================================================
  if (index < queue.length) {
    if (window.location.href === queue[index] || index > 0) {
      await waitForSettle();

      const parsePage = () => {
        const page = {
          breadcrumb: [],
          headings: [],
          forms: [],
          filters: [],
          tables: [],
          actions: [],
          tabs: [],
          dialogs: [],
          descriptions: [],
          textExcerpt: "",
        };

        // --- breadcrumb -----------------------------------------------------
        page.breadcrumb = uniq(
          Array.from(document.querySelectorAll('.breadcrumb li, .breadcrumb a, [aria-label="breadcrumb"] li, nav.breadcrumb *'))
            .map((el) => clean(el.innerText))
        ).slice(0, 10);

        // --- heading outline ------------------------------------------------
        page.headings = Array.from(document.querySelectorAll("h1, h2, h3, h4"))
          .filter(isVisible)
          .map((h) => ({ level: Number(h.tagName[1]), text: clean(h.innerText) }))
          .filter((h) => h.text)
          .slice(0, 30);

        // --- inputs (shared scan; classified into forms + filters) ----------
        const allControls = Array.from(document.querySelectorAll("input, select, textarea")).filter(
          (el) => !["button", "submit", "reset", "image"].includes((el.getAttribute("type") || "").toLowerCase())
        );

        const describeField = (el) => {
          const kind = fieldKind(el);
          const f = { label: labelFor(el), kind, required: el.required || el.getAttribute("aria-required") === "true" };
          if (el.placeholder) f.placeholder = clean(el.placeholder);
          if (kind === "select") {
            f.options = Array.from(el.options).map((o) => clean(o.text)).filter(Boolean).slice(0, CAPS.options);
          }
          const val = clean(el.value);
          if (val && kind !== "password") f.value = val.slice(0, 80);
          return f;
        };

        // forms: group controls by their <form> (or a synthetic "ungrouped")
        const formEls = Array.from(document.querySelectorAll("form"));
        const seen = new Set();
        formEls.forEach((form) => {
          const controls = Array.from(form.querySelectorAll("input, select, textarea")).filter((el) => allControls.includes(el));
          if (!controls.length) return;
          controls.forEach((c) => seen.add(c));
          const heading = clean(
            form.querySelector("legend, h1, h2, h3, h4")?.innerText ||
              form.getAttribute("aria-label") ||
              form.closest("section, .card, .panel")?.querySelector("h1, h2, h3, h4")?.innerText ||
              ""
          );
          const submitEl = form.querySelector('button[type="submit"], input[type="submit"], button:not([type])');
          page.forms.push({
            heading: heading || "(form)",
            submit: submitEl ? actionLabel(submitEl) || null : null,
            fields: controls.map(describeField).slice(0, CAPS.fields),
          });
        });
        const ungrouped = allControls.filter((c) => !seen.has(c));
        if (ungrouped.length) {
          page.forms.push({ heading: "(standalone controls)", fields: ungrouped.map(describeField).slice(0, CAPS.fields) });
        }

        // --- filters: the controls a user uses to narrow data ---------------
        const dateRe = /date|from\b|to\b|start|end|day|month|year|period|range|since|until/i;
        const searchRe = /search|filter|query|find|keyword/i;
        allControls.forEach((el) => {
          const kind = fieldKind(el);
          const label = labelFor(el);
          const hay = `${label} ${el.name || ""} ${el.placeholder || ""}`;
          let role = null;
          if (["date", "datetime-local", "month", "week", "time"].includes(kind) || dateRe.test(hay)) role = "date";
          else if (kind === "search" || searchRe.test(hay)) role = "search";
          else if (kind === "select" && el.closest("table, .table, .filters, .toolbar, [class*=filter]")) role = "dropdown-filter";
          if (role) page.filters.push({ role, label: label || `(${kind})`, kind });
        });
        page.filters = page.filters.slice(0, 25);

        // --- tables / data grids --------------------------------------------
        Array.from(document.querySelectorAll('table, [role="table"], [role="grid"]')).forEach((table) => {
          const columns = uniq(
            Array.from(table.querySelectorAll('thead th, thead td, [role="columnheader"]')).map((th) => clean(th.innerText))
          );
          if (!columns.length) {
            const firstRow = table.querySelector("tr");
            if (firstRow) columns.push(...Array.from(firstRow.querySelectorAll("th, td")).map((c) => clean(c.innerText)).filter(Boolean));
          }
          if (!columns.length) return;

          const bodyRows = Array.from(table.querySelectorAll("tbody tr")).filter(isVisible);
          const sampleRows = bodyRows.slice(0, CAPS.sampleRows).map((tr) =>
            Array.from(tr.querySelectorAll("td, th")).map((td) => clean(td.innerText).slice(0, 60))
          );
          const rowActions = uniq(
            Array.from(table.querySelectorAll('tbody button, tbody a.btn, tbody [role="button"], tbody [class*="action"]')).map(actionLabel)
          ).slice(0, 12);
          const sortableColumns = uniq(
            Array.from(table.querySelectorAll('th[aria-sort], th[class*="sort"], th a, th [class*="sort"]'))
              .map((th) => clean(th.closest("th")?.innerText || th.innerText))
          );
          const emptyState = bodyRows.length === 0
            ? clean(table.querySelector("tbody")?.innerText || table.nextElementSibling?.innerText || "") || null
            : null;
          const paginated = !!table.closest("*")?.parentElement?.querySelector?.('.pagination, [aria-label*="pag" i], [class*="pagination"]');

          page.tables.push({
            caption: clean(table.querySelector("caption")?.innerText) || null,
            columns: columns.slice(0, 40),
            rowCount: bodyRows.length,
            sampleRows,
            rowActions,
            sortableColumns: sortableColumns.slice(0, 40),
            paginated,
            emptyState,
          });
        });

        // --- page-level actions (exclude in-row actions captured above) -----
        const actionEls = Array.from(
          document.querySelectorAll('button, [role="button"], a.btn, a.button, input[type="button"], input[type="submit"], [class*="btn"]')
        ).filter((el) => !el.closest("tbody") && isVisible(el));
        page.actions = uniq(
          actionEls.map((el) => {
            const label = actionLabel(el);
            if (!label) return null;
            const isLink = el.tagName.toLowerCase() === "a" && el.href;
            return isLink ? `${label} -> ${el.getAttribute("href")}` : label;
          })
        ).slice(0, CAPS.actions);

        // --- tabs -----------------------------------------------------------
        page.tabs = uniq(
          Array.from(document.querySelectorAll('[role="tab"], .nav-tabs a, .nav-tabs li, .tabs a, [class*="tab-"] [class*="tab"]'))
            .filter(isVisible)
            .map((t) => clean(t.innerText))
        ).slice(0, 20);

        // --- dialogs / modals (reveal create & edit capabilities) -----------
        Array.from(document.querySelectorAll('.modal, [role="dialog"], dialog')).slice(0, CAPS.modals).forEach((m) => {
          const title = clean(m.querySelector(".modal-title, h1, h2, h3, header")?.innerText) || clean(m.getAttribute("aria-label"));
          const fields = uniq(Array.from(m.querySelectorAll("input, select, textarea")).map(labelFor)).slice(0, 30);
          const buttons = uniq(Array.from(m.querySelectorAll("button, .btn")).map(actionLabel)).slice(0, 15);
          if (title || fields.length || buttons.length) page.dialogs.push({ title: title || "(dialog)", fields, buttons });
        });

        // --- instructional / descriptive text -------------------------------
        page.descriptions = uniq(
          Array.from(document.querySelectorAll("p, .description, .help-block, .form-text, .text-muted, [class*='hint'], [class*='subtitle']"))
            .filter(isVisible)
            .map((el) => clean(el.innerText))
            .filter((t) => t.length > 8 && t.length < 400)
        ).slice(0, CAPS.descriptions);

        // --- visible text excerpt (fuel for NL summary) ---------------------
        const cloneForText = document.body.cloneNode(true);
        ["nav", "header", "footer", "script", "style", ".menu", ".sidebar", "#sidebar", ".navigation", "svg"].forEach((sel) =>
          cloneForText.querySelectorAll(sel).forEach((n) => n.remove())
        );
        page.textExcerpt = clean(cloneForText.innerText).slice(0, CAPS.excerpt);

        return page;
      };

      let layout;
      try {
        layout = parsePage();
      } catch (err) {
        layout = { error: String(err && err.message ? err.message : err) };
      }

      const pageData = { url: window.location.href, title: document.title || "Feature Tab", layout };

      if (results.length === 0 || results[results.length - 1].url !== window.location.href) {
        results.push(pageData);
      }
    }

    const nextIndex = index + 1;
    await chrome.storage.local.set({ results, queueIndex: nextIndex });

    if (nextIndex >= queue.length) {
      console.log("✅ Finished all pages. Saving output...");
      chrome.runtime.sendMessage({ action: "mapping_complete" });
      return;
    }

    console.log(`🚀 Navigating ${nextIndex + 1}/${queue.length}: ${queue[nextIndex]}`);
    await sleep(2000);
    window.location.href = queue[nextIndex];
  } else if (queue.length > 0) {
    chrome.runtime.sendMessage({ action: "mapping_complete" });
  }
})();
