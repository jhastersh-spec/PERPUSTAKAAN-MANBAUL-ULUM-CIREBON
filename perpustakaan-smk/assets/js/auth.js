import { api, escapeHtml, toast } from "./config.js";

const brand = `<a class="brand brand-light" href="/"><span class="brand-mark">M</span><span>Perpustakaan<span class="brand-accent"> SMK</span><small>MANBAUL ULUM · CIREBON</small></span></a>`;

export function renderAuth(page) {
  const views = {
    login: `<div class="auth-heading"><span class="eyebrow">SELAMAT DATANG KEMBALI</span><h1>Temukan dunia baru<br>di setiap halaman.</h1><p>Masuk untuk menjelajahi koleksi dan mengelola peminjaman bukumu.</p></div>
      <form id="auth-form" novalidate><label>Username atau email<input name="identity" autocomplete="username" inputmode="text" maxlength="254" required placeholder="Masukkan username atau email"></label>
      <label>Kata sandi<input name="password" type="password" autocomplete="current-password" minlength="10" maxlength="128" required placeholder="Masukkan kata sandi"></label>
      <div class="form-between"><span></span><a href="/forgot.html">Lupa kata sandi?</a></div>
      <p id="auth-error" class="auth-error" role="alert" aria-live="assertive" hidden></p><button class="button button-primary button-wide" type="submit">Masuk ke akun</button><p class="form-note">Belum punya akun? <a href="/register.html">Daftar sebagai anggota</a></p></form>`,
    register: `<div class="auth-heading"><span class="eyebrow">GABUNG DENGAN KAMI</span><h1>Mulai petualangan<br>membacamu.</h1><p>Buat akun anggota perpustakaan. Admin tidak dapat dibuat dari pendaftaran publik.</p></div>
      <form id="auth-form"><label>Nama lengkap<input name="name" required minlength="2" maxlength="100" autocomplete="name"></label>
      <label>Nomor anggota / NIS<input name="member_number" required minlength="3" maxlength="30" pattern="[A-Za-z0-9\\-]{3,30}" autocomplete="off"></label>
      <label>Email<input name="email" type="email" required maxlength="254" autocomplete="email"></label>
      <label>Kata sandi<input name="password" type="password" required minlength="10" maxlength="128" autocomplete="new-password"><small>Minimal 10 karakter.</small></label>
      <button class="button button-primary button-wide">Buat akun anggota</button><p class="form-note">Sudah menjadi anggota? <a href="/">Masuk</a></p></form>`,
    forgot: `<div class="auth-heading"><span class="eyebrow">BANTUAN AKUN</span><h1>Lupa kata sandi?</h1><p>Untuk menjaga keamanan akun, pengaturan ulang saat ini dibantu langsung oleh petugas perpustakaan.</p></div>
      <form id="auth-form"><label>Email atau nomor anggota<input name="identity" required autocomplete="username"></label>
      <button class="button button-primary button-wide">Minta bantuan petugas</button><p class="form-note">Kembali ke <a href="/">halaman masuk</a></p><p class="helper-box">Fitur pengiriman email reset belum dikonfigurasi. Tidak ada tautan reset yang dikirim.</p></form>`,
  };
  return `<div class="auth-layout"><section class="auth-side">${brand}<div class="auth-art"><div class="art-orbit orbit-one"></div><div class="art-orbit orbit-two"></div><div class="book-stack"><span></span><span></span><span></span><span></span></div><p>“Membaca adalah jendela<br>menuju dunia.”</p><small>PERPUSTAKAAN SEKOLAH</small></div><div class="auth-side-foot">Literasi untuk masa depan yang lebih cerah.</div></section>
    <section class="auth-main"><div class="auth-mobile-brand">${brand}</div><div class="auth-content">${views[page]}</div><div class="auth-footer">© ${new Date().getFullYear()} Perpustakaan SMK Manbaul Ulum Cirebon</div></section></div>`;
}

export function bindAuth(page, session) {
  const form = document.querySelector("#auth-form");
  const button = form?.querySelector("button[type=submit],button:not([type])");
  const errorBox = form?.querySelector("#auth-error");
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    errorBox.hidden = true;
    errorBox.textContent = "";
    const identity = form.elements.identity?.value.trim() || "";
    const password = form.elements.password?.value || "";
    if (page === "login" && (!identity || identity.length > 254 || password.length < 10 || password.length > 128)) {
      errorBox.textContent = "Periksa username/email dan pastikan kata sandi berisi 10–128 karakter.";
      errorBox.hidden = false;
      return;
    }
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    try {
      const values = Object.fromEntries(new FormData(form));
      if (page === "login") values.identity = identity;
      if (page === "login") {
        await api("/login", { method: "POST", body: { identity: values.identity, password: values.password } });
        const current = await api("/session");
        window.location.replace(current.user?.role === "admin" ? "/admin.html" : "/dashboard.html");
      } else if (page === "register") {
        await api("/register", { method: "POST", body: values });
        toast("Akun berhasil dibuat.");
        window.location.replace("/dashboard.html");
      } else {
        try {
          await api("/password-reset", { method: "POST", body: { identity: values.identity } });
        } catch (error) {
          if (!error.message.includes("hubungi petugas")) throw error;
        }
        toast("Hubungi petugas perpustakaan untuk bantuan kata sandi.");
      }
    } catch (error) {
      if (page === "login") {
        form.elements.password.value = "";
        form.elements.password.focus();
        errorBox.textContent = error.message;
        errorBox.hidden = false;
      } else {
        toast(error.message, "error");
      }
    } finally {
      button.removeAttribute("aria-busy");
      button.disabled = false;
    }
  });
}
