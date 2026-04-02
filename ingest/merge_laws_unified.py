import argparse
import json
import os
from typing import Any, Dict, Iterable, List


PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_LOCAL = os.path.join(PROJECT_ROOT, "ingest", "laws.json")
DEFAULT_OPENLAW = os.path.join(PROJECT_ROOT, "ingest", "laws_openlaw_relevant.json")
DEFAULT_OUTPUT = os.path.join(PROJECT_ROOT, "ingest", "laws_unified.json")

UNIFIED_KEYS = [
    "law",
    "section",
    "text",
    "url",
    "source",
    "publish_date",
    "category_hint",
    "law_code",
    "timeline_code",
    "is_latest",
]


def _load_rows(path: str) -> List[Dict[str, Any]]:
    if not os.path.exists(path):
        return []
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, list):
        return []
    return [row for row in data if isinstance(row, dict)]


def _normalize_row(row: Dict[str, Any], default_source: str) -> Dict[str, Any]:
    out: Dict[str, Any] = {
        "law": str(row.get("law", "") or "").strip(),
        "section": str(row.get("section", "") or "").strip(),
        "text": str(row.get("text", "") or "").strip(),
        "url": str(row.get("url", "") or "").strip(),
        "source": str(row.get("source", "") or default_source).strip(),
        "publish_date": str(row.get("publish_date", "") or "").strip(),
        "category_hint": str(row.get("category_hint", "") or "").strip(),
        "law_code": str(row.get("law_code", "") or "").strip(),
        "timeline_code": str(row.get("timeline_code", "") or "").strip(),
        "is_latest": bool(row.get("is_latest", False)),
    }
    return out


def _iter_merged(local_rows: Iterable[Dict[str, Any]], openlaw_rows: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    merged: List[Dict[str, Any]] = []
    for row in local_rows:
        normalized = _normalize_row(row, default_source="local-laws")
        if normalized["law"] and normalized["text"]:
            merged.append(normalized)
    for row in openlaw_rows:
        normalized = _normalize_row(row, default_source="openlaw-ocs-krisdika")
        if normalized["law"] and normalized["text"]:
            merged.append(normalized)
    return merged


def main() -> None:
    parser = argparse.ArgumentParser(description="Merge local laws + OpenLaw into a single unified JSON file")
    parser.add_argument("--local", default=DEFAULT_LOCAL, help="Path to local laws JSON")
    parser.add_argument("--openlaw", default=DEFAULT_OPENLAW, help="Path to OpenLaw JSON")
    parser.add_argument("--output", default=DEFAULT_OUTPUT, help="Unified output JSON path")
    args = parser.parse_args()

    local_rows = _load_rows(args.local)
    openlaw_rows = _load_rows(args.openlaw)
    merged_rows = _iter_merged(local_rows, openlaw_rows)

    os.makedirs(os.path.dirname(args.output), exist_ok=True)
    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(merged_rows, f, ensure_ascii=False, indent=2)

    print(f"Unified rows: {len(merged_rows)}")
    print(f"Keys: {UNIFIED_KEYS}")
    print(f"Output: {args.output}")


if __name__ == "__main__":
    main()
