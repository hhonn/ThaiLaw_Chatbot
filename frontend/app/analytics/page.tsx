"use client";

import { ReactNode, useEffect, useMemo, useState } from "react";
import styles from "./page.module.css";
import {
  AnalyticsSummary,
  exportAnalyticsTrainingRows,
  AnalyticsUserInsight,
  fetchAnalyticsSummary,
  fetchAnalyticsUsers,
  runAnalyticsSnapshotExport,
} from "../lib/api";

const ANALYTICS_KEY_STORAGE = "thai-law-analytics-admin-key";
const DAY_OPTIONS = [7, 30, 90];

export default function AnalyticsPage() {
  const [days, setDays] = useState(30);
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [users, setUsers] = useState<AnalyticsUserInsight[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [adminKey, setAdminKey] = useState("");
  const [exporting, setExporting] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [snapshotting, setSnapshotting] = useState(false);
  const [topicFilter, setTopicFilter] = useState("");
  const [domainFilter, setDomainFilter] = useState("");
  const [riskFilter, setRiskFilter] = useState("");
  const [previewJson, setPreviewJson] = useState("");
  const [snapshotResult, setSnapshotResult] = useState("");
  const [userQuery, setUserQuery] = useState("");
  const [lastLoadedAt, setLastLoadedAt] = useState<number | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem(ANALYTICS_KEY_STORAGE);
    if (saved) setAdminKey(saved);
  }, []);

  useEffect(() => {
    localStorage.setItem(ANALYTICS_KEY_STORAGE, adminKey);
  }, [adminKey]);

  useEffect(() => {
    let alive = true;

    async function load() {
      setLoading(true);
      setError("");
      if (!adminKey.trim()) {
        if (!alive) return;
        setSummary(null);
        setUsers([]);
        setLoading(false);
        return;
      }

      try {
        const [s, u] = await Promise.all([
          fetchAnalyticsSummary(days, adminKey),
          fetchAnalyticsUsers(days, 20, adminKey),
        ]);
        if (!alive) return;
        setSummary(s);
        setUsers(u);
        setLastLoadedAt(Date.now());
      } catch (err) {
        if (!alive) return;
        const message = err instanceof Error ? err.message : "Failed to load analytics";
        if (message.includes("401")) {
          setError("Analytics Admin Key ไม่ถูกต้อง หรือยังไม่ได้กรอกคีย์");
        } else {
          setError(message);
        }
      } finally {
        if (alive) setLoading(false);
      }
    }

    void load();
    return () => {
      alive = false;
    };
  }, [days, adminKey]);

  const totalUpvotes = useMemo(() => users.reduce((sum, u) => sum + u.upvotes, 0), [users]);
  const totalDownvotes = useMemo(() => users.reduce((sum, u) => sum + u.downvotes, 0), [users]);
  const totalQuestions = useMemo(() => users.reduce((sum, u) => sum + u.questions, 0), [users]);
  const activeQuestionUsers = useMemo(() => users.filter((u) => u.questions > 0).length, [users]);
  const feedbackTotal = totalUpvotes + totalDownvotes;
  const positiveRate = feedbackTotal > 0 ? (totalUpvotes / feedbackTotal) * 100 : null;

  const filteredUsers = useMemo(() => {
    const q = userQuery.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        u.user_hash.toLowerCase().includes(q) ||
        (u.top_topic || "").toLowerCase().includes(q)
    );
  }, [users, userQuery]);

  const keyReady = adminKey.trim().length > 0;

  const handleExport = async (
    format: "json" | "jsonl",
    dataset: "questions" | "pairs" | "instruction",
    style: "native" | "chatml" | "alpaca" = "native"
  ) => {
    setExporting(true);
    setError("");
    try {
      const result = await exportAnalyticsTrainingRows(
        days,
        2000,
        format,
        dataset,
        style,
        {
          topic: topicFilter,
          domain: domainFilter,
          risk: riskFilter,
        },
        adminKey
      );
      const blob =
        format === "json"
          ? new Blob([JSON.stringify(result.rows || [], null, 2)], { type: "application/json;charset=utf-8" })
          : new Blob([result.content || ""], { type: "application/x-ndjson;charset=utf-8" });

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const styleSuffix = dataset === "instruction" ? `-${style}` : "";
      a.download = `lawbot-training-${dataset}${styleSuffix}-${days}d.${format === "json" ? "json" : "jsonl"}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  const handlePreview = async () => {
    setPreviewing(true);
    setError("");
    try {
      const result = await exportAnalyticsTrainingRows(
        days,
        20,
        "json",
        "instruction",
        "chatml",
        {
          topic: topicFilter,
          domain: domainFilter,
          risk: riskFilter,
        },
        adminKey
      );
      setPreviewJson(JSON.stringify(result.rows || [], null, 2));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Preview failed");
    } finally {
      setPreviewing(false);
    }
  };

  const handleSnapshotExport = async () => {
    setSnapshotting(true);
    setError("");
    setSnapshotResult("");
    try {
      const result = await runAnalyticsSnapshotExport(
        days,
        3000,
        {
          topic: topicFilter,
          domain: domainFilter,
          risk: riskFilter,
        },
        "real",
        adminKey
      );
      const lines = [
        `Folder: ${result.base_dir}`,
        result.deleted_old_files && result.deleted_old_files.length > 0
          ? `Deleted old files: ${result.deleted_old_files.length}`
          : "Deleted old files: 0",
        ...result.files.map((f) => `${f.name} (${f.count} rows)`),
      ];
      setSnapshotResult(lines.join("\n"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Snapshot export failed");
    } finally {
      setSnapshotting(false);
    }
  };

  return (
    <main className={styles.page}>
      <div className={styles.bgOrbOne} />
      <div className={styles.bgOrbTwo} />
      <div className={styles.container}>
        <header className={styles.header}>
          <div>
            <h1 className={styles.title}>Analytics Dashboard</h1>
            <p className={styles.subtitle}>
              สรุปพฤติกรรมผู้ใช้งานแบบ anonymized เพื่อใช้ปรับปรุงโมเดลและระบบตอบคำถาม
            </p>
          </div>
          <div className={styles.headerMeta}>
            <span className={`${styles.badge} ${keyReady ? styles.badgeReady : styles.badgeMissing}`}>
              {keyReady ? "Admin Key Ready" : "Missing Admin Key"}
            </span>
            <span className={styles.badge}>
              {lastLoadedAt ? `Updated ${new Date(lastLoadedAt).toLocaleTimeString("th-TH")}` : "ยังไม่โหลดข้อมูล"}
            </span>
          </div>
        </header>

        <section className={styles.panel}>
          <div className={styles.sectionTitleRow}>
            <h2 className={styles.sectionTitle}>Control Center</h2>
            <button
              onClick={() => setAdminKey("")}
              className={styles.ghostButton}
              disabled={!adminKey}
            >
              Clear Key
            </button>
          </div>

          <div className={styles.gridTwoCols}>
            <label className={styles.fieldGroup}>
              <span className={styles.fieldLabel}>Analytics Admin Key</span>
              <input
                type="password"
                value={adminKey}
                onChange={(e) => setAdminKey(e.target.value)}
                placeholder="กรอก Analytics Admin Key"
                className={styles.input}
              />
            </label>

            <div className={styles.fieldGroup}>
              <span className={styles.fieldLabel}>ช่วงเวลาวิเคราะห์</span>
              <div className={styles.segmentWrap}>
                {DAY_OPTIONS.map((d) => (
                  <button
                    key={d}
                    onClick={() => setDays(d)}
                    className={`${styles.segmentButton} ${days === d ? styles.segmentButtonActive : ""}`}
                  >
                    {d} วัน
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className={styles.gridThreeCols}>
            <label className={styles.fieldGroup}>
              <span className={styles.fieldLabel}>Filter Topic</span>
              <input
                value={topicFilter}
                onChange={(e) => setTopicFilter(e.target.value)}
                placeholder="เช่น อาญา"
                className={styles.input}
              />
            </label>
            <label className={styles.fieldGroup}>
              <span className={styles.fieldLabel}>Filter Domain</span>
              <input
                value={domainFilter}
                onChange={(e) => setDomainFilter(e.target.value)}
                placeholder="เช่น กฎหมายแรงงาน"
                className={styles.input}
              />
            </label>
            <label className={styles.fieldGroup}>
              <span className={styles.fieldLabel}>Filter Risk</span>
              <input
                value={riskFilter}
                onChange={(e) => setRiskFilter(e.target.value)}
                placeholder="เช่น medium"
                className={styles.input}
              />
            </label>
          </div>
        </section>

        <section className={styles.panel}>
          <h2 className={styles.sectionTitle}>Training Data Actions</h2>
          <div className={styles.actionGrid}>
            <ActionBlock title="Export Datasets" description="ดาวน์โหลดข้อมูลสำหรับ train/retrain ตามฟอร์แมตที่ต้องการ">
              <div className={styles.actionButtonWrap}>
                <button
                  onClick={() => void handleExport("json", "questions")}
                  disabled={exporting || !keyReady}
                  className={`${styles.button} ${styles.buttonNeutral}`}
                >
                  {exporting ? "กำลัง export..." : "Questions JSON"}
                </button>
                <button
                  onClick={() => void handleExport("jsonl", "questions")}
                  disabled={exporting || !keyReady}
                  className={`${styles.button} ${styles.buttonWarm}`}
                >
                  Questions JSONL
                </button>
                <button
                  onClick={() => void handleExport("jsonl", "pairs")}
                  disabled={exporting || !keyReady}
                  className={`${styles.button} ${styles.buttonGreen}`}
                >
                  Q-A Pairs JSONL
                </button>
                <button
                  onClick={() => void handleExport("jsonl", "instruction")}
                  disabled={exporting || !keyReady}
                  className={`${styles.button} ${styles.buttonBlue}`}
                >
                  Instruction JSONL
                </button>
                <button
                  onClick={() => void handleExport("jsonl", "instruction", "chatml")}
                  disabled={exporting || !keyReady}
                  className={`${styles.button} ${styles.buttonCyan}`}
                >
                  ChatML JSONL
                </button>
                <button
                  onClick={() => void handleExport("jsonl", "instruction", "alpaca")}
                  disabled={exporting || !keyReady}
                  className={`${styles.button} ${styles.buttonAmber}`}
                >
                  Alpaca JSONL
                </button>
              </div>
            </ActionBlock>

            <ActionBlock title="Preview & Snapshot" description="เช็กตัวอย่างข้อมูลและสร้าง snapshot จากข้อมูลผู้ใช้จริงเท่านั้น">
              <div className={styles.actionButtonWrap}>
                <button
                  onClick={() => void handlePreview()}
                  disabled={previewing || !keyReady}
                  className={`${styles.button} ${styles.buttonTeal}`}
                >
                  {previewing ? "กำลัง preview..." : "Preview 20 (ChatML)"}
                </button>
                <div className={styles.realOnlyNote}>Snapshot Group: Real (fixed)</div>
                <button
                  onClick={() => void handleSnapshotExport()}
                  disabled={snapshotting || !keyReady}
                  className={`${styles.button} ${styles.buttonRoyal}`}
                >
                  {snapshotting ? "กำลังสร้าง snapshot..." : "Create Snapshot Files"}
                </button>
              </div>
            </ActionBlock>
          </div>
        </section>

        {snapshotResult && (
          <section className={styles.panel}>
            <h2 className={styles.sectionTitle}>Snapshot Result</h2>
            <textarea readOnly value={snapshotResult} className={styles.console} />
          </section>
        )}

        {previewJson && (
          <section className={styles.panel}>
            <h2 className={styles.sectionTitle}>Preview JSON</h2>
            <textarea readOnly value={previewJson} className={`${styles.console} ${styles.consoleLarge}`} />
          </section>
        )}

        {loading && <p className={styles.infoLine}>กำลังโหลดข้อมูล...</p>}
        {!loading && !adminKey.trim() && (
          <p className={`${styles.infoLine} ${styles.warnLine}`}>กรุณากรอก Analytics Admin Key เพื่อโหลดข้อมูลสรุป</p>
        )}
        {error && <p className={`${styles.infoLine} ${styles.errorLine}`}>เกิดข้อผิดพลาด: {error}</p>}

        {!loading && !error && summary && (
          <>
            <section className={styles.statGrid}>
              <StatCard label="Events" value={formatNumber(summary.total_events)} />
              <StatCard label="Unique Users" value={formatNumber(summary.unique_users)} />
              <StatCard label="Avg Events/User" value={summary.behavior.avg_events_per_user.toFixed(2)} />
              <StatCard label="Avg Questions/User" value={summary.behavior.avg_questions_per_user.toFixed(2)} />
              <StatCard label="Total Questions" value={formatNumber(totalQuestions)} />
              <StatCard
                label="Positive Feedback"
                value={positiveRate === null ? "-" : `${positiveRate.toFixed(1)}%`}
                hint={`up ${formatNumber(totalUpvotes)} / down ${formatNumber(totalDownvotes)}`}
              />
            </section>

            <section className={styles.panelGrid}>
              <Panel title="Event Types">
                <SimpleTable
                  headers={["ประเภท Event", "จำนวน", "สัดส่วน"]}
                  rows={summary.events_by_type.map((e) => [
                    e.event_type,
                    formatNumber(e.count),
                    <MiniBar
                      key={e.event_type}
                      value={e.count}
                      max={Math.max(...summary.events_by_type.map((x) => x.count), 1)}
                    />,
                  ])}
                />
              </Panel>
              <Panel title="Top Legal Topics">
                <SimpleTable
                  headers={["หัวข้อกฎหมาย", "จำนวนคำถาม", "สัดส่วน"]}
                  rows={summary.topics.map((t) => [
                    t.topic,
                    formatNumber(t.count),
                    <MiniBar
                      key={t.topic}
                      value={t.count}
                      max={Math.max(...summary.topics.map((x) => x.count), 1)}
                    />,
                  ])}
                />
              </Panel>
            </section>

            <section className={styles.panel}>
              <div className={styles.sectionTitleRow}>
                <h2 className={styles.sectionTitle}>User Behavior (Hashed IDs)</h2>
                <div className={styles.inlineStats}>
                  <span className={styles.inlineStat}>Active users with questions: {activeQuestionUsers}</span>
                  <span className={styles.inlineStat}>Showing: {filteredUsers.length}</span>
                </div>
              </div>

              <label className={styles.fieldGroup}>
                <span className={styles.fieldLabel}>Search User Hash / Topic</span>
                <input
                  value={userQuery}
                  onChange={(e) => setUserQuery(e.target.value)}
                  placeholder="พิมพ์เพื่อค้นหา user hash หรือหัวข้อ"
                  className={styles.input}
                />
              </label>

              <SimpleTable
                headers={["User Hash", "Events", "Questions", "Top Topic", "Up", "Down", "Last Active"]}
                rows={filteredUsers.map((u) => [
                  `${u.user_hash.slice(0, 12)}...`,
                  formatNumber(u.total_events),
                  formatNumber(u.questions),
                  u.top_topic,
                  formatNumber(u.upvotes),
                  formatNumber(u.downvotes),
                  new Date(u.last_active_ts).toLocaleString("th-TH"),
                ])}
              />
            </section>
          </>
        )}
      </div>
    </main>
  );
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function ActionBlock({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.actionBlock}>
      <h3 className={styles.blockTitle}>{title}</h3>
      <p className={styles.blockDescription}>{description}</p>
      {children}
    </div>
  );
}

function MiniBar({ value, max }: { value: number; max: number }) {
  const pct = Math.max(6, Math.round((value / max) * 100));
  return (
    <div className={styles.miniBarTrack}>
      <div className={styles.miniBarFill} style={{ width: `${pct}%` }} />
    </div>
  );
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className={styles.statCard}>
      <div className={styles.statLabel}>{label}</div>
      <div className={styles.statValue}>{value}</div>
      {hint ? <div className={styles.statHint}>{hint}</div> : null}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className={styles.panel}>
      <h2 className={styles.sectionTitle}>{title}</h2>
      {children}
    </div>
  );
}

function SimpleTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: Array<Array<string | number | ReactNode>>;
}) {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, idx) => (
            <tr key={idx}>
              {r.map((c, cidx) => (
                <td key={`${idx}-${cidx}`}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
