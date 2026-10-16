import { api, dateLabel, escapeHtml, setCsrf, toast } from "./config.js";
import { bindAuth, renderAuth } from "./auth.js";
import { renderBookDetail, renderCatalog, renderFavorites } from "./books.js";
import { renderBorrowings, renderDashboard } from "./borrowings.js";
import { renderAdmin } from "./admin.js";
import { renderCamera } from "./camera.js";
import { renderReports } from "./reports.js";

const page = document.body.dataset.page;
const titles = {
  dashboard: "Dashboard", catalog: "Katalog buku", "book-detail": "Detail buku",
  borrowings: "Peminjaman", history: "Riwayat", favorites: "Favorit", profile: "Profil",
  notifications: "Notifikasi", admin: "Kelola perpustakaan", settings: "Pengaturan",
  help: "Bantuan", camera: "Kamera & Scanner Buku", reports: "Laporan",
};
const memberNavigation = [
  ["dashboard", "▦", "Dashboard", "/dashboard.html"],
  ["catalog", "⌕", "Katalog buku", "/catalog.html"],
  ["borrowings", "↗", "Peminjaman", "/borrowings.html"],
  ["history", "◷", "Riwayat", "/history.html"],
  ["favorites", "♡", "Favorit", "/favorites.html"],
];
const adminNavigation = [
  ["dashboard", "▦", "Dashboard", "/dashboard.html"],
  ["catalog", "⌕", "Katalog buku", "/catalog.html"],
  ["admin", "▤", "Kelola koleksi", "/admin.html"],
  ["borrowings", "↗", "Peminjaman", "/borrowings.html"],
  ["reports", "▧", "Laporan", "/reports.html"],
  ["camera", "▣", "Kamera & Scanner", "/camera.html"],
];

function navigation(user) {
  const links = user.role === "admin" ? adminNavigation : memberNavigation;
  return links.map(([key, icon, label, href]) => `<a class="nav-link ${page === key ? "active" : ""}" href="${href}"><span>${icon}</span>${label}</a>`).join("");
}

function renderShell(user) {
  const brand = `<a class="brand" href="/dashboard.html"><span class="brand-mark">M</span><span>Perpustakaan<span class="brand-accent"> SMK</span><small>MANBAUL ULUM · CIREBON</small></span></a>`;
  document.querySelector("#app").innerHTML = `<div class="app-shell"><aside class="sidebar"><div class="sidebar-brand">${brand}</div><div class="sidebar-label">MENU UTAMA</div><nav>${navigation(user)}</nav><div class="sidebar-bottom"><a class="nav-link ${page === "notifications" ? "active" : ""}" href="/notifications.html"><span>♧</span>Notifikasi</a><a class="nav-link ${page === "profile" ? "active" : ""}" href="/profile.html"><span>◉</span>Profil saya</a><a class="nav-link ${page === "settings" ? "active" : ""}" href="/settings.html"><span>⚙</span>Pengaturan</a><a class="nav-link ${page === "help" ? "active" : ""}" href="/help.html"><span>?</span>Pusat bantuan</a><a class="nav-link" href="/help.html#contact"><span>⌖</span>Kontak</a></div><div class="sidebar-quote">“Satu buku, seribu jendela dunia.”</div></aside>
    <div class="workspace"><header class="topbar"><button class="mobile-menu icon-button" id="mobile-menu" aria-label="Buka menu">☰</button><form class="top-search" action="/catalog.html"><span>⌕</span><input name="q" placeholder="Cari buku, penulis, atau ISBN"><kbd>Enter</kbd></form><div class="topbar-actions"><a class="header-icon" href="/notifications.html" aria-label="Notifikasi">♧<i></i></a><div class="top-profile"><span class="avatar">${escapeHtml(user.name.slice(0,1).toUpperCase())}</span><div><strong>${escapeHtml(user.name)}</strong><small>${user.role === "admin" ? "Petugas perpustakaan" : `Anggota · ${escapeHtml(user.member_number)}`}</small></div><button class="icon-button logout-button" aria-label="Keluar" title="Keluar">↪</button></div></div></header><main class="main-content"><div class="mobile-page-title">${escapeHtml(titles[page] || "")}</div><div id="view-root"></div></main><footer class="app-footer">© ${new Date().getFullYear()} Perpustakaan SMK Manbaul Ulum Cirebon <span>•</span> Ruang baca masa depan</footer></div><div class="mobile-nav">${memberNavigation.slice(0,4).map(([key,icon,label,href]) => `<a class="${page === key ? "active" : ""}" href="${href}"><span>${icon}</span><small>${label === "Dashboard" ? "Home" : label.split(" ")[0]}</small></a>`).join("")}<a href="/profile.html" class="${page === "profile" ? "active" : ""}"><span>◉</span><small>Profil</small></a></div><div id="toast-region" class="toast-region" aria-live="polite"></div></div>`;
  document.querySelector("#mobile-menu").addEventListener("click", () => document.querySelector(".sidebar").classList.toggle("sidebar-open"));
  document.querySelectorAll(".logout-button").forEach((button) => button.addEventListener("click", async () => {
    try { await api("/logout", { method: "POST", body: {} }); window.location.replace("/"); }
    catch (error) { toast(error.message, "error"); }
  }));
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".sidebar,.mobile-menu")) document.querySelector(".sidebar")?.classList.remove("sidebar-open");
  });
}

function renderProfile(user) {
  const root = document.querySelector("#view-root");
  root.innerHTML = `<div class="page-heading"><div><span class="eyebrow">AKUN SAYA</span><h1>Profil anggota</h1><p>Informasi akun perpustakaanmu.</p></div></div><section class="panel profile-panel"><div class="profile-avatar">${escapeHtml(user.name.slice(0,1).toUpperCase())}</div><form id="profile-form" class="profile-details"><h2>${escapeHtml(user.name)}</h2><span class="badge badge-approved">${user.role === "admin" ? "Petugas" : "Anggota"}</span><label>Nama lengkap<input name="name" value="${escapeHtml(user.name)}" maxlength="100" required></label><label>Email<input name="email" type="email" value="${escapeHtml(user.email)}" maxlength="254" required></label><dl>${user.role === "admin" ? "" : `<div><dt>Nomor anggota</dt><dd>${escapeHtml(user.member_number)}</dd></div>`}<div><dt>Jenis akun</dt><dd>${user.role === "admin" ? "Petugas perpustakaan" : "Anggota"}</dd></div></dl><button class="button button-primary">Simpan profil</button></form></section>`;
  root.querySelector("#profile-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api("/profile", { method: "PATCH", body: Object.fromEntries(new FormData(event.target)) });
      toast("Profil berhasil diperbarui.");
      window.location.reload();
    } catch (error) { toast(error.message, "error"); }
  });
}

async function renderNotifications(user) {
  const result = await api("/notifications");
  const root = document.querySelector("#view-root");
  root.innerHTML = `<div class="page-heading"><div><span class="eyebrow">PEMBARUAN AKUN</span><h1>Notifikasi</h1><p>Pengingat transaksi dan informasi terbaru.</p></div></div><div class="notification-list">${result.length ? result.map((item) => `<article class="notification-card ${item.kind}"><span class="notification-icon">${item.kind === "danger" ? "!" : "◷"}</span><div><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.message)}</p><small>${dateLabel(item.date)}</small></div></article>`).join("") : `<div class="empty-state"><span class="empty-icon">♧</span><strong>Kamu sudah mengikuti semua kabar</strong><p>Notifikasi baru akan tampil di sini.</p></div>`}</div>`;
}

async function renderSettings(user) {
  const settings = await api("/settings");
  const root = document.querySelector("#view-root");
  root.innerHTML = `<div class="page-heading"><div><span class="eyebrow">PREFERENSI</span><h1>Pengaturan akun</h1><p>Atur keamanan akun${user.role === "admin" ? " dan aturan peminjaman" : ""}.</p></div></div><div class="settings-grid"><form id="password-form" class="panel form-panel"><h2>Ubah kata sandi</h2><label>Kata sandi saat ini<input name="current_password" type="password" autocomplete="current-password" required></label><label>Kata sandi baru<input name="new_password" type="password" minlength="10" maxlength="128" autocomplete="new-password" required></label><button class="button button-primary">Perbarui kata sandi</button></form>${user.role === "admin" ? `<form id="loan-settings" class="panel form-panel"><h2>Aturan peminjaman</h2><label>Lama peminjaman (hari)<input name="loan_days" type="number" min="1" max="90" value="${settings.loan_days}" required></label><label>Denda keterlambatan per hari (rupiah)<input name="fine_per_day" type="number" min="0" max="100000000" value="${settings.fine_per_day}" required></label><label>Denda buku rusak (rupiah)<input name="fine_damaged" type="number" min="0" max="100000000" value="${settings.fine_damaged}" required></label><label>Denda buku hilang (rupiah)<input name="fine_lost" type="number" min="0" max="100000000" value="${settings.fine_lost}" required></label><small>Denda keterlambatan dapat ditambahkan ke denda rusak atau hilang. Nilai 0 berarti tidak ada denda untuk kondisi tersebut.</small><button class="button button-primary">Simpan aturan</button></form>` : ""}</div>`;
  document.querySelector("#password-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api("/password", { method: "PUT", body: Object.fromEntries(new FormData(event.target)) });
      event.target.reset(); toast("Kata sandi berhasil diperbarui.");
    } catch (error) { toast(error.message, "error"); }
  });
  document.querySelector("#loan-settings")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const body = Object.fromEntries(new FormData(event.target));
      body.loan_days = Number(body.loan_days);
      body.fine_per_day = Number(body.fine_per_day);
      body.fine_damaged = Number(body.fine_damaged);
      body.fine_lost = Number(body.fine_lost);
      await api("/settings", { method: "PUT", body }); toast("Aturan peminjaman diperbarui.");
    } catch (error) { toast(error.message, "error"); }
  });
}

function renderHelp() {
  document.querySelector("#view-root").innerHTML = `<div class="page-heading"><div><span class="eyebrow">KAMI SIAP MEMBANTU</span><h1>Pusat bantuan</h1><p>Panduan penggunaan Perpustakaan SMK Manbaul Ulum Cirebon.</p></div></div><div class="help-grid"><article class="panel"><span class="stat-icon">↗</span><h2>Cara meminjam buku</h2><p>Buka katalog, pilih buku yang tersedia, tentukan tanggal mulai pinjam, lalu kirim pengajuan. Petugas akan menyetujui atau menolak permintaanmu.</p></article><article class="panel"><span class="stat-icon">◷</span><h2>Pengembalian</h2><p>Periksa tanggal jatuh tempo di halaman peminjaman. Kembalikan buku kepada petugas agar transaksi dan stok diperbarui.</p></article><article class="panel"><span class="stat-icon">▣</span><h2>Scan ISBN</h2><p>Gunakan kamera pada koneksi HTTPS atau localhost. Jika kamera atau pemindai tidak tersedia, ketik ISBN secara manual.</p></article><article class="panel"><span class="stat-icon">?</span><h2>Lupa kata sandi</h2><p>Hubungi petugas perpustakaan untuk bantuan. Demi keamanan, jangan bagikan kata sandimu kepada siapa pun.</p></article><article class="panel contact-panel" id="contact"><span class="eyebrow">KONTAK PERPUSTAKAAN</span><h2>Perlu bantuan langsung?</h2><p>Silakan kunjungi meja layanan perpustakaan pada jam operasional sekolah.</p><p><strong>Email layanan:</strong> Hubungi admin sekolah</p><p><strong>Jam layanan:</strong> Senin–Jumat · 07.00–15.00</p></article></div>`;
}

async function initialize() {
  if (["login", "register", "forgot"].includes(page)) {
    document.querySelector("#app").innerHTML = `${renderAuth(page)}<div id="toast-region" class="toast-region"></div>`;
    const current = await api("/session");
    setCsrf(current.csrf_token);
    if (current.user && page === "login") {
      window.location.replace(current.user.role === "admin" ? "/admin.html" : "/dashboard.html");
      return;
    }
    bindAuth(page, current);
    return;
  }
  const current = await api("/session");
  setCsrf(current.csrf_token);
  if (!current.user) { window.location.replace("/"); return; }
  if (["admin", "reports", "camera"].includes(page) && current.user.role !== "admin") {
    window.location.replace("/dashboard.html"); return;
  }
  renderShell(current.user);
  const root = document.querySelector("#view-root");
  if (page === "dashboard") await renderDashboard(root, current.user);
  else if (page === "catalog") await renderCatalog(root, current.user);
  else if (page === "book-detail") await renderBookDetail(root, current.user);
  else if (page === "borrowings") await renderBorrowings(root, current.user);
  else if (page === "history") await renderBorrowings(root, current.user, true);
  else if (page === "favorites") await renderFavorites(root);
  else if (page === "profile") renderProfile(current.user);
  else if (page === "notifications") await renderNotifications(current.user);
  else if (page === "admin") await renderAdmin(root, current.user);
  else if (page === "settings") await renderSettings(current.user);
  else if (page === "help") renderHelp();
  else if (page === "camera") await renderCamera(root, current.user);
  else if (page === "reports") await renderReports(root);
}

initialize().catch((error) => {
  const appRoot = document.querySelector("#app");
  if (appRoot) appRoot.innerHTML = `<main class="fatal-error"><h1>Aplikasi tidak dapat dimuat</h1><p>${escapeHtml(error.message)}</p><a href="/">Kembali ke halaman masuk</a></main>`;
});
