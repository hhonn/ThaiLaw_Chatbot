from __future__ import annotations

import hmac
import os
import random
import smtplib
import sqlite3
import threading
import time
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from dotenv import load_dotenv

load_dotenv()

# Config
SMTP_EMAIL    = os.environ.get("SMTP_EMAIL", "")
SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD", "")
SMTP_HOST     = os.environ.get("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT     = int(os.environ.get("SMTP_PORT", "587"))
OTP_EXPIRY_SECONDS = 600  # 10 minutes
OTP_RATE_LIMIT     = 3    # max OTP requests per window per email
OTP_RATE_WINDOW    = 3600  # 1 hour

# SQLite OTP store
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_OTP_DB_PATH = os.environ.get(
    "OTP_DB_PATH",
    os.path.join(PROJECT_ROOT, "data", "analytics", "otp.sqlite3"),
)
_db_lock = threading.Lock()


def _get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(_OTP_DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def _init_db() -> None:
    os.makedirs(os.path.dirname(_OTP_DB_PATH), exist_ok=True)
    with _db_lock, _get_conn() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS otp_codes (
                email      TEXT PRIMARY KEY,
                code       TEXT NOT NULL,
                created_at REAL NOT NULL
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS otp_rate (
                email        TEXT NOT NULL,
                requested_at REAL NOT NULL
            )
        """)
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_otp_rate_email ON otp_rate(email)"
        )
        conn.commit()


_init_db()


def _check_rate_limit(email: str) -> bool:
    """Return True if within limit, False if exceeded."""
    window_start = time.time() - OTP_RATE_WINDOW
    with _db_lock, _get_conn() as conn:
        row = conn.execute(
            "SELECT COUNT(*) AS cnt FROM otp_rate WHERE email = ? AND requested_at > ?",
            (email, window_start),
        ).fetchone()
        return int(row["cnt"]) < OTP_RATE_LIMIT


def _record_otp_request(email: str) -> None:
    with _db_lock, _get_conn() as conn:
        conn.execute(
            "INSERT INTO otp_rate (email, requested_at) VALUES (?, ?)",
            (email, time.time()),
        )
        # Purge expired entries to keep the table small
        conn.execute(
            "DELETE FROM otp_rate WHERE requested_at < ?",
            (time.time() - OTP_RATE_WINDOW,),
        )
        conn.commit()


def generate_otp() -> str:
    return f"{random.randint(0, 999999):06d}"


def send_otp(email: str) -> bool:
    """Generate OTP, store it in SQLite, and email it. Returns True on success."""
    if not SMTP_EMAIL or not SMTP_PASSWORD:
        raise RuntimeError("SMTP_EMAIL and SMTP_PASSWORD env vars are required")

    if not _check_rate_limit(email):
        raise RuntimeError(
            f"ส่งรหัสยืนยันได้สูงสุด {OTP_RATE_LIMIT} ครั้งต่อชั่วโมง กรุณารอแล้วลองใหม่"
        )

    code = generate_otp()
    with _db_lock, _get_conn() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO otp_codes (email, code, created_at) VALUES (?, ?, ?)",
            (email, code, time.time()),
        )
        conn.commit()
    _record_otp_request(email)

    msg = MIMEMultipart("alternative")
    msg["From"] = f"Thai Law Chatbot <{SMTP_EMAIL}>"
    msg["To"] = email
    msg["Subject"] = f"รหัสยืนยัน: {code} — Thai Law Chatbot"

    html = f"""\
    <div style="font-family: 'Inter', sans-serif; max-width: 480px; margin: 0 auto;
                background: #1a1a1a; color: #e8e4df; padding: 40px 32px; border-radius: 16px;">
      <div style="text-align: center; margin-bottom: 32px;">
        <div style="display: inline-block; width: 48px; height: 48px; line-height: 48px;
                    background: linear-gradient(135deg, #D97757, #E8956A);
                    border-radius: 12px; font-size: 24px;">⚖️</div>
      </div>
      <h2 style="text-align: center; font-weight: 500; margin-bottom: 8px; color: #fafafa;">
        รหัสยืนยันของคุณ
      </h2>
      <p style="text-align: center; color: #8b8580; font-size: 14px; margin-bottom: 32px;">
        ใช้รหัสนี้เพื่อเข้าสู่ระบบ Thai Law Chatbot
      </p>
      <div style="text-align: center; font-size: 36px; font-weight: 700; letter-spacing: 0.3em;
                  color: #fafafa; background: #2a2a2a; padding: 20px; border-radius: 12px;
                  border: 1px solid rgba(255,255,255,0.08); margin-bottom: 24px;">
        {code}
      </div>
      <p style="text-align: center; color: #6b6560; font-size: 12px;">
        รหัสนี้จะหมดอายุใน 10 นาที<br>
        หากคุณไม่ได้ร้องขอ กรุณาเพิกเฉยอีเมลนี้
      </p>
    </div>
    """

    msg.attach(MIMEText(html, "html", "utf-8"))

    with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
        server.starttls()
        server.login(SMTP_EMAIL, SMTP_PASSWORD)
        server.sendmail(SMTP_EMAIL, email, msg.as_string())

    return True


def verify_otp(email: str, code: str) -> bool:
    """Check if the code matches and hasn't expired. Uses constant-time comparison."""
    with _db_lock, _get_conn() as conn:
        row = conn.execute(
            "SELECT code, created_at FROM otp_codes WHERE email = ?", (email,)
        ).fetchone()
        if not row:
            return False
        if time.time() - row["created_at"] > OTP_EXPIRY_SECONDS:
            conn.execute("DELETE FROM otp_codes WHERE email = ?", (email,))
            conn.commit()
            return False
        # Constant-time comparison to prevent timing attacks
        if not hmac.compare_digest(str(row["code"]), str(code)):
            return False
        # Valid — consume the code
        conn.execute("DELETE FROM otp_codes WHERE email = ?", (email,))
        conn.commit()
        return True