/* ===== Paths ===== */
// Build a file path from a book. If the stored value already looks like a full
// URL (e.g. a GitHub Releases asset on another origin), use it as-is.
function bookFile(book, filename) {
  if (!filename) return null;
  if (/^https?:\/\//i.test(filename)) return filename;
  return `books/${book.slug}/${filename}`;
}

/* ===== Forced download (works same-origin and cross-origin) ===== */
async function downloadFile(url, suggestedName) {
  const sameOrigin = url.startsWith("books/") || url.startsWith(location.origin);
  // Same-origin: the download attribute is honoured reliably.
  if (sameOrigin) {
    triggerAnchor(url, suggestedName);
    return;
  }
  // Cross-origin (e.g. Releases on another domain): the download attribute is
  // ignored, so fetch the bytes and download the blob instead. Fall back to a
  // normal navigation if the remote host blocks CORS.
  try {
    const res = await fetch(url, { mode: "cors" });
    if (!res.ok) throw new Error("bad status " + res.status);
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    triggerAnchor(objectUrl, suggestedName);
    setTimeout(() => URL.revokeObjectURL(objectUrl), 4000);
  } catch (e) {
    // CORS or network failure: open in a new tab as a last resort.
    window.open(url, "_blank", "noopener");
  }
}
function triggerAnchor(href, name) {
  const a = document.createElement("a");
  a.href = href;
  if (name) a.download = name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/* ===== State ===== */
let BOOKS = [];
const PAGE = 60; // cards rendered per batch — keeps the DOM small with many books
let view = []; // current (possibly filtered) list
let shown = 0; // how many of `view` are in the DOM
let sentinelObserver = null;
const grid = () => document.getElementById("grid");

async function init() {
  setupSearch();
  setupModal();
  setupGridDelegation();

  try {
    const res = await fetch("books.json", { cache: "no-cache" });
    BOOKS = await res.json();
  } catch (e) {
    document.getElementById("empty-note").textContent =
      "خواندن فهرست کتاب‌ها ممکن نشد. لطفاً books.json را بررسی کنید.";
    return;
  }

  if (!Array.isArray(BOOKS) || BOOKS.length === 0) {
    document.getElementById("empty-note").textContent = "هنوز کتابی اضافه نشده است.";
    return;
  }

  // Precompute, once: stable index (so filtered cards still map back) and a
  // lowercased search haystack (so filtering never rebuilds strings per keypress).
  BOOKS.forEach((b, i) => {
    b._idx = i;
    b._hay = [b.title, b.author, b.category, (b.tags || []).join(" ")]
      .join(" ")
      .toLowerCase();
  });

  setupSentinel();
  showList(BOOKS);
}

/* ===== Incremental rendering ===== */
// Render `list` from scratch, then stream in more batches as the user scrolls.
function showList(list) {
  view = list;
  shown = 0;
  const g = grid();
  g.classList.remove("is-faded"); // reset any stale hover-fade on re-render
  g.innerHTML = "";
  appendBatch();
}

function appendBatch() {
  if (shown >= view.length) return;
  const next = view.slice(shown, shown + PAGE);
  grid().insertAdjacentHTML("beforeend", next.map(cardHTML).join(""));
  shown += next.length;
}

function setupSentinel() {
  if (sentinelObserver) return;
  const sentinel = document.getElementById("grid-sentinel");
  sentinelObserver = new IntersectionObserver(
    (entries) => {
      // Keep appending while the sentinel stays in view (e.g. tall screens).
      if (entries.some((e) => e.isIntersecting)) appendBatch();
    },
    { rootMargin: "600px 0px" } // start loading a bit before it's reached
  );
  sentinelObserver.observe(sentinel);
}

function cardHTML(b) {
  const cover = bookFile(b, b.cover);
  const coverInner = cover
    ? `<img src="${cover}" alt="${escapeHtml(b.title)}" loading="lazy" decoding="async"
           onerror="this.parentElement.classList.add('is-empty');this.remove();">`
    : "";
  const emptyClass = cover ? "" : "is-empty";
  const author = b.author
    ? `<a class="card__author" data-author="${escapeHtml(b.author)}">${escapeHtml(b.author)}</a>`
    : "";
  return `
    <article class="card" data-index="${b._idx}">
      <div class="card__cover ${emptyClass}" data-title="${escapeHtml(b.title)}">${coverInner}</div>
      <div class="card__meta">
        <div class="card__title">${escapeHtml(b.title)}</div>
        ${author}
      </div>
    </article>`;
}

// One delegated listener for the whole grid — no per-card handlers, so it stays
// cheap no matter how many cards are rendered.
function setupGridDelegation() {
  const g = grid();
  g.addEventListener("click", (e) => {
    const authorEl = e.target.closest(".card__author");
    if (authorEl) {
      e.stopPropagation();
      filterByFacet("author", authorEl.dataset.author);
      return;
    }
    const card = e.target.closest(".card");
    if (card) openModal(Number(card.dataset.index));
  });

  // Deterministic hover-fade: dim every card except the one under the cursor.
  // Hovering the empty gaps (target is the grid itself) clears the fade.
  g.addEventListener("mouseover", (e) => setHovered(e.target.closest(".card")));
  g.addEventListener("mouseleave", () => setHovered(null));
}

function setHovered(card) {
  // Hover-fade is fully disabled while a modal is open.
  if (document.body.classList.contains("modal-open")) return;
  const g = grid();
  const prev = g.querySelector(".card.is-hover");
  if (prev && prev !== card) prev.classList.remove("is-hover");
  if (card) {
    card.classList.add("is-hover");
    g.classList.add("is-faded");
  } else {
    g.classList.remove("is-faded");
  }
}

/* ===== Search / filter ===== */
function setupSearch() {
  const toggle = document.getElementById("search-toggle");
  const panel = document.getElementById("search-panel");
  const input = document.getElementById("search-input");

  toggle.addEventListener("click", () => {
    const open = panel.hasAttribute("hidden");
    if (open) {
      panel.removeAttribute("hidden");
      toggle.setAttribute("aria-expanded", "true");
      input.focus();
    } else {
      panel.setAttribute("hidden", "");
      toggle.setAttribute("aria-expanded", "false");
    }
  });

  // Debounce so a fast typist filters once they pause, not on every keystroke.
  let t;
  input.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(() => applySearch(input.value), 120);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      input.value = "";
      applySearch("");
      panel.setAttribute("hidden", "");
      toggle.setAttribute("aria-expanded", "false");
    }
  });
}

function applySearch(raw) {
  const q = (raw || "").trim().toLowerCase();
  const meta = document.getElementById("search-meta");
  // Search and tag-filtering are independent: typing a query drops any active
  // tag filter so the two never mix.
  clearFacetState();
  if (!q) {
    showList(BOOKS);
    meta.textContent = "";
    return;
  }
  const list = BOOKS.filter((b) => b._hay.includes(q));
  showList(list);
  meta.textContent = list.length ? `${faNum(list.length)} نتیجه` : "نتیجه‌ای یافت نشد";
}

/* ===== Tag filter (author / category / tag) — separate from search ===== */
// Three distinct, typed facet dimensions. They never mix: an author "رمان" and
// a category "رمان" are different facets because each filter carries its type.
let activeFacet = null;
const FACET_LABELS = { author: "نویسنده", translator: "مترجم", category: "نوع", tag: "موضوع" };

function matchFacet(b, type, value) {
  if (type === "author") return b.author === value;
  if (type === "translator") return b.translator === value;
  if (type === "category") return b.category === value;
  if (type === "tag") return (b.tags || []).includes(value);
  return false;
}

function filterByFacet(type, value) {
  if (!type || !value) return;
  activeFacet = { type, value };
  closeModal();
  // Tag filtering is independent from search: clear and close the search field.
  const input = document.getElementById("search-input");
  const panel = document.getElementById("search-panel");
  const toggle = document.getElementById("search-toggle");
  input.value = "";
  document.getElementById("search-meta").textContent = "";
  panel.setAttribute("hidden", "");
  toggle.setAttribute("aria-expanded", "false");

  showList(BOOKS.filter((b) => matchFacet(b, type, value)));

  const bar = document.getElementById("filter-bar");
  document.getElementById("filter-chip").innerHTML =
    `<span class="filter-chip__type">${FACET_LABELS[type] || ""}</span>` +
    `${escapeHtml(value)}<span class="filter-chip__x">✕</span>`;
  bar.removeAttribute("hidden");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// Hide the filter bar and forget the active facet (does not re-render).
function clearFacetState() {
  activeFacet = null;
  document.getElementById("filter-bar").setAttribute("hidden", "");
}

function clearFacet() {
  clearFacetState();
  showList(BOOKS);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// Brand acts as Home: drop every filter and show the full catalog.
function goHome() {
  clearFacetState();
  const input = document.getElementById("search-input");
  input.value = "";
  document.getElementById("search-meta").textContent = "";
  document.getElementById("search-panel").setAttribute("hidden", "");
  document.getElementById("search-toggle").setAttribute("aria-expanded", "false");
  closeModal();
  showList(BOOKS);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/* ===== Modal ===== */
function setupModal() {
  const backdrop = document.getElementById("modal-backdrop");
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) closeModal();
  });
  document.getElementById("modal-close").addEventListener("click", closeModal);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });

  // Home button + clear-filter chip.
  document.getElementById("home").addEventListener("click", goHome);
  document.getElementById("filter-chip").addEventListener("click", clearFacet);

  // Delegated clicks on the modal's tag chips → filter by that facet.
  document.getElementById("m-tags").addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (chip) filterByFacet(chip.dataset.type, chip.dataset.value);
  });
}

function openModal(i) {
  const b = BOOKS[i];
  if (!b) return;
  const cover = bookFile(b, b.cover);
  const light = bookFile(b, b.file_light);
  const dark = bookFile(b, b.file_dark);

  document.getElementById("m-title").textContent = b.title || "";
  document.getElementById("m-desc").textContent = b.description || "";

  // Plain info rows (year/language/pages). Author and category live in the
  // clickable chips below, so they're not repeated here.
  const rows = [
    ["سال", b.year, true],
    ["زبان", b.language],
    ["صفحات", b.pages, true],
  ]
    .filter(([, v]) => v)
    .map(
      ([k, v, ltr]) =>
        `<div class="modal__row"><span class="k">${k}</span><span class="v">${
          ltr ? `<span class="ltr">${escapeHtml(String(v))}</span>` : escapeHtml(String(v))
        }</span></div>`
    )
    .join("");
  document.getElementById("m-rows").innerHTML = rows;

  // Clickable tags, kept in distinct groups: author, translator (only for
  // translated books), then type-of-writing (category), then subject tags.
  // Each carries its facet type.
  const chips = [];
  if (b.author) chips.push({ type: "author", value: b.author });
  if (b.translator) chips.push({ type: "translator", value: b.translator });
  if (b.category) chips.push({ type: "category", value: b.category });
  (b.tags || []).forEach((t) => chips.push({ type: "tag", value: t }));
  document.getElementById("m-tags").innerHTML = chips
    .map(
      (c) =>
        `<button class="chip chip--${c.type}" type="button" data-type="${c.type}" data-value="${escapeHtml(
          c.value
        )}">${escapeHtml(c.value)}</button>`
    )
    .join("");

  const mc = document.getElementById("m-cover");
  mc.innerHTML = cover
    ? `<img src="${cover}" alt="${escapeHtml(b.title)}" onerror="this.remove()">`
    : "";

  const filenameBase = (b.slug || "book").replace(/\s+/g, "-");
  setupDlButton("dl-light", light, `${filenameBase}-light.pdf`);
  setupDlButton("dl-dark", dark, `${filenameBase}-dark.pdf`);

  setHovered(null); // clear any hover-fade left from the click (before the guard)
  document.body.classList.add("modal-open");
  const backdrop = document.getElementById("modal-backdrop");
  backdrop.classList.add("open");
  document.body.style.overflow = "hidden";
  // Always show the modal from its top, regardless of the previous scroll.
  backdrop.scrollTop = 0;
}

function setupDlButton(id, url, name) {
  const btn = document.getElementById(id);
  if (!url) {
    btn.style.display = "none";
    return;
  }
  btn.style.display = "";
  btn.onclick = async () => {
    btn.disabled = true;
    await downloadFile(url, name);
    btn.disabled = false;
  };
}

function closeModal() {
  document.getElementById("modal-backdrop").classList.remove("open");
  document.body.classList.remove("modal-open");
  document.body.style.overflow = "";
}

/* ===== util ===== */
const FA_DIGITS = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"];
function faNum(n) {
  return String(n).replace(/\d/g, (d) => FA_DIGITS[d]);
}
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

document.addEventListener("DOMContentLoaded", init);
