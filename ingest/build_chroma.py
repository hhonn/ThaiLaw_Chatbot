import argparse
import json
import logging
import os
import re
import shutil
from typing import List

from langchain_chroma import Chroma
from langchain_core.documents import Document
from langchain_huggingface import HuggingFaceEmbeddings

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_LAWS_PATH = os.path.join(PROJECT_ROOT, "ingest", "laws_unified.json")
DEFAULT_OPENLAW_PATH = os.path.join(PROJECT_ROOT, "ingest", "laws_openlaw_relevant.json")
DEFAULT_CHROMA_DIR = os.path.join(PROJECT_ROOT, "data", "chroma_unified")

EMBEDDING_MODEL = "BAAI/bge-m3"  # must match rag_chain.py

# Chunking parameters
MAX_CHUNK_SIZE = 600   # chars — optimal for embedding quality
CHUNK_OVERLAP  = 100   # chars overlap between chunks


def _classify_category(law: str, text: str) -> str:
    # Auto-classify document into a category for metadata filtering.
    law_lower = law.lower()
    text_lower = text.lower()
    
    if "คำพิพากษา" in law or "ฎีกา" in law:
        return "คำพิพากษา"
    if "ร้องเรียน" in law or "สคบ" in law:
        return "กรณีร้องเรียน"
    if "คู่มือ" in law or "ปฏิบัติ" in law:
        return "คู่มือปฏิบัติ"
    if "คำถาม" in law or "FAQ" in law_lower:
        return "คำถามที่พบบ่อย"
    if any(k in law_lower for k in ["แรงงาน", "คุ้มครองแรงงาน", "ประกันสังคม", "เงินทดแทน"]):
        return "แรงงาน"
    if any(k in law_lower for k in ["ผู้บริโภค", "ขายตรง"]):
        return "ผู้บริโภค"
    if any(k in law_lower for k in ["ข้อมูลส่วนบุคคล", "pdpa"]):
        return "PDPA"
    if "อาญา" in law_lower:
        return "อาญา"
    if "แพ่ง" in law_lower:
        return "แพ่ง"
    if "คอมพิวเตอร์" in law_lower:
        return "ไซเบอร์"
    
    # Fallback: classify by content
    if any(k in text_lower for k in ["นายจ้าง", "ลูกจ้าง", "ค่าจ้าง", "เลิกจ้าง"]):
        return "แรงงาน"
    if any(k in text_lower for k in ["ผู้บริโภค", "สินค้า", "โฆษณา"]):
        return "ผู้บริโภค"
    return "ทั่วไป"


def _extract_keywords(text: str) -> str:
    """Extract key legal terms from text for enhanced search."""
    keywords = []
    keyword_patterns = [
        "ค่าชดเชย", "เลิกจ้าง", "ค่าล่วงเวลา", "โอที", "OT",
        "ลาคลอด", "ลาป่วย", "ลาบวช", "ลาอุปสมบท", "วันหยุด",
        "ทดลองงาน", "สัญญาจ้าง", "ค่าจ้าง", "เงินเดือน",
        "ผู้บริโภค", "คืนสินค้า", "โฆษณา", "รับประกัน",
        "ฉ้อโกง", "ยักยอก", "หมิ่นประมาท", "ละเมิด",
        "ฎีกา", "ศาลฎีกา", "คำพิพากษา",
        "ประกันสังคม", "เงินทดแทน", "ว่างงาน", "ทุพพลภาพ",
        "PDPA", "ข้อมูลส่วนบุคคล", "ข้อมูลอ่อนไหว",
        "ดอกเบี้ย", "กู้ยืม", "หนี้", "ค้ำประกัน",
        "คอนโด", "เช่า", "มัดจำ", "ที่ดิน",
        "หย่า", "สินสมรส", "อำนาจปกครอง", "มรดก",
        "ออนไลน์", "คอลเซ็นเตอร์", "แก๊ง",
        "ขายตรง", "แชร์ลูกโซ่", "บัตรเครดิต",
        "ลิขสิทธิ์", "เครื่องหมายการค้า",
    ]
    for kw in keyword_patterns:
        if kw.lower() in text.lower():
            keywords.append(kw)
    return ", ".join(keywords[:10])  # top 10 keywords


def _smart_chunk(text: str, max_size: int = MAX_CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> List[str]:
    # Split long text into overlapping chunks at natural boundaries.
    if len(text) <= max_size:
        return [text]
    
    # Try splitting at numbered items, paragraphs, or sentences
    chunks = []
    current_pos = 0
    
    while current_pos < len(text):
        end_pos = min(current_pos + max_size, len(text))
        
        if end_pos >= len(text):
            chunks.append(text[current_pos:])
            break
        
        # Find best split point (prefer numbered lists, then periods, then spaces)
        best_split = end_pos
        search_start = max(current_pos + max_size // 2, current_pos + 50)
        
        # Try to split at numbered items (e.g., "2)", "3.")
        for i in range(end_pos, search_start, -1):
            if i < len(text) and re.match(r'\s*\d+[).]\s', text[i:i+5]):
                best_split = i
                break
        else:
            # Try to split at sentence boundaries
            for i in range(end_pos, search_start, -1):
                if text[i-1] in '.。\n' or text[i-1:i+1] == ' |':
                    best_split = i
                    break
            else:
                # Split at space
                for i in range(end_pos, search_start, -1):
                    if text[i] == ' ':
                        best_split = i + 1
                        break
        
        chunks.append(text[current_pos:best_split])
        current_pos = max(best_split - overlap, current_pos + 1)
    
    return chunks


def main() -> None:
    parser = argparse.ArgumentParser(description="Build Chroma index from local laws and optional OpenLaw rows")
    parser.add_argument(
        "--persist-dir",
        default=os.environ.get("CHROMA_DIR", DEFAULT_CHROMA_DIR),
        help="Target Chroma persist directory (default: env CHROMA_DIR or data/chroma)",
    )
    parser.add_argument(
        "--laws-path",
        default=os.environ.get("LAWS_PATH", DEFAULT_LAWS_PATH),
        help="Base laws JSON path (default: env LAWS_PATH or ingest/laws.json)",
    )
    parser.add_argument(
        "--openlaw-path",
        default=os.environ.get("OPENLAW_PATH", DEFAULT_OPENLAW_PATH),
        help="OpenLaw JSON path when INCLUDE_OPENLAW=1",
    )
    args = parser.parse_args()
    chroma_dir = args.persist_dir
    openlaw_path = args.openlaw_path
    laws_path = args.laws_path

    if not os.path.exists(laws_path):
        raise FileNotFoundError(f"laws json not found at {laws_path}")

    # Remove old index
    if os.path.exists(chroma_dir):
        shutil.rmtree(chroma_dir)
        logger.info("Removed old ChromaDB at %s", chroma_dir)

    with open(laws_path, encoding="utf-8") as f:
        laws = json.load(f)

    include_openlaw = os.environ.get("INCLUDE_OPENLAW", "0").strip() == "1"
    has_openlaw_in_base = any(
        isinstance(row, dict) and str(row.get("source", "")).startswith("openlaw")
        for row in laws
    )
    if include_openlaw:
        if has_openlaw_in_base:
            logger.info("Base laws already contains OpenLaw rows; skipping extra merge")
        elif os.path.abspath(laws_path) == os.path.abspath(openlaw_path):
            logger.info("--laws-path and --openlaw-path are identical; skipping extra merge")
        else:
            if os.path.exists(openlaw_path):
                with open(openlaw_path, encoding="utf-8") as f:
                    openlaw_rows = json.load(f)
                if isinstance(openlaw_rows, list):
                    laws.extend(openlaw_rows)
                    logger.info("Merged OpenLaw rows: %d", len(openlaw_rows))
            else:
                logger.warning("INCLUDE_OPENLAW=1 but file not found: %s", openlaw_path)

    if not laws:
        raise ValueError("laws.json is empty")

    # Build documents with smart chunking and rich metadata
    docs: List[Document] = []
    skipped = 0
    chunked_count = 0
    
    for row in laws:
        text = row.get("text", "").strip()
        if not text:
            skipped += 1
            continue
        
        law = row.get("law", "")
        section = row.get("section", "")
        url = row.get("url", "")
        source = row.get("source", "local-laws")
        publish_date = row.get("publish_date", "")
        category_hint = row.get("category_hint", "")
        is_latest = bool(row.get("is_latest", False))
        category = _classify_category(law, text)
        if category_hint:
            category = str(category_hint)
        keywords = _extract_keywords(text)
        
        # Smart chunk long documents
        chunks = _smart_chunk(text)
        if len(chunks) > 1:
            chunked_count += 1
        
        for i, chunk in enumerate(chunks):
            chunk_section = f"{section} (ส่วน {i+1}/{len(chunks)})" if len(chunks) > 1 else section
            # Contextual enrichment: prepend law + section to chunk
            # so embeddings capture the legal context of each chunk
            context_prefix = f"[{law} | {chunk_section}]\n"
            enriched_content = context_prefix + chunk
            docs.append(Document(
                page_content=enriched_content,
                metadata={
                    "law":      law,
                    "section":  chunk_section,
                    "url":      url,
                    "category": category,
                    "keywords": keywords,
                    "chunk_id": i,
                    "total_chunks": len(chunks),
                    "source": source,
                    "publish_date": publish_date,
                    "is_latest": is_latest,
                },
            ))

    logger.info("Documents prepared: %d (from %d entries, %d chunked, %d skipped)",
                len(docs), len(laws), chunked_count, skipped)

    # Build vector index
    emb = HuggingFaceEmbeddings(
        model_name=EMBEDDING_MODEL,
        encode_kwargs={"normalize_embeddings": True},
    )

    # Index in batches to avoid memory issues
    BATCH_SIZE = 200
    db = None
    for start in range(0, len(docs), BATCH_SIZE):
        batch = docs[start:start + BATCH_SIZE]
        if db is None:
            db = Chroma.from_documents(
                documents=batch,
                embedding=emb,
                persist_directory=chroma_dir,
            )
        else:
            db.add_documents(batch)
        logger.info("  Indexed batch %d-%d / %d", start, min(start + BATCH_SIZE, len(docs)), len(docs))

    logger.info("✅ Built ChromaDB at: %s", chroma_dir)
    logger.info("✅ Documents indexed: %d", len(docs))

if __name__ == "__main__":
    main()