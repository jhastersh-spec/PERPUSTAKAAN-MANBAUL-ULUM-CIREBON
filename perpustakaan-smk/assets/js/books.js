import { api, bookCard, categories, dateLabel, emptyState, escapeHtml, formData, toast } from "./config.js";

export async function renderCatalog(root, user) {
  const params = new URLSearchParams(location.search);
  root.innerHTML = `<div class="page-heading"><div><span class="eyebrow">JELAJAHI KOLEKSI</span><h1>Katalog buku</h1><p>Temukan bacaan berikutnya yang menginspirasi.</p></div><a class="button button-secondary" href="/camera.html">▦ <span>Scan ISBN</span></a></div>
    <form id="catalog-filter" class="filter-bar"><label class="search-field">⌕<input name="q" placeholder="Cari judul, penulis, atau ISBN" value="${escapeHtml(params.get("q") || "")}"></label>
    <select name="category"><option value="">Semua kategori</option>${categories.map((item) => `<option>${item}</option>`).join("")}</select><input name="author" placeholder="Penulis" value="${escapeHtml(params.get("author") || "")}"><label class="check-filter"><input name="available" type="checkbox"> Tersedia</label><button class="button button-primary">Terapkan</button></form>
    <p class="result-count" id="catalog-count"></p><div class="book-grid" id="book-grid"></div>`;
  const favorites = await api("/favorites");
  const favoriteIds = favorites.map((book) => book.id);
  async function load() {
    const query = new URLSearchParams(new FormData(document.querySelector("#catalog-filter")));
    const available = document.querySelector('[name="available"]').checked;
    if (available) query.set("available", "1"); else query.delete("available");
    const books = await api(`/books?${query}`);
    document.querySelector("#catalog-count").textContent = `${books.length} buku ditemukan`;
    document.querySelector("#book-grid").innerHTML = books.length ? books.map((book) => bookCard(book, favoriteIds)).join("") : emptyState("Buku belum ditemukan", "Coba ubah kata kunci atau filter pencarian.");
  }
  document.querySelector("#catalog-filter").addEventListener("submit", async (event) => { event.preventDefault(); await load(); });
  await load();
  bindFavorites(root);
}

export async function renderBookDetail(root, user) {
  const bookId = Number(new URLSearchParams(location.search).get("id"));
  if (!Number.isInteger(bookId) || bookId < 1) {
    root.innerHTML = emptyState("Buku tidak ditemukan", "Pilih buku dari katalog terlebih dahulu.");
    return;
  }
  const book = await api(`/books/${bookId}`);
  const settings = await api("/settings");
  const due = new Date(Date.now() + settings.loan_days * 86400000).toISOString().slice(0, 10);
  root.innerHTML = `<a class="back-link" href="/catalog.html">← Kembali ke katalog</a><section class="detail-layout">
    <div class="detail-cover ${book.cover ? "" : "cover-fallback"}">${book.cover ? `<img src="${escapeHtml(book.cover)}" alt="Sampul ${escapeHtml(book.title)}" onerror="this.closest('.detail-cover').classList.add('cover-fallback');this.remove()">` : ""}<span class="cover-title">${escapeHtml(book.title)}</span></div>
    <div class="detail-copy"><span class="eyebrow">${escapeHtml(book.category)}</span><h1>${escapeHtml(book.title)}</h1><p class="detail-author">oleh ${escapeHtml(book.author)}</p>
    <div class="detail-meta"><div><small>PENERBIT</small><strong>${escapeHtml(book.publisher || "—")}</strong></div><div><small>TAHUN</small><strong>${book.year || "—"}</strong></div><div><small>ISBN</small><strong>${escapeHtml(book.isbn)}</strong></div><div><small>STOK</small><strong>${book.stock} buku</strong></div></div>
    <p class="detail-description">${escapeHtml(book.description || "Belum ada deskripsi untuk buku ini.")}</p><form id="borrow-form" class="borrow-box"><label>Tanggal mulai pinjam<input name="borrow_date" type="date" required min="${new Date().toISOString().slice(0, 10)}" value="${new Date().toISOString().slice(0, 10)}"></label><p class="due-hint">Estimasi batas pengembalian: <strong id="due-date">${dateLabel(due)}</strong> (${settings.loan_days} hari)</p><button class="button button-primary" ${book.stock < 1 ? "disabled" : ""}>${book.stock ? "Ajukan peminjaman" : "Stok sedang habis"}</button></form>
    <button class="text-button favorite-toggle" data-book-id="${book.id}">♡ Simpan ke favorit</button></div></section>`;
  document.querySelector('[name="borrow_date"]').addEventListener("input", (event) => {
    const date = new Date(`${event.target.value}T00:00:00`);
    date.setDate(date.getDate() + settings.loan_days);
    document.querySelector("#due-date").textContent = dateLabel(date.toISOString().slice(0, 10));
  });
  document.querySelector("#borrow-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const result = await api("/borrowings", { method: "POST", body: { book_id: book.id, borrow_date: event.target.borrow_date.value } });
      toast(`Pengajuan ${result.transaction_no} berhasil dikirim.`);
      window.location.href = "/borrowings.html";
    } catch (error) { toast(error.message, "error"); }
  });
  bindFavorites(root);
}

export async function renderFavorites(root) {
  const books = await api("/favorites");
  root.innerHTML = `<div class="page-heading"><div><span class="eyebrow">KOLEKSI PRIBADI</span><h1>Buku favorit</h1><p>Bacaan yang ingin kamu simpan.</p></div></div><div class="book-grid">${books.length ? books.map((book) => bookCard(book, books.map((item) => item.id))).join("") : emptyState("Belum ada buku favorit", "Simpan buku dari katalog menggunakan ikon hati.")}</div>`;
  bindFavorites(root);
}

export function bindFavorites(root) {
  root.querySelectorAll(".favorite-toggle").forEach((button) => button.addEventListener("click", async () => {
    try {
      const { favorite } = await api(`/books/${button.dataset.bookId}/favorite`, { method: "POST", body: {} });
      button.textContent = favorite ? "♥" : "♡";
      button.classList.toggle("is-favorite", favorite);
      if (location.pathname.endsWith("favorites.html") && !favorite) button.closest(".book-card")?.remove();
      toast(favorite ? "Ditambahkan ke favorit." : "Dihapus dari favorit.");
    } catch (error) { toast(error.message, "error"); }
  }));
}
