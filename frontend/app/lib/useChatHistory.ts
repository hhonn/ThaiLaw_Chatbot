"use client";

import { useState, useEffect, useCallback } from "react";
import { ChatMessage } from "./api";

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  domain: string;
  risk: string;
  citations: string;
  createdAt: number;
  updatedAt: number;
}

const STORAGE_KEY_PREFIX = "thai-law-chatbot-history";
const MAX_SESSIONS = 50;

function generateId(): string {
  return crypto.randomUUID();
}

function extractTitle(messages: ChatMessage[]): string {
  const firstUser = messages.find((m) => m.role === "user");
  if (!firstUser) return "แชทใหม่";
  const text = firstUser.content.trim();
  return text.length > 60 ? text.slice(0, 57) + "..." : text;
}

function getStorageKey(userEmail: string): string {
  return `${STORAGE_KEY_PREFIX}-${userEmail}`;
}

function loadSessions(userEmail: string): ChatSession[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(getStorageKey(userEmail));
    if (!raw) return [];
    return JSON.parse(raw) as ChatSession[];
  } catch {
    return [];
  }
}

function saveSessions(userEmail: string, sessions: ChatSession[]) {
  const key = getStorageKey(userEmail);
  try {
    localStorage.setItem(key, JSON.stringify(sessions.slice(0, MAX_SESSIONS)));
  } catch {
    // Storage full — remove oldest
    const trimmed = sessions.slice(0, Math.floor(MAX_SESSIONS / 2));
    localStorage.setItem(key, JSON.stringify(trimmed));
  }
}

export function useChatHistory(userEmail: string) {
  const [sessions, setSessions] = useState<ChatSession[]>(() => loadSessions(userEmail));
  const [activeId, setActiveId] = useState<string | null>(null);

  // Persist whenever sessions change
  useEffect(() => {
    if (sessions.length > 0) saveSessions(userEmail, sessions);
  }, [sessions, userEmail]);

  const activeSession = sessions.find((s) => s.id === activeId) || null;

  const createSession = useCallback((): string => {
    const id = generateId();
    const session: ChatSession = {
      id,
      title: "แชทใหม่",
      messages: [],
      domain: "—",
      risk: "—",
      citations: "",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setSessions((prev) => [session, ...prev]);
    setActiveId(id);
    return id;
  }, []);

  const updateSession = useCallback(
    (id: string, data: Partial<Pick<ChatSession, "messages" | "domain" | "risk" | "citations">>) => {
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== id) return s;
          const updated = { ...s, ...data, updatedAt: Date.now() };
          if (data.messages && data.messages.length > 0) {
            updated.title = extractTitle(data.messages);
          }
          return updated;
        })
      );
    },
    []
  );

  const selectSession = useCallback((id: string) => {
    setActiveId(id);
  }, []);

  const deleteSession = useCallback(
    (id: string) => {
      setSessions((prev) => {
        const filtered = prev.filter((s) => s.id !== id);
        if (filtered.length === 0) {
          localStorage.removeItem(getStorageKey(userEmail));
        }
        return filtered;
      });
      if (activeId === id) setActiveId(null);
    },
    [activeId, userEmail]
  );

  const startNewChat = useCallback(() => {
    setActiveId(null);
  }, []);

  const clearAllSessions = useCallback(() => {
    setSessions([]);
    setActiveId(null);
    localStorage.removeItem(getStorageKey(userEmail));
  }, [userEmail]);

  return {
    sessions,
    activeId,
    activeSession,
    createSession,
    updateSession,
    selectSession,
    deleteSession,
    startNewChat,
    clearAllSessions,
  };
}