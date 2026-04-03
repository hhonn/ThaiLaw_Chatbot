const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp?: number;
}

export interface ChatStreamData {
  answer: string;
  citations: string;
  domain: string;
  risk: string;
}

export interface AnalyticsEventPayload {
  eventType: string;
  userEmail?: string;
  sessionId?: string;
  messageLength?: number;
  messageText?: string;
  topic?: string;
  metadata?: Record<string, unknown>;
}

export interface AnalyticsSummary {
  window_days: number;
  total_events: number;
  unique_users: number;
  events_by_type: Array<{ event_type: string; count: number }>;
  topics: Array<{ topic: string; count: number }>;
  behavior: {
    avg_events_per_user: number;
    avg_questions_per_user: number;
  };
}

export interface AnalyticsUserInsight {
  user_hash: string;
  total_events: number;
  questions: number;
  upvotes: number;
  downvotes: number;
  last_active_ts: number;
  top_topic: string;
}

export interface AnalyticsTrainingRow {
  ts: number;
  user_hash: string;
  session_id: string;
  topic: string;
  question_length: number;
  question_redacted: string;
}

export interface AnalyticsTrainingPair {
  ts: number;
  user_hash: string;
  session_id: string;
  topic: string;
  question_redacted: string;
  answer_redacted: string;
  domain: string;
  risk: string;
}

export interface AnalyticsInstructionRow {
  ts: number;
  topic: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  metadata: {
    domain: string;
    risk: string;
    session_id: string;
  };
}

export interface AnalyticsInstructionChatMLRow {
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  metadata: {
    domain: string;
    risk: string;
    session_id: string;
  };
}

export interface AnalyticsInstructionAlpacaRow {
  ts: number;
  topic: string;
  instruction: string;
  input: string;
  output: string;
  metadata: {
    domain: string;
    risk: string;
    session_id: string;
  };
}

export interface AnalyticsExportFilters {
  topic?: string;
  domain?: string;
  risk?: string;
}

export interface AnalyticsSnapshotResult {
  ok: boolean;
  created_at: string;
  base_dir: string;
  files: Array<{ name: string; path: string; count: number }>;
  deleted_old_files?: string[];
  filters: {
    topic: string;
    domain: string;
    risk: string;
    days: number;
    limit: number;
  };
}

export interface AnalyticsGenerateSampleResult {
  ok: boolean;
  created_pairs: number;
  feedback_up: number;
  feedback_down: number;
}

export interface AnalyticsBootstrapResult {
  ok: boolean;
  sample: AnalyticsGenerateSampleResult;
  snapshot: AnalyticsSnapshotResult;
}

/*
 - Stream chat response via SSE.
 - Calls onData for each partial update, onDone when finished.
*/

const STREAM_TIMEOUT_MS = 180_000;  // 180 seconds (cold start with large models can take ~60s)
const FETCH_TIMEOUT_MS  = 30_000;  // 30 seconds

function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(id));
}

export async function streamChat(
  message: string,
  history: ChatMessage[],
  onData: (data: ChatStreamData) => void,
  onDone: () => void,
  onError: (err: string) => void
) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), STREAM_TIMEOUT_MS);

  try {
    const res = await fetch(`${API_BASE}/api/chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, history }),
      signal: controller.signal,
    });

    if (!res.ok) {
      onError(`API error: ${res.status}`);
      return;
    }

    const reader = res.body?.getReader();
    if (!reader) {
      onError("No response body");
      return;
    }

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6).trim();
        if (payload === "[DONE]") {
          onDone();
          return;
        }
        try {
          const data: ChatStreamData = JSON.parse(payload);
          if ("error" in data) {
            onError((data as unknown as { error: string }).error);
            return;
          }
          onData(data);
        } catch {
          // skip malformed JSON
        }
      }
    }
    onDone();
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      onError("หมดเวลาการเชื่อมต่อ (3 นาที) กรุณาลองใหม่อีกครั้ง");
    } else {
      onError(err instanceof Error ? err.message : "Unknown error");
    }
  } finally {
    clearTimeout(timeoutId);
  }
}

// Auth API

export async function sendAuthCode(email: string): Promise<void> {
  const res = await fetchWithTimeout(
    `${API_BASE}/api/auth/send-code`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    },
    FETCH_TIMEOUT_MS,
  );
  if (!res.ok) {
    const data = await res.json().catch(() => null) as { detail?: string } | null;
    throw new Error(data?.detail || "ไม่สามารถส่งอีเมลได้");
  }
}

export async function verifyAuthCode(email: string, code: string): Promise<void> {
  const res = await fetchWithTimeout(
    `${API_BASE}/api/auth/verify-code`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, code }),
    },
    FETCH_TIMEOUT_MS,
  );
  if (!res.ok) {
    const data = await res.json().catch(() => null) as { detail?: string } | null;
    throw new Error(data?.detail || "รหัสไม่ถูกต้อง");
  }
}

// Health check

export async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(`${API_BASE}/api/health`, {}, FETCH_TIMEOUT_MS);
    return res.ok;
  } catch {
    return false;
  }
}

export async function logAnalyticsEvent(payload: AnalyticsEventPayload): Promise<void> {
  try {
    await fetchWithTimeout(
      `${API_BASE}/api/analytics/event`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event_type: payload.eventType,
          user_email: payload.userEmail,
          session_id: payload.sessionId,
          message_length: payload.messageLength,
          message_text: payload.messageText,
          topic: payload.topic,
          metadata: payload.metadata || {},
        }),
      },
      FETCH_TIMEOUT_MS,
    );
  } catch {
    // fire-and-forget analytics
  }
}

function buildAdminHeaders(adminKey?: string): HeadersInit {
  if (!adminKey) return {};
  // HTTP headers must be ISO-8859-1; encode any non-ASCII characters via encodeURIComponent.
  const safeKey = encodeURIComponent(adminKey);
  return { "x-analytics-key": safeKey };
}

export async function fetchAnalyticsSummary(
  days: number = 30,
  adminKey?: string
): Promise<AnalyticsSummary> {
  const res = await fetchWithTimeout(
    `${API_BASE}/api/analytics/summary?days=${days}`,
    { headers: buildAdminHeaders(adminKey) },
    FETCH_TIMEOUT_MS,
  );
  if (!res.ok) {
    throw new Error(`Failed to fetch summary: ${res.status}`);
  }
  return res.json();
}

export async function fetchAnalyticsUsers(
  days: number = 30,
  limit: number = 25,
  adminKey?: string
): Promise<AnalyticsUserInsight[]> {
  const res = await fetchWithTimeout(
    `${API_BASE}/api/analytics/users?days=${days}&limit=${limit}`,
    { headers: buildAdminHeaders(adminKey) },
    FETCH_TIMEOUT_MS,
  );
  if (!res.ok) {
    throw new Error(`Failed to fetch users: ${res.status}`);
  }
  const data = (await res.json()) as { users: AnalyticsUserInsight[] };
  return data.users;
}

export async function exportAnalyticsTrainingRows(
  days: number = 30,
  limit: number = 2000,
  format: "json" | "jsonl" = "json",
  dataset: "questions" | "pairs" | "instruction" = "questions",
  style: "native" | "chatml" | "alpaca" = "native",
  filters?: AnalyticsExportFilters,
  adminKey?: string
): Promise<{
  format: "json" | "jsonl";
  dataset: "questions" | "pairs" | "instruction";
  style: "native" | "chatml" | "alpaca";
  count: number;
  rows?:
    | AnalyticsTrainingRow[]
    | AnalyticsTrainingPair[]
    | AnalyticsInstructionRow[]
    | AnalyticsInstructionChatMLRow[]
    | AnalyticsInstructionAlpacaRow[];
  content?: string;
}> {
  const res = await fetchWithTimeout(
    `${API_BASE}/api/analytics/export`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...buildAdminHeaders(adminKey),
      },
      body: JSON.stringify({
        days,
        limit,
        format,
        dataset,
        style,
        topic: filters?.topic || undefined,
        domain: filters?.domain || undefined,
        risk: filters?.risk || undefined,
      }),
    },
    FETCH_TIMEOUT_MS,
  );

  if (!res.ok) {
    throw new Error(`Failed to export training rows: ${res.status}`);
  }
  return res.json();
}

export async function runAnalyticsSnapshotExport(
  days: number,
  limit: number,
  filters: AnalyticsExportFilters,
  group: "real" | "samples" = "real",
  adminKey?: string
): Promise<AnalyticsSnapshotResult> {
  const res = await fetchWithTimeout(
    `${API_BASE}/api/analytics/export/snapshot`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...buildAdminHeaders(adminKey),
      },
      body: JSON.stringify({
        days,
        limit,
        topic: filters.topic || undefined,
        domain: filters.domain || undefined,
        risk: filters.risk || undefined,
        group,
      }),
    },
    FETCH_TIMEOUT_MS,
  );

  if (!res.ok) {
    throw new Error(`Failed to run snapshot export: ${res.status}`);
  }
  return res.json();
}

export async function runAnalyticsGenerateSamples(
  count: number,
  adminKey?: string
): Promise<AnalyticsGenerateSampleResult> {
  const res = await fetchWithTimeout(
    `${API_BASE}/api/analytics/generate-samples`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...buildAdminHeaders(adminKey),
      },
      body: JSON.stringify({ count }),
    },
    FETCH_TIMEOUT_MS,
  );

  if (!res.ok) {
    throw new Error(`Failed to generate sample conversations: ${res.status}`);
  }
  return res.json();
}

export async function runAnalyticsBootstrapTrainingData(
  sampleCount: number,
  days: number,
  limit: number,
  filters: AnalyticsExportFilters,
  adminKey?: string
): Promise<AnalyticsBootstrapResult> {
  const res = await fetchWithTimeout(
    `${API_BASE}/api/analytics/bootstrap-training-data`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...buildAdminHeaders(adminKey),
      },
      body: JSON.stringify({
        sample_count: sampleCount,
        days,
        limit,
        topic: filters.topic || undefined,
        domain: filters.domain || undefined,
        risk: filters.risk || undefined,
      }),
    },
    FETCH_TIMEOUT_MS,
  );

  if (!res.ok) {
    throw new Error(`Failed to bootstrap training data: ${res.status}`);
  }
  return res.json();
}