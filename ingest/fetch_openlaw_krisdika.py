import argparse
import json
import os
from glob import glob
from typing import Any, Dict, Iterator, List

from huggingface_hub import snapshot_download


PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_OUTPUT = os.path.join(PROJECT_ROOT, "ingest", "laws_openlaw_krisdika.json")

RELEVANCE_KEYWORDS = [
    "แรงงาน", "ลูกจ้าง", "นายจ้าง", "ค่าจ้าง", "เลิกจ้าง", "ประกันสังคม",
    "ผู้บริโภค", "ขายตรง", "โฆษณา", "สคบ", "คืนสินค้า", "คุ้มครองผู้บริโภค",
    "ข้อมูลส่วนบุคคล", "pdpa", "คอมพิวเตอร์", "ออนไลน์", "ฉ้อโกง", "ไซเบอร์",
    "สัญญา", "เช่า", "มัดจำ", "หนี้", "ดอกเบี้ย", "ค้ำประกัน",
]


def _clean_text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _iter_hf_records() -> Iterator[Dict[str, Any]]:
    snapshot_dir = snapshot_download(
        repo_id="open-law-data-thailand/ocs-krisdika",
        repo_type="dataset",
        allow_patterns=["data/**/*.jsonl"],
    )

    pattern = os.path.join(snapshot_dir, "data", "**", "*.jsonl")
    for path in sorted(glob(pattern, recursive=True)):
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    rec = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if isinstance(rec, dict):
                    yield rec


def _normalize_rows(records: Iterator[Dict[str, Any]], latest_only: bool, max_rows: int) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []

    for rec in records:
        if latest_only and not bool(rec.get("is_latest", False)):
            continue

        law_title = _clean_text(rec.get("title"))
        if not law_title:
            continue

        ref_url = _clean_text(rec.get("reference_url"))
        publish_date = _clean_text(rec.get("publish_date"))
        category = _clean_text(rec.get("category"))
        law_code = _clean_text(rec.get("law_code"))
        timeline_code = _clean_text(rec.get("timeline_code"))

        sections = rec.get("sections") or []
        if not isinstance(sections, list):
            continue

        for idx, sec in enumerate(sections):
            if not isinstance(sec, dict):
                continue
            content = _clean_text(sec.get("content"))
            if not content:
                continue

            section_id = sec.get("sectionId")
            if section_id is None or str(section_id).strip() == "":
                section_name = f"ส่วน {idx + 1}"
            else:
                section_name = f"มาตรา {section_id}"

            out.append(
                {
                    "law": law_title,
                    "section": section_name,
                    "text": content,
                    "url": ref_url,
                    "source": "openlaw-ocs-krisdika",
                    "publish_date": publish_date,
                    "category_hint": category,
                    "law_code": law_code,
                    "timeline_code": timeline_code,
                    "is_latest": bool(rec.get("is_latest", False)),
                }
            )

            if max_rows > 0 and len(out) >= max_rows:
                return out

    return out


def _is_relevant_record(rec: Dict[str, Any]) -> bool:
    title = _clean_text(rec.get("title")).lower()
    category = _clean_text(rec.get("category")).lower()
    sections = rec.get("sections") or []

    section_text = ""
    if isinstance(sections, list):
        # Use only early sections for speed while still capturing topic intent.
        for sec in sections[:5]:
            if not isinstance(sec, dict):
                continue
            content = _clean_text(sec.get("content"))
            if content:
                section_text += " " + content.lower()

    haystack = f"{title} {category} {section_text}"
    return any(kw in haystack for kw in RELEVANCE_KEYWORDS)


def main() -> None:
    parser = argparse.ArgumentParser(description="Fetch OpenLaw OCS Krisdika and convert to laws JSON format")
    parser.add_argument("--output", default=DEFAULT_OUTPUT, help="Output JSON path")
    parser.add_argument("--max-rows", type=int, default=8000, help="Max section rows to export (0 = unlimited)")
    parser.add_argument("--latest-only", action="store_true", help="Keep only latest law versions")
    parser.add_argument("--relevant-only", action="store_true", help="Keep only rows relevant to chatbot domains")
    args = parser.parse_args()

    records_iter = _iter_hf_records()
    if args.relevant_only:
        records = (rec for rec in records_iter if _is_relevant_record(rec))
    else:
        records = records_iter

    rows = _normalize_rows(records, latest_only=args.latest_only, max_rows=args.max_rows)
    os.makedirs(os.path.dirname(args.output), exist_ok=True)

    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False, indent=2)

    print(f"Exported {len(rows)} rows to {args.output}")


if __name__ == "__main__":
    main()
