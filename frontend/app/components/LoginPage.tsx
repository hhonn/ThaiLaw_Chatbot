"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { sendAuthCode, verifyAuthCode } from "../lib/api";

/* Types */
interface LoginPageProps {
  onLogin: (user: GoogleUser) => void;
}

export interface GoogleUser {
  type: "google";
  name: string;
  email: string;
  picture: string;
}

export type AppUser = GoogleUser;

/* Google credential JWT decoder (no library needed) */
function decodeJwt(token: string): Record<string, string> {
  const base64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
  const json = decodeURIComponent(
    atob(base64)
      .split("")
      .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
      .join("")
  );
  return JSON.parse(json);
}

/* Config */
const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "";
const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "";

export default function LoginPage({ onLogin }: LoginPageProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [googleReady, setGoogleReady] = useState(false);
  const [email, setEmail] = useState("");
  const [loginStep, setLoginStep] = useState<"form" | "emailSent" | "enterCode">("form");
  const [verificationCode, setVerificationCode] = useState("");

  const turnstileRef = useRef<HTMLDivElement>(null);
  const googleBtnRef = useRef<HTMLDivElement>(null);

  /* Load Cloudflare Turnstile */
  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) return;
    const existing = document.querySelector('script[src*="turnstile"]');
    if (existing) return;

    (window as unknown as Record<string, unknown>).onTurnstileLoad = () => {
      if (turnstileRef.current && (window as unknown as Record<string, { render: Function }>).turnstile) {
        (window as unknown as Record<string, { render: Function }>).turnstile.render(turnstileRef.current, {
          sitekey: TURNSTILE_SITE_KEY,
          theme: "light",
          callback: () => { /* Turnstile verified */ },
          "expired-callback": () => { /* Turnstile expired */ },
        });
      }
    };

    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoad";
    script.async = true;
    document.head.appendChild(script);
  }, []);

  /* Google credential handler */
  const handleGoogleCredential = useCallback(
    (response: { credential: string }) => {
      setIsLoading(true);
      try {
        const payload = decodeJwt(response.credential);
        const user: GoogleUser = {
          type: "google",
          name: payload.name || payload.email,
          email: payload.email,
          picture: payload.picture || "",
        };
        onLogin(user);
      } catch {
        setError("เข้าสู่ระบบด้วย Google ล้มเหลว");
        setIsLoading(false);
      }
    },
    [onLogin]
  );

  /* Load Google Identity Services script (once) */
  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;
    const w = window as unknown as Record<string, unknown>;
    // Already loaded
    if (w.google && (w.google as Record<string, unknown>).accounts) {
      setGoogleReady(true);
      return;
    }
    const existing = document.querySelector('script[src*="accounts.google.com/gsi"]');
    if (existing) {
      // Script tag exists but may still be loading — wait for it
      existing.addEventListener("load", () => setGoogleReady(true));
      // In case it already finished loading
      if (w.google && (w.google as Record<string, unknown>).accounts) {
        setGoogleReady(true);
      }
      return;
    }
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = () => setGoogleReady(true);
    document.head.appendChild(script);
  }, []);

  /* Render Google button (re-runs when SDK ready or callback changes) */
  useEffect(() => {
    if (!googleReady || !GOOGLE_CLIENT_ID || !googleBtnRef.current) return;
    const w = window as unknown as Record<string, { accounts: { id: { initialize: Function; renderButton: Function } } }>;
    const google = w.google;
    if (!google?.accounts?.id) return;

    google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: handleGoogleCredential,
    });
    // Clear previous render
    googleBtnRef.current.innerHTML = "";
    const containerW = googleBtnRef.current.offsetWidth;
    const btnWidth = containerW > 0 ? Math.min(containerW, 400) : 400;
    google.accounts.id.renderButton(googleBtnRef.current, {
      type: "standard",
      theme: "outline",
      size: "large",
      width: btnWidth,
      text: "continue_with",
      shape: "pill",
      logo_alignment: "left",
    });
  }, [googleReady, handleGoogleCredential]);

  /* Chat demo messages */
  const demoMessages = [
    { role: "user", text: "ถ้าถูกเลิกจ้างโดยไม่แจ้งล่วงหน้า จะได้ค่าชดเชยไหม?" },
    { role: "bot", text: "ได้ครับ ตาม พ.ร.บ.คุ้มครองแรงงาน มาตรา 118 ลูกจ้างที่ถูกเลิกจ้างมีสิทธิได้รับค่าชดเชยตามอายุงาน เช่น ทำงาน 1-3 ปี ได้ค่าชดเชย 90 วัน และถ้าไม่แจ้งล่วงหน้า ยังมีสิทธิได้ค่าสินจ้างแทนการบอกกล่าวล่วงหน้าด้วยครับ" },
    { role: "user", text: "ค่าชดเชยคำนวณจากเงินเดือนเท่าไหร่?" },
  ];

  return (
    <div style={{
      minHeight: "100vh",
      background: "#1a1a1a",
      display: "flex",
      fontFamily: "'Inter', 'Noto Sans Thai', -apple-system, sans-serif",
      color: "#e8e4df",
    }}>
      {/* LEFT SIDE */}
      <div style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        padding: "60px 40px",
        position: "relative",
      }}>
        {/* Nav logo top-left */}
        <div style={{
          position: "absolute", top: 28, left: 32,
          display: "flex", alignItems: "center", gap: 10,
        }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8,
            background: "linear-gradient(135deg, #D97757, #E8956A)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 16,
          }}>⚖️</div>
          <span style={{ fontSize: 16, fontWeight: 600, color: "#fafafa", letterSpacing: "-0.02em" }}>
            Thai Law Chatbot
          </span>
        </div>

        {/* Main content */}
        <div style={{ maxWidth: 480, width: "100%", textAlign: "center" }}>
          {/* Tagline */}
          <h1 style={{
            fontSize: "clamp(32px, 4vw, 48px)",
            fontWeight: 300,
            lineHeight: 1.15,
            color: "#fafafa",
            letterSpacing: "-0.03em",
            marginBottom: 16,
            fontStyle: "italic",
          }}>
            ถามกฎหมาย,<br />
            <span style={{ fontWeight: 400 }}>ได้คำตอบทันที</span>
          </h1>
          <p style={{
            fontSize: 16, color: "#8b8580", lineHeight: 1.6,
            marginBottom: 48,
          }}>
            ระบบ AI ให้ข้อมูลกฎหมายไทยเบื้องต้น พร้อมอ้างอิงมาตราที่เกี่ยวข้อง
          </p>

          {/* Login Card */}
          <div style={{
            background: "#2a2a2a",
            borderRadius: 16,
            padding: "28px 32px",
            border: "1px solid rgba(255,255,255,0.08)",
          }}>

            {/* Step: Email Sent */}
            {loginStep === "emailSent" && (
              <div style={{ textAlign: "center", padding: "16px 0" }}>
                <div style={{
                  width: 48, height: 48, margin: "0 auto 20px",
                  background: "linear-gradient(135deg, #D97757, #E8956A)",
                  borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="4" width="20" height="16" rx="2" />
                    <polyline points="22,4 12,13 2,4" />
                  </svg>
                </div>
                <p style={{ fontSize: 16, color: "#e8e4df", marginBottom: 6, fontWeight: 500 }}>
                  เพื่อดำเนินการต่อ กรุณาตรวจสอบอีเมล
                </p>
                <p style={{ fontSize: 15, color: "#fafafa", fontWeight: 600, marginBottom: 32 }}>
                  {email}
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: 12, fontSize: 13.5 }}>
                  <p style={{ color: "#8b8580" }}>
                    ลงชื่อเข้าใช้จากเบราว์เซอร์อื่น?{" "}
                    <button onClick={() => { setLoginStep("enterCode"); setError(""); }} className="cursor-pointer"
                      style={{ background: "none", border: "none", color: "#D97757", textDecoration: "underline", fontSize: 13.5, padding: 0, fontFamily: "inherit" }}>
                      กรอกรหัสยืนยัน
                    </button>
                  </p>
                  <p style={{ color: "#8b8580" }}>
                    ไม่ได้รับอีเมล?{" "}
                    <button
                      onClick={async () => {
                        setIsLoading(true); setError("");
                        try {
                          await sendAuthCode(email.trim());
                        } catch (e) { setError(e instanceof Error ? e.message : "เกิดข้อผิดพลาด"); }
                        finally { setIsLoading(false); }
                      }}
                      className="cursor-pointer"
                      style={{ background: "none", border: "none", color: "#D97757", textDecoration: "underline", fontSize: 13.5, padding: 0, fontFamily: "inherit" }}>
                      {isLoading ? "กำลังส่งใหม่..." : "ส่งอีกครั้ง"}
                    </button>
                  </p>
                </div>
                {error && <div style={{ fontSize: 13, color: "#f87171", marginTop: 16, textAlign: "center" }}>{error}</div>}
              </div>
            )}

            {/* Step: Enter Code */}
            {loginStep === "enterCode" && (
              <div style={{ textAlign: "center", padding: "16px 0" }}>
                <div style={{
                  width: 48, height: 48, margin: "0 auto 20px",
                  background: "linear-gradient(135deg, #D97757, #E8956A)",
                  borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="5" y="11" width="14" height="10" rx="2" /><circle cx="12" cy="16" r="1" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
                  </svg>
                </div>
                <p style={{ fontSize: 16, color: "#e8e4df", marginBottom: 4, fontWeight: 500 }}>กรอกรหัสยืนยัน</p>
                <p style={{ fontSize: 13, color: "#8b8580", marginBottom: 24 }}>ที่ส่งไปยัง {email}</p>
                <input type="text" value={verificationCode}
                  onChange={(e) => { setVerificationCode(e.target.value.replace(/\D/g, "")); setError(""); }}
                  placeholder="กรอกรหัส 6 หลัก" maxLength={6} autoFocus
                  style={{ width: "100%", height: 48, borderRadius: 24, border: "1.5px solid rgba(255,255,255,0.15)", padding: "0 20px", fontSize: 18, letterSpacing: "0.3em", color: "#e8e4df", background: "transparent", outline: "none", textAlign: "center", transition: "border-color 0.2s, box-shadow 0.2s", fontFamily: "inherit" }}
                  onFocus={(e) => { e.currentTarget.style.borderColor = "#D97757"; e.currentTarget.style.boxShadow = "0 0 0 3px rgba(217,119,87,0.15)"; }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.15)"; e.currentTarget.style.boxShadow = "none"; }}
                  onKeyDown={async (e) => {
                    if (e.key === "Enter" && verificationCode.length >= 4) {
                      setIsLoading(true); setError("");
                      try {
                        await verifyAuthCode(email.trim(), verificationCode);
                        onLogin({ type: "google", name: email.split("@")[0], email: email.trim(), picture: "" });
                      } catch (err) { setError(err instanceof Error ? err.message : "เกิดข้อผิดพลาด"); setIsLoading(false); }
                    }
                  }}
                />
                <button
                  onClick={async () => {
                    if (verificationCode.length < 4) { setError("กรุณากรอกรหัสยืนยัน"); return; }
                    setIsLoading(true); setError("");
                    try {
                      await verifyAuthCode(email.trim(), verificationCode);
                      onLogin({ type: "google", name: email.split("@")[0], email: email.trim(), picture: "" });
                    } catch (err) { setError(err instanceof Error ? err.message : "เกิดข้อผิดพลาด"); setIsLoading(false); }
                  }}
                  disabled={isLoading} className="cursor-pointer"
                  style={{ width: "100%", height: 48, borderRadius: 24, background: "#ffffff", color: "#1a1a1a", fontSize: 15, fontWeight: 500, border: "none", marginTop: 16, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, transition: "all 0.2s", opacity: isLoading ? 0.7 : 1 }}
                  onMouseEnter={(e) => { if (!isLoading) e.currentTarget.style.background = "#f0f0f0"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "#ffffff"; }}
                >
                  {isLoading ? (<><span style={{ width: 16, height: 16, border: "2px solid #ccc", borderTopColor: "#1a1a1a", borderRadius: "50%", animation: "spin 0.6s linear infinite", display: "inline-block" }} />กำลังยืนยัน...</>) : "ยืนยันรหัส"}
                </button>
                {error && <div style={{ fontSize: 13, color: "#f87171", marginTop: 12, textAlign: "center" }}>{error}</div>}
                <button onClick={() => { setLoginStep("emailSent"); setVerificationCode(""); setError(""); }} className="cursor-pointer"
                  style={{ background: "none", border: "none", color: "#8b8580", fontSize: 13, marginTop: 20, padding: 0, fontFamily: "inherit" }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = "#D97757"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = "#8b8580"; }}>
                  ← ย้อนกลับ
                </button>
              </div>
            )}

            {/* Step: Login Form */}
            {loginStep === "form" && (<>
            {/* Google Sign-In */}
            {GOOGLE_CLIENT_ID ? (
              <div ref={googleBtnRef} style={{
                display: "flex", justifyContent: "center",
                minHeight: 44,
              }} />
            ) : (
              <button
                onClick={() => {
                  setIsLoading(true);
                  setTimeout(() => {
                    onLogin({
                      type: "google",
                      name: "Demo User",
                      email: "demo@example.com",
                      picture: "",
                    });
                  }, 600);
                }}
                disabled={isLoading}
                className="cursor-pointer"
                style={{
                  width: "100%", height: 48, borderRadius: 24,
                  background: "#ffffff",
                  color: "#1a1a1a", fontSize: 15, fontWeight: 500,
                  border: "none",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
                  transition: "all 0.2s",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "#f0f0f0"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "#ffffff"; }}
              >
                <svg width="18" height="18" viewBox="0 0 48 48">
                  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
                  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
                  <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
                  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
                </svg>
                Continue with Google
              </button>
            )}

            {/* Cloudflare Turnstile */}
            {TURNSTILE_SITE_KEY && (
              <div style={{ display: "flex", justifyContent: "center", marginTop: 16 }}>
                <div ref={turnstileRef} />
              </div>
            )}

            {/* OR divider */}
            <div style={{
              display: "flex", alignItems: "center", gap: 12,
              margin: "20px 0",
            }}>
              <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.1)" }} />
              <span style={{ fontSize: 12, color: "#6b6560", fontWeight: 500, letterSpacing: "0.05em" }}>OR</span>
              <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.1)" }} />
            </div>

            {/* Email input */}
            <input
              type="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setError(""); }}
              placeholder="กรอกอีเมลของคุณ"
              autoComplete="email"
              style={{
                width: "100%", height: 48, borderRadius: 24,
                border: "1.5px solid rgba(255,255,255,0.15)",
                padding: "0 20px", fontSize: 14,
                color: "#e8e4df", background: "transparent",
                outline: "none", transition: "border-color 0.2s, box-shadow 0.2s",
                fontFamily: "inherit",
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = "#D97757";
                e.currentTarget.style.boxShadow = "0 0 0 3px rgba(217,119,87,0.15)";
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = "rgba(255,255,255,0.15)";
                e.currentTarget.style.boxShadow = "none";
              }}
            />

            {/* Continue with email button */}
            <button
              onClick={async () => {
                if (!email.trim()) {
                  setError("กรุณากรอกอีเมล");
                  return;
                }
                if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                  setError("รูปแบบอีเมลไม่ถูกต้อง");
                  return;
                }
                setIsLoading(true);
                setError("");
                try {
                  await sendAuthCode(email.trim());
                  setLoginStep("emailSent");
                } catch (e) {
                  setError(e instanceof Error ? e.message : "เกิดข้อผิดพลาด");
                } finally {
                  setIsLoading(false);
                }
              }}
              disabled={isLoading}
              className="cursor-pointer"
              style={{
                width: "100%", height: 48, borderRadius: 24,
                background: "#ffffff",
                color: "#1a1a1a", fontSize: 15, fontWeight: 500,
                border: "none", marginTop: 12,
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                transition: "all 0.2s",
                opacity: isLoading ? 0.7 : 1,
              }}
              onMouseEnter={(e) => { if (!isLoading) e.currentTarget.style.background = "#f0f0f0"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "#ffffff"; }}
            >
              {isLoading ? (
                <>
                  <span style={{
                    width: 16, height: 16, border: "2px solid #ccc",
                    borderTopColor: "#1a1a1a", borderRadius: "50%",
                    animation: "spin 0.6s linear infinite", display: "inline-block",
                  }} />
                  กำลังส่งรหัส...
                </>
              ) : (
                "Continue with email"
              )}
            </button>

            {/* Disclaimer */}
            <p style={{
              fontSize: 11.5, color: "#6b6560", marginTop: 16,
              textAlign: "center", lineHeight: 1.5,
            }}>
              ข้อมูลที่ให้เป็นข้อมูลเบื้องต้น ไม่ใช่คำปรึกษาทางกฎหมาย
            </p>

            {/* Error */}
            {error && (
              <div style={{
                fontSize: 13, color: "#f87171", marginTop: 16,
                display: "flex", alignItems: "center", gap: 6,
                background: "rgba(248,113,113,0.1)", padding: "8px 12px",
                borderRadius: 8,
              }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                {error}
              </div>
            )}
            </>)}
          </div>

        </div>
      </div>

      {/* RIGHT SIDE — Chat Preview */}
      <div className="hidden lg:flex" style={{
        width: "45%", maxWidth: 560,
        flexDirection: "column",
        justifyContent: "center",
        padding: "60px 40px 60px 20px",
      }}>
        <div style={{
          background: "#2a2a2a",
          borderRadius: 20,
          padding: "32px 28px",
          border: "1px solid rgba(255,255,255,0.06)",
          boxShadow: "0 8px 40px rgba(0,0,0,0.3)",
        }}>
          {/* Chat header tabs */}
          <div style={{
            display: "flex",
            justifyContent: "center",
            marginBottom: 28,
          }}>
            <div style={{
              display: "inline-flex",
              background: "#333",
              borderRadius: 24,
              padding: 3,
            }}>
              <div style={{
                padding: "7px 24px",
                borderRadius: 20,
                background: "#4a4a4a",
                color: "#fafafa",
                fontSize: 13,
                fontWeight: 500,
              }}>Chat</div>
              <div style={{
                padding: "7px 24px",
                borderRadius: 20,
                color: "#8b8580",
                fontSize: 13,
                fontWeight: 500,
              }}>RAG</div>
            </div>
          </div>

          {/* Messages */}
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {demoMessages.map((msg, i) => (
              <div key={i}>
                {msg.role === "user" ? (
                  <div style={{ display: "flex", justifyContent: "flex-end" }}>
                    <div style={{
                      background: "#D97757",
                      color: "#fff",
                      padding: "10px 16px",
                      borderRadius: "18px 18px 4px 18px",
                      fontSize: 13.5,
                      lineHeight: 1.6,
                      maxWidth: "85%",
                    }}>
                      {msg.text}
                    </div>
                  </div>
                ) : (
                  <div style={{
                    color: "#d4d0cb",
                    fontSize: 13.5,
                    lineHeight: 1.75,
                    padding: "0 4px",
                  }}>
                    {msg.text}
                  </div>
                )}
              </div>
            ))}
            {/* Typing indicator */}
            <div style={{ display: "flex", gap: 4, padding: "4px 4px" }}>
              {[0, 1, 2].map((i) => (
                <div key={i} style={{
                  width: 6, height: 6, borderRadius: "50%",
                  background: "#D97757",
                  opacity: 0.5,
                  animation: `pulse 1.2s ease-in-out ${i * 0.15}s infinite`,
                }} />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Pulse animation */}
      <style>{`
        @keyframes pulse {
          0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
          40% { opacity: 1; transform: scale(1.1); }
        }
      `}</style>
    </div>
  );
}