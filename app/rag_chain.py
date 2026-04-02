from __future__ import annotations

import json
import logging
import os
import re
from typing import Generator, List, Tuple

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

# Input constraints
MAX_QUESTION_LENGTH = 1000  # chars — guard against prompt-injection / cost attacks
MAX_HISTORY_TURNS   = 6     # turns kept in context
TOP_K_RERANK        = 8     # docs kept after reranking (was 6)
RETRIEVER_K         = 20    # docs fetched per retriever (was 15)
MIN_RERANK_SCORE    = -3.0  # cross-encoder threshold — drop docs below this
CHROMA_LOAD_BATCH   = 500   # batched read size to avoid SQLite variable-limit errors

from dotenv import load_dotenv
from openai import OpenAI

from langchain_chroma import Chroma
from langchain_community.retrievers import BM25Retriever
from langchain_core.documents import Document
from langchain_huggingface import HuggingFaceEmbeddings
from sentence_transformers import CrossEncoder

from prompts import SYSTEM_PROMPT

load_dotenv()

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHROMA_DIR   = os.environ.get("CHROMA_DIR", os.path.join(PROJECT_ROOT, "data", "chroma_unified"))

# ── Security: validate API key at startup (fail fast) ───────────────────────
_api_key = os.environ.get("TYPHOON_API_KEY", "").strip()
if not _api_key:
    raise EnvironmentError(
        "TYPHOON_API_KEY is not set. "
        "Create a .env file with TYPHOON_API_KEY=<your_key>."
    )

# ---------- Embedding + Vector DB ----------
logger.info("Loading embedding model (BAAI/bge-m3)...")
_emb = HuggingFaceEmbeddings(
    model_name="BAAI/bge-m3",
    encode_kwargs={"normalize_embeddings": True},
)
_db = Chroma(persist_directory=CHROMA_DIR, embedding_function=_emb)

# ---------- BM25 (keyword) retriever ----------
def _strip_context_prefix(text: str) -> str:
    """Remove the [law | section] prefix added during indexing for cleaner BM25 matching."""
    if text.startswith("[") and "]\n" in text[:200]:
        return text[text.index("]\n") + 2:]
    return text

def _load_all_docs() -> List[Document]:
    try:
        docs = []
        offset = 0

        # Read Chroma documents in pages; large unified corpora can exceed SQLite
        # variable limits when fetched in one call.
        while True:
            result = _db.get(
                include=["documents", "metadatas"],
                limit=CHROMA_LOAD_BATCH,
                offset=offset,
            )
            documents = result.get("documents") or []
            metadatas = result.get("metadatas") or []
            if not documents:
                break

            for content, meta in zip(documents, metadatas):
                # Use original text (without prefix) for BM25 keyword matching
                bm25_content = _strip_context_prefix(content)
                docs.append(Document(page_content=bm25_content, metadata=meta or {}))

            offset += len(documents)

        logger.info("Loaded %d documents from ChromaDB", len(docs))
        return docs
    except Exception as exc:
        logger.exception("Failed to load documents from ChromaDB: %s", exc)
        raise

_all_docs         = _load_all_docs()
_bm25_retriever   = BM25Retriever.from_documents(_all_docs, k=RETRIEVER_K)
_vector_retriever = _db.as_retriever(search_kwargs={"k": RETRIEVER_K})

# ---------- Cross-Encoder Reranker ----------
logger.info("Loading reranker (BAAI/bge-reranker-v2-m3)...")
_reranker = CrossEncoder("BAAI/bge-reranker-v2-m3")
logger.info("All models loaded — system ready.")

# ---------- Hybrid retrieval (BM25 + Vector via Reciprocal Rank Fusion) ----------

def _hybrid_retrieve(query: str, k: int = 25) -> List[Document]:
    """Merge BM25 and vector results using Reciprocal Rank Fusion (RRF)."""
    bm25_docs   = _bm25_retriever.invoke(query)
    vector_docs = _vector_retriever.invoke(query)

    # RRF score: 1/(rank + 60) — higher is better
    rrf_scores: dict[str, float] = {}
    doc_map:    dict[str, Document] = {}

    def _key(d: Document) -> str:
        return d.metadata.get("law", "") + "||" + d.metadata.get("section", "")

    for rank, doc in enumerate(bm25_docs):
        dk = _key(doc)
        rrf_scores[dk] = rrf_scores.get(dk, 0.0) + 0.4 / (rank + 60)
        doc_map[dk] = doc
    for rank, doc in enumerate(vector_docs):
        dk = _key(doc)
        rrf_scores[dk] = rrf_scores.get(dk, 0.0) + 0.6 / (rank + 60)
        doc_map[dk] = doc

    ranked = sorted(rrf_scores.items(), key=lambda x: x[1], reverse=True)
    return [doc_map[dk] for dk, _ in ranked[:k]]


# ---------- Query classification ----------

CATEGORY_KEYWORDS = {
    "แรงงาน": ["นายจ้าง", "ลูกจ้าง", "เลิกจ้าง", "ค่าจ้าง", "โอที", "ล่วงเวลา", "ค่าชดเชย",
                "สัญญาจ้าง", "ทดลองงาน", "ลาคลอด", "ลาป่วย", "วันหยุด", "แรงงาน", "ประกันสังคม",
                "ลาบวช", "ทำงาน", "เงินเดือน", "สวัสดิการ", "พักงาน", "ลาออก", "เกษียณ"],
    "ผู้บริโภค": ["ผู้บริโภค", "สินค้า", "คืนสินค้า", "รับประกัน", "โฆษณา", "ขายออนไลน์",
                  "ร้านค้า", "สคบ", "หลอกลวง", "ของปลอม", "คุณภาพ", "บริการ", "ฟิตเนส",
                  "ขายตรง", "แชร์ลูกโซ่", "คอนโด", "บ้าน", "อาหารเสริม", "มะเร็ง"],
    "อาญา": ["ฉ้อโกง", "ยักยอก", "ลักทรัพย์", "ทำร้าย", "ขู่", "หมิ่นประมาท", "จับกุม",
             "ตำรวจ", "แก๊งคอลเซ็นเตอร์", "หลอกโอนเงิน", "คดีอาญา", "โดนหลอก",
             "โอนเงิน", "โซเชียล", "คอลเซ็นเตอร์", "แจ้งความ"],
    "แพ่ง": ["สัญญา", "ละเมิด", "ค้ำประกัน", "กู้ยืม", "ดอกเบี้ย", "หนี้", "เช่า", "มัดจำ",
             "ที่ดิน", "มรดก", "พินัยกรรม", "หย่า", "สินสมรส", "รถชน", "นอกระบบ",
             "ห้องเช่า", "ผู้ให้เช่า", "สัตว์", "กัดคน", "สุนัข", "ค่าเลี้ยงดู", "บุตร",
             "หลักฐานในศาล", "แชทไลน์", "ไล่ออกจากห้อง"],
    "PDPA": ["ข้อมูลส่วนบุคคล", "PDPA", "ความเป็นส่วนตัว", "ข้อมูลรั่ว", "ความยินยอม",
             "ข้อมูลสุขภาพ", "เปิดเผยข้อมูล", "เก็บข้อมูล"],
}

def _classify_query(question: str) -> str:
    """Classify query into a legal category for targeted retrieval."""
    q = question.lower()
    scores: dict[str, int] = {}
    for cat, keywords in CATEGORY_KEYWORDS.items():
        scores[cat] = sum(1 for k in keywords if k.lower() in q)
    best = max(scores, key=lambda k: scores[k])
    return best if scores[best] > 0 else "ทั่วไป"


# ---------- Typhoon API client ----------
_client = OpenAI(
    api_key=os.environ.get("TYPHOON_API_KEY", ""),
    base_url="https://api.opentyphoon.ai/v1",
)
TYPHOON_MODEL = "typhoon-v2.5-30b-a3b-instruct"


# ---------- Helpers ----------

def _citations_markdown(docs) -> str:
    seen, lines = set(), []
    for d in docs:
        law = d.metadata.get("law", "").strip()
        sec = d.metadata.get("section", "").strip()
        url = d.metadata.get("url", "").strip()
        cat = d.metadata.get("category", "").strip()
        key = (law, sec)
        if key in seen:
            continue
        seen.add(key)
        prefix = ""
        if cat == "คำพิพากษา":
            prefix = "⚖️ "
        elif cat == "กรณีร้องเรียน":
            prefix = "📋 "
        elif cat == "คู่มือปฏิบัติ":
            prefix = "📖 "
        elif cat == "คำถามที่พบบ่อย":
            prefix = "❓ "
        lines.append(f"- {prefix}[{law} {sec}]({url})" if url else f"- {prefix}{law} {sec}")
    return "\n".join(lines) or "- (ไม่พบแหล่งอ้างอิง)"


def _classify_domain(question: str, context: str = "") -> str:
    """Classify domain primarily from the question, using context only as tiebreaker."""
    q = question.lower()
    # Question-based classification (weighted 3x)
    q_result = _classify_query(q)
    if q_result != "ทั่วไป":
        return q_result
    # Fallback: classify from context with broader keywords
    t = (q + " " + context).lower()
    labor = sum(k in t for k in ["นายจ้าง","ลูกจ้าง","ค่าจ้าง","โอที","เลิกจ้าง","วันหยุด",
                                  "สัญญาจ้าง","ทดลองงาน","ชดเชย","แรงงาน","ลาคลอด","ลาป่วย",
                                  "ลาบวช","ประกันสังคม","เงินเดือน"])
    cons  = sum(k in t for k in ["ผู้บริโภค","โฆษณา","คืนสินค้า","รับประกัน","หลอกลวง",
                                  "บริการ","สินค้า","ขายตรง","ออนไลน์","สคบ"])
    crim  = sum(k in t for k in ["อาญา","จำคุก","ฉ้อโกง","ยักยอก","ลักทรัพย์","ตำรวจ",
                                  "หมิ่นประมาท","แก๊งคอลเซ็นเตอร์"])
    civil = sum(k in t for k in ["สัญญา","ละเมิด","ค้ำประกัน","กู้ยืม","เช่า","มรดก","หย่า","ที่ดิน",
                                  "ดอกเบี้ย","หนี้","มัดจำ","สินสมรส","บุตร","รถชน","สัตว์","กัด"])
    pdpa  = sum(k in t for k in ["ข้อมูลส่วนบุคคล","pdpa","ความยินยอม","ข้อมูลรั่ว","ข้อมูลสุขภาพ","เปิดเผยข้อมูล"])
    
    scores: dict[str, int] = {"แรงงาน": labor, "ผู้บริโภค": cons, "อาญา": crim, "แพ่ง": civil, "PDPA": pdpa}
    best = max(scores, key=lambda k: scores[k])
    return best if scores[best] > 0 else "ทั่วไป"


def _risk_level(question: str) -> str:
    q = question.lower()
    if any(k in q for k in ["ฟ้อง","ศาล","อาญา","คดี","หมายเรียก","ตำรวจ","ฉ้อโกง","ยักยอก",
                             "จับกุม","แก๊ง","คอลเซ็นเตอร์","โดนหลอก","โดนโกง", "ทำร้าย"]):
        return "🔴 สูง — ควรปรึกษาทนายความ"
    if any(k in q for k in ["เลิกจ้าง","ค่าชดเชย","ค่าเสียหาย","ร้องเรียน","บอกเลิก",
                             "ผิดสัญญา","ไกล่เกลี่ย","ข้อมูลรั่ว","ไล่ออก","หักเงิน"]):
        return "🟡 กลาง — ควรเตรียมหลักฐาน"
    return "🟢 ต่ำ — ข้อมูลทั่วไป"


def _sanitize_input(text: str) -> str:
    """Trim and enforce max length to guard against prompt injection / runaway costs."""
    text = text.strip()
    if len(text) > MAX_QUESTION_LENGTH:
        logger.warning("Input truncated from %d to %d chars", len(text), MAX_QUESTION_LENGTH)
        text = text[:MAX_QUESTION_LENGTH]
    return text


def _is_smalltalk_only(question: str) -> bool:
    q = question.strip().lower()
    if not q:
        return False

    legal_hints = [
        "มาตรา", "กฎหมาย", "ฟ้อง", "ศาล", "คดี", "เลิกจ้าง", "ค่าชดเชย", "สัญญา",
        "ตำรวจ", "ฉ้อโกง", "ผู้บริโภค", "pdpa", "ภาษี", "ประกันสังคม", "สิทธิ",
    ]
    if any(h in q for h in legal_hints):
        return False

    greeting_words = [
        "สวัสดี", "หวัดดี", "ดีครับ", "ดีค่ะ", "hello", "hi", "hey",
        "ทดสอบ", "test", "โย่ว", "yo", "เป็นไง", "เป็นไงบ้าง",
    ]
    if any(w in q for w in greeting_words):
        # Only treat as smalltalk when message is short and not a real question.
        return len(q) <= 40 and "?" not in q and "ไหม" not in q

    return False


def _smalltalk_response() -> tuple[str, str, str, str]:
    return (
        "สวัสดีครับ ยินดีช่วยเรื่องกฎหมายไทยครับ ถ้าพร้อมแล้วพิมพ์คำถามได้เลย เช่น \"ถูกเลิกจ้างไม่แจ้งล่วงหน้า ได้อะไรบ้าง\"",
        "- (ยังไม่มีการอ้างอิงกฎหมาย เพราะยังไม่มีคำถามทางกฎหมาย)",
        "ทั่วไป",
        "🟢 ต่ำ — ข้อมูลทั่วไป",
    )


def _build_messages(question: str, context: str, history: List[Tuple[str, str]]) -> list:
    """Build OpenAI messages list with chat history and RAG context."""
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    for user_msg, assistant_msg in history[-MAX_HISTORY_TURNS:]:
        messages.append({"role": "user",      "content": user_msg})
        messages.append({"role": "assistant", "content": assistant_msg})
    user_content = (
        f"บริบทกฎหมายที่เกี่ยวข้อง (จัดกลุ่มตามประเภท):\n{context}\n\n"
        f"คำถาม: {question}\n\n"
        f"โปรดวิเคราะห์บริบทด้านบนอย่างละเอียด แล้วตอบตามรูปแบบที่กำหนด"
    )
    messages.append({"role": "user", "content": user_content})
    return messages


# ---------- History-aware query rewriting ----------

def _rewrite_with_history(question: str, history: List[Tuple[str, str]]) -> str:
    """Rewrite a follow-up question into a standalone query using chat history."""
    if not history:
        return question
    try:
        hist_text = ""
        for u, a in history[-3:]:
            hist_text += f"ผู้ใช้: {u[:200]}\nระบบ: {a[:200]}\n"
        r = _client.chat.completions.create(
            model=TYPHOON_MODEL,
            messages=[
                {"role": "system",
                 "content": "จากประวัติการสนทนาและคำถามล่าสุด ให้เขียนคำถามใหม่เป็นคำถามเดียวที่สมบูรณ์ในตัวเอง "
                            "ไม่ต้องอ้างอิงบทสนทนาก่อนหน้า ถ้าคำถามสมบูรณ์อยู่แล้วให้ตอบคำถามเดิม "
                            "ตอบเฉพาะคำถามที่เขียนใหม่เท่านั้น ไม่ต้องอธิบายเพิ่ม"},
                {"role": "user",
                 "content": f"ประวัติสนทนา:\n{hist_text}\nคำถามล่าสุด: {question}"},
            ],
            temperature=0.1,
            max_tokens=300,
            timeout=10,
        )
        rewritten = (r.choices[0].message.content or "").strip()
        if rewritten and len(rewritten) < MAX_QUESTION_LENGTH:
            logger.info("Query rewritten: '%s' → '%s'", question[:60], rewritten[:60])
            return rewritten
    except Exception as exc:
        logger.warning("Query rewriting failed (using original): %s", exc)
    return question


# ---------- Multi-query expansion (improved) ----------

def _expand_queries(question: str, category: str) -> List[str]:
    """Use LLM to generate 3 alternative search queries with category context."""
    try:
        r = _client.chat.completions.create(
            model=TYPHOON_MODEL,
            messages=[
                {"role": "system",
                 "content": f"สร้างคำค้นหา 3 รูปแบบที่แตกต่างกัน สำหรับคำถามกฎหมายไทยหมวด '{category}' "
                            "คำค้นที่ 1: เน้นมาตรากฎหมายที่เกี่ยวข้อง "
                            "คำค้นที่ 2: เน้น keyword สำคัญในเชิงปฏิบัติ "
                            "คำค้นที่ 3: เน้นค้นหาคำพิพากษาศาลฎีกาหรือเคสจริง "
                            "ตอบเป็น JSON array เท่านั้น เช่น [\"คำค้น 1\", \"คำค้น 2\", \"คำค้น 3\"]"},
                {"role": "user", "content": f"คำถาม: {question}"},
            ],
            temperature=0.3,
            max_tokens=600,
            timeout=10,
        )
        text = (r.choices[0].message.content or "").strip()
        m = re.search(r'\[.*?\]', text, re.DOTALL)
        if m:
            extras = json.loads(m.group())
            valid = [str(q)[:MAX_QUESTION_LENGTH] for q in extras[:3] if str(q).strip()]
            logger.info("Multi-query expanded: %d alternatives", len(valid))
            return [question] + valid
    except Exception as exc:
        logger.warning("Multi-query expansion failed (using original): %s", exc)
    return [question]


# ---------- Context compression ----------

def _compress_context(question: str, doc: Document) -> str:
    """Extract only the relevant portion of a document for the given question."""
    content = doc.page_content
    if len(content) <= 400:
        return content
    
    # For court cases, always keep full content (they're already focused)
    cat = doc.metadata.get("category", "")
    if cat in ("คำพิพากษา", "กรณีร้องเรียน", "คำถามที่พบบ่อย"):
        return content[:1000]
    
    # For long law text, keep most relevant sentences
    sentences = re.split(r'(?<=[.。])\s+', content)
    if len(sentences) <= 3:
        return content[:800]
    
    # Score sentences by keyword overlap with question
    q_words = set(question.lower().split())
    scored = []
    for i, sent in enumerate(sentences):
        s_words = set(sent.lower().split())
        overlap = len(q_words & s_words)
        # Boost first and last sentences
        boost = 2 if i == 0 or i == len(sentences) - 1 else 0
        scored.append((overlap + boost, i, sent))
    
    scored.sort(key=lambda x: x[0], reverse=True)
    # Keep top sentences in original order
    selected = sorted(scored[:5], key=lambda x: x[1])
    return " ".join(s[2] for s in selected)[:800]


# ---------- Public API ----------

def get_context_and_meta(question: str, history: List[Tuple[str, str]] | None = None):
    """Hybrid-retrieve → rerank → compress → return (context_str, citations_md, domain, risk)."""
    question = _sanitize_input(question)
    if not question:
        return "", "- (ไม่มีคำถาม)", "ทั่วไป", "🟢 ต่ำ — ข้อมูลทั่วไป"

    # Rewrite follow-up questions using conversation history
    search_query = _rewrite_with_history(question, history or [])

    logger.info("Query: %s", search_query[:80])

    # Step 0: Classify query for targeted retrieval
    query_category = _classify_query(search_query)
    logger.info("Query category: %s", query_category)

    # Step 1: Multi-query expansion (category-aware)
    queries = _expand_queries(search_query, query_category)

    # Step 2: Hybrid retrieval for each query, deduplicate by (law, section)
    seen_keys: dict[tuple, Document] = {}
    for q in queries:
        for doc in _hybrid_retrieve(q):
            key = (
                doc.metadata.get("law", ""),
                doc.metadata.get("section", ""),
            )
            if key not in seen_keys:
                seen_keys[key] = doc

    candidates = list(seen_keys.values())
    logger.info("Candidates before reranking: %d", len(candidates))

    # Step 3: Rerank with cross-encoder + score threshold gating
    if len(candidates) > 1:
        pairs  = [(search_query, d.page_content) for d in candidates]
        scores = _reranker.predict(pairs)
        ranked = sorted(zip(scores, candidates), key=lambda x: x[0], reverse=True)

        # Filter out low-relevance docs (score threshold gating)
        ranked = [(s, d) for s, d in ranked if s >= MIN_RERANK_SCORE]
        if not ranked:
            ranked = sorted(zip(scores, candidates), key=lambda x: x[0], reverse=True)[:3]
        
        logger.info("Rerank scores: top=%.2f, bottom=%.2f, kept=%d",
                    ranked[0][0] if ranked else 0, ranked[-1][0] if ranked else 0, len(ranked))

        # Step 3.5: Ensure diversity — include at least 1 court case + 1 law article + 1 guide
        top_docs = []
        has_case = False
        has_law = False
        has_guide = False
        
        for score, doc in ranked:
            cat = doc.metadata.get("category", "")
            if len(top_docs) < TOP_K_RERANK:
                top_docs.append(doc)
                if cat == "คำพิพากษา" or cat == "กรณีร้องเรียน":
                    has_case = True
                elif cat in ("แรงงาน", "ผู้บริโภค", "อาญา", "แพ่ง", "PDPA", "ไซเบอร์", "ทั่วไป"):
                    has_law = True
                elif cat in ("คู่มือปฏิบัติ", "คำถามที่พบบ่อย"):
                    has_guide = True
        
        # Fill missing categories if available
        for score, doc in ranked[TOP_K_RERANK:]:
            cat = doc.metadata.get("category", "")
            if not has_case and (cat == "คำพิพากษา" or cat == "กรณีร้องเรียน"):
                top_docs.append(doc)
                has_case = True
            elif not has_guide and cat in ("คู่มือปฏิบัติ", "คำถามที่พบบ่อย"):
                top_docs.append(doc)
                has_guide = True
            if has_case and has_guide:
                break
    else:
        top_docs = candidates[:TOP_K_RERANK]

    # Step 4: Context compression + structured grouping
    law_parts = []
    case_parts = []
    guide_parts = []
    for doc in top_docs:
        compressed = _compress_context(search_query, doc)
        law = doc.metadata.get("law", "")
        sec = doc.metadata.get("section", "")
        cat = doc.metadata.get("category", "")
        entry = f"[{law} {sec}]\n{compressed}"
        if cat in ("คำพิพากษา", "กรณีร้องเรียน"):
            case_parts.append(entry)
        elif cat in ("คู่มือปฏิบัติ", "คำถามที่พบบ่อย"):
            guide_parts.append(entry)
        else:
            law_parts.append(entry)

    # Build structured context: laws first, then cases, then guides
    sections = []
    if law_parts:
        sections.append("== บทบัญญัติกฎหมาย ==\n" + "\n\n".join(law_parts))
    if case_parts:
        sections.append("== คำพิพากษา/กรณีร้องเรียน ==\n" + "\n\n".join(case_parts))
    if guide_parts:
        sections.append("== คู่มือปฏิบัติ/คำถามที่พบบ่อย ==\n" + "\n\n".join(guide_parts))
    context = "\n\n".join(sections)
    citations_md = _citations_markdown(top_docs)
    domain       = _classify_domain(question, context)
    risk         = _risk_level(question)
    
    logger.info("Context: %d chars from %d docs | Domain: %s | Risk: %s",
                len(context), len(top_docs), domain, risk)
    return context, citations_md, domain, risk


def retrieve_docs(question: str) -> List[Document]:
    """Return the final reranked docs for a question (for retrieval evaluation)."""
    question = _sanitize_input(question)
    if not question:
        return []

    query_category = _classify_query(question)
    queries = _expand_queries(question, query_category)

    seen_keys: dict[tuple, Document] = {}
    for q in queries:
        for doc in _hybrid_retrieve(q):
            key = (doc.metadata.get("law", ""), doc.metadata.get("section", ""))
            if key not in seen_keys:
                seen_keys[key] = doc

    candidates = list(seen_keys.values())
    if len(candidates) <= 1:
        return candidates

    pairs = [(question, d.page_content) for d in candidates]
    scores = _reranker.predict(pairs)
    ranked = sorted(zip(scores, candidates), key=lambda x: x[0], reverse=True)
    return [doc for _, doc in ranked[:TOP_K_RERANK]]


def stream_answer(
    question: str,
    history: List[Tuple[str, str]],
) -> Generator[Tuple[str, str, str, str], None, None]:
    """
    Yields (partial_answer, citations_md, domain, risk) incrementally.
    `history` is a list of (user, assistant) string tuples — previous turns.
    """
    question = _sanitize_input(question)
    if not question:
        yield "กรุณาพิมพ์คำถาม", "- (ไม่มีคำถาม)", "ทั่วไป", "🟢 ต่ำ"
        return

    if _is_smalltalk_only(question):
        answer, citations_md, domain, risk = _smalltalk_response()
        yield answer, citations_md, domain, risk
        return

    context, citations_md, domain, risk = get_context_and_meta(question, history)
    messages = _build_messages(question, context, history)

    try:
        response = _client.chat.completions.create(
            model=TYPHOON_MODEL,
            messages=messages,
            temperature=0.1,
            top_p=0.9,
            frequency_penalty=0.1,
            max_tokens=16000,  # Typhoon counts prompt+output together; 16000 = model context window
            stream=True,
        )

        partial = ""
        for chunk in response:
            delta = chunk.choices[0].delta.content or ""
            partial += delta
            yield partial, citations_md, domain, risk

    except Exception as exc:
        logger.exception("LLM API error: %s", exc)
        yield (
            "❌ เกิดข้อผิดพลาดในการเชื่อมต่อ API กรุณาลองใหม่อีกครั้ง",
            citations_md, domain, risk,
        )


def answer_question(
    question: str,
    history: List[Tuple[str, str]] | None = None,
) -> Tuple[str, str, str, str]:
    """Non-streaming version — returns (answer, citations_md, domain, risk)."""
    history = history or []
    question = _sanitize_input(question)
    if not question:
        return "กรุณาพิมพ์คำถาม", "- (ไม่มีคำถาม)", "ทั่วไป", "🟢 ต่ำ"

    if _is_smalltalk_only(question):
        return _smalltalk_response()

    context, citations_md, domain, risk = get_context_and_meta(question, history)
    messages = _build_messages(question, context, history)

    try:
        response = _client.chat.completions.create(
            model=TYPHOON_MODEL,
            messages=messages,
            temperature=0.1,
            top_p=0.9,
            frequency_penalty=0.1,
            max_tokens=16000,
            stream=False,
            timeout=120,
        )
        answer = (response.choices[0].message.content or "").strip()
        return answer, citations_md, domain, risk
    except Exception as exc:
        logger.exception("LLM API error: %s", exc)
        return (
            "❌ เกิดข้อผิดพลาดในการเชื่อมต่อ API กรุณาลองใหม่อีกครั้ง",
            citations_md, domain, risk,
        )