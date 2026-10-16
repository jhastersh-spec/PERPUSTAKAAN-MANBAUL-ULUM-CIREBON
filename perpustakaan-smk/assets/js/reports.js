import { api, dateLabel, emptyState, escapeHtml, rupiah, statusBadge } from "./config.js";

export async function renderReports(root) {
  const monthStart = new Date();
  monthStart.setDate(1);
  root.innerHTML = `<div class="page-heading"><div><span class="eyebrow">DATA PERPUSTAKAAN</span><h1>Laporan</h1><p>Filter transaksi dan cetak laporan dalam format PDF.</p></div><button class="button button-primary" id="print-report">⇧ Cetak / Simpan PDF</button></div>
    <form id="report-filter" class="filter-bar"><label>Dari tanggal<input type="date" name="start" value="${monthStart.toISOString().slice(0,10)}"></label><label>Sampai tanggal<input type="date" name="end" value="${new Date().toISOString().slice(0,10)}"></label><button class="button button-primary">Tampilkan</button></form>
    <div id="report-content"></div>`;
  async function load() {
    const params = new URLSearchParams(new FormData(document.querySelector("#report-filter")));
    const report = await api(`/reports?${params}`);
    const rows = report.transactions;
    document.querySelector("#report-content").innerHTML = `<div class="stat-grid report-stats"><article class="stat-card"><span class="stat-icon">↗</span><div><small>Total transaksi</small><strong>${rows.length}</strong></div></article><article class="stat-card"><span class="stat-icon">◷</span><div><small>Peminjaman aktif</small><strong>${rows.filter((row) => row.status === "approved").length}</strong></div></article><article class="stat-card"><span class="stat-icon">!</span><div><small>Terlambat</small><strong>${rows.filter((row) => row.status === "approved" && row.due_date < new Date().toISOString().slice(0,10)).length}</strong></div></article><article class="stat-card"><span class="stat-icon">✓</span><div><small>Total denda tercatat</small><strong>${rupiah(rows.reduce((sum,row) => sum + row.fine,0))}</strong></div></article></div>
      <section class="content-section"><div class="section-title"><h2>Transaksi peminjaman</h2><span class="muted">${params.get("start") || "Semua"} – ${params.get("end") || "sekarang"}</span></div><div class="table-wrap"><table><thead><tr><th>No. transaksi</th><th>Anggota</th><th>Buku</th><th>Tanggal</th><th>Status</th><th>Kondisi kembali</th><th>Denda</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${escapeHtml(row.transaction_no)}</td><td>${escapeHtml(row.member_name)}<small>${escapeHtml(row.member_number)}</small></td><td>${escapeHtml(row.book_title)}</td><td>${dateLabel(row.borrow_date)}</td><td>${statusBadge(row.status,row.due_date)}</td><td>${row.status === "returned" ? ({ good: "Baik", damaged: "Rusak", lost: "Hilang" }[row.return_condition] || "Baik") : "—"}</td><td>${rupiah(row.fine)}</td></tr>`).join("") || `<tr><td colspan="7">${emptyState("Tidak ada transaksi", "Tidak ditemukan transaksi pada rentang tanggal ini.")}</td></tr>`}</tbody></table></div></section>
      <section class="content-section"><div class="section-title"><h2>Ringkasan stok</h2></div><div class="table-wrap"><table><thead><tr><th>Judul</th><th>ISBN</th><th>Kategori</th><th>Stok</th></tr></thead><tbody>${report.stock.map((book) => `<tr><td>${escapeHtml(book.title)}</td><td>${escapeHtml(book.isbn)}</td><td>${escapeHtml(book.category)}</td><td>${book.stock}</td></tr>`).join("")}</tbody></table></div></section>
      <section class="content-section"><div class="section-title"><h2>Riwayat perubahan admin</h2><span class="muted">100 aktivitas terakhir</span></div><div class="table-wrap"><table><thead><tr><th>Waktu</th><th>Petugas</th><th>Tindakan</th><th>Detail</th></tr></thead><tbody>${report.audit.map((row) => `<tr><td>${dateLabel(row.created_at)}</td><td>${escapeHtml(row.actor_name || "Sistem")}</td><td>${escapeHtml(row.action)}</td><td>${escapeHtml(row.details)}</td></tr>`).join("") || `<tr><td colspan="4">Belum ada aktivitas tercatat.</td></tr>`}</tbody></table></div></section>`;
    document.querySelector("#print-report").onclick = () => {
      const content = document.querySelector("#report-content").innerHTML;
      const windowRef = window.open("", "_blank", "width=1000,height=900");
      if (!windowRef) return window.alert("Izinkan pop-up untuk mencetak laporan.");
      windowRef.opener = null;
      windowRef.document.write(`<!doctype html><html lang="id"><meta charset="utf-8"><title>Laporan Perpustakaan SMK Manbaul Ulum Cirebon</title><style>body{font:12px Arial;color:#17233a;padding:24px}h1{font-size:24px;color:#123a73}h2{font-size:16px;margin-top:24px}.eyebrow,.button{display:none}.stat-grid{display:flex;gap:14px}.stat-card{border:1px solid #ddd;padding:10px}.table-wrap{margin:12px 0}table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:7px;border:1px solid #ddd}small{display:block;color:#667}@page{size:A4 landscape;margin:12mm}</style><h1>Perpustakaan SMK Manbaul Ulum Cirebon · Laporan</h1><p>Dicetak ${dateLabel(new Date().toISOString())}</p>${content}<script>window.onload=()=>window.print()<\/script></html>`);
      windowRef.document.close();
    };
  }
  document.querySelector("#report-filter").addEventListener("submit", async (event) => { event.preventDefault(); try { await load(); } catch (error) { window.alert(error.message); } });
  await load();
}
