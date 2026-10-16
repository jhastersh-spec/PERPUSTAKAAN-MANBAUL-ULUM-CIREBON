import { api, escapeHtml, toast } from "./config.js";

export async function renderCamera(root, user) {
  const borrowingPromise = api("/borrowings");
  root.innerHTML = `<div class="page-heading"><div><span class="eyebrow">ALAT PETUGAS</span><h1>Kamera &amp; Scanner Buku</h1><p>Pindai ISBN buku atau ambil foto kondisi transaksi.</p></div></div>
    <div class="camera-layout"><section class="panel camera-panel"><div class="section-title"><div><h2>Pemindai barcode ISBN</h2><p>Izinkan akses kamera saat diminta. Kamera belakang akan dipilih bila tersedia.</p></div></div>
      <div class="camera-frame"><video id="camera-video" playsinline muted></video><div id="camera-placeholder" class="camera-placeholder"><span>▦</span><p>Pratinjau kamera akan muncul di sini</p></div></div>
      <div class="camera-controls"><label>Kamera<select id="camera-facing"><option value="environment">Belakang</option><option value="user">Depan</option></select></label><div class="button-row"><button class="button button-primary" id="camera-on">Aktifkan kamera</button><button class="button button-secondary" id="scan-button" disabled>Mulai scan</button><button class="button button-outline" id="capture-button" disabled>Ambil foto</button><button class="button button-outline" id="retake-button" disabled>Ulangi foto</button><button class="button button-outline" id="camera-off" disabled>Matikan kamera</button></div></div>
      <label class="file-button">Pilih foto dari galeri<input id="camera-gallery" type="file" accept="image/*"></label>
      <p id="camera-status" class="helper-box">Untuk Android, buka halaman lewat HTTPS lalu izinkan kamera. Pemindai mendukung ISBN barcode EAN-13.</p>
      <canvas id="camera-canvas" hidden></canvas></section>
      <section class="panel"><div class="section-title"><div><h2>Cari buku dengan ISBN</h2><p>Masukkan 10 atau 13 digit secara manual bila pemindaian tidak tersedia.</p></div></div>
      <form id="isbn-form" class="isbn-form"><label>ISBN<input name="isbn" inputmode="numeric" autocomplete="off" placeholder="Contoh: 9786024125189" required pattern="([0-9]{10}|[0-9]{13})"></label><button class="button button-primary">Cari buku</button></form>
      <div id="isbn-result" class="lookup-result"></div>
      <hr><div class="section-title"><div><h2>Simpan foto kondisi</h2><p>Foto hanya terkait transaksi yang dapat kamu akses.</p></div></div>
      <form id="photo-form"><label>Transaksi<input name="borrowing_id" list="transaction-options" required placeholder="Pilih atau masukkan nomor transaksi"><datalist id="transaction-options"></datalist></label><label>Jenis foto<select name="type"><option value="before">Sebelum dipinjam</option><option value="return">Saat pengembalian</option><option value="damage">Kondisi kerusakan</option></select></label><input type="file" name="photo" accept="image/jpeg,image/png,image/webp"><button class="button button-primary">Unggah foto kondisi</button><p class="field-hint">JPEG, PNG, WebP · maksimal 5 MB. Foto tidak digunakan sebagai bukti identitas.</p></form></section></div>`;

  const video = document.querySelector("#camera-video");
  const streamButtons = ["#scan-button", "#capture-button", "#camera-off"].map((selector) => document.querySelector(selector));
  let stream;
  let scanTimer;
  let detector;
  let scannerControls;
  let zxingModule;
  let lastCapturedBlob;
  const borrowings = await borrowingPromise;
  document.querySelector("#transaction-options").innerHTML = borrowings.map((row) => `<option value="${row.id}">${escapeHtml(row.transaction_no)} · ${escapeHtml(row.book_title)}</option>`).join("");
  function setStatus(message) { document.querySelector("#camera-status").textContent = message; }
  function showCameraError(error) {
    streamButtons.forEach((button) => { button.disabled = true; });
    document.querySelector("#camera-placeholder").hidden = false;
    if (error.name === "NotAllowedError" || error.name === "SecurityError") {
      setStatus("Izin kamera ditolak atau situs tidak aman. Gunakan HTTPS (atau localhost) lalu izinkan kamera di pengaturan browser.");
    } else if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
      setStatus("Kamera tidak ditemukan. Periksa kamera perangkat atau gunakan ISBN manual.");
    } else {
      setStatus(error.message || "Kamera tidak dapat dibuka. Gunakan HTTPS atau masukkan ISBN secara manual.");
    }
  }
  function stopScanner() {
    window.clearInterval(scanTimer);
    scanTimer = undefined;
    scannerControls?.stop();
    scannerControls = undefined;
  }
  async function loadZxing() {
    if (!zxingModule) {
      zxingModule = import("https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.5/+esm")
        .catch((error) => {
          zxingModule = undefined;
          throw error;
        });
    }
    return zxingModule;
  }
  async function handleBarcode(rawValue) {
    stopScanner();
    const isbn = String(rawValue || "").replace(/[\s-]/g, "");
    if (!/^(\d{10}|\d{13})$/.test(isbn)) {
      setStatus(`Barcode terbaca (${rawValue}), tetapi bukan ISBN 10 atau 13 digit.`);
      return;
    }
    document.querySelector("#isbn-form").elements.isbn.value = isbn;
    setStatus(`ISBN terbaca: ${isbn}. Mencari buku…`);
    await lookup(isbn);
  }
  async function startCamera() {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      throw new Error("Akses kamera membutuhkan HTTPS atau localhost. Buka situs melalui HTTPS, lalu coba lagi.");
    }
    stopScanner();
    stream?.getTracks().forEach((track) => track.stop());
    stream = undefined;
    video.srcObject = null;
    const nextStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: document.querySelector("#camera-facing").value } }, audio: false });
    stream = nextStream;
    video.srcObject = stream;
    await video.play();
    document.querySelector("#camera-placeholder").hidden = true;
    streamButtons.forEach((button) => { button.disabled = false; });
    setStatus(`Kamera ${document.querySelector("#camera-facing").value === "environment" ? "belakang" : "depan"} aktif. Arahkan barcode ke kamera.`);
    if ("BarcodeDetector" in window) {
      try { detector = new window.BarcodeDetector({ formats: ["ean_13", "ean_8", "upc_a", "upc_e"] }); }
      catch { detector = null; }
    }
  }
  async function compressPhoto(file) {
    if (!("createImageBitmap" in window)) return file;
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.78));
    if (!blob) throw new Error("Foto tidak dapat dikompresi. Pilih file gambar lain.");
    return new File([blob], "foto-kondisi.jpg", { type: "image/jpeg" });
  }
  async function lookup(isbn) {
    try {
      const result = await api("/books/lookup", { method: "POST", body: { isbn } });
      setStatus(result.book ? `Buku ditemukan: ${result.book.title}.` : "ISBN belum terdaftar di katalog.");
      document.querySelector("#isbn-result").innerHTML = result.book
        ? `<article class="lookup-card"><strong>${escapeHtml(result.book.title)}</strong><p>${escapeHtml(result.book.author)} · ${escapeHtml(result.book.isbn)}</p><p>Stok tersedia: ${result.book.stock}</p><a href="/book-detail.html?id=${result.book.id}" class="button button-secondary">Lihat detail</a></article>`
        : `<div class="helper-box">ISBN belum terdaftar. ${user.role === "admin" ? `<a href="/admin.html?isbn=${encodeURIComponent(isbn)}">Tambahkan buku dari panel admin</a>.` : "Minta petugas perpustakaan menambahkan buku."}</div>`;
    } catch (error) { toast(error.message, "error"); }
  }
  document.querySelector("#isbn-form").addEventListener("submit", async (event) => { event.preventDefault(); await lookup(event.target.isbn.value); });
  document.querySelector("#camera-on").addEventListener("click", async () => {
    try {
      await startCamera();
      if (location.protocol !== "https:" && location.hostname !== "localhost") setStatus("Kamera aktif. Untuk akses kamera yang andal, gunakan HTTPS atau localhost.");
    } catch (error) {
      showCameraError(error);
    }
  });
  document.querySelector("#camera-facing").addEventListener("change", async () => {
    if (!stream) return;
    try { await startCamera(); }
    catch (error) { showCameraError(error); }
  });
  document.querySelector("#scan-button").addEventListener("click", async () => {
    if (!stream) { setStatus("Aktifkan kamera terlebih dahulu."); return; }
    stopScanner();
    setStatus("Memuat pemindai barcode…");
    try {
      const { BrowserMultiFormatReader, BarcodeFormat } = await loadZxing();
      const reader = new BrowserMultiFormatReader();
      reader.possibleFormats = [BarcodeFormat.EAN_13];
      let barcodeFound = false;
      scannerControls = await reader.decodeFromStream(stream, video, (result, _error, controls) => {
        if (!result || barcodeFound) return;
        barcodeFound = true;
        scannerControls = controls;
        void handleBarcode(result.getText());
      });
      if (barcodeFound) stopScanner();
      else setStatus("Memindai barcode EAN-13… Arahkan barcode buku ke dalam bingkai.");
    } catch (error) {
      if (!detector) {
        setStatus("Pemindai tidak dapat dimuat. Periksa internet, gunakan HTTPS, atau masukkan ISBN secara manual.");
        return;
      }
      setStatus("Pemindai cadangan aktif. Arahkan barcode EAN-13 ke kamera.");
      let detecting = false;
      scanTimer = window.setInterval(async () => {
        if (detecting || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
        detecting = true;
        try {
          const codes = await detector.detect(video);
          if (codes.length) await handleBarcode(codes[0].rawValue);
        } catch (scanError) {
          stopScanner();
          setStatus(`Pemindaian gagal: ${scanError.message}`);
        } finally {
          detecting = false;
        }
      }, 400);
    }
  });
  document.querySelector("#capture-button").addEventListener("click", async () => {
    const canvas = document.querySelector("#camera-canvas");
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);
    lastCapturedBlob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.78));
    if (lastCapturedBlob) {
      const file = new File([lastCapturedBlob], "kondisi-buku.jpg", { type: "image/jpeg" });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      document.querySelector("#photo-form").elements.photo.files = transfer.files;
      setStatus("Foto diambil dan dikompresi. Pilih transaksi lalu unggah untuk menyimpannya.");
      document.querySelector("#retake-button").disabled = false;
      toast("Foto kamera berhasil diambil.");
    }
  });
  document.querySelector("#retake-button").addEventListener("click", () => {
    lastCapturedBlob = null;
    document.querySelector("#photo-form").elements.photo.value = "";
    document.querySelector("#retake-button").disabled = true;
    setStatus("Foto dihapus. Ambil foto baru atau pilih dari galeri.");
  });
  document.querySelector("#camera-gallery").addEventListener("change", (event) => {
    if (event.target.files?.[0]) document.querySelector("#photo-form").elements.photo.files = event.target.files;
  });
  document.querySelector("#camera-off").addEventListener("click", () => {
    stopScanner();
    stream?.getTracks().forEach((track) => track.stop());
    video.srcObject = null;
    document.querySelector("#camera-placeholder").hidden = false;
    streamButtons.forEach((button) => { button.disabled = true; });
    setStatus("Kamera dimatikan.");
  });
  document.querySelector("#photo-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(event.target);
    if (lastCapturedBlob && !data.get("photo").size) data.set("photo", lastCapturedBlob, "kondisi-buku.jpg");
    if (!data.get("photo")?.size) { toast("Ambil atau pilih foto terlebih dahulu.", "error"); return; }
    try {
      const compressed = await compressPhoto(data.get("photo"));
      data.set("photo", compressed);
      const id = data.get("borrowing_id");
      data.delete("borrowing_id");
      const result = await api(`/borrowings/${id}/photos`, { method: "POST", body: data });
      toast("Foto kondisi tersimpan pada transaksi.");
      setStatus(`Foto tersimpan: ${result.url}`);
      lastCapturedBlob = null;
      event.target.reset();
    } catch (error) { toast(error.message, "error"); }
  });
  window.addEventListener("pagehide", () => {
    stopScanner();
    stream?.getTracks().forEach((track) => track.stop());
  }, { once: true });
}
