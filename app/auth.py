"""
Email-based authentication: send & verify 6-digit OTP via Gmail SMTP.
Codes expire after 10 minutes. Stored in-memory (suitable for demo / thesis).
"""

from __future__ import annotations

import os
import random
import smtplib
import time
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from dotenv import load_dotenv

load_dotenv()

# ── Config ──────────────────────────────────────────────────────────────
SMTP_EMAIL = os.environ.get("SMTP_EMAIL", "")       # e.g. your-gmail@gmail.com
SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD", "")  # Gmail App Password
SMTP_HOST = os.environ.get("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
OTP_EXPIRY_SECONDS = 600  # 10 minutes

# ── In-memory OTP store: { email: (code, created_at) } ─────────────────
_otp_store: dict[str, tuple[str, float]] = {}


def generate_otp() -> str:
    return f"{random.randint(0, 999999):06d}"


def send_otp(email: str) -> bool:
    """Generate OTP, store it, and email it. Returns True on success."""
    if not SMTP_EMAIL or not SMTP_PASSWORD:
        raise RuntimeError("SMTP_EMAIL and SMTP_PASSWORD env vars are required")

    code = generate_otp()
    _otp_store[email] = (code, time.time())

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
    """Check if the code matches and hasn't expired."""
    entry = _otp_store.get(email)
    if not entry:
        return False
    stored_code, created_at = entry
    if time.time() - created_at > OTP_EXPIRY_SECONDS:
        _otp_store.pop(email, None)
        return False
    if stored_code != code:
        return False
    # Valid — remove used code
    _otp_store.pop(email, None)
    return True
