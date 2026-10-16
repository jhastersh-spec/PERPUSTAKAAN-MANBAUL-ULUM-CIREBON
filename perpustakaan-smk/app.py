import argparse
import hmac
import os
import re
import secrets
import sqlite3
from contextlib import contextmanager
from datetime import date, datetime, timedelta
from functools import wraps
from pathlib import Path
from uuid import uuid4

from flask import Flask, jsonify, redirect, request, send_from_directory, session
from werkzeug.exceptions import RequestEntityTooLarge
from werkzeug.security import check_password_hash, generate_password_hash
from werkzeug.utils import secure_filename

BASE_DIR = Path(__file__).resolve().parent
INSTANCE_DIR = BASE_DIR / "instance"
UPLOAD_DIR = INSTANCE_DIR / "uploads"
COVER_DIR = INSTANCE_DIR / "covers"
DB_PATH = Path(os.environ.get("PUSTAKANUSA_DB", INSTANCE_DIR / "pustakanusa.sqlite3"))
ALLOWED_CATEGORIES = {
    "Pendidikan", "Novel", "Sejarah", "Teknologi", "Agama",
    "Komik", "Sains", "Referensi",
}
app = Flask(__name__, static_folder="assets", static_url_path="/assets")
app.config.update(
    SECRET_KEY=os.environ.get("PUSTAKANUSA_SECRET") or secrets.token_hex(32),
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=os.environ.get("PUSTAKANUSA_COOKIE_SECURE", "").lower() == "true",
    PERMANENT_SESSION_LIFETIME=timedelta(hours=8),
    MAX_CONTENT_LENGTH=5 * 1024 * 1024,
)
DUMMY_PASSWORD_HASH = generate_password_hash(secrets.token_urlsafe(24))


@contextmanager
def connect_db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DB_PATH, timeout=10)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    db.execute("PRAGMA journal_mode = WAL")
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def init_db():
    INSTANCE_DIR.mkdir(parents=True, exist_ok=True)
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    COVER_DIR.mkdir(parents=True, exist_ok=True)
    with connect_db() as db:
        db.executescript("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                member_number TEXT NOT NULL UNIQUE COLLATE NOCASE,
                name TEXT NOT NULL,
                email TEXT NOT NULL UNIQUE COLLATE NOCASE,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL CHECK(role IN ('admin', 'member')),
                active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL
            );
            DROP TABLE IF EXISTS login_attempts;
            CREATE TABLE IF NOT EXISTS books (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                author TEXT NOT NULL,
                publisher TEXT NOT NULL DEFAULT '',
                year INTEGER,
                category TEXT NOT NULL,
                isbn TEXT NOT NULL UNIQUE,
                stock INTEGER NOT NULL DEFAULT 0 CHECK(stock >= 0),
                cover TEXT NOT NULL DEFAULT '',
                description TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS borrowings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                transaction_no TEXT NOT NULL UNIQUE,
                user_id INTEGER NOT NULL REFERENCES users(id),
                book_id INTEGER NOT NULL REFERENCES books(id),
                borrow_date TEXT NOT NULL,
                due_date TEXT,
                requested_at TEXT NOT NULL,
                approved_at TEXT,
                returned_at TEXT,
                status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected','returned')),
                fine INTEGER NOT NULL DEFAULT 0,
                return_condition TEXT NOT NULL DEFAULT 'good',
                condition_note TEXT NOT NULL DEFAULT '',
                processed_by INTEGER REFERENCES users(id),
                admin_note TEXT NOT NULL DEFAULT '',
                member_note TEXT NOT NULL DEFAULT ''
            );
            CREATE TABLE IF NOT EXISTS favorites (
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
                created_at TEXT NOT NULL,
                PRIMARY KEY(user_id, book_id)
            );
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS audit_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                actor_id INTEGER REFERENCES users(id),
                action TEXT NOT NULL,
                details TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS transaction_photos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                borrowing_id INTEGER NOT NULL REFERENCES borrowings(id) ON DELETE CASCADE,
                file_name TEXT NOT NULL,
                photo_type TEXT NOT NULL,
                created_by INTEGER NOT NULL REFERENCES users(id),
                created_at TEXT NOT NULL
            );
            INSERT OR IGNORE INTO settings(key, value) VALUES ('loan_days', '14');
            INSERT OR IGNORE INTO settings(key, value) VALUES ('fine_per_day', '1000');
            INSERT OR IGNORE INTO settings(key, value) VALUES ('fine_damaged', '0');
            INSERT OR IGNORE INTO settings(key, value) VALUES ('fine_lost', '0');
        """)
        borrowing_columns = {
            row["name"] for row in db.execute("PRAGMA table_info(borrowings)")
        }
        if "return_condition" not in borrowing_columns:
            db.execute(
                "ALTER TABLE borrowings ADD COLUMN return_condition TEXT NOT NULL DEFAULT 'good'"
            )
        if db.execute("SELECT COUNT(*) FROM books").fetchone()[0] == 0:
            rows = [
                ("Laskar Pelangi", "Andrea Hirata", "Bentang Pustaka", 2005, "Novel", "9789793062792", 5, "https://covers.openlibrary.org/b/isbn/9789793062792-L.jpg", "Kisah persahabatan dan semangat belajar dari Belitung."),
                ("Bumi Manusia", "Pramoedya Ananta Toer", "Lentera Dipantara", 1980, "Sejarah", "9789799731234", 3, "https://covers.openlibrary.org/b/isbn/9789799731234-L.jpg", "Novel sejarah tentang Minke dan awal abad ke-20."),
                ("Filosofi Teras", "Henry Manampiring", "Kompas", 2018, "Pendidikan", "9786024125189", 4, "https://covers.openlibrary.org/b/isbn/9786024125189-L.jpg", "Pengantar filsafat Stoa untuk kehidupan sehari-hari."),
                ("Sapiens", "Yuval Noah Harari", "KPG", 2017, "Sains", "9786024246945", 2, "https://covers.openlibrary.org/b/isbn/9786024246945-L.jpg", "Sejarah singkat umat manusia."),
                ("Atomic Habits", "James Clear", "Gramedia", 2019, "Referensi", "9786020633176", 4, "https://covers.openlibrary.org/b/isbn/9786020633176-L.jpg", "Panduan praktis membangun kebiasaan baik."),
                ("Teknologi Informasi dan Komunikasi", "Rudi Hidayat", "Erlangga", 2022, "Teknologi", "9786232665123", 6, "", "Dasar komputer, jaringan, dan literasi digital."),
                ("Sejarah Indonesia Modern", "M.C. Ricklefs", "Gadjah Mada University Press", 2008, "Sejarah", "9789794204254", 2, "", "Referensi perjalanan sejarah Indonesia modern."),
                ("Komik Sains: Tubuh Manusia", "Iwan Juniarto", "Elex Media", 2021, "Komik", "9786230034567", 3, "", "Belajar anatomi dengan ilustrasi yang menyenangkan."),
                ("Pendidikan Agama Islam", "Kementerian Pendidikan", "Pusat Kurikulum", 2023, "Agama", "9786022449876", 5, "", "Buku pembelajaran agama untuk sekolah menengah."),
            ]
            db.executemany(
                """INSERT INTO books(title,author,publisher,year,category,isbn,stock,cover,description,created_at)
                   VALUES(?,?,?,?,?,?,?,?,?,?)""",
                [(*row, datetime.utcnow().isoformat(timespec="seconds")) for row in rows],
            )


def now_iso():
    return datetime.utcnow().isoformat(timespec="seconds")


def error(message, status=400):
    return jsonify({"error": message}), status


def get_user():
    user_id = session.get("user_id")
    if not user_id:
        return None
    with connect_db() as db:
        row = db.execute("SELECT * FROM users WHERE id=? AND active=1", (user_id,)).fetchone()
        return dict(row) if row else None


def login_required(role=None):
    def decorate(fn):
        @wraps(fn)
        def wrapped(*args, **kwargs):
            user = get_user()
            if not user:
                session.clear()
                return error("Silakan masuk kembali.", 401)
            if role and user["role"] != role:
                return error("Anda tidak memiliki izin untuk melakukan tindakan ini.", 403)
            request.current_user = user
            return fn(*args, **kwargs)
        return wrapped
    return decorate


def csrf_required(fn):
    @wraps(fn)
    def wrapped(*args, **kwargs):
        token = session.get("csrf_token", "")
        supplied = request.headers.get("X-CSRF-Token", "")
        if not token or not hmac.compare_digest(token, supplied):
            return error("Sesi formulir tidak valid. Muat ulang halaman dan coba lagi.", 400)
        return fn(*args, **kwargs)
    return wrapped


def audit(db, actor_id, action, details):
    db.execute(
        "INSERT INTO audit_log(actor_id,action,details,created_at) VALUES(?,?,?,?)",
        (actor_id, action, details[:500], now_iso()),
    )


def book_json(row):
    return dict(row)


def borrowing_query(db, where="", params=()):
    return db.execute(
        """SELECT r.*, u.name AS member_name, u.member_number, b.title AS book_title,
                  b.author, b.isbn, b.cover, p.name AS staff_name
           FROM borrowings r JOIN users u ON u.id=r.user_id
           JOIN books b ON b.id=r.book_id
           LEFT JOIN users p ON p.id=r.processed_by """ + where + " ORDER BY r.requested_at DESC",
        params,
    )


@app.errorhandler(RequestEntityTooLarge)
def too_large(_exc):
    return error("Ukuran file melebihi batas 5 MB.", 413)


@app.after_request
def set_security_headers(response):
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    if request.path.startswith("/api/") or request.path.endswith(".html") or request.path == "/":
        response.headers["Cache-Control"] = "no-store"
    return response


@app.get("/")
def home():
    return send_from_directory(BASE_DIR, "index.html")


@app.get("/<page>.html")
def page(page):
    allowed = {
        "index", "register", "forgot", "dashboard", "catalog", "book-detail",
        "borrowings", "history", "favorites", "profile", "notifications",
        "admin", "settings", "help", "camera", "reports",
    }
    if page not in allowed:
        return error("Halaman tidak ditemukan.", 404)
    if page not in {"index", "register", "forgot"} and not get_user():
        return redirect("/")
    if page in {"admin", "reports", "camera"}:
        user = get_user()
        if not user or user["role"] != "admin":
            return redirect("/dashboard.html" if user else "/")
    return send_from_directory(BASE_DIR, page + ".html")


@app.get("/api/session")
def session_info():
    user = get_user()
    session.setdefault("csrf_token", secrets.token_urlsafe(32))
    return jsonify({
        "user": {key: user[key] for key in ("id", "name", "email", "member_number", "role")} if user else None,
        "csrf_token": session["csrf_token"],
    })


@app.post("/api/register")
@csrf_required
def register():
    data = request.get_json(silent=True) or {}
    name = str(data.get("name", "")).strip()
    member_number = str(data.get("member_number", "")).strip()
    email = str(data.get("email", "")).strip().lower()
    password = str(data.get("password", ""))
    if len(name) < 2 or len(name) > 100:
        return error("Nama harus terdiri dari 2–100 karakter.")
    if not re.fullmatch(r"[A-Za-z0-9-]{3,30}", member_number):
        return error("Nomor anggota hanya boleh berisi huruf, angka, atau tanda hubung (3–30 karakter).")
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email) or len(email) > 254:
        return error("Alamat email tidak valid.")
    if len(password) < 10 or len(password) > 128:
        return error("Kata sandi harus berisi 10–128 karakter.")
    try:
        with connect_db() as db:
            db.execute(
                """INSERT INTO users(member_number,name,email,password_hash,role,created_at)
                   VALUES(?,?,?,?, 'member', ?)""",
                (member_number, name, email, generate_password_hash(password), now_iso()),
            )
            user_id = db.execute("SELECT last_insert_rowid()").fetchone()[0]
            audit(db, user_id, "account.registered", "Anggota mendaftar")
    except sqlite3.IntegrityError:
        return error("Nomor anggota atau email sudah terdaftar.", 409)
    session.clear()
    session["user_id"] = user_id
    session["csrf_token"] = secrets.token_urlsafe(32)
    session.permanent = True
    return jsonify({"ok": True}), 201


@app.post("/api/login")
@csrf_required
def login():
    data = request.get_json(silent=True) or {}
    identity = str(data.get("identity", "")).strip()
    password = str(data.get("password", ""))
    if not identity or len(identity) > 254 or len(password) < 10 or len(password) > 128:
        return error("Nama pengguna/email atau kata sandi tidak cocok.", 401)
    with connect_db() as db:
        row = db.execute(
            """SELECT * FROM users
               WHERE (email=? COLLATE NOCASE OR member_number=? COLLATE NOCASE)
               ORDER BY CASE WHEN member_number=? COLLATE NOCASE THEN 0 ELSE 1 END
               LIMIT 1""",
            (identity, identity, identity),
        ).fetchone()
    password_hash = row["password_hash"] if row else DUMMY_PASSWORD_HASH
    password_matches = check_password_hash(password_hash, password)
    if not row or not password_matches or not row["active"]:
        return error("Nama pengguna/email atau kata sandi tidak cocok.", 401)
    session.clear()
    session["user_id"] = row["id"]
    session["csrf_token"] = secrets.token_urlsafe(32)
    session.permanent = True
    return jsonify({"ok": True, "role": row["role"]})


@app.post("/api/logout")
@csrf_required
def logout():
    session.clear()
    return jsonify({"ok": True})


@app.post("/api/password-reset")
@csrf_required
def password_reset():
    return error("Untuk keamanan, hubungi petugas perpustakaan untuk mengatur ulang kata sandi.", 501)


@app.get("/api/books")
@login_required()
def books():
    query = str(request.args.get("q", "")).strip()[:100]
    category = str(request.args.get("category", "")).strip()
    author = str(request.args.get("author", "")).strip()[:100]
    available = request.args.get("available")
    where, params = [], []
    if query:
        where.append("(title LIKE ? OR author LIKE ? OR isbn LIKE ?)")
        params.extend([f"%{query}%"] * 3)
    if category in ALLOWED_CATEGORIES:
        where.append("category=?")
        params.append(category)
    if author:
        where.append("author LIKE ?")
        params.append(f"%{author}%")
    if available == "1":
        where.append("stock > 0")
    sql = "SELECT * FROM books" + (" WHERE " + " AND ".join(where) if where else "") + " ORDER BY title"
    with connect_db() as db:
        rows = [book_json(row) for row in db.execute(sql, params).fetchall()]
    return jsonify(rows)


@app.get("/api/books/<int:book_id>")
@login_required()
def book_detail(book_id):
    with connect_db() as db:
        row = db.execute("SELECT * FROM books WHERE id=?", (book_id,)).fetchone()
    return (jsonify(dict(row)), 200) if row else error("Buku tidak ditemukan.", 404)


@app.post("/api/books")
@login_required("admin")
@csrf_required
def create_book():
    data = request.get_json(silent=True) or {}
    try:
        fields = validate_book(data)
    except ValueError as exc:
        return error(str(exc))
    try:
        with connect_db() as db:
            db.execute(
                """INSERT INTO books(title,author,publisher,year,category,isbn,stock,cover,description,created_at)
                   VALUES(?,?,?,?,?,?,?,?,?,?)""",
                (*fields, now_iso()),
            )
            book_id = db.execute("SELECT last_insert_rowid()").fetchone()[0]
            audit(db, request.current_user["id"], "book.created", f"book_id={book_id}")
    except sqlite3.IntegrityError:
        return error("ISBN tersebut sudah terdaftar.", 409)
    return jsonify({"id": book_id}), 201


@app.put("/api/books/<int:book_id>")
@login_required("admin")
@csrf_required
def update_book(book_id):
    try:
        fields = validate_book(request.get_json(silent=True) or {})
    except ValueError as exc:
        return error(str(exc))
    try:
        with connect_db() as db:
            result = db.execute(
                """UPDATE books SET title=?,author=?,publisher=?,year=?,category=?,isbn=?,stock=?,
                   cover=?,description=? WHERE id=?""", (*fields, book_id),
            )
            if not result.rowcount:
                return error("Buku tidak ditemukan.", 404)
            audit(db, request.current_user["id"], "book.updated", f"book_id={book_id}")
    except sqlite3.IntegrityError:
        return error("ISBN tersebut sudah digunakan oleh buku lain.", 409)
    return jsonify({"ok": True})


def validate_book(data):
    title = str(data.get("title", "")).strip()
    author = str(data.get("author", "")).strip()
    publisher = str(data.get("publisher", "")).strip()[:120]
    category = str(data.get("category", "")).strip()
    isbn = re.sub(r"[-\s]", "", str(data.get("isbn", "")))
    cover = str(data.get("cover", "")).strip()[:500]
    description = str(data.get("description", "")).strip()[:2000]
    try:
        stock = int(data.get("stock", 0))
        year = int(data["year"]) if data.get("year") else None
    except (TypeError, ValueError):
        raise ValueError("Tahun terbit dan stok harus berupa angka.")
    if not title or len(title) > 180 or not author or len(author) > 120:
        raise ValueError("Judul dan penulis wajib diisi.")
    if category not in ALLOWED_CATEGORIES:
        raise ValueError("Pilih kategori buku yang tersedia.")
    if not re.fullmatch(r"\d{10}(\d{3})?", isbn):
        raise ValueError("ISBN harus berisi 10 atau 13 digit.")
    if not 0 <= stock <= 100000 or (year is not None and not 1000 <= year <= 2100):
        raise ValueError("Tahun atau jumlah stok tidak masuk akal.")
    if cover and not (cover.startswith("/media/") or cover.startswith("https://covers.openlibrary.org/")):
        raise ValueError("Sampul harus diunggah atau menggunakan URL Open Library HTTPS.")
    return title, author, publisher, year, category, isbn, stock, cover, description


@app.delete("/api/books/<int:book_id>")
@login_required("admin")
@csrf_required
def delete_book(book_id):
    with connect_db() as db:
        active = db.execute(
            "SELECT COUNT(*) FROM borrowings WHERE book_id=? AND status IN ('pending','approved')",
            (book_id,),
        ).fetchone()[0]
        if active:
            return error("Buku tidak dapat dihapus selama ada pengajuan atau peminjaman aktif.", 409)
        result = db.execute("DELETE FROM books WHERE id=?", (book_id,))
        if not result.rowcount:
            return error("Buku tidak ditemukan.", 404)
        audit(db, request.current_user["id"], "book.deleted", f"book_id={book_id}")
    return jsonify({"ok": True})


@app.post("/api/books/<int:book_id>/favorite")
@login_required()
@csrf_required
def toggle_favorite(book_id):
    with connect_db() as db:
        if not db.execute("SELECT id FROM books WHERE id=?", (book_id,)).fetchone():
            return error("Buku tidak ditemukan.", 404)
        key = (request.current_user["id"], book_id)
        exists = db.execute("SELECT 1 FROM favorites WHERE user_id=? AND book_id=?", key).fetchone()
        if exists:
            db.execute("DELETE FROM favorites WHERE user_id=? AND book_id=?", key)
            favorite = False
        else:
            db.execute("INSERT INTO favorites(user_id,book_id,created_at) VALUES(?,?,?)", (*key, now_iso()))
            favorite = True
    return jsonify({"favorite": favorite})


@app.get("/api/favorites")
@login_required()
def get_favorites():
    with connect_db() as db:
        rows = db.execute(
            """SELECT b.* FROM favorites f JOIN books b ON b.id=f.book_id
               WHERE f.user_id=? ORDER BY f.created_at DESC""",
            (request.current_user["id"],),
        ).fetchall()
    return jsonify([dict(row) for row in rows])


@app.post("/api/borrowings")
@login_required()
@csrf_required
def request_borrowing():
    data = request.get_json(silent=True) or {}
    try:
        book_id = int(data.get("book_id"))
        borrow_date = date.fromisoformat(str(data.get("borrow_date", "")))
    except (TypeError, ValueError):
        return error("Pilih buku dan tanggal peminjaman yang valid.")
    if borrow_date < date.today() or borrow_date > date.today() + timedelta(days=30):
        return error("Tanggal peminjaman harus hari ini hingga 30 hari ke depan.")
    with connect_db() as db:
        book = db.execute("SELECT id,stock FROM books WHERE id=?", (book_id,)).fetchone()
        if not book:
            return error("Buku tidak ditemukan.", 404)
        if book["stock"] < 1:
            return error("Stok buku sedang habis.", 409)
        pending = db.execute(
            "SELECT 1 FROM borrowings WHERE user_id=? AND book_id=? AND status IN ('pending','approved')",
            (request.current_user["id"], book_id),
        ).fetchone()
        if pending:
            return error("Buku ini sudah memiliki pengajuan atau peminjaman aktif Anda.", 409)
        transaction_no = "TRX-" + datetime.utcnow().strftime("%y%m%d") + "-" + secrets.token_hex(3).upper()
        db.execute(
            """INSERT INTO borrowings(transaction_no,user_id,book_id,borrow_date,requested_at,status)
               VALUES(?,?,?,?,?,'pending')""",
            (transaction_no, request.current_user["id"], book_id, borrow_date.isoformat(), now_iso()),
        )
        audit(db, request.current_user["id"], "borrowing.requested", transaction_no)
    return jsonify({"transaction_no": transaction_no}), 201


@app.get("/api/borrowings")
@login_required()
def get_borrowings():
    user = request.current_user
    with connect_db() as db:
        if user["role"] == "admin":
            rows = borrowing_query(db).fetchall()
        else:
            rows = borrowing_query(db, " WHERE r.user_id=?", (user["id"],)).fetchall()
    results = [dict(row) for row in rows]
    if user["role"] != "admin":
        for row in results:
            row.pop("admin_note", None)
    return jsonify(results)


@app.post("/api/borrowings/<int:borrowing_id>/decision")
@login_required("admin")
@csrf_required
def borrowing_decision(borrowing_id):
    data = request.get_json(silent=True) or {}
    decision = data.get("decision")
    if decision not in {"approve", "reject"}:
        return error("Keputusan harus setujui atau tolak.")
    with connect_db() as db:
        db.execute("BEGIN IMMEDIATE")
        row = db.execute(
            "SELECT * FROM borrowings WHERE id=? AND status='pending'", (borrowing_id,),
        ).fetchone()
        if not row:
            return error("Pengajuan tidak ditemukan atau sudah diproses.", 409)
        if decision == "approve":
            changed = db.execute(
                "UPDATE books SET stock=stock-1 WHERE id=? AND stock>0", (row["book_id"],),
            ).rowcount
            if not changed:
                return error("Stok buku sudah habis. Pengajuan belum diproses.", 409)
            loan_days = int(db.execute("SELECT value FROM settings WHERE key='loan_days'").fetchone()[0])
            due_date = date.fromisoformat(row["borrow_date"]) + timedelta(days=loan_days)
            db.execute(
                """UPDATE borrowings SET status='approved',approved_at=?,due_date=?,processed_by=? WHERE id=?""",
                (now_iso(), due_date.isoformat(), request.current_user["id"], borrowing_id),
            )
        else:
            db.execute(
                "UPDATE borrowings SET status='rejected',approved_at=?,processed_by=? WHERE id=?",
                (now_iso(), request.current_user["id"], borrowing_id),
            )
        audit(db, request.current_user["id"], f"borrowing.{decision}d", row["transaction_no"])
    return jsonify({"ok": True})


@app.post("/api/borrowings/<int:borrowing_id>/return")
@login_required("admin")
@csrf_required
def return_borrowing(borrowing_id):
    data = request.get_json(silent=True) or {}
    return_condition = str(data.get("return_condition", "good")).strip().lower()
    if return_condition not in {"good", "damaged", "lost"}:
        return error("Pilih kondisi buku baik, rusak, atau hilang.")
    condition = str(data.get("condition_note", "")).strip()[:500]
    member_note = str(data.get("member_note", "")).strip()[:500]
    admin_note = str(data.get("admin_note", "")).strip()[:1000]
    with connect_db() as db:
        db.execute("BEGIN IMMEDIATE")
        row = db.execute(
            "SELECT * FROM borrowings WHERE id=? AND status='approved'", (borrowing_id,),
        ).fetchone()
        if not row:
            return error("Peminjaman tidak aktif atau sudah dikembalikan.", 409)
        returned_on = date.today()
        due = date.fromisoformat(row["due_date"])
        late_days = max(0, (returned_on - due).days)
        settings = {
            setting["key"]: int(setting["value"])
            for setting in db.execute(
                "SELECT key,value FROM settings WHERE key IN ('fine_per_day','fine_damaged','fine_lost')"
            )
        }
        late_fine = late_days * settings["fine_per_day"]
        condition_fine = settings["fine_damaged"] if return_condition == "damaged" else 0
        if return_condition == "lost":
            condition_fine = settings["fine_lost"]
        fine = late_fine + condition_fine
        db.execute(
            """UPDATE borrowings SET status='returned',returned_at=?,fine=?,return_condition=?,condition_note=?,
               member_note=?,admin_note=?,processed_by=? WHERE id=?""",
            (returned_on.isoformat(), fine, return_condition, condition, member_note, admin_note, request.current_user["id"], borrowing_id),
        )
        if return_condition == "good":
            db.execute("UPDATE books SET stock=stock+1 WHERE id=?", (row["book_id"],))
        audit(
            db,
            request.current_user["id"],
            "borrowing.returned",
            f"{row['transaction_no']},condition={return_condition},fine={fine}",
        )
    return jsonify({
        "ok": True,
        "fine": fine,
        "late_fine": late_fine,
        "condition_fine": condition_fine,
        "late_days": late_days,
        "return_condition": return_condition,
    })


@app.get("/api/stats")
@login_required()
def stats():
    user = request.current_user
    with connect_db() as db:
        if user["role"] == "admin":
            totals = {
                "members": db.execute("SELECT COUNT(*) FROM users WHERE role='member'").fetchone()[0],
                "books": db.execute("SELECT COUNT(*) FROM books").fetchone()[0],
                "active": db.execute("SELECT COUNT(*) FROM borrowings WHERE status='approved'").fetchone()[0],
                "late": db.execute("SELECT COUNT(*) FROM borrowings WHERE status='approved' AND due_date < ?", (date.today().isoformat(),)).fetchone()[0],
                "pending": db.execute("SELECT COUNT(*) FROM borrowings WHERE status='pending'").fetchone()[0],
            }
        else:
            uid = user["id"]
            totals = {
                "borrowed": db.execute("SELECT COUNT(*) FROM borrowings WHERE user_id=? AND status='approved'", (uid,)).fetchone()[0],
                "returned": db.execute("SELECT COUNT(*) FROM borrowings WHERE user_id=? AND status='returned'", (uid,)).fetchone()[0],
                "late": db.execute("SELECT COUNT(*) FROM borrowings WHERE user_id=? AND status='approved' AND due_date < ?", (uid, date.today().isoformat())).fetchone()[0],
            }
        latest = db.execute("SELECT * FROM books ORDER BY created_at DESC LIMIT 4").fetchall()
        popular = db.execute(
            """SELECT b.*,COUNT(r.id) AS borrow_count FROM books b
               LEFT JOIN borrowings r ON r.book_id=b.id GROUP BY b.id
               ORDER BY borrow_count DESC,b.title LIMIT 4"""
        ).fetchall()
        activity = borrowing_query(db, " WHERE r.user_id=?" if user["role"] == "member" else "", (user["id"],) if user["role"] == "member" else ()).fetchmany(5)
    return jsonify({
        **totals,
        "latest": [dict(row) for row in latest],
        "popular": [dict(row) for row in popular],
        "activity": [dict(row) for row in activity],
    })


@app.get("/api/members")
@login_required("admin")
def members():
    with connect_db() as db:
        rows = db.execute(
            """SELECT id,member_number,name,email,active,created_at FROM users
               WHERE role='member' ORDER BY name"""
        ).fetchall()
    return jsonify([dict(row) for row in rows])


@app.patch("/api/members/<int:user_id>")
@login_required("admin")
@csrf_required
def update_member(user_id):
    active = (request.get_json(silent=True) or {}).get("active")
    if active not in (True, False):
        return error("Status akun tidak valid.")
    with connect_db() as db:
        result = db.execute(
            "UPDATE users SET active=? WHERE id=? AND role='member'",
            (int(active), user_id),
        )
        if not result.rowcount:
            return error("Anggota tidak ditemukan.", 404)
        audit(db, request.current_user["id"], "member.status_changed", f"user_id={user_id},active={active}")
    return jsonify({"ok": True})


@app.get("/api/settings")
@login_required()
def get_settings():
    with connect_db() as db:
        values = {row["key"]: int(row["value"]) for row in db.execute("SELECT * FROM settings")}
    return jsonify(values)


@app.put("/api/settings")
@login_required("admin")
@csrf_required
def set_settings():
    data = request.get_json(silent=True) or {}
    try:
        loan_days = int(data.get("loan_days"))
        fine_per_day = int(data.get("fine_per_day"))
        fine_damaged = int(data.get("fine_damaged"))
        fine_lost = int(data.get("fine_lost"))
    except (TypeError, ValueError):
        return error("Aturan peminjaman harus berupa angka.")
    fines = (fine_per_day, fine_damaged, fine_lost)
    if not 1 <= loan_days <= 90 or any(fine < 0 or fine > 100000000 for fine in fines):
        return error("Durasi peminjaman harus 1–90 hari dan setiap denda maksimal Rp100.000.000.")
    with connect_db() as db:
        db.executemany(
            """INSERT INTO settings(key,value) VALUES(?,?)
               ON CONFLICT(key) DO UPDATE SET value=excluded.value""",
            [
                ("loan_days", str(loan_days)),
                ("fine_per_day", str(fine_per_day)),
                ("fine_damaged", str(fine_damaged)),
                ("fine_lost", str(fine_lost)),
            ],
        )
        audit(
            db,
            request.current_user["id"],
            "settings.updated",
            f"loan_days={loan_days},fine_per_day={fine_per_day},fine_damaged={fine_damaged},fine_lost={fine_lost}",
        )
    return jsonify({"ok": True})


@app.get("/api/reports")
@login_required("admin")
def reports():
    start = request.args.get("start", "")
    end = request.args.get("end", "")
    try:
        if start:
            date.fromisoformat(start)
        if end:
            date.fromisoformat(end)
    except ValueError:
        return error("Rentang tanggal tidak valid.")
    where, params = [], []
    if start:
        where.append("substr(r.requested_at,1,10)>=?")
        params.append(start)
    if end:
        where.append("substr(r.requested_at,1,10)<=?")
        params.append(end)
    with connect_db() as db:
        rows = borrowing_query(db, " WHERE " + " AND ".join(where) if where else "", params).fetchall()
        stock = db.execute("SELECT title,isbn,category,stock FROM books ORDER BY title").fetchall()
        audit_rows = db.execute(
            """SELECT a.*,u.name AS actor_name FROM audit_log a
               LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.created_at DESC LIMIT 100"""
        ).fetchall()
    return jsonify({"transactions": [dict(row) for row in rows], "stock": [dict(row) for row in stock], "audit": [dict(row) for row in audit_rows]})


@app.post("/api/books/lookup")
@login_required()
@csrf_required
def lookup_isbn():
    data = request.get_json(silent=True) or {}
    isbn = re.sub(r"[-\s]", "", str(data.get("isbn", "")))
    if not re.fullmatch(r"\d{10}(\d{3})?", isbn):
        return error("Masukkan ISBN 10 atau 13 digit.")
    with connect_db() as db:
        row = db.execute("SELECT * FROM books WHERE isbn=?", (isbn,)).fetchone()
    return jsonify({"book": dict(row) if row else None})


@app.post("/api/borrowings/<int:borrowing_id>/photos")
@login_required("admin")
@csrf_required
def upload_photo(borrowing_id):
    user = request.current_user
    photo = request.files.get("photo")
    photo_type = request.form.get("type", "condition")
    if not photo or photo_type not in {"before", "return", "cover", "damage"}:
        return error("Pilih foto dan jenis foto yang valid.")
    data = photo.stream.read(5 * 1024 * 1024 + 1)
    if len(data) > 5 * 1024 * 1024:
        return error("Ukuran foto maksimal 5 MB.", 413)
    signatures = (data.startswith(b"\xff\xd8\xff"), data.startswith(b"\x89PNG\r\n\x1a\n"), data.startswith(b"RIFF") and data[8:12] == b"WEBP")
    if not any(signatures):
        return error("Format foto harus JPEG, PNG, atau WebP.")
    with connect_db() as db:
        borrowing = db.execute("SELECT user_id FROM borrowings WHERE id=?", (borrowing_id,)).fetchone()
        if not borrowing or (user["role"] != "admin" and borrowing["user_id"] != user["id"]):
            return error("Transaksi tidak ditemukan atau Anda tidak memiliki akses.", 404)
        name = secure_filename(photo.filename or "foto")[:80]
        filename = f"{uuid4().hex}-{name}"
        (UPLOAD_DIR / filename).write_bytes(data)
        db.execute(
            """INSERT INTO transaction_photos(borrowing_id,file_name,photo_type,created_by,created_at)
               VALUES(?,?,?,?,?)""",
            (borrowing_id, filename, photo_type, user["id"], now_iso()),
        )
    return jsonify({"url": f"/media/{filename}"}), 201


@app.post("/api/covers")
@login_required("admin")
@csrf_required
def upload_cover():
    image = request.files.get("cover")
    if not image:
        return error("Pilih file sampul terlebih dahulu.")
    data = image.stream.read(5 * 1024 * 1024 + 1)
    if len(data) > 5 * 1024 * 1024:
        return error("Ukuran sampul maksimal 5 MB.", 413)
    signatures = {
        "jpg": data.startswith(b"\xff\xd8\xff"),
        "png": data.startswith(b"\x89PNG\r\n\x1a\n"),
        "webp": data.startswith(b"RIFF") and data[8:12] == b"WEBP",
    }
    extension = next((ext for ext, valid in signatures.items() if valid), None)
    if not extension:
        return error("Sampul harus berupa JPEG, PNG, atau WebP.")
    filename = f"{uuid4().hex}.{extension}"
    (COVER_DIR / filename).write_bytes(data)
    return jsonify({"cover": f"/covers/{filename}"}), 201


@app.get("/covers/<path:filename>")
@login_required()
def cover(filename):
    return send_from_directory(COVER_DIR, filename)


@app.get("/api/borrowings/<int:borrowing_id>/photos")
@login_required()
def borrowing_photos(borrowing_id):
    user = request.current_user
    with connect_db() as db:
        borrowing = db.execute("SELECT user_id FROM borrowings WHERE id=?", (borrowing_id,)).fetchone()
        if not borrowing or (user["role"] != "admin" and borrowing["user_id"] != user["id"]):
            return error("Transaksi tidak ditemukan atau Anda tidak memiliki akses.", 404)
        rows = db.execute(
            "SELECT id,file_name,photo_type,created_at FROM transaction_photos WHERE borrowing_id=? ORDER BY created_at",
            (borrowing_id,),
        ).fetchall()
    return jsonify([{**dict(row), "url": f"/media/{row['file_name']}"} for row in rows])


@app.get("/api/notifications")
@login_required()
def notifications():
    user = request.current_user
    with connect_db() as db:
        if user["role"] == "admin":
            pending = db.execute("SELECT COUNT(*) FROM borrowings WHERE status='pending'").fetchone()[0]
            late = borrowing_query(
                db, " WHERE r.status='approved' AND r.due_date<?", (date.today().isoformat(),),
            ).fetchall()
            items = []
            if pending:
                items.append({"kind": "info", "title": "Pengajuan menunggu", "message": f"Ada {pending} pengajuan peminjaman yang perlu diproses.", "date": date.today().isoformat()})
            for row in late:
                items.append({"kind": "danger", "title": "Peminjaman terlambat", "message": f"{row['member_name']} belum mengembalikan “{row['book_title']}”.", "date": row["due_date"]})
        else:
            rows = borrowing_query(db, " WHERE r.user_id=? AND r.status IN ('pending','approved','returned','rejected')", (user["id"],)).fetchall()
            items = []
            for row in rows:
                if row["status"] == "pending":
                    items.append({"kind": "info", "title": "Pengajuan diterima", "message": f"Pengajuan “{row['book_title']}” menunggu persetujuan petugas.", "date": row["requested_at"]})
                elif row["status"] == "approved":
                    late = row["due_date"] < date.today().isoformat()
                    items.append({"kind": "danger" if late else "info", "title": "Terlambat dikembalikan" if late else "Pengingat pengembalian", "message": f"“{row['book_title']}” — batas pengembalian {row['due_date']}.", "date": row["due_date"]})
                elif row["status"] == "returned":
                    items.append({"kind": "success", "title": "Buku berhasil dikembalikan", "message": f"“{row['book_title']}” telah dicatat kembali.", "date": row["returned_at"]})
                elif row["status"] == "rejected":
                    items.append({"kind": "danger", "title": "Pengajuan tidak disetujui", "message": f"Pengajuan “{row['book_title']}” ditolak petugas.", "date": row["approved_at"]})
    return jsonify(items)


@app.get("/api/profile")
@login_required()
def profile():
    user = request.current_user
    return jsonify({key: user[key] for key in ("id", "name", "email", "member_number", "role", "created_at")})


@app.patch("/api/profile")
@login_required()
@csrf_required
def update_profile():
    data = request.get_json(silent=True) or {}
    name = str(data.get("name", "")).strip()
    email = str(data.get("email", "")).strip().lower()
    if not 2 <= len(name) <= 100 or not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email) or len(email) > 254:
        return error("Nama atau alamat email tidak valid.")
    try:
        with connect_db() as db:
            db.execute("UPDATE users SET name=?,email=? WHERE id=?", (name, email, request.current_user["id"]))
    except sqlite3.IntegrityError:
        return error("Alamat email sudah digunakan.", 409)
    return jsonify({"ok": True})


@app.put("/api/password")
@login_required()
@csrf_required
def change_password():
    data = request.get_json(silent=True) or {}
    current = str(data.get("current_password", ""))
    new_password = str(data.get("new_password", ""))
    if not 10 <= len(new_password) <= 128:
        return error("Kata sandi baru harus berisi 10–128 karakter.")
    with connect_db() as db:
        row = db.execute("SELECT password_hash FROM users WHERE id=?", (request.current_user["id"],)).fetchone()
        if not check_password_hash(row["password_hash"], current):
            return error("Kata sandi saat ini tidak cocok.", 401)
        db.execute("UPDATE users SET password_hash=? WHERE id=?", (generate_password_hash(new_password), request.current_user["id"]))
        audit(db, request.current_user["id"], "account.password_changed", "Kata sandi diperbarui")
    return jsonify({"ok": True})


@app.get("/media/<path:filename>")
@login_required()
def media(filename):
    user = request.current_user
    with connect_db() as db:
        record = db.execute(
            """SELECT r.user_id FROM transaction_photos p JOIN borrowings r ON r.id=p.borrowing_id
               WHERE p.file_name=?""", (filename,),
        ).fetchone()
        if record and user["role"] != "admin" and record["user_id"] != user["id"]:
            return error("Anda tidak memiliki akses ke foto ini.", 403)
        is_photo = bool(record)
    if not is_photo and user["role"] != "admin":
        return error("File tidak ditemukan.", 404)
    return send_from_directory(UPLOAD_DIR, filename)


def create_admin(username, name, email, password):
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9 ._-]{1,49}", username):
        raise ValueError("Username admin harus berisi 2–50 huruf, angka, spasi, titik, garis bawah, atau tanda hubung.")
    if not name.strip() or not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
        raise ValueError("Nama dan alamat email admin harus valid.")
    if not 10 <= len(password) <= 128:
        raise ValueError("Kata sandi admin harus berisi 10–128 karakter.")
    with connect_db() as db:
        db.execute(
            """INSERT INTO users(member_number,name,email,password_hash,role,created_at)
               VALUES(?,?,?,?, 'admin', ?)""",
            (username, name, email.lower(), generate_password_hash(password), now_iso()),
        )


init_db()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Perpustakaan SMK Manbaul Ulum Cirebon")
    parser.add_argument("--create-admin", action="store_true", help="Create the first administrator account")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=5000)
    args = parser.parse_args()
    if args.create_admin:
        username = input("Username admin: ").strip()
        name = input("Nama lengkap: ").strip()
        email = input("Email: ").strip()
        password = __import__("getpass").getpass("Kata sandi (minimal 10 karakter): ")
        try:
            create_admin(username, name, email, password)
        except sqlite3.IntegrityError:
            parser.error("Username/nomor anggota atau email sudah dipakai.")
        except ValueError as exc:
            parser.error(str(exc))
        print("Admin berhasil dibuat. Jalankan server tanpa --create-admin.")
    else:
        app.run(host=args.host, port=args.port, debug=False)
