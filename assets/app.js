/* ===== Theme ===== */
(function () {
  const saved = localStorage.getItem("matn-theme");
  if (saved) document.documentElement.setAttribute("data-theme", saved);
})();

function toggleTheme() {
  const el = document.documentElement;
  const next = el.getAttribute("data-theme") === "dark" ? "light" : "dark";
  el.setAttribute("data-theme", next);
  localStorage.setItem("matn-theme", next);
  updateThemeLabel();
}
function updateThemeLabel() {
  const btn = document.getElementById("theme-toggle");
  if (!btn) return;
  const dark = document.documentElement.getAttribute("data-theme") === "dark";
  btn.textContent = dark ? "روشن" : "تاریک";
}

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

/* ===== Render grid ===== */
const FA_DIGITS = ["۰", "۱", "۲", "۳", "۴", "۵", "۶", "۷", "۸", "۹"];
function faNum(n) {
  return String(n).replace(/\d/g, (d) => FA_DIGITS[d]);
}

let BOOKS = [];

async function init() {
  document.getElementById("theme-toggle")?.addEventListener("click", toggleTheme);
  updateThemeLabel();
  setupModal();

  const grid = document.getElementById("grid");
  try {
    const res = await fetch("books.json", { cache: "no-cache" });
    BOOKS = await res.json();
  } catch (e) {
    grid.innerHTML = "";
    document.getElementById("empty-note").textContent =
      "خواندن فهرست کتاب‌ها ممکن نشد. لطفاً books.json را بررسی کنید.";
    return;
  }

  if (!Array.isArray(BOOKS) || BOOKS.length === 0) {
    document.getElementById("empty-note").textContent = "هنوز کتابی اضافه نشده است.";
    return;
  }

  grid.innerHTML = BOOKS.map((b, i) => cardHTML(b, i)).join("");
  grid.querySelectorAll(".card").forEach((el) => {
    el.addEventListener("click", () => openModal(Number(el.dataset.index)));
  });
}

function cardHTML(b, i) {
  const cover = bookFile(b, b.cover);
  const coverInner = cover
    ? `<img src="${cover}" alt="${escapeHtml(b.title)}" loading="lazy"
           onerror="this.parentElement.classList.add('is-empty');this.remove();">`
    : "";
  const emptyClass = cover ? "" : "is-empty";
  return `
    <article class="card" data-index="${i}">
      <div class="card__cover ${emptyClass}" data-title="${escapeHtml(b.title)}">${coverInner}</div>
      <div class="card__meta">
        <div>
          <div class="card__title">${escapeHtml(b.title)}</div>
          <div class="card__author">${escapeHtml(b.author || "")}</div>
        </div>
        <div class="card__num"><span class="ltr">${faNum(String(i + 1).padStart(2, "0"))}</span></div>
      </div>
    </article>`;
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

  const rows = [
    ["نویسنده", b.author],
    ["سال", b.year, true],
    ["دسته‌بندی", b.category],
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

  const tags = (b.tags || [])
    .map((t) => `<span>${escapeHtml(t)}</span>`)
    .join("");
  document.getElementById("m-tags").innerHTML = tags;

  const mc = document.getElementById("m-cover");
  mc.innerHTML = cover
    ? `<img src="${cover}" alt="${escapeHtml(b.title)}" onerror="this.remove()">`
    : "";

  const filenameBase = (b.slug || "book").replace(/\s+/g, "-");
  setupDlButton("dl-light", light, `${filenameBase}-light.pdf`);
  setupDlButton("dl-dark", dark, `${filenameBase}-dark.pdf`);

  document.getElementById("modal-backdrop").classList.add("open");
  document.body.style.overflow = "hidden";
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
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

document.addEventListener("DOMContentLoaded", init);
