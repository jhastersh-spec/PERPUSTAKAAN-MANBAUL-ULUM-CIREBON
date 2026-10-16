import { api, categories, emptyState, escapeHtml, toast } from "./config.js";
import { renderBorrowings } from "./borrowings.js";

const categoriesMarkup = () => categories.map((category) => `<option>${category}</option>`).join("");

export async function renderAdmin(root, user) {
  root.innerHTML = `<div class="page-heading"><div><span class="eyebrow">PANEL PETUGAS</span><h1>Kelola perpustakaan</h1><p>Atur koleksi buku dan status keanggotaan.</p></div><a href="/reports.html" class="button button-secondary">▤ Laporan</a></div>
    <div class="admin-tabs"><button class="tab-button active" data-tab="books">Koleksi buku</button><button class="tab-button" data-tab="members">Anggota</button><button class="tab-button" data-tab="requests">Pengajuan</button></div>
    <section id="admin-books" class="admin-pane"><div class="section-title"><h2>Daftar buku</h2><button class="button button-primary" id="new-book">＋ Tambah buku</button></div><div id="admin-book-list"></div></section>
    <section id="admin-members" class="admin-pane" hidden><div class="section-title"><h2>Anggota perpustakaan</h2></div><div id="member-list"></div></section>
    <section id="admin-requests" class="admin-pane" hidden><div id="request-list"></div></section>
    <dialog id="book-dialog" class="modal"><form id="book-form"><div class="modal-head"><div><span class="eyebrow">DATA KOLEKSI</span><h2 id="book-form-title">Tambah buku</h2></div><button type="button" class="icon-button modal-close" aria-label="Tutup">×</button></div><input type="hidden" name="book_id"><div class="form-grid">
      <label>Judul buku<input name="title" required maxlength="180"></label><label>Penulis<input name="author" required maxlength="120"></label>
      <label>Penerbit<input name="publisher" maxlength="120"></label><label>Tahun terbit<input name="year" type="number" min="1000" max="2100"></label>
      <label>Kategori<select name="category" required>${categoriesMarkup()}</select></label><label>ISBN<input name="isbn" required inputmode="numeric" pattern="([0-9]{10}|[0-9]{13})"></label>
      <label>Jumlah stok<input name="stock" required type="number" min="0" max="100000" value="1"></label>
      <label>Sampul (URL HTTPS)<input name="cover" type="text" maxlength="500" placeholder="https://... atau unggah file"></label>
      <label>Unggah sampul dari perangkat<input name="cover_file" type="file" accept="image/jpeg,image/png,image/webp"><small>JPEG, PNG, atau WebP · maksimal 5 MB.</small></label>
      <label class="span-two">Deskripsi<textarea name="description" rows="3" maxlength="2000"></textarea></label>
      </div><div class="modal-actions"><button type="button" class="button button-outline modal-close">Batal</button><button class="button button-primary">Simpan buku</button></div></form></dialog>`;

  const dialog = document.querySelector("#book-dialog");
  const bookForm = document.querySelector("#book-form");
  async function loadBooks() {
    const books = await api("/books");
    document.querySelector("#admin-book-list").innerHTML = books.length ? `<div class="table-wrap"><table><thead><tr><th>Judul</th><th>ISBN</th><th>Kategori</th><th>Stok</th><th>Aksi</th></tr></thead><tbody>${books.map((book) => `<tr><td><strong>${escapeHtml(book.title)}</strong><small>${escapeHtml(book.author)}</small></td><td>${escapeHtml(book.isbn)}</td><td>${escapeHtml(book.category)}</td><td>${book.stock}</td><td class="action-cell"><button class="button button-small button-outline edit-book" data-id="${book.id}">Edit</button> <button class="button button-small button-danger delete-book" data-id="${book.id}">Hapus</button></td></tr>`).join("")}</tbody></table></div>` : emptyState("Belum ada koleksi", "Tambahkan buku pertama.");
    document.querySelectorAll(".edit-book").forEach((button) => button.addEventListener("click", async () => {
      const book = await api(`/books/${button.dataset.id}`);
      for (const [key, value] of Object.entries(book)) if (bookForm.elements[key]) bookForm.elements[key].value = value ?? "";
      bookForm.elements.book_id.value = book.id;
      document.querySelector("#book-form-title").textContent = "Edit data buku";
      dialog.showModal();
    }));
    document.querySelectorAll(".delete-book").forEach((button) => button.addEventListener("click", async () => {
      if (!window.confirm("Hapus buku ini dari katalog?")) return;
      try { await api(`/books/${button.dataset.id}`, { method: "DELETE" }); toast("Buku dihapus."); await loadBooks(); }
      catch (error) { toast(error.message, "error"); }
    }));
  }
  async function loadMembers() {
    const members = await api("/members");
    document.querySelector("#member-list").innerHTML = members.length ? `<div class="table-wrap"><table><thead><tr><th>Anggota</th><th>Email</th><th>Bergabung</th><th>Status</th><th>Aksi</th></tr></thead><tbody>${members.map((member) => `<tr><td><strong>${escapeHtml(member.name)}</strong><small>${escapeHtml(member.member_number)}</small></td><td>${escapeHtml(member.email)}</td><td>${new Date(member.created_at).toLocaleDateString("id-ID")}</td><td><span class="badge ${member.active ? "badge-approved" : "badge-rejected"}">${member.active ? "Aktif" : "Nonaktif"}</span></td><td><button class="button button-small ${member.active ? "button-danger" : "button-outline"} member-toggle" data-id="${member.id}" data-active="${member.active}">${member.active ? "Nonaktifkan" : "Aktifkan"}</button></td></tr>`).join("")}</tbody></table></div>` : emptyState("Belum ada anggota", "Anggota yang mendaftar akan muncul di sini.");
    document.querySelectorAll(".member-toggle").forEach((button) => button.addEventListener("click", async () => {
      try { await api(`/members/${button.dataset.id}`, { method: "PATCH", body: { active: button.dataset.active !== "true" } }); toast("Status anggota diperbarui."); await loadMembers(); }
      catch (error) { toast(error.message, "error"); }
    }));
  }
  async function loadRequests() { await renderBorrowings(document.querySelector("#request-list"), user); }
  document.querySelectorAll(".tab-button").forEach((button) => button.addEventListener("click", async () => {
    document.querySelectorAll(".tab-button").forEach((tab) => tab.classList.toggle("active", tab === button));
    document.querySelectorAll(".admin-pane").forEach((pane) => { pane.hidden = pane.id !== `admin-${button.dataset.tab}`; });
    if (button.dataset.tab === "members") await loadMembers();
    if (button.dataset.tab === "requests") await loadRequests();
  }));
  document.querySelector("#new-book").addEventListener("click", () => { bookForm.reset(); bookForm.elements.book_id.value = ""; bookForm.elements.isbn.value = new URLSearchParams(location.search).get("isbn") || ""; document.querySelector("#book-form-title").textContent = "Tambah buku"; dialog.showModal(); });
  dialog.querySelectorAll(".modal-close").forEach((button) => button.addEventListener("click", () => dialog.close()));
  bookForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const fields = Object.fromEntries(new FormData(bookForm));
    const id = fields.book_id;
    const coverFile = bookForm.elements.cover_file.files[0];
    delete fields.book_id;
    delete fields.cover_file;
    try {
      if (coverFile) {
        const data = new FormData();
        data.set("cover", coverFile);
        const upload = await api("/covers", { method: "POST", body: data });
        fields.cover = upload.cover;
      }
      await api(id ? `/books/${id}` : "/books", { method: id ? "PUT" : "POST", body: fields });
      dialog.close(); toast(id ? "Data buku diperbarui." : "Buku ditambahkan."); await loadBooks();
    } catch (error) { toast(error.message, "error"); }
  });
  await loadBooks();
}
