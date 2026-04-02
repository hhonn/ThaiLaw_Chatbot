"use client";

import React, { useEffect, useRef } from "react";
import type { ChatMessage } from "../lib/api";

interface ChatAreaProps {
  messages: ChatMessage[];
  isLoading: boolean;
  citations: string;
  domain: string;
  risk: string;
  feedback: Record<number, "up" | "down">;
  onFeedback: (index: number, value: "up" | "down") => void;
}

const riskStyle = (r: string) => {
  if (!r || r === "—") return { color: "#71717a", dot: "#71717a" };
  if (r.includes("สูง")) return { color: "#dc2626", dot: "#dc2626" };
  if (r.includes("ปานกลาง")) return { color: "#d97706", dot: "#d97706" };
  return { color: "#16a34a", dot: "#16a34a" };
};

export default function ChatArea({
  messages,
  isLoading,
  citations,
  domain,
  risk,
  feedback,
  onFeedback,
}: ChatAreaProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  const isEmpty = messages.length === 0;

  return (
    <div className="flex-1 overflow-y-auto" style={{ background: "var(--bg-chat)" }}>
      {isEmpty ? (
        <div
          className="flex flex-col items-center justify-center h-full"
          style={{ padding: "40px 32px 60px" }}
        >
          {/* Hero — Claude style */}
          <div className="animate-slideUp" style={{ textAlign: "center" }}>
            <div style={{
              width: 52, height: 52, borderRadius: 14,
              background: "linear-gradient(135deg, #D97757, #E8956A)",
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              fontSize: 26, marginBottom: 20,
              boxShadow: "0 8px 32px rgba(217,119,87,0.2), 0 0 0 6px rgba(217,119,87,0.06)",
            }}>
              ⚖️
            </div>
            <h1 style={{
              fontSize: 26, fontWeight: 700, color: "var(--text-primary)",
              letterSpacing: "-0.03em", marginBottom: 8, lineHeight: 1.2,
            }}>
              วันนี้ช่วยอะไรได้บ้าง?
            </h1>
            <p style={{
              fontSize: 14, color: "var(--text-secondary)", maxWidth: 400,
              lineHeight: 1.6, margin: "0 auto",
            }}>
              ถามคำถามเกี่ยวกับกฎหมายไทย ค้นหาข้อมูลจากฐานกฎหมายและคำพิพากษาศาลฎีกา
            </p>
          </div>
        </div>
      ) : (
        /* ── Messages ── */
        <div style={{ maxWidth: 740, margin: "0 auto", padding: "24px 28px 28px" }}>
          {messages.map((msg, i) => {
            const isUser = msg.role === "user";
            const isLatestAssistant = !isUser && i === messages.length - 1;
            const showAnalysis = isLatestAssistant && (domain !== "—" || risk !== "—");
            const contentHtml = isLatestAssistant && citations
              ? `${renderMarkdown(msg.content)}${renderCitationsInline(citations)}`
              : renderMarkdown(msg.content);
            return (
              <React.Fragment key={i}>
                <div
                  className="animate-fadeUp"
                  style={{
                    display: "flex", gap: 12, marginBottom: showAnalysis ? 8 : 20,
                    flexDirection: isUser ? "row-reverse" : "row",
                    alignItems: "flex-start",
                  }}
                >
                  {/* Avatar */}
                  <div
                    style={{
                      width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: isUser ? 12 : 13, marginTop: 2,
                      ...(isUser
                        ? { background: "var(--avatar-user-bg)", color: "var(--avatar-user-color)", fontWeight: 600 }
                        : { background: "linear-gradient(135deg, #D97757, #E8956A)" }),
                    }}
                  >
                    {isUser ? "U" : "⚖️"}
                  </div>

                  {/* Bubble / Content */}
                  <div
                    className="prose max-w-none"
                    style={isUser ? {
                      background: "var(--user-msg-bg)", color: "var(--user-msg-color)",
                      borderRadius: "18px 18px 4px 18px",
                      padding: "10px 16px", maxWidth: "72%",
                      fontSize: 14, lineHeight: 1.7,
                    } : {
                      color: "var(--text-primary)",
                      padding: "4px 0", maxWidth: "calc(100% - 42px)",
                      fontSize: 14, lineHeight: 1.8,
                    }}
                    dangerouslySetInnerHTML={{ __html: contentHtml }}
                  />
                </div>

                {/* Thumbs up/down for bot messages */}
                {!isUser && (
                  <div style={{
                    display: "flex", gap: 2, marginLeft: 40, marginBottom: showAnalysis ? 4 : 12, marginTop: -4,
                  }}>
                    {(["up", "down"] as const).map((dir) => {
                      const isSelected = feedback[i] === dir;
                      return (
                        <button
                          key={dir}
                          onClick={() => onFeedback(i, dir)}
                          className="cursor-pointer"
                          style={{
                            width: 28, height: 28, borderRadius: 6,
                            border: "none",
                            background: isSelected
                              ? (dir === "up" ? "rgba(22,163,74,0.1)" : "rgba(220,38,38,0.1)")
                              : "transparent",
                            color: isSelected
                              ? (dir === "up" ? "#16a34a" : "#dc2626")
                              : "#a1a1aa",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: 14, transition: "all 0.15s",
                          }}
                          onMouseEnter={(e) => {
                            if (!isSelected) {
                              e.currentTarget.style.background = "rgba(0,0,0,0.04)";
                              e.currentTarget.style.color = dir === "up" ? "#16a34a" : "#dc2626";
                            }
                          }}
                          onMouseLeave={(e) => {
                            if (!isSelected) {
                              e.currentTarget.style.background = "transparent";
                              e.currentTarget.style.color = "#a1a1aa";
                            }
                          }}
                        >
                          {dir === "up" ? "👍" : "👎"}
                        </button>
                      );
                    })}
                  </div>
                )}
                {/* Analysis card below last bot message */}
                {showAnalysis && (
                  <div
                    className="animate-fadeUp"
                    style={{
                      marginLeft: 40, marginBottom: 16,
                    }}
                  >
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: citations ? 8 : 0 }}>
                      {domain && domain !== "—" && (
                        <span style={{
                          display: "inline-flex", alignItems: "center", gap: 5,
                          fontSize: 12, fontWeight: 500, color: "#52525b",
                          background: "var(--bg-secondary)", border: "1px solid var(--border-color)",
                          borderRadius: 6, padding: "4px 10px",
                        }}>
                          <span style={{ fontSize: 13 }}>📂</span> {domain}
                        </span>
                      )}
                      {risk && risk !== "—" && (
                        <span style={{
                          display: "inline-flex", alignItems: "center", gap: 5,
                          fontSize: 12, fontWeight: 600, color: riskStyle(risk).color,
                          background: `${riskStyle(risk).color}0a`,
                          border: `1px solid ${riskStyle(risk).color}22`,
                          borderRadius: 6, padding: "4px 10px",
                        }}>
                          <span style={{
                            width: 6, height: 6, borderRadius: "50%",
                            background: riskStyle(risk).dot, flexShrink: 0,
                          }} />
                          {risk}
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </React.Fragment>
            );
          })}

          {/* Typing */}
          {isLoading && messages[messages.length - 1]?.role === "user" && (
            <div className="animate-fadeIn" style={{ display: "flex", gap: 12, marginBottom: 16 }}>
              <div style={{
                width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
                background: "linear-gradient(135deg, #D97757, #E8956A)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 13,
              }}>
                ⚖️
              </div>
              <div
                className="flex items-center gap-1.5"
                style={{
                  padding: "8px 4px",
                }}
              >
                <span className="typing-dot" />
                <span className="typing-dot" />
                <span className="typing-dot" />
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  );
}

function inlineFormat(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

function parseTable(block: string): string {
  const lines = block.trim().split("\n").filter((l) => l.trim());
  if (lines.length < 2) return "";

  const parseRow = (line: string) =>
    line.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

  const headerCells = parseRow(lines[0]);
  const startIdx = /^[\s|:-]+$/.test(lines[1]) ? 2 : 1;
  const bodyRows = lines.slice(startIdx);

  let html = '<div class="table-wrap"><table>';
  html += "<thead><tr>" + headerCells.map((c) => `<th>${inlineFormat(c)}</th>`).join("") + "</tr></thead>";
  html += "<tbody>";
  for (const row of bodyRows) {
    const cells = parseRow(row);
    html += "<tr>" + cells.map((c) => `<td>${inlineFormat(c)}</td>`).join("") + "</tr>";
  }
  html += "</tbody></table></div>";
  return html;
}

function renderMarkdown(text: string): string {
  if (!text) return "";

  // Step 1: Extract tables before other processing
  const tableRegex = /((?:^\|.+\|\s*$\n?){2,})/gm;
  const tablePlaceholders: string[] = [];
  let src = text.replace(tableRegex, (match) => {
    const idx = tablePlaceholders.length;
    tablePlaceholders.push(parseTable(match));
    return `\n\n%%TABLE_${idx}%%\n\n`;
  });

  // Step 2: Normalize block boundaries
  // Remove bare colon lines (stray ":" on its own line)
  src = src.replace(/^\s*:\s*$/gm, "");
  // Merge lone emoji line with next line (e.g. "⚠️\ntext" → "⚠️ text")
  src = src.replace(/^([\p{Emoji_Presentation}\p{Extended_Pictographic}]\uFE0F?)\s*\n+(.)/gmu, "$1 $2");
  // Remove trailing colon after bold section headers (e.g. "**⚖️ text:**:" or "**text**:")
  src = src.replace(/(\*\*[^*]+\*\*):?\s*$/gm, "$1");
  src = src
    .replace(/([^\n])\n(- )/g, "$1\n\n$2")
    .replace(/([^\n])\n(\d+\. )/g, "$1\n\n$2")
    .replace(/([^\n])\n(#{1,3} )/g, "$1\n\n$2")
    .replace(/([^\n])\n(---+)$/gm, "$1\n\n$2")
    .replace(/([^\n])\n(> )/g, "$1\n\n$2")
    .replace(/(^- .+)\n([^-\n])/gm, "$1\n\n$2")
    .replace(/(^\d+\. .+)\n([^\d\n])/gm, "$1\n\n$2")
    .replace(/([^\n])\n(\*\*[^*]+\*\*:?)\s*$/gm, "$1\n\n$2");

  // Step 2b: Re-collapse consecutive list items (undo over-splitting)
  src = src.replace(/(^- .+)\n\n(- )/gm, "$1\n$2");
  src = src.replace(/(^\d+\. .+)\n\n(\d+\. )/gm, "$1\n$2");
  // Keep bullet items together with preceding numbered item (for nesting)
  src = src.replace(/(^\d+\. .+)\n\n(- )/gm, "$1\n$2");
  // Keep numbered items together with preceding bullet items (continuous list)
  src = src.replace(/(^- .+)\n\n(\d+\. )/gm, "$1\n$2");

  // Step 2c: Normalize indented sub-items ("  - item" → "- item")
  src = src.replace(/^[ \t]{2,}(- )/gm, "$1");

  // Step 2d: Split inline bullet lists ("- a - b - c" → separate lines)
  // Case 1: Lines starting with "- "
  src = src.replace(/^(- .+?) - (.+)$/gm, (line) => {
    const parts = line.replace(/^- /, "").split(/ - /);
    if (parts.length >= 2) {
      return parts.map((p) => `- ${p.trim()}`).join("\n");
    }
    return line;
  });
  // Case 2: Lines NOT starting with "- " but containing multiple " - " separators
  src = src.replace(/^([^-\n#>|\d].+?) - (.+)$/gm, (line) => {
    const parts = line.split(/ - /);
    if (parts.length >= 3) {
      return parts.map((p) => `- ${p.trim()}`).join("\n");
    }
    return line;
  });

  // Step 3: Convert markdown syntax to HTML
  let html = src
    .replace(/^---+$/gm, "<hr/>")
    .replace(/^> (.+)$/gm, "<blockquote><p>$1</p></blockquote>")
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(
      /\[([^\]]+)\]\(([^)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener">$1</a>'
    )
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/^- (.+)$/gm, "<li class=\"ul-item\">$1</li>")
    .replace(/^(\d+)\. (.+)$/gm, "<li class=\"ol-item\" value=\"$1\">$2</li>");

  // Step 4: Group block elements
  html = html.replace(/(<\/blockquote>)\n?(<blockquote>)/g, "");

  // Group consecutive list items with nesting (ul sub-items under ol)
  html = html.replace(
    /(?:<li class="(?:ol|ul)-item"[^>]*>.*?<\/li>\n?)+/g,
    (block) => {
      const itemRegex = /<li class="(ol|ul)-item"([^>]*)>(.*?)<\/li>/g;
      const items: Array<{type: string; attrs: string; content: string}> = [];
      let m;
      while ((m = itemRegex.exec(block)) !== null) {
        items.push({ type: m[1], attrs: m[2], content: m[3] });
      }
      if (items.length === 0) return block;

      const hasOl = items.some(i => i.type === 'ol');
      if (!hasOl) {
        return `<ul>${items.map(i => `<li>${i.content}</li>`).join('')}</ul>`;
      }

      let result = '';
      let idx = 0;

      // Leading ul-items before first ol-item → standalone <ul>
      const leadingUl: string[] = [];
      while (idx < items.length && items[idx].type === 'ul') {
        leadingUl.push(`<li>${items[idx].content}</li>`);
        idx++;
      }
      if (leadingUl.length > 0) {
        result += `<ul>${leadingUl.join('')}</ul>`;
      }

      // Build <ol> with nested <ul> sub-items
      let olContent = '';
      while (idx < items.length) {
        if (items[idx].type === 'ol') {
          olContent += `<li${items[idx].attrs}>${items[idx].content}`;
          idx++;
          const nested: string[] = [];
          while (idx < items.length && items[idx].type === 'ul') {
            nested.push(`<li>${items[idx].content}</li>`);
            idx++;
          }
          if (nested.length > 0) {
            olContent += `<ul>${nested.join('')}</ul>`;
          }
          olContent += '</li>';
        } else {
          idx++;
        }
      }
      if (olContent) {
        result += `<ol>${olContent}</ol>`;
      }
      return result;
    }
  );

  // Step 5: Detect emoji section headers
  // Case 1: emoji INSIDE bold — <strong>📋 text:</strong>
  const sectionHeaderRe = /<strong>([\p{Emoji_Presentation}\p{Extended_Pictographic}]\uFE0F?)\s*([^<]*?):?<\/strong>/gu;
  html = html.replace(sectionHeaderRe, (_, icon, label) => {
    const trimLabel = label.trim().replace(/:$/, "");
    return `<div class="section-header"><span class="section-icon">${icon}</span>${trimLabel}</div>`;
  });
  // Case 2: emoji OUTSIDE bold — ⚠️ <strong>text:</strong> or ⚠️<strong>text</strong>
  const sectionHeaderRe2 = /([\p{Emoji_Presentation}\p{Extended_Pictographic}]\uFE0F?)\s*<strong>([^<]*?):?<\/strong>:?/gu;
  html = html.replace(sectionHeaderRe2, (_, icon, label) => {
    const trimLabel = label.trim().replace(/:$/, "");
    return `<div class="section-header"><span class="section-icon">${icon}</span>${trimLabel}</div>`;
  });

  // Step 5b: Split into blocks and wrap paragraphs
  html = html
    .split(/\n{2,}/)
    .map((b) => {
      const t = b.trim();
      if (!t) return "";
      if (/^<(h[1-3]|ul|ol|hr|blockquote|div)/.test(t)) return t;
      if (/^%%TABLE_\d+%%$/.test(t)) return t;
      return `<p>${t.replace(/\n/g, "<br/>")}</p>`;
    })
    .join("");

  // Step 6: Post-process — clean up section headers wrapped in <p>
  html = html.replace(/<p>(<div class="section-header">.*?<\/div>)<\/p>/g, "$1");

  // Step 7: Restore table placeholders
  html = html.replace(/%%TABLE_(\d+)%%/g, (_, idx) => tablePlaceholders[parseInt(idx)]);

  // Step 8: Remove commas between Thai words (not inside numbers or English)
  html = html.replace(/([\u0E00-\u0E7F]),\s*([\u0E00-\u0E7F])/g, "$1 $2");

  return html;
}

function renderCitationsInline(citations: string): string {
  if (!citations.trim()) return "";
  const html = citations
    .replace(
      /\[([^\]]+)\]\(([^)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
    )
    .replace(/\n/g, "<br/>");

  return `
    <div style="margin-top:10px;font-size:12px;line-height:1.65;color:#71717a;">
      <strong style="font-size:11px;color:#a1a1aa;letter-spacing:0.01em;">📎 แหล่งอ้างอิง</strong><br/>
      ${html}
    </div>
  `;
}