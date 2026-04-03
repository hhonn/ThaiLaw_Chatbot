"use client";

import React, { useState } from "react";
import { ChatSession } from "../lib/useChatHistory";
import type { ChatMessage } from "../lib/api";
import type { AppUser } from "./LoginPage";

interface SidebarProps {
  onNewChat: () => void;
  sessions: ChatSession[];
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  onDeleteAll: () => void;
  messages: ChatMessage[];
  theme: "light" | "dark";
  onToggleTheme: () => void;
  user: AppUser;
  onLogout: () => void;
}

export default function Sidebar({
  onNewChat,
  sessions,
  activeSessionId,
  onSelectSession,
  onDeleteSession,
  onDeleteAll,
  messages,
  theme,
  onToggleTheme,
  user,
  onLogout,
}: SidebarProps) {
  const [hoveredSession, setHoveredSession] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showAbout, setShowAbout] = useState(false);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);

  const filtered = search.trim()
    ? sessions.filter((s) => s.title.toLowerCase().includes(search.trim().toLowerCase()))
    : sessions;

  const exportChat = () => {
    if (messages.length === 0) return;
    const lines = messages.map((m) =>
      `[${m.role === "user" ? "คุณ" : "LawBot"}]\n${m.content}`
    );
    const text = lines.join("\n\n" + "─".repeat(40) + "\n\n");
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `lawbot-chat-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <aside
      className="hidden md:flex flex-col h-screen"
      style={{
        width: 272,
        minWidth: 272,
        background: "var(--bg-sidebar)",
        borderRight: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      {/* Header */}
      <div style={{ padding: "20px 18px 16px" }}>
        <div className="flex items-center gap-2.5" style={{ marginBottom: 14 }}>
          <div
            style={{
              width: 34, height: 34, borderRadius: 9,
              background: "linear-gradient(135deg, #D97757 0%, #E8956A 100%)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 17,
            }}
          >
            ⚖️
          </div>
          <div>
            <div style={{ color: "#fafafa", fontSize: 14, fontWeight: 600, lineHeight: 1.2 }}>
              Thai Law Chatbot
            </div>
            <div style={{ color: "#71717a", fontSize: 11, marginTop: 1 }}>
              AI Legal Assistant
            </div>
          </div>
        </div>
        <button
          onClick={onNewChat}
          className="w-full cursor-pointer"
          style={{
            height: 36, borderRadius: 8, fontSize: 13, fontWeight: 500,
            color: "#fafafa",
            background: "rgba(255,255,255,0.07)",
            border: "1px solid rgba(255,255,255,0.1)",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
            transition: "all 0.15s ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(255,255,255,0.12)";
            e.currentTarget.style.borderColor = "rgba(255,255,255,0.18)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "rgba(255,255,255,0.07)";
            e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)";
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          เริ่มแชทใหม่
        </button>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto" style={{ padding: "0 12px 12px" }}>
        {/* Search */}
        {sessions.length > 0 && (
          <div style={{ padding: "4px 6px 10px" }}>
            <div style={{
              display: "flex", alignItems: "center", gap: 6,
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 7, padding: "0 10px", height: 32,
            }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#71717a" strokeWidth="2" strokeLinecap="round">
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="ค้นหาประวัติ..."
                style={{
                  flex: 1, background: "transparent", border: "none", outline: "none",
                  color: "#e4e4e7", fontSize: 12, caretColor: "#E8956A",
                }}
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  className="cursor-pointer"
                  style={{ background: "none", border: "none", color: "#71717a", fontSize: 14, lineHeight: 1 }}
                >
                  ×
                </button>
              )}
            </div>
          </div>
        )}

        {/* Chat History */}
        {filtered.length > 0 && (
          <div style={{ marginBottom: 4 }}>
            <div style={{
              fontSize: 11, fontWeight: 500, color: "#52525b",
              padding: "4px 8px 6px", letterSpacing: "0.01em",
              display: "flex", justifyContent: "space-between", alignItems: "center",
            }}>
              <span>ประวัติการสนทนา ({sessions.length})</span>
              {sessions.length > 1 && !confirmDeleteAll && (
                <button
                  onClick={() => setConfirmDeleteAll(true)}
                  className="cursor-pointer"
                  style={{
                    background: "none", border: "none", color: "#52525b",
                    fontSize: 10, transition: "color 0.12s",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = "#ef4444")}
                  onMouseLeave={(e) => (e.currentTarget.style.color = "#52525b")}
                >
                  ลบทั้งหมด
                </button>
              )}
              {confirmDeleteAll && (
                <span style={{ display: "flex", gap: 6 }}>
                  <button
                    onClick={() => { onDeleteAll(); setConfirmDeleteAll(false); }}
                    className="cursor-pointer"
                    style={{ background: "none", border: "none", color: "#ef4444", fontSize: 10, fontWeight: 600 }}
                  >
                    ยืนยัน
                  </button>
                  <button
                    onClick={() => setConfirmDeleteAll(false)}
                    className="cursor-pointer"
                    style={{ background: "none", border: "none", color: "#71717a", fontSize: 10 }}
                  >
                    ยกเลิก
                  </button>
                </span>
              )}
            </div>
            {filtered.map((s) => {
              const isActive = s.id === activeSessionId;
              const isHovered = hoveredSession === s.id;
              return (
                <div
                  key={s.id}
                  onMouseEnter={() => setHoveredSession(s.id)}
                  onMouseLeave={() => setHoveredSession(null)}
                  style={{
                    display: "flex", alignItems: "center", gap: 4,
                    borderRadius: 7, marginBottom: 1,
                    background: isActive ? "rgba(217,119,87,0.15)" : isHovered ? "rgba(255,255,255,0.06)" : "transparent",
                    transition: "background 0.12s ease",
                  }}
                >
                  <button
                    onClick={() => onSelectSession(s.id)}
                    className="text-left cursor-pointer"
                    style={{
                      flex: 1, minWidth: 0, padding: "7px 10px", border: "none",
                      background: "transparent",
                      fontSize: 12.5, lineHeight: 1.45,
                      color: isActive ? "#E8956A" : isHovered ? "#fafafa" : "#a1a1aa",
                      whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                      transition: "color 0.12s ease",
                    }}
                  >
                    {s.title}
                  </button>
                  {isHovered && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onDeleteSession(s.id); }}
                      className="cursor-pointer"
                      title="ลบ"
                      style={{
                        flexShrink: 0, width: 24, height: 24, border: "none",
                        background: "transparent", borderRadius: 5,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        color: "#71717a", marginRight: 4,
                        transition: "color 0.12s",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = "#ef4444")}
                      onMouseLeave={(e) => (e.currentTarget.style.color = "#71717a")}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                      </svg>
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {search && filtered.length === 0 && (
          <div style={{ padding: "16px 12px", textAlign: "center", color: "#52525b", fontSize: 12 }}>
            ไม่พบผลลัพธ์
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{
        padding: "10px 16px 16px",
        borderTop: "1px solid rgba(255,255,255,0.06)",
      }}>
        {/* Action buttons row */}
        <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
          {/* Theme toggle */}
          <button
            onClick={onToggleTheme}
            className="cursor-pointer"
            title={theme === "light" ? "โหมดมืด" : "โหมดสว่าง"}
            style={{
              flex: 1, height: 32, borderRadius: 7, border: "none",
              background: "rgba(255,255,255,0.06)",
              color: "#a1a1aa", fontSize: 13,
              display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
              transition: "all 0.15s",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.12)"; e.currentTarget.style.color = "#fafafa"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; e.currentTarget.style.color = "#a1a1aa"; }}
          >
            {theme === "light" ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="12" cy="12" r="5" />
                <line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" />
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                <line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" />
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
              </svg>
            )}
            <span style={{ fontSize: 11 }}>{theme === "light" ? "มืด" : "สว่าง"}</span>
          </button>

          {/* Export */}
          <button
            onClick={exportChat}
            className="cursor-pointer"
            title="ส่งออกแชท"
            style={{
              flex: 1, height: 32, borderRadius: 7, border: "none",
              background: "rgba(255,255,255,0.06)",
              color: messages.length > 0 ? "#a1a1aa" : "#3f3f46",
              fontSize: 13,
              display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
              transition: "all 0.15s",
              cursor: messages.length > 0 ? "pointer" : "default",
            }}
            onMouseEnter={(e) => { if (messages.length > 0) { e.currentTarget.style.background = "rgba(255,255,255,0.12)"; e.currentTarget.style.color = "#fafafa"; } }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; e.currentTarget.style.color = messages.length > 0 ? "#a1a1aa" : "#3f3f46"; }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            <span style={{ fontSize: 11 }}>ส่งออก</span>
          </button>

          {/* About */}
          <button
            onClick={() => setShowAbout(!showAbout)}
            className="cursor-pointer"
            title="เกี่ยวกับระบบ"
            style={{
              flex: 1, height: 32, borderRadius: 7, border: "none",
              background: showAbout ? "rgba(217,119,87,0.15)" : "rgba(255,255,255,0.06)",
              color: showAbout ? "#E8956A" : "#a1a1aa",
              fontSize: 13,
              display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
              transition: "all 0.15s",
            }}
            onMouseEnter={(e) => { if (!showAbout) { e.currentTarget.style.background = "rgba(255,255,255,0.12)"; e.currentTarget.style.color = "#fafafa"; } }}
            onMouseLeave={(e) => { if (!showAbout) { e.currentTarget.style.background = "rgba(255,255,255,0.06)"; e.currentTarget.style.color = "#a1a1aa"; } }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
            <span style={{ fontSize: 11 }}>ข้อมูล</span>
          </button>
        </div>

        {/* About panel */}
        {showAbout && (
          <div style={{
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 8, padding: "12px 14px", fontSize: 11, lineHeight: 1.7,
            color: "#a1a1aa",
          }}>
            {[
              { label: "Model", value: "Typhoon v2.5-30B" },
              { label: "Embedding", value: "BGE-M3" },
              { label: "Reranker", value: "BGE-Reranker-v2-M3" },
              { label: "Vector DB", value: "ChromaDB (32,962 docs)" },
              { label: "กฎหมาย", value: "32,887 รายการ" },
              { label: "Version", value: "1.0.0" },
            ].map((item) => (
              <div key={item.label} style={{ display: "flex", justifyContent: "space-between", padding: "1px 0" }}>
                <span style={{ color: "#71717a" }}>{item.label}</span>
                <span style={{ color: "#d4d4d8", fontWeight: 500 }}>{item.value}</span>
              </div>
            ))}
          </div>
        )}

        {/* User profile & logout */}
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "10px 4px 0",
          borderTop: "1px solid rgba(255,255,255,0.06)",
          marginTop: 8,
        }}>
          {user.type === "google" && user.picture ? (
            <img
              src={user.picture}
              alt={user.name}
              referrerPolicy="no-referrer"
              style={{
                width: 32, height: 32, borderRadius: 8,
                flexShrink: 0, objectFit: "cover",
              }}
            />
          ) : (
            <div style={{
              width: 32, height: 32, borderRadius: 8,
              background: "linear-gradient(135deg, #D97757, #E8956A)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 13, fontWeight: 700, color: "#fff", flexShrink: 0,
            }}>
              {user.name.charAt(0).toUpperCase()}
            </div>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: "#e4e4e7", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {user.name}
            </div>
            {user.type === "google" && (
              <div style={{ fontSize: 10, color: "#71717a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {user.email}
              </div>
            )}
          </div>
          <button
            onClick={onLogout}
            className="cursor-pointer"
            title="ออกจากระบบ"
            style={{
              width: 28, height: 28, borderRadius: 6, border: "none",
              background: "transparent", color: "#71717a",
              display: "flex", alignItems: "center", justifyContent: "center",
              transition: "all 0.15s", flexShrink: 0,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(239,68,68,0.12)"; e.currentTarget.style.color = "#ef4444"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#71717a"; }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </button>
        </div>
      </div>
    </aside>
  );
}