"use client";

import React, { useState, useRef, useEffect } from "react";

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled: boolean;
}

export default function ChatInput({ onSend, disabled }: ChatInputProps) {
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = Math.min(el.scrollHeight, 150) + "px";
    }
  }, [value]);

  useEffect(() => { textareaRef.current?.focus(); }, []);

  const handleSend = () => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const canSend = !disabled && value.trim().length > 0;

  return (
    <div style={{
      flexShrink: 0, background: "var(--bg-chat)",
      padding: "12px 28px 20px",
    }}>
      <div style={{
        maxWidth: 740, margin: "0 auto",
        background: "var(--input-bg)",
        borderRadius: 20,
        border: `1.5px solid ${focused ? "var(--accent)" : "var(--border-color)"}`,
        boxShadow: focused ? "var(--shadow-glow), var(--shadow-md)" : "var(--shadow-sm)",
        transition: "border-color 0.2s, box-shadow 0.2s",
        display: "flex", alignItems: "flex-end",
        padding: "4px 8px 4px 0",
      }}>
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="ถามคำถามเกี่ยวกับกฎหมายไทย..."
          disabled={disabled}
          rows={1}
          style={{
            flex: 1, resize: "none", outline: "none",
            background: "transparent", border: "none",
            padding: "12px 0 12px 18px", fontSize: 14,
            lineHeight: 1.6, color: "var(--text-primary)",
            fontFamily: "inherit",
          }}
        />
        <button
          onClick={handleSend}
          disabled={!canSend}
          className="cursor-pointer"
          style={{
            width: 36, height: 36, borderRadius: 12,
            border: "none", flexShrink: 0,
            background: canSend
              ? "linear-gradient(135deg, #D97757, #C4654A)"
              : "var(--border-color)",
            color: canSend ? "#ffffff" : "#a1a1aa",
            display: "flex", alignItems: "center", justifyContent: "center",
            transition: "all 0.2s ease", marginBottom: 1,
            boxShadow: canSend ? "0 2px 8px rgba(217,119,87,0.3)" : "none",
          }}
          onMouseEnter={(e) => {
            if (canSend) {
              e.currentTarget.style.transform = "scale(1.05)";
              e.currentTarget.style.boxShadow = "0 4px 12px rgba(217,119,87,0.4)";
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = "scale(1)";
            if (canSend) e.currentTarget.style.boxShadow = "0 2px 8px rgba(217,119,87,0.3)";
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="19" x2="12" y2="5" />
            <polyline points="5 12 12 5 19 12" />
          </svg>
        </button>
      </div>
      <div style={{
        textAlign: "center", fontSize: 11,
        color: "var(--text-muted)", marginTop: 8,
        maxWidth: 740, margin: "8px auto 0",
      }}>
        ข้อมูลที่ให้เป็นข้อมูลเบื้องต้น ไม่ใช่คำปรึกษาทางกฎหมาย · ควรปรึกษาทนายความสำหรับกรณีเฉพาะ
      </div>
    </div>
  );
}