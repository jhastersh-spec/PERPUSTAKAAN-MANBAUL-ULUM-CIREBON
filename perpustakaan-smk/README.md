# Perpustakaan SMK Manbaul Ulum Cirebon

Aplikasi perpustakaan full-stack berbasis Flask + SQLite. Repo ini dibersihkan untuk dipublikasikan: database lokal, akun, foto unggahan, virtual environment, dan riwayat Git lokal tidak disertakan.

## Cara paling mudah memublikasikan

**GitHub Pages tidak bisa menjalankan aplikasi ini**, karena backend memakai Python/Flask, API, sesi login, dan SQLite. Gunakan GitHub untuk menyimpan kode dan Render untuk menjalankan aplikasi web.

1. Buat repository baru di https://github.com/new (misalnya `perpustakaan-smk`).
2. Ekstrak ZIP ini, lalu unggah isi folder ke repository. Pastikan `app.py`, `requirements.txt`, dan `render.yaml` berada di folder utama repository. Jangan unggah folder `.venv` atau database pribadi.
3. Buka https://render.com dan masuk menggunakan GitHub.
4. Pilih **New + → Blueprint**, pilih repository tersebut, lalu ikuti proses deploy. Render membaca `render.yaml`.
5. Setelah deploy selesai, buka URL `.onrender.com` yang diberikan Render. URL itu yang bisa dibagikan ke orang lain.
6. Untuk membuat admin pertama, buka **Shell** pada layanan Render jika tersedia, lalu jalankan `python app.py --create-admin` dan ikuti pertanyaannya. Jika paket/layanan yang digunakan tidak menyediakan Shell, buat admin secara lokal terlebih dahulu tidak akan membuat akun itu tersedia di database server; gunakan layanan yang menyediakan Shell atau tambahkan mekanisme provisioning admin yang aman.

## Jalankan di komputer Windows

1. Instal Python 3.10 atau lebih baru.
2. Buka folder proyek di Terminal.
3. Jalankan `python -m venv .venv`
4. Aktifkan: ` .\.venv\Scripts\Activate.ps1`
5. Jalankan `pip install -r requirements.txt`
6. Buat admin pertama: `python app.py --create-admin`
7. Jalankan `python app.py`
8. Buka http://127.0.0.1:5000

## Catatan penting sebelum dipakai sungguhan

- Database SQLite dan file unggahan pada hosting gratis dapat hilang saat redeploy/restart jika penyimpanan persisten tidak disediakan. Untuk data yang harus bertahan, gunakan persistent disk/database yang didukung hosting dan konfigurasi `PUSTAKANUSA_DB` serta direktori unggahan dengan benar.
- Jangan memasukkan database, kata sandi, token, atau foto pribadi ke repository publik.
- Aplikasi ini adalah prototipe dan perlu ditinjau keamanannya serta dilengkapi backup, kebijakan privasi, dan alur reset password/email sebelum digunakan untuk data siswa sungguhan.
