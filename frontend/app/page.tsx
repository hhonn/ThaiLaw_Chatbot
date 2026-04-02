"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import LoginPage, { type AppUser } from "./components/LoginPage";
import Sidebar from "./components/Sidebar";
import ChatArea from "./components/ChatArea";
import ChatInput from "./components/ChatInput";
import { ChatMessage, logAnalyticsEvent, streamChat } from "./lib/api";
import { useChatHistory } from "./lib/useChatHistory";

const AUTH_KEY = "thai-law-user";

export default function Home() {
  const [user, setUser] = useState<AppUser | null>(null);
  const [authLoaded, setAuthLoaded] = useState(false);

  // Load auth from localStorage
  useEffect(() => {
    const saved = localStorage.getItem(AUTH_KEY);
    if (saved) {
      try {
        setUser(JSON.parse(saved));
      } catch {
        localStorage.removeItem(AUTH_KEY);
      }
    }
    setAuthLoaded(true);
  }, []);

  const handleLogin = useCallback((u: AppUser) => {
    localStorage.setItem(AUTH_KEY, JSON.stringify(u));
    setUser(u);
    void logAnalyticsEvent({
      eventType: "auth_login",
      userEmail: u.email,
      metadata: { method: u.type },
    });
  }, []);

  const handleLogout = useCallback(() => {
    if (user?.email) {
      void logAnalyticsEvent({
        eventType: "auth_logout",
        userEmail: user.email,
      });
    }
    localStorage.removeItem(AUTH_KEY);
    setUser(null);
  }, [user]);

  // Don't render until auth state is loaded (prevents flash)
  if (!authLoaded) return null;

  // Show login page if not authenticated
  if (!user) return <LoginPage onLogin={handleLogin} />;

  return <ChatApp key={user.email} user={user} onLogout={handleLogout} />;
}

function ChatApp({ user, onLogout }: { user: AppUser; onLogout: () => void }) {
  const {
    sessions,
    activeId,
    createSession,
    updateSession,
    selectSession,
    deleteSession,
    startNewChat,
    clearAllSessions,
  } = useChatHistory(user.email);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [citations, setCitations] = useState("");
  const [domain, setDomain] = useState("—");
  const [risk, setRisk] = useState("—");
  const [feedback, setFeedback] = useState<Record<number, "up" | "down">>({});
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const currentSessionRef = useRef<string | null>(null);

  // Load theme from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem("thai-law-theme") as "light" | "dark" | null;
    if (saved) setTheme(saved);
  }, []);

  // Apply theme to <html> element
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("thai-law-theme", theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === "light" ? "dark" : "light"));
  }, []);

  const handleFeedback = useCallback((index: number, value: "up" | "down") => {
    setFeedback((prev) => {
      if (prev[index] === value) {
        const copy = { ...prev };
        delete copy[index];
        return copy;
      }
      return { ...prev, [index]: value };
    });
    void logAnalyticsEvent({
      eventType: value === "up" ? "chat_feedback_up" : "chat_feedback_down",
      userEmail: user.email,
      sessionId: currentSessionRef.current || undefined,
      metadata: { messageIndex: index },
    });
  }, [user.email]);

  // When user selects a past session, load its data
  const handleSelectSession = useCallback(
    (id: string) => {
      if (isLoading) return;
      selectSession(id);
      void logAnalyticsEvent({
        eventType: "chat_select_session",
        userEmail: user.email,
        sessionId: id,
      });
      const session = sessions.find((s) => s.id === id);
      if (session) {
        setMessages(session.messages);
        setCitations(session.citations);
        setDomain(session.domain);
        setRisk(session.risk);
        currentSessionRef.current = id;
        setFeedback({});
      }
    },
    [sessions, selectSession, isLoading, user.email]
  );

  const handleNewChat = useCallback(() => {
    if (isLoading) return;
    void logAnalyticsEvent({
      eventType: "chat_new_session",
      userEmail: user.email,
    });
    startNewChat();
    setMessages([]);
    setCitations("");
    setDomain("—");
    setRisk("—");
    setFeedback({});
    currentSessionRef.current = null;
  }, [startNewChat, isLoading, user.email]);

  const handleDeleteSession = useCallback(
    (id: string) => {
      void logAnalyticsEvent({
        eventType: "chat_delete_session",
        userEmail: user.email,
        sessionId: id,
      });
      deleteSession(id);
      if (currentSessionRef.current === id) {
        setMessages([]);
        setCitations("");
        setDomain("—");
        setRisk("—");
        setFeedback({});
        currentSessionRef.current = null;
      }
    },
    [deleteSession, user.email]
  );

  const handleDeleteAll = useCallback(() => {
    void logAnalyticsEvent({
      eventType: "chat_delete_all",
      userEmail: user.email,
      metadata: { sessionCount: sessions.length },
    });
    clearAllSessions();
    setMessages([]);
    setCitations("");
    setDomain("—");
    setRisk("—");
    setFeedback({});
    currentSessionRef.current = null;
  }, [clearAllSessions, user.email, sessions.length]);

  const sendMessage = useCallback(
    (text: string) => {
      if (!text.trim() || isLoading) return;

      // Create session if none active
      let sessionId = currentSessionRef.current;
      if (!sessionId) {
        sessionId = createSession();
        currentSessionRef.current = sessionId;
      }

      const userMsg: ChatMessage = { role: "user", content: text };
      const updatedMessages = [...messages, userMsg];
      setMessages(updatedMessages);
      setIsLoading(true);

      const history = messages.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));

      const assistantMsg: ChatMessage = { role: "assistant", content: "" };
      setMessages([...updatedMessages, assistantMsg]);

      const sid = sessionId;
      let latestAnswer = "";
      let latestDomain = "—";
      let latestRisk = "—";

      void logAnalyticsEvent({
        eventType: "chat_send",
        userEmail: user.email,
        sessionId: sid,
        messageLength: text.length,
        messageText: text,
      });

      streamChat(
        text,
        history,
        (data) => {
          latestAnswer = data.answer;
          latestDomain = data.domain;
          latestRisk = data.risk;
          setMessages((prev) => {
            const copy = [...prev];
            copy[copy.length - 1] = {
              role: "assistant",
              content: data.answer,
            };
            // Save to history on each data update
            updateSession(sid, {
              messages: copy,
              citations: data.citations,
              domain: data.domain,
              risk: data.risk,
            });
            return copy;
          });
          setCitations(data.citations);
          setDomain(data.domain);
          setRisk(data.risk);
        },
        () => {
          void logAnalyticsEvent({
            eventType: "chat_response_done",
            userEmail: user.email,
            sessionId: sid,
            messageLength: latestAnswer.length,
            messageText: latestAnswer,
            metadata: {
              domain: latestDomain,
              risk: latestRisk,
            },
          });
          setIsLoading(false);
        },
        (err) => {
          void logAnalyticsEvent({
            eventType: "chat_error",
            userEmail: user.email,
            sessionId: sid,
            metadata: { error: err },
          });
          setMessages((prev) => {
            const copy = [...prev];
            copy[copy.length - 1] = {
              role: "assistant",
              content: `❌ เกิดข้อผิดพลาด: ${err}`,
            };
            updateSession(sid, { messages: copy });
            return copy;
          });
          setIsLoading(false);
        }
      );
    },
    [messages, isLoading, createSession, updateSession, user.email]
  );

  return (
    <div className="flex h-screen" style={{ background: "var(--bg-primary)" }}>
      <Sidebar
        onNewChat={handleNewChat}
        sessions={sessions}
        activeSessionId={activeId}
        onSelectSession={handleSelectSession}
        onDeleteSession={handleDeleteSession}
        onDeleteAll={handleDeleteAll}
        messages={messages}
        theme={theme}
        onToggleTheme={toggleTheme}
        user={user}
        onLogout={onLogout}
      />
      <main
        className="flex-1 flex flex-col h-screen overflow-hidden"
        style={{ background: "var(--bg-chat)" }}
      >
        <ChatArea
          messages={messages}
          isLoading={isLoading}
          citations={citations}
          domain={domain}
          risk={risk}
          feedback={feedback}
          onFeedback={handleFeedback}
        />
        <ChatInput onSend={sendMessage} disabled={isLoading} />
      </main>
    </div>
  );
}