import { api, dateLabel, emptyState, escapeHtml, formData, rupiah, statusBadge, toast } from "./config.js";
import { printReceipt } from "./pdf.js";

export async function renderBorrowings(root, user, historyOnly = false) {
  const rows = await api("/borrowings");
  const visible = historyOnly
    ? rows.filter((row) => ["returned", "rejected"].includes(row.status))
    : rows.filter((row) => !["returned", "rejected"].includes(row.status));
  root.innerHTML = `<div class="page-heading"><div><span class="eyebrow">${historyOnly ? "ARSIP TRANSAKSI" : "PEMANTAUAN BUKU"}</span><h1>${historyOnly ? "Riwayat peminjaman" : "Peminjaman"}</h1><p>${historyOnly ? "Catatan pengajuan dan pengembalian sebelumnya." : "Pantau status permintaan dan tanggal pengembalian."}</p></div>${historyOnly ? "" : `<a class="button button-primary" href="/catalog.html">＋ Cari buku</a>`}</div>
    <div class="table-wrap"><table><thead><tr><th>Transaksi</th>${user.role === "admin" ? "<th>Anggota</th>" : ""}<th>Buku</th><th>Tanggal pinjam</th><th>Jatuh tempo</th><th>Status</th><th>Denda</th><th>Aksi</th></tr></thead><tbody>${visible.map((row) => {
      const late = row.status === "approved" && row.due_date < new Date().toISOString().slice(0, 10);
      const returnCondition = { good: "Baik", damaged: "Rusak", lost: "Hilang" }[row.return_condition];
      let actions = `<button class="button button-small button-outline receipt" data-id="${row.id}">Bukti</button>`;
      if (user.role === "admin" && row.status === "pending") actions += ` <button class="button button-small button-primary decision" data-id="${row.id}" data-choice="approve">Setujui</button> <button class="button button-small button-danger decision" data-id="${row.id}" data-choice="reject">Tolak</button>`;
      if (user.role === "admin" && row.status === "approved") actions += ` <button class="button button-small button-primary return-book" data-id="${row.id}">Proses kembali</button>`;
      if (late) actions += `<small class="late-note">Terlambat</small>`;
      return `<tr><td><strong>${escapeHtml(row.transaction_no)}</strong><small>${dateLabel(row.requested_at)}</small></td>${user.role === "admin" ? `<td>${escapeHtml(row.member_name)}<small>${escapeHtml(row.member_number)}</small></td>` : ""}<td>${escapeHtml(row.book_title)}<small>${escapeHtml(row.author)}</small></td><td>${dateLabel(row.borrow_date)}</td><td>${dateLabel(row.due_date)}</td><td>${statusBadge(row.status, row.due_date)}</td><td>${rupiah(row.fine)}${row.status === "returned" && returnCondition ? `<small>Kondisi: ${returnCondition}</small>` : ""}</td><td class="action-cell">${actions}</td></tr>`;
    }).join("") || `<tr><td colspan="${user.role === "admin" ? 8 : 7}">${emptyState(historyOnly ? "Belum ada riwayat" : "Belum ada pengajuan", historyOnly ? "Riwayatmu akan muncul di sini setelah transaksi diproses." : "Pilih buku dari katalog untuk mengajukan peminjaman.")}</td></tr>`}</tbody></table></div>`;
  root.querySelectorAll(".receipt").forEach((button) => button.addEventListener("click", () => {
    const row = rows.find((item) => item.id === Number(button.dataset.id));
    printReceipt(row, row.status === "returned" ? "return" : "borrow");
  }));
  root.querySelectorAll(".decision").forEach((button) => button.addEventListener("click", async () => {
    if (button.dataset.choice === "reject" && !window.confirm("Tolak pengajuan peminjaman ini?")) return;
    try {
      await api(`/borrowings/${button.dataset.id}/decision`, { method: "POST", body: { decision: button.dataset.choice } });
      toast(button.dataset.choice === "approve" ? "Pengajuan disetujui dan stok buku diperbarui." : "Pengajuan ditolak.");
      await renderBorrowings(root, user, historyOnly);
    } catch (error) { toast(error.message, "error"); }
  }));
  root.querySelectorAll(".return-book").forEach((button) => button.addEventListener("click", async () => {
    const conditionChoice = window.prompt("Kondisi buku saat dikembalikan: Baik, Rusak, atau Hilang", "Baik");
    if (conditionChoice === null) return;
    const normalizedCondition = conditionChoice.trim().toLocaleLowerCase("id-ID");
    const conditions = { baik: "good", rusak: "damaged", hilang: "lost" };
    const returnCondition = conditions[normalizedCondition];
    if (!returnCondition) {
      toast("Kondisi harus diisi Baik, Rusak, atau Hilang.", "error");
      return;
    }
    const conditionNote = window.prompt("Catatan kondisi buku (opsional):", "") ?? "";
    const memberNote = window.prompt("Catatan untuk anggota (opsional):", "") ?? "";
    const adminNote = window.prompt("Catatan internal petugas (opsional):", "") ?? "";
    try {
      const result = await api(`/borrowings/${button.dataset.id}/return`, { method: "POST", body: { return_condition: returnCondition, condition_note: conditionNote, member_note: memberNote, admin_note: adminNote } });
      const conditionLabel = { good: "Baik", damaged: "Rusak", lost: "Hilang" }[result.return_condition];
      toast(result.fine ? `Pengembalian (${conditionLabel}) diproses. Denda total: ${rupiah(result.fine)}.` : `Pengembalian (${conditionLabel}) diproses tanpa denda.`);
      await renderBorrowings(root, user, historyOnly);
    } catch (error) { toast(error.message, "error"); }
  }));
}

export async function renderDashboard(root, user) {
  const data = await api("/stats");
  const admin = user.role === "admin";
  const cards = admin
    ? [["Anggota", data.members, "♙"], ["Judul buku", data.books, "▤"], ["Peminjaman aktif", data.active, "↗"], ["Terlambat", data.late, "◷"]]
    : [["Sedang dipinjam", data.borrowed, "↗"], ["Dikembalikan", data.returned, "✓"], ["Terlambat", data.late, "◷"]];
  const renderCards = (books) => `<div class="book-grid compact-grid">${books.map((book) => `<article class="mini-book"><div class="mini-cover ${book.cover ? "" : "cover-fallback"}">${book.cover ? `<img src="${escapeHtml(book.cover)}" alt="" onerror="this.remove()">` : ""}</div><div><span class="eyebrow">${escapeHtml(book.category)}</span><h3><a href="/book-detail.html?id=${book.id}">${escapeHtml(book.title)}</a></h3><p>${escapeHtml(book.author)}</p><small>${book.borrow_count !== undefined ? `${book.borrow_count} kali dipinjam` : `${book.stock} tersedia`}</small></div></article>`).join("")}</div>`;
  root.innerHTML = `<section class="welcome-panel"><div><span class="eyebrow">${admin ? "RUANG KERJA PETUGAS" : "SELAMAT MEMBACA"}</span><h1>${admin ? "Halo, " : "Hai, "}${escapeHtml(user.name.split(" ")[0])} 👋</h1><p>${admin ? "Ringkasan perpustakaan hari ini." : "Temukan cerita dan ilmu baru di koleksi perpustakaan."}</p><a class="button button-light" href="${admin ? "/admin.html" : "/catalog.html"}">${admin ? "Kelola perpustakaan" : "Jelajahi katalog"} <span>→</span></a></div><div class="welcome-decoration">✳</div></section>
    <div class="stat-grid">${cards.map(([label, value, icon]) => `<article class="stat-card"><span class="stat-icon">${icon}</span><div><small>${label}</small><strong>${value}</strong></div></article>`).join("")}</div>
    ${admin ? `<div class="section-title"><div><span class="eyebrow">TINDAKAN PERLU DILAKUKAN</span><h2>Pengajuan menunggu</h2></div><a href="/borrowings.html">Lihat semua →</a></div><p class="helper-box">${data.pending} pengajuan peminjaman menunggu keputusan petugas.</p>` : ""}
    <section class="content-section"><div class="section-title"><div><span class="eyebrow">BARU DI PERPUSTAKAAN</span><h2>Buku terbaru</h2></div><a href="/catalog.html">Lihat katalog →</a></div>${renderCards(data.latest)}</section>
    <section class="content-section"><div class="section-title"><div><span class="eyebrow">PILIHAN PEMBACA</span><h2>Buku populer</h2></div></div>${renderCards(data.popular)}</section>
    ${admin ? "" : `<section class="content-section"><div class="section-title"><div><span class="eyebrow">AKTIVITAS</span><h2>Peminjaman terakhir</h2></div><a href="/history.html">Riwayat →</a></div><div class="activity-list">${data.activity.length ? data.activity.map((row) => `<div class="activity-row"><span class="activity-dot"></span><div><strong>${escapeHtml(row.book_title)}</strong><p>${statusBadge(row.status, row.due_date)} <span class="muted">${dateLabel(row.requested_at)}</span></p></div><a href="/borrowings.html" aria-label="Lihat transaksi">→</a></div>`).join("") : `<p class="muted">Aktivitas peminjamanmu akan muncul di sini.</p>`}</div></section>`}`;
}
