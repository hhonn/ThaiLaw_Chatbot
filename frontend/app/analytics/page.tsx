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

type ExportTab = "export" | "snapshot";

const KPI_ACCENT: Record<string, string> = {
  blue:   styles.kpiAccentBlue,
  orange: styles.kpiAccentOrange,
  purple: styles.kpiAccentPurple,
  green:  styles.kpiAccentGreen,
  teal:   styles.kpiAccentTeal,
  amber:  styles.kpiAccentAmber,
  slate:  styles.kpiAccentSlate,
};

const EXPORT_BTN_VARIANT: Record<string, string> = {
  neutral: styles.exportBtnNeutral,
  warm:    styles.exportBtnWarm,
  green:   styles.exportBtnGreen,
  blue:    styles.exportBtnBlue,
  cyan:    styles.exportBtnCyan,
  amber:   styles.exportBtnAmber,
  teal:    styles.exportBtnTeal,
};

export default function AnalyticsPage() {
  const [days, setDays] = useState(30);
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [users, setUsers] = useState<AnalyticsUserInsight[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [adminKey, setAdminKey] = useState("");
  const [exporting, setExporting] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [snapshotting, setSnapshotting] = useState(false);
  const [topicFilter, setTopicFilter] = useState("");
  const [domainFilter, setDomainFilter] = useState("");
  const [riskFilter, setRiskFilter] = useState("");
  const [previewJson, setPreviewJson] = useState("");
  const [snapshotResult, setSnapshotResult] = useState("");
  const [userQuery, setUserQuery] = useState("");
  const [lastLoadedAt, setLastLoadedAt] = useState<number | null>(null);
  const [exportTab, setExportTab] = useState<ExportTab>("export");
  const [refreshToken, setRefreshToken] = useState(0);

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
        setError(message.includes("401") ? "Admin Key ไม่ถูกต้อง — กรุณาตรวจสอบและลองใหม่" : message);
      } finally {
        if (alive) setLoading(false);
      }
    }

    void load();
    return () => { alive = false; };
  }, [days, adminKey, refreshToken]);

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
    label: string,
    format: "json" | "jsonl",
    dataset: "questions" | "pairs" | "instruction",
    style: "native" | "chatml" | "alpaca" = "native"
  ) => {
    setExporting(label);
    setError("");
    try {
      const result = await exportAnalyticsTrainingRows(
        days, 2000, format, dataset, style,
        { topic: topicFilter, domain: domainFilter, risk: riskFilter },
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
      a.download = `lawbot-${dataset}${styleSuffix}-${days}d.${format === "json" ? "json" : "jsonl"}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(null);
    }
  };

  const handlePreview = async () => {
    setPreviewing(true);
    setError("");
    try {
      const result = await exportAnalyticsTrainingRows(
        days, 20, "json", "instruction", "chatml",
        { topic: topicFilter, domain: domainFilter, risk: riskFilter },
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
        days, 3000,
        { topic: topicFilter, domain: domainFilter, risk: riskFilter },
        "real",
        adminKey
      );
      const lines = [
        `Folder: ${result.base_dir}`,
        `Deleted old: ${result.deleted_old_files?.length ?? 0} file(s)`,
        ...result.files.map((f) => `  ${f.name}  —  ${f.count} rows`),
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
      <div className={styles.bgGradient} />
      <div className={styles.container}>

        {/* Header */}
        <header className={styles.header}>
          <div className={styles.headerLeft}>
            <h1 className={styles.title}>Analytics</h1>
            <p className={styles.subtitle}>สรุปพฤติกรรมผู้ใช้งาน (anonymized) สำหรับปรับปรุงระบบ</p>
          </div>
          <div className={styles.headerControls}>
            <div className={styles.keyInput}>
              <span className={styles.keyIcon}>🔑</span>
              <input
                type="password"
                value={adminKey}
                onChange={(e) => setAdminKey(e.target.value)}
                placeholder="Admin Key"
                className={styles.keyField}
              />
              {adminKey && (
                <button onClick={() => setAdminKey("")} className={styles.keyClear} title="Clear key">✕</button>
              )}
            </div>
            <div className={styles.dayTabs}>
              {DAY_OPTIONS.map((d) => (
                <button
                  key={d}
                  onClick={() => setDays(d)}
                  className={`${styles.dayTab} ${days === d ? styles.dayTabActive : ""}`}
                >
                  {d}d
                </button>
              ))}
            </div>
            <button
              onClick={() => setRefreshToken((t) => t + 1)}
              disabled={loading || !keyReady}
              className={styles.refreshButton}
              title="Refresh"
            >
              {loading ? "⏳" : "↻"}
            </button>
          </div>
        </header>

        {/* Status bar */}
        <div className={styles.statusBar}>
          <span className={`${styles.statusDot} ${keyReady ? styles.statusDotOn : styles.statusDotOff}`} />
          <span className={styles.statusText}>{keyReady ? "Admin key set" : "No admin key"}</span>
          {lastLoadedAt && (
            <>
              <span className={styles.statusSep}>·</span>
              <span className={styles.statusText}>Updated {new Date(lastLoadedAt).toLocaleTimeString("th-TH")}</span>
            </>
          )}
          {loading && (
            <>
              <span className={styles.statusSep}>·</span>
              <span className={styles.statusText}>กำลังโหลด...</span>
            </>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className={styles.errorBanner}>
            <span>⚠️</span>
            <span>{error}</span>
            <button onClick={() => setError("")} className={styles.errorDismiss}>✕</button>
          </div>
        )}

        {/* Empty state */}
        {!keyReady && !loading && (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon}>🔒</div>
            <div className={styles.emptyTitle}>ใส่ Admin Key เพื่อดูข้อมูล</div>
            <div className={styles.emptyHint}>กรอก analytics admin key ในช่องด้านบนเพื่อโหลดข้อมูล dashboard</div>
          </div>
        )}

        {/* Skeleton */}
        {loading && keyReady && (
          <div className={styles.skeletonWrap}>
            <div className={styles.skeletonGrid}>
              {Array.from({ length: 6 }).map((_, i) => <div key={i} className={styles.skeletonCard} />)}
            </div>
            <div className={styles.skeletonBlock} />
            <div className={styles.skeletonBlock} style={{ height: "160px" }} />
          </div>
        )}

        {/* Main data */}
        {!loading && !error && summary && (
          <>
            {/* KPI row */}
            <div className={styles.kpiGrid}>
              <KpiCard icon="👥" label="Unique Users"      value={formatNumber(summary.unique_users)}                          accent="blue"   />
              <KpiCard icon="💬" label="Total Events"      value={formatNumber(summary.total_events)}                          accent="orange" />
              <KpiCard icon="❓" label="Questions Asked"   value={formatNumber(totalQuestions)}                                accent="purple" />
              <KpiCard
                icon="👍"
                label="Positive Feedback"
                value={positiveRate === null ? "—" : `${positiveRate.toFixed(1)}%`}
                accent={positiveRate !== null && positiveRate >= 70 ? "green" : "amber"}
                hint={feedbackTotal > 0 ? `${formatNumber(totalUpvotes)} ↑  ${formatNumber(totalDownvotes)} ↓` : "ยังไม่มี feedback"}
              />
              <KpiCard icon="📈" label="Events / User"    value={summary.behavior.avg_events_per_user.toFixed(1)}             accent="teal"   />
              <KpiCard icon="🙋" label="Active Users"     value={String(activeQuestionUsers)} hint={`ในช่วง ${days} วันที่ผ่านมา`} accent="slate"  />
            </div>

            {/* Charts */}
            <div className={styles.chartsRow}>
              <section className={styles.chartPanel}>
                <h2 className={styles.panelTitle}>หัวข้อกฎหมายยอดนิยม</h2>
                <BarChart
                  items={summary.topics.slice(0, 8).map((t) => ({ label: t.topic, value: t.count }))}
                  colorClass={styles.barFillOrange}
                  emptyText="ไม่มีข้อมูล topic"
                />
              </section>
              <section className={styles.chartPanel}>
                <h2 className={styles.panelTitle}>Event Breakdown</h2>
                <BarChart
                  items={summary.events_by_type.map((e) => ({ label: e.event_type, value: e.count }))}
                  colorClass={styles.barFillBlue}
                  emptyText="ไม่มีข้อมูล event"
                />
              </section>
            </div>

            {/* User table */}
            <section className={styles.panel}>
              <div className={styles.panelHeader}>
                <h2 className={styles.panelTitle}>User Insights</h2>
                <div className={styles.panelActions}>
                  <input
                    value={userQuery}
                    onChange={(e) => setUserQuery(e.target.value)}
                    placeholder="ค้นหา user / topic"
                    className={styles.searchInput}
                  />
                  <span className={styles.resultCount}>{filteredUsers.length} users</span>
                </div>
              </div>
              <div className={styles.tableScroll}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>User (hashed)</th>
                      <th className={styles.numCol}>Events</th>
                      <th className={styles.numCol}>Questions</th>
                      <th>Top Topic</th>
                      <th className={styles.numCol}>👍</th>
                      <th className={styles.numCol}>👎</th>
                      <th>Last Active</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUsers.map((u) => (
                      <tr key={u.user_hash}>
                        <td className={styles.hashCell}><code>{u.user_hash.slice(0, 14)}…</code></td>
                        <td className={styles.numCell}>{formatNumber(u.total_events)}</td>
                        <td className={styles.numCell}>{formatNumber(u.questions)}</td>
                        <td>
                          {u.top_topic
                            ? <span className={styles.topicChip}>{u.top_topic}</span>
                            : <span className={styles.dimText}>—</span>}
                        </td>
                        <td className={styles.numCell}><span className={styles.upVote}>{formatNumber(u.upvotes)}</span></td>
                        <td className={styles.numCell}><span className={styles.downVote}>{formatNumber(u.downvotes)}</span></td>
                        <td className={styles.timeCell}>{new Date(u.last_active_ts).toLocaleDateString("th-TH")}</td>
                      </tr>
                    ))}
                    {filteredUsers.length === 0 && (
                      <tr><td colSpan={7} className={styles.emptyRow}>ไม่พบผู้ใช้ตามเงื่อนไขที่กรอง</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}

        {/* Training Data Tools */}
        {keyReady && (
          <section className={`${styles.panel} ${styles.toolsPanel}`}>
            <div className={styles.panelHeader}>
              <h2 className={styles.panelTitle}>Training Data Tools</h2>
              <div className={styles.tabRow}>
                <button
                  onClick={() => setExportTab("export")}
                  className={`${styles.tab} ${exportTab === "export" ? styles.tabActive : ""}`}
                >
                  Export Datasets
                </button>
                <button
                  onClick={() => setExportTab("snapshot")}
                  className={`${styles.tab} ${exportTab === "snapshot" ? styles.tabActive : ""}`}
                >
                  Snapshot
                </button>
              </div>
            </div>

            {/* Shared filters */}
            <div className={styles.filterRow}>
              <FilterField label="Topic"  value={topicFilter}  onChange={setTopicFilter}  placeholder="เช่น อาญา" />
              <FilterField label="Domain" value={domainFilter} onChange={setDomainFilter} placeholder="เช่น กฎหมายแรงงาน" />
              <FilterField label="Risk"   value={riskFilter}   onChange={setRiskFilter}   placeholder="เช่น medium" />
              <div className={styles.windowBadge}>
                <span className={styles.filterLabel}>Window</span>
                <span className={styles.windowValue}>{days} วัน</span>
              </div>
            </div>

            {exportTab === "export" && (
              <div className={styles.exportGrid}>
                <ExportGroup title="Questions">
                  <ExportButton label="JSON"  id="q-json"  onClick={() => void handleExport("q-json",  "json",  "questions")} exporting={exporting} variant="neutral" />
                  <ExportButton label="JSONL" id="q-jsonl" onClick={() => void handleExport("q-jsonl", "jsonl", "questions")} exporting={exporting} variant="warm"    />
                </ExportGroup>
                <ExportGroup title="Q-A Pairs">
                  <ExportButton label="JSONL" id="pairs" onClick={() => void handleExport("pairs", "jsonl", "pairs")} exporting={exporting} variant="green" />
                </ExportGroup>
                <ExportGroup title="Instruction">
                  <ExportButton label="Native" id="inst-native" onClick={() => void handleExport("inst-native", "jsonl", "instruction", "native")} exporting={exporting} variant="blue"  />
                  <ExportButton label="ChatML" id="inst-chatml" onClick={() => void handleExport("inst-chatml", "jsonl", "instruction", "chatml")} exporting={exporting} variant="cyan"  />
                  <ExportButton label="Alpaca" id="inst-alpaca" onClick={() => void handleExport("inst-alpaca", "jsonl", "instruction", "alpaca")} exporting={exporting} variant="amber" />
                </ExportGroup>
                <ExportGroup title="Preview">
                  <ExportButton
                    label={previewing ? "Loading…" : "Preview ChatML (20)"}
                    id="preview"
                    onClick={() => void handlePreview()}
                    exporting={previewing ? "preview" : null}
                    variant="teal"
                  />
                </ExportGroup>
              </div>
            )}

            {exportTab === "snapshot" && (
              <div className={styles.snapshotTab}>
                <p className={styles.snapshotInfo}>
                  สร้าง snapshot ทุกฟอร์แมตพร้อมกันจากข้อมูลผู้ใช้จริง (group: <code>real</code>) บันทึกลง <code>train/exports/real/</code>
                </p>
                <button
                  onClick={() => void handleSnapshotExport()}
                  disabled={snapshotting}
                  className={styles.snapshotButton}
                >
                  {snapshotting ? "⏳  กำลังสร้าง snapshot..." : "🗂️  Create Snapshot"}
                </button>
                {snapshotResult && <pre className={styles.snapshotOutput}>{snapshotResult}</pre>}
              </div>
            )}
          </section>
        )}

        {/* Preview output */}
        {previewJson && (
          <section className={`${styles.panel} ${styles.toolsPanel}`}>
            <div className={styles.panelHeader}>
              <h2 className={styles.panelTitle}>Preview — ChatML (20 rows)</h2>
              <button onClick={() => setPreviewJson("")} className={styles.dimButton}>✕ Close</button>
            </div>
            <pre className={styles.previewOutput}>{previewJson}</pre>
          </section>
        )}

      </div>
    </main>
  );
}

// Helper components

function KpiCard({
  icon, label, value, hint, accent,
}: {
  icon: string; label: string; value: string; hint?: string;
  accent: "blue" | "orange" | "purple" | "green" | "teal" | "amber" | "slate";
}) {
  return (
    <div className={`${styles.kpiCard} ${KPI_ACCENT[accent] ?? ""}`}>
      <div className={styles.kpiIcon}>{icon}</div>
      <div className={styles.kpiLabel}>{label}</div>
      <div className={styles.kpiValue}>{value}</div>
      {hint && <div className={styles.kpiHint}>{hint}</div>}
    </div>
  );
}

function BarChart({ items, colorClass, emptyText }: {
  items: { label: string; value: number }[];
  colorClass: string;
  emptyText: string;
}) {
  const max = Math.max(...items.map((x) => x.value), 1);
  if (items.length === 0) return <p className={styles.noData}>{emptyText}</p>;
  return (
    <div className={styles.barChart}>
      {items.map((item) => (
        <div key={item.label} className={styles.barRow}>
          <div className={styles.barLabel}>{item.label}</div>
          <div className={styles.barTrackOuter}>
            <div
              className={`${styles.barTrackFill} ${colorClass}`}
              style={{ width: `${Math.max(4, Math.round((item.value / max) * 100))}%` }}
            />
          </div>
          <div className={styles.barCount}>{formatNumber(item.value)}</div>
        </div>
      ))}
    </div>
  );
}

function FilterField({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder: string;
}) {
  return (
    <label className={styles.filterField}>
      <span className={styles.filterLabel}>{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={styles.filterInput} />
    </label>
  );
}

function ExportGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className={styles.exportGroup}>
      <div className={styles.exportGroupTitle}>{title}</div>
      <div className={styles.exportGroupButtons}>{children}</div>
    </div>
  );
}

function ExportButton({ label, id, onClick, exporting, variant }: {
  label: string; id: string; onClick: () => void;
  exporting: string | null; variant: string;
}) {
  const isActive = exporting === id;
  const isDisabled = exporting !== null;
  return (
    <button
      onClick={onClick}
      disabled={isDisabled}
      className={`${styles.exportBtn} ${EXPORT_BTN_VARIANT[variant] ?? ""} ${isActive ? styles.exportBtnActive : ""}`}
    >
      {isActive ? "↻ " : ""}{label}
    </button>
  );
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}