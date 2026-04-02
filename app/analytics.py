from __future__ import annotations

import hashlib
import json
import os
import re
import sqlite3
import threading
import time
from typing import Any, Dict, List, Optional

_DB_PATH = os.environ.get(
    "ANALYTICS_DB_PATH",
    os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "analytics", "usage.sqlite3"),
)
_MAX_META_CHARS = 4000
_DB_LOCK = threading.Lock()
_EXPORT_RETENTION_DAYS = int(os.environ.get("ANALYTICS_EXPORT_RETENTION_DAYS", "30"))
_SAMPLE_MARKER = "sample_generator"

_PII_PATTERNS: list[tuple[str, str]] = [
    (r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", "[EMAIL]"),
    (r"\b\d{10,13}\b", "[PHONE_OR_ID]"),
    (r"\b\d{1,2}[-/ ]\d{1,2}[-/ ]\d{2,4}\b", "[DATE]"),
    (r"\b\d{3,}\b", "[NUMBER]"),
]


_TOPIC_KEYWORDS: dict[str, list[str]] = {
    "แรงงาน": [
        "แรงงาน",
        "ค่าจ้าง",
        "โอที",
        "เลิกจ้าง",
        "นายจ้าง",
        "ลูกจ้าง",
        "ประกันสังคม",
    ],
    "ครอบครัว": [
        "หย่า",
        "สมรส",
        "บุตร",
        "อุปการะ",
        "ค่าเลี้ยงดู",
        "มรดก",
    ],
    "อาญา": [
        "อาญา",
        "คดีอาญา",
        "แจ้งความ",
        "จับกุม",
        "ประมวลกฎหมายอาญา",
        "ลักทรัพย์",
        "ฉ้อโกง",
    ],
    "แพ่ง": [
        "แพ่ง",
        "สัญญา",
        "หนี้",
        "ละเมิด",
        "ฟ้อง",
        "ค่าเสียหาย",
    ],
    "ทรัพย์สิน": [
        "ที่ดิน",
        "โฉนด",
        "กรรมสิทธิ์",
        "เช่า",
        "จำนอง",
    ],
    "ภาษี": [
        "ภาษี",
        "สรรพากร",
        "ภงด",
        "vat",
        "มูลค่าเพิ่ม",
    ],
    "คุ้มครองผู้บริโภค": [
        "ผู้บริโภค",
        "สคบ",
        "คืนเงิน",
        "รับประกัน",
        "โฆษณาเกินจริง",
    ],
    "ดิจิทัล": [
        "พ.ร.บ.คอม",
        "คอมพิวเตอร์",
        "ข้อมูลส่วนบุคคล",
        "pdpa",
        "ออนไลน์",
        "หมิ่นประมาท",
    ],
}


def init_analytics_db() -> None:
    os.makedirs(os.path.dirname(_DB_PATH), exist_ok=True)
    with _connect() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS analytics_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ts INTEGER NOT NULL,
                event_type TEXT NOT NULL,
                user_hash TEXT,
                session_id TEXT,
                topic TEXT,
                message_length INTEGER,
                metadata_json TEXT
            )
            """
        )
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_analytics_ts ON analytics_events(ts)
            """
        )
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_analytics_event_type ON analytics_events(event_type)
            """
        )
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_analytics_user_hash ON analytics_events(user_hash)
            """
        )
        conn.commit()


def anonymize_user(email: Optional[str]) -> Optional[str]:
    if not email:
        return None
    cleaned = email.strip().lower()
    if not cleaned:
        return None
    return hashlib.sha256(cleaned.encode("utf-8")).hexdigest()


def classify_legal_topic(text: Optional[str]) -> str:
    if not text:
        return "อื่นๆ"
    t = text.strip().lower()
    if not t:
        return "อื่นๆ"

    best_topic = "อื่นๆ"
    best_score = 0
    for topic, keywords in _TOPIC_KEYWORDS.items():
        score = 0
        for keyword in keywords:
            if keyword in t:
                score += 1
        if score > best_score:
            best_topic = topic
            best_score = score
    return best_topic


def redact_text_for_training(text: Optional[str]) -> str:
    if not text:
        return ""
    redacted = text.strip()
    for pattern, replacement in _PII_PATTERNS:
        redacted = re.sub(pattern, replacement, redacted)
    return redacted[:2000]


def log_event(
    event_type: str,
    user_email: Optional[str] = None,
    session_id: Optional[str] = None,
    topic: Optional[str] = None,
    message_length: Optional[int] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> None:
    now_ms = int(time.time() * 1000)
    user_hash = anonymize_user(user_email)
    if metadata is None:
        metadata = {}

    metadata_json = json.dumps(metadata, ensure_ascii=False)
    if len(metadata_json) > _MAX_META_CHARS:
        metadata_json = metadata_json[:_MAX_META_CHARS]

    with _DB_LOCK:
        with _connect() as conn:
            conn.execute(
                """
                INSERT INTO analytics_events(
                    ts, event_type, user_hash, session_id, topic, message_length, metadata_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (now_ms, event_type, user_hash, session_id, topic, message_length, metadata_json),
            )
            conn.commit()


def _real_events_clause(alias: str = "") -> str:
    """SQL predicate to keep only real user events and exclude synthetic samples."""
    prefix = f"{alias}." if alias else ""
    return (
        f"({prefix}session_id IS NULL OR {prefix}session_id NOT LIKE 'sample-%') "
        f"AND ({prefix}metadata_json IS NULL OR {prefix}metadata_json NOT LIKE '%{_SAMPLE_MARKER}%')"
    )


def get_summary(days: int = 30) -> Dict[str, Any]:
    days = max(1, min(days, 365))
    start_ts = int((time.time() - days * 86400) * 1000)
    real_filter = _real_events_clause()

    with _connect() as conn:
        total_events = conn.execute(
            f"SELECT COUNT(*) FROM analytics_events WHERE ts >= ? AND {real_filter}",
            (start_ts,),
        ).fetchone()[0]

        unique_users = conn.execute(
            f"SELECT COUNT(DISTINCT user_hash) FROM analytics_events WHERE ts >= ? AND user_hash IS NOT NULL AND {real_filter}",
            (start_ts,),
        ).fetchone()[0]

        events_by_type_rows = conn.execute(
            f"""
            SELECT event_type, COUNT(*) as c
            FROM analytics_events
            WHERE ts >= ? AND {real_filter}
            GROUP BY event_type
            ORDER BY c DESC
            """,
            (start_ts,),
        ).fetchall()

        topic_rows = conn.execute(
            f"""
            SELECT topic, COUNT(*) as c
            FROM analytics_events
            WHERE ts >= ? AND topic IS NOT NULL AND event_type = 'chat_send' AND {real_filter}
            GROUP BY topic
            ORDER BY c DESC
            """,
            (start_ts,),
        ).fetchall()

        user_behavior_row = conn.execute(
                        f"""
            SELECT
              AVG(CAST(event_count AS REAL)),
              AVG(CAST(chat_count AS REAL))
            FROM (
              SELECT
                user_hash,
                COUNT(*) AS event_count,
                SUM(CASE WHEN event_type = 'chat_send' THEN 1 ELSE 0 END) AS chat_count
              FROM analytics_events
                            WHERE ts >= ? AND user_hash IS NOT NULL AND {real_filter}
              GROUP BY user_hash
            )
            """,
            (start_ts,),
        ).fetchone()

    return {
        "window_days": days,
        "total_events": total_events,
        "unique_users": unique_users,
        "events_by_type": [
            {"event_type": row[0], "count": row[1]} for row in events_by_type_rows
        ],
        "topics": [{"topic": row[0], "count": row[1]} for row in topic_rows],
        "behavior": {
            "avg_events_per_user": round(user_behavior_row[0] or 0, 2),
            "avg_questions_per_user": round(user_behavior_row[1] or 0, 2),
        },
    }


def get_user_insights(days: int = 30, limit: int = 25) -> List[Dict[str, Any]]:
    days = max(1, min(days, 365))
    limit = max(1, min(limit, 100))
    start_ts = int((time.time() - days * 86400) * 1000)
    real_filter = _real_events_clause()

    with _connect() as conn:
        rows = conn.execute(
                        f"""
            SELECT
              user_hash,
              COUNT(*) AS total_events,
              SUM(CASE WHEN event_type = 'chat_send' THEN 1 ELSE 0 END) AS questions,
              SUM(CASE WHEN event_type = 'chat_feedback_up' THEN 1 ELSE 0 END) AS upvotes,
              SUM(CASE WHEN event_type = 'chat_feedback_down' THEN 1 ELSE 0 END) AS downvotes,
              MAX(ts) AS last_active_ts
            FROM analytics_events
            WHERE ts >= ? AND user_hash IS NOT NULL AND {real_filter}
            GROUP BY user_hash
            ORDER BY total_events DESC
            LIMIT ?
            """,
            (start_ts, limit),
        ).fetchall()

        out: list[dict[str, Any]] = []
        for row in rows:
            user_hash = row[0]
            top_topic_row = conn.execute(
                f"""
                SELECT topic, COUNT(*) AS c
                FROM analytics_events
                WHERE ts >= ? AND user_hash = ? AND topic IS NOT NULL AND event_type = 'chat_send' AND {real_filter}
                GROUP BY topic
                ORDER BY c DESC
                LIMIT 1
                """,
                (start_ts, user_hash),
            ).fetchone()

            out.append(
                {
                    "user_hash": user_hash,
                    "total_events": row[1] or 0,
                    "questions": row[2] or 0,
                    "upvotes": row[3] or 0,
                    "downvotes": row[4] or 0,
                    "last_active_ts": row[5] or 0,
                    "top_topic": top_topic_row[0] if top_topic_row else "อื่นๆ",
                }
            )
        return out


def export_training_rows(
    days: int = 30,
    limit: int = 2000,
    topic: Optional[str] = None,
) -> List[Dict[str, Any]]:
    days = max(1, min(days, 365))
    limit = max(1, min(limit, 20000))
    start_ts = int((time.time() - days * 86400) * 1000)
    topic_filter = (topic or "").strip().lower()
    real_filter = _real_events_clause()

    with _connect() as conn:
        rows = conn.execute(
                        f"""
            SELECT
              ts,
              user_hash,
              session_id,
              topic,
              message_length,
              metadata_json
            FROM analytics_events
            WHERE ts >= ? AND event_type = 'chat_send' AND {real_filter}
            ORDER BY ts DESC
            LIMIT ?
            """,
            (start_ts, limit),
        ).fetchall()

        output: list[dict[str, Any]] = []
        for row in rows:
            metadata_raw = row[5] or "{}"
            try:
                metadata = json.loads(metadata_raw)
            except Exception:
                metadata = {}

            item_topic = row[3] or "อื่นๆ"
            if topic_filter and topic_filter not in str(item_topic).lower():
                continue

            output.append(
                {
                    "ts": row[0],
                    "user_hash": row[1],
                    "session_id": row[2],
                    "topic": item_topic,
                    "question_length": row[4] or 0,
                    "question_redacted": str(metadata.get("message_text_redacted", "")),
                }
            )

            if len(output) >= limit:
                break
        return output


def export_training_pairs(
    days: int = 30,
    limit: int = 1000,
    topic: Optional[str] = None,
    domain: Optional[str] = None,
    risk: Optional[str] = None,
) -> List[Dict[str, Any]]:
    days = max(1, min(days, 365))
    limit = max(1, min(limit, 10000))
    start_ts = int((time.time() - days * 86400) * 1000)
    topic_filter = (topic or "").strip().lower()
    domain_filter = (domain or "").strip().lower()
    risk_filter = (risk or "").strip().lower()
    real_filter = _real_events_clause()

    # Pull enough rows to build pairs reliably even when event distribution is uneven.
    fetch_limit = min(max(limit * 6, 5000), 100000)

    with _connect() as conn:
        rows = conn.execute(
                        f"""
            SELECT
              id,
              ts,
              user_hash,
              session_id,
              event_type,
              topic,
              metadata_json
            FROM analytics_events
            WHERE ts >= ?
                            AND {real_filter}
              AND event_type IN ('chat_send', 'chat_response_done')
              AND session_id IS NOT NULL
            ORDER BY ts ASC, id ASC
            LIMIT ?
            """,
            (start_ts, fetch_limit),
        ).fetchall()

    pending_by_session: dict[tuple[str, str], list[dict[str, Any]]] = {}
    pairs: list[dict[str, Any]] = []

    for row in rows:
        user_hash = row[2] or ""
        session_id = row[3] or ""
        event_type = row[4] or ""
        topic = row[5] or "อื่นๆ"
        metadata_raw = row[6] or "{}"

        try:
            metadata = json.loads(metadata_raw)
        except Exception:
            metadata = {}

        key = (user_hash, session_id)

        if event_type == "chat_send":
            question = str(metadata.get("message_text_redacted", "")).strip()
            if not question:
                continue
            pending_by_session.setdefault(key, []).append(
                {
                    "ts": row[1],
                    "topic": topic,
                    "question_redacted": question,
                }
            )
            continue

        if event_type == "chat_response_done":
            queue = pending_by_session.get(key, [])
            if not queue:
                continue

            send_item = queue.pop(0)
            answer = str(metadata.get("message_text_redacted", "")).strip()
            if not answer:
                continue

            item_topic = str(send_item["topic"])
            item_domain = str(metadata.get("domain", "—"))
            item_risk = str(metadata.get("risk", "—"))

            if topic_filter and topic_filter not in item_topic.lower():
                continue
            if domain_filter and domain_filter not in item_domain.lower():
                continue
            if risk_filter and risk_filter not in item_risk.lower():
                continue

            pairs.append(
                {
                    "ts": row[1],
                    "user_hash": user_hash,
                    "session_id": session_id,
                    "topic": item_topic,
                    "question_redacted": send_item["question_redacted"],
                    "answer_redacted": answer,
                    "domain": item_domain,
                    "risk": item_risk,
                }
            )

    return pairs[-limit:]


def export_instruction_rows(
    days: int = 30,
    limit: int = 1000,
    style: str = "native",
    topic: Optional[str] = None,
    domain: Optional[str] = None,
    risk: Optional[str] = None,
) -> List[Dict[str, Any]]:
    style = (style or "native").strip().lower()
    if style not in {"native", "chatml", "alpaca"}:
        style = "native"

    pairs = export_training_pairs(
        days=days,
        limit=limit,
        topic=topic,
        domain=domain,
        risk=risk,
    )
    rows: list[dict[str, Any]] = []
    system_prompt = "คุณเป็นผู้ช่วยด้านกฎหมายไทย ตอบอย่างระมัดระวัง กระชับ และไม่ให้ข้อมูลเท็จ"

    for item in pairs:
        ts = item.get("ts")
        topic = item.get("topic", "อื่นๆ")
        question = str(item.get("question_redacted", ""))
        answer = str(item.get("answer_redacted", ""))
        metadata = {
            "domain": str(item.get("domain", "—")),
            "risk": str(item.get("risk", "—")),
            "session_id": str(item.get("session_id", "")),
        }

        if style == "alpaca":
            rows.append(
                {
                    "ts": ts,
                    "topic": topic,
                    "instruction": system_prompt,
                    "input": question,
                    "output": answer,
                    "metadata": metadata,
                }
            )
            continue

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": question},
            {"role": "assistant", "content": answer},
        ]

        if style == "chatml":
            rows.append({"messages": messages, "metadata": metadata})
            continue

        rows.append(
            {
                "ts": ts,
                "topic": topic,
                "messages": messages,
                "metadata": metadata,
            }
        )

    return rows


def write_training_snapshots(
    days: int = 30,
    limit: int = 3000,
    topic: Optional[str] = None,
    domain: Optional[str] = None,
    risk: Optional[str] = None,
    group: str = "",
) -> Dict[str, Any]:
    group_name = (group or "").strip().lower()
    if group_name not in {"", "samples", "real"}:
        group_name = ""

    base_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "train", "exports")
    if group_name:
        base_dir = os.path.join(base_dir, group_name)
    os.makedirs(base_dir, exist_ok=True)

    stamp = time.strftime("%Y%m%d-%H%M%S", time.localtime())

    questions = export_training_rows(days=days, limit=limit, topic=topic)
    pairs = export_training_pairs(
        days=days,
        limit=limit,
        topic=topic,
        domain=domain,
        risk=risk,
    )
    instruction_native = export_instruction_rows(
        days=days,
        limit=limit,
        style="native",
        topic=topic,
        domain=domain,
        risk=risk,
    )
    instruction_chatml = export_instruction_rows(
        days=days,
        limit=limit,
        style="chatml",
        topic=topic,
        domain=domain,
        risk=risk,
    )
    instruction_alpaca = export_instruction_rows(
        days=days,
        limit=limit,
        style="alpaca",
        topic=topic,
        domain=domain,
        risk=risk,
    )

    outputs: list[tuple[str, list[dict[str, Any]]]] = [
        (f"lawbot-questions-{stamp}.jsonl", questions),
        (f"lawbot-pairs-{stamp}.jsonl", pairs),
        (f"lawbot-instruction-native-{stamp}.jsonl", instruction_native),
        (f"lawbot-instruction-chatml-{stamp}.jsonl", instruction_chatml),
        (f"lawbot-instruction-alpaca-{stamp}.jsonl", instruction_alpaca),
    ]

    files: list[dict[str, Any]] = []
    for filename, rows in outputs:
        file_path = os.path.join(base_dir, filename)
        with open(file_path, "w", encoding="utf-8") as f:
            for row in rows:
                f.write(json.dumps(row, ensure_ascii=False) + "\n")
        files.append({"name": filename, "path": file_path, "count": len(rows)})

    deleted_files = _prune_old_snapshot_files(
        base_dir=base_dir,
        retention_days=max(1, _EXPORT_RETENTION_DAYS),
    )

    return {
        "ok": True,
        "created_at": stamp,
        "base_dir": base_dir,
        "files": files,
        "deleted_old_files": deleted_files,
        "filters": {
            "topic": topic or "",
            "domain": domain or "",
            "risk": risk or "",
            "days": days,
            "limit": limit,
        },
    }


def generate_sample_conversations(count: int = 20) -> Dict[str, Any]:
    count = max(1, min(count, 200))
    samples: list[dict[str, str]] = [
        {
            "question": "ลูกจ้างถูกเลิกจ้างกะทันหัน ต้องได้ค่าชดเชยอย่างไร",
            "answer": "โดยหลักต้องพิจารณาอายุงานและเหตุเลิกจ้าง หากไม่มีเหตุร้ายแรง ลูกจ้างมีสิทธิค่าชดเชยตามกฎหมายแรงงาน",
            "domain": "กฎหมายแรงงาน",
            "risk": "low",
        },
        {
            "question": "กรณีถูกฉ้อโกงออนไลน์ ควรแจ้งความและเตรียมหลักฐานอะไรบ้าง",
            "answer": "ควรเก็บหลักฐานการโอนเงิน บทสนทนา และข้อมูลบัญชีปลายทาง แล้วแจ้งความที่สถานีตำรวจหรือช่องทางออนไลน์โดยเร็ว",
            "domain": "กฎหมายอาญา",
            "risk": "medium",
        },
        {
            "question": "เจ้าของห้องไม่คืนเงินประกันเมื่อย้ายออก สามารถฟ้องได้ไหม",
            "answer": "หากหักเกินเหตุหรือไม่คืนโดยไม่มีเหตุผล ผู้เช่าสามารถทวงถามเป็นหนังสือและฟ้องเรียกเงินคืนพร้อมดอกเบี้ยได้",
            "domain": "กฎหมายแพ่ง",
            "risk": "low",
        },
        {
            "question": "ข้อมูลส่วนบุคคลถูกนำไปเผยแพร่โดยไม่ได้ยินยอม ทำอย่างไรได้บ้าง",
            "answer": "สามารถร้องเรียนผู้ควบคุมข้อมูลและหน่วยงานที่เกี่ยวข้อง รวมทั้งเรียกค่าเสียหายตาม PDPA ได้เมื่อมีความเสียหาย",
            "domain": "กฎหมายดิจิทัล",
            "risk": "medium",
        },
        {
            "question": "ผู้ซื้อสินค้าออนไลน์ได้รับของไม่ตรงปก มีสิทธิขอคืนเงินหรือไม่",
            "answer": "ผู้บริโภคมีสิทธิขอเปลี่ยน คืนเงิน หรือเรียกร้องค่าเสียหายตามข้อเท็จจริงและเงื่อนไขการซื้อขาย",
            "domain": "คุ้มครองผู้บริโภค",
            "risk": "low",
        },
    ]

    created = 0
    feedback_up = 0
    feedback_down = 0

    for i in range(count):
        sample = samples[i % len(samples)]
        question = sample["question"]
        answer = sample["answer"]
        topic = classify_legal_topic(question)
        session_id = f"sample-{int(time.time())}-{i}"
        user_email = f"sample{i % 7}@example.com"

        log_event(
            event_type="chat_send",
            user_email=user_email,
            session_id=session_id,
            topic=topic,
            message_length=len(question),
            metadata={
                "message_text_redacted": redact_text_for_training(question),
                "source": _SAMPLE_MARKER,
            },
        )

        log_event(
            event_type="chat_response_done",
            user_email=user_email,
            session_id=session_id,
            topic=topic,
            message_length=len(answer),
            metadata={
                "message_text_redacted": redact_text_for_training(answer),
                "domain": sample["domain"],
                "risk": sample["risk"],
                "source": _SAMPLE_MARKER,
            },
        )

        if i % 3 != 0:
            log_event(
                event_type="chat_feedback_up",
                user_email=user_email,
                session_id=session_id,
                topic=topic,
                metadata={"source": _SAMPLE_MARKER},
            )
            feedback_up += 1
        else:
            log_event(
                event_type="chat_feedback_down",
                user_email=user_email,
                session_id=session_id,
                topic=topic,
                metadata={"source": _SAMPLE_MARKER},
            )
            feedback_down += 1

        created += 1

    return {
        "ok": True,
        "created_pairs": created,
        "feedback_up": feedback_up,
        "feedback_down": feedback_down,
    }


def bootstrap_training_data(
    sample_count: int = 30,
    days: int = 30,
    limit: int = 3000,
    topic: Optional[str] = None,
    domain: Optional[str] = None,
    risk: Optional[str] = None,
) -> Dict[str, Any]:
    sample_result = generate_sample_conversations(count=sample_count)
    snapshot_result = write_training_snapshots(
        days=days,
        limit=limit,
        topic=topic,
        domain=domain,
        risk=risk,
        group="samples",
    )
    return {
        "ok": True,
        "sample": sample_result,
        "snapshot": snapshot_result,
    }


def _prune_old_snapshot_files(base_dir: str, retention_days: int) -> List[str]:
    if retention_days <= 0:
        return []

    cutoff_epoch = time.time() - (retention_days * 86400)
    deleted: list[str] = []

    for name in os.listdir(base_dir):
        if not name.endswith(".jsonl"):
            continue
        path = os.path.join(base_dir, name)
        if not os.path.isfile(path):
            continue
        try:
            if os.path.getmtime(path) < cutoff_epoch:
                os.remove(path)
                deleted.append(name)
        except OSError:
            continue

    return deleted


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(_DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn
