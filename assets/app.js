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
const grid = () => document.getElementById("grid");

async function init() {
  setupSearch();
  setupModal();

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

  // Keep each book's original index so cards in a filtered view still map back.
  BOOKS.forEach((b, i) => (b._idx = i));
  renderGrid(BOOKS);
}

/* ===== Grid ===== */
function renderGrid(list) {
  const g = grid();
  g.innerHTML = list.map((b) => cardHTML(b)).join("");
  g.querySelectorAll(".card").forEach((el) => {
    el.addEventListener("click", (e) => {
      // Author click filters instead of opening the modal.
      if (e.target.closest(".card__author")) {
        e.stopPropagation();
        filterByAuthor(e.target.closest(".card__author").dataset.author);
        return;
      }
      openModal(Number(el.dataset.index));
    });
  });
}

function cardHTML(b) {
  const cover = bookFile(b, b.cover);
  const coverInner = cover
    ? `<img src="${cover}" alt="${escapeHtml(b.title)}" loading="lazy"
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

  input.addEventListener("input", () => applySearch(input.value));
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
  if (!q) {
    renderGrid(BOOKS);
    meta.textContent = "";
    return;
  }
  const list = BOOKS.filter((b) => {
    const hay = [b.title, b.author, b.category, (b.tags || []).join(" ")]
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  });
  renderGrid(list);
  meta.textContent = list.length
    ? `${faNum(list.length)} نتیجه`
    : "نتیجه‌ای یافت نشد";
}

function filterByAuthor(author) {
  if (!author) return;
  const panel = document.getElementById("search-panel");
  const input = document.getElementById("search-input");
  const toggle = document.getElementById("search-toggle");
  closeModal();
  panel.removeAttribute("hidden");
  toggle.setAttribute("aria-expanded", "true");
  input.value = author;
  applySearch(author);
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
}

function openModal(i) {
  const b = BOOKS[i];
  if (!b) return;
  const cover = bookFile(b, b.cover);
  const light = bookFile(b, b.file_light);
  const dark = bookFile(b, b.file_dark);

  document.getElementById("m-title").textContent = b.title || "";
  document.getElementById("m-desc").textContent = b.description || "";

  const rows = [];
  if (b.author) {
    rows.push(
      `<div class="modal__row"><span class="k">نویسنده</span>` +
        `<span class="v author"><a class="alink" data-author="${escapeHtml(b.author)}">${escapeHtml(
          b.author
        )}</a></span></div>`
    );
  }
  [
    ["سال", b.year, true],
    ["دسته‌بندی", b.category],
    ["زبان", b.language],
    ["صفحات", b.pages, true],
  ]
    .filter(([, v]) => v)
    .forEach(([k, v, ltr]) => {
      rows.push(
        `<div class="modal__row"><span class="k">${k}</span><span class="v">${
          ltr ? `<span class="ltr">${escapeHtml(String(v))}</span>` : escapeHtml(String(v))
        }</span></div>`
      );
    });
  const rowsEl = document.getElementById("m-rows");
  rowsEl.innerHTML = rows.join("");
  const authorLink = rowsEl.querySelector(".alink");
  if (authorLink) {
    authorLink.addEventListener("click", () => filterByAuthor(authorLink.dataset.author));
  }

  document.getElementById("m-tags").innerHTML = (b.tags || [])
    .map((t) => `<span>${escapeHtml(t)}</span>`)
    .join("");

  const mc = document.getElementById("m-cover");
  mc.innerHTML = cover
    ? `<img src="${cover}" alt="${escapeHtml(b.title)}" onerror="this.remove()">`
    : "";

  const filenameBase = (b.slug || "book").replace(/\s+/g, "-");
  setupDlButton("dl-light", light, `${filenameBase}-light.pdf`);
  setupDlButton("dl-dark", dark, `${filenameBase}-dark.pdf`);

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
