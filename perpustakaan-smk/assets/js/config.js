export const categories = ["Pendidikan", "Novel", "Sejarah", "Teknologi", "Agama", "Komik", "Sains", "Referensi"];
export const statuses = { pending: "Menunggu persetujuan", approved: "Sedang dipinjam", rejected: "Ditolak", returned: "Dikembalikan" };
let csrfToken = "";

export class ApiError extends Error {
  constructor(message) {
    super(message);
    this.name = "ApiError";
  }
}

export function setCsrf(token) {
  csrfToken = token;
}

export async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (csrfToken) headers.set("X-CSRF-Token", csrfToken);
  if (options.body && !(options.body instanceof FormData) && typeof options.body !== "string") {
    headers.set("Content-Type", "application/json");
    options = { ...options, body: JSON.stringify(options.body) };
  }
  const response = await fetch(`/api${path}`, { credentials: "same-origin", ...options, headers });
  const payload = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(payload?.error || `Permintaan gagal (${response.status}).`);
  }
  return payload;
}

export function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

export function rupiah(value) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(Number(value) || 0);
}

export function dateLabel(value) {
  if (!value) return "—";
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  return new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

export function toast(message, kind = "info") {
  const region = document.querySelector("#toast-region");
  if (!region) return;
  const item = document.createElement("div");
  item.className = `toast toast-${kind}`;
  item.textContent = message;
  region.append(item);
  window.setTimeout(() => item.remove(), 3800);
}

export function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

export function emptyState(title, text) {
  return `<div class="empty-state"><span class="empty-icon">✦</span><strong>${escapeHtml(title)}</strong><p>${escapeHtml(text)}</p></div>`;
}

export function bookCard(book, favoriteIds = []) {
  const cover = book.cover
    ? `<img src="${escapeHtml(book.cover)}" alt="Sampul ${escapeHtml(book.title)}" loading="lazy" onerror="this.closest('.book-cover').classList.add('cover-fallback');this.remove()">`
    : "";
  return `<article class="book-card">
    <a class="book-cover ${cover ? "" : "cover-fallback"}" href="/book-detail.html?id=${book.id}">${cover}<span class="cover-title">${escapeHtml(book.title)}</span><span class="cover-category">${escapeHtml(book.category)}</span></a>
    <div class="book-info"><span class="eyebrow">${escapeHtml(book.category)}</span><h3><a href="/book-detail.html?id=${book.id}">${escapeHtml(book.title)}</a></h3>
    <p class="muted">${escapeHtml(book.author)}</p><div class="book-bottom"><span class="stock ${book.stock > 0 ? "available" : "unavailable"}">${book.stock > 0 ? `${book.stock} tersedia` : "Stok habis"}</span>
    <button class="icon-button favorite-toggle" data-book-id="${book.id}" aria-label="Favorit" title="Favorit">${favoriteIds.includes(book.id) ? "♥" : "♡"}</button></div></div></article>`;
}

export function statusBadge(status, dueDate) {
  const late = status === "approved" && dueDate && dueDate < new Date().toISOString().slice(0, 10);
  return `<span class="badge ${late ? "badge-danger" : `badge-${status}`}">${late ? "Terlambat" : (statuses[status] || status)}</span>`;
}
