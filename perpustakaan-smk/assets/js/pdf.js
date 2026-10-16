import { dateLabel, escapeHtml, rupiah, statusBadge } from "./config.js";

export function printReceipt(row, kind) {
  if (!row) return;
  const returned = kind === "return";
  const title = returned ? "BUKTI PENGEMBALIAN" : "BUKTI PEMINJAMAN";
  const details = [
    ["Nomor transaksi", row.transaction_no],
    ["Nomor anggota", row.member_number],
    ["Nama peminjam", row.member_name],
    ["Judul buku", row.book_title],
    ["Penulis", row.author],
    ["ISBN", row.isbn],
    ["Tanggal pengajuan", dateLabel(row.requested_at)],
    ["Tanggal peminjaman", dateLabel(row.borrow_date)],
    ["Tanggal persetujuan", dateLabel(row.approved_at)],
    ["Batas pengembalian", dateLabel(row.due_date)],
    ...(returned ? [["Tanggal dikembalikan", dateLabel(row.returned_at)], ["Kondisi buku", { good: "Baik", damaged: "Rusak", lost: "Hilang" }[row.return_condition] || "Baik"], ["Catatan kondisi", row.condition_note || "—"], ["Denda", rupiah(row.fine)]] : []),
    ["Status", row.status],
  ];
  const printWindow = window.open("", "_blank", "width=800,height=900");
  if (!printWindow) {
    window.alert("Izinkan pop-up untuk melihat bukti transaksi dan menyimpannya sebagai PDF.");
    return;
  }
  printWindow.opener = null;
  printWindow.document.write(`<!doctype html><html lang="id"><meta charset="utf-8"><title>${title} ${escapeHtml(row.transaction_no)}</title><style>
    *{box-sizing:border-box}body{font:14px Arial,sans-serif;color:#18243a;margin:0;padding:38px}.paper{max-width:760px;margin:auto;border:1px solid #dce3ed;padding:38px}.brand{font-size:22px;font-weight:700;color:#123a73}.brand span{color:#3988e8}.tag{color:#68809d;font-size:11px;letter-spacing:2px;margin-top:5px}.rule{height:3px;background:#1a559b;margin:25px 0}h1{font-size:19px;letter-spacing:1px}.sub{color:#60718a}table{width:100%;border-collapse:collapse;margin-top:25px}td{padding:11px;border-bottom:1px solid #e5eaf1}td:first-child{width:42%;color:#718098}.signature{display:flex;justify-content:space-between;margin-top:65px}.signature div{width:40%;border-top:1px solid #aeb9c8;text-align:center;padding-top:8px}.foot{font-size:11px;color:#8390a1;margin-top:45px;text-align:center}@media print{body{padding:0}.paper{border:0}}@page{size:A4;margin:18mm}
    </style><body><div class="paper"><div class="brand">Perpustakaan SMK Manbaul Ulum Cirebon</div><div class="tag">PERPUSTAKAAN SEKOLAH</div><div class="rule"></div><h1>${title}</h1><p class="sub">Dokumen transaksi perpustakaan · ${dateLabel(new Date().toISOString())}</p><table>${details.map(([label,value]) => `<tr><td>${escapeHtml(label)}</td><td><strong>${escapeHtml(value ?? "—")}</strong></td></tr>`).join("")}</table><div class="signature"><div>Peminjam</div><div>Petugas perpustakaan</div></div><p class="foot">Simpan dokumen ini sebagai bukti transaksi perpustakaan.</p></div><script>window.onload=()=>window.print()<\/script></body></html>`);
  printWindow.document.close();
}
