"""Map experimental/instrument errors to verified fixes.

Matching combines exact error-code hits (strongest signal) with keyword overlap
against each entry's curated keyword list and symptom text. Only entries marked
``verified`` are returned as fixes; unverified ones are surfaced separately so
the UI can label them.
"""
from __future__ import annotations

import re
import sqlite3
from typing import Any

from ..rag.embeddings import tokenize

ERROR_CODE = re.compile(r"\b([A-Z]{1,4})[- ]?(\d{2,4})\b")


def extract_error_codes(text: str) -> list[str]:
    return sorted({f"{a}-{b}" for a, b in ERROR_CODE.findall((text or "").upper())})


def _normalise_code(code: str | None) -> str | None:
    if not code:
        return None
    m = ERROR_CODE.search(code.upper())
    return f"{m.group(1)}-{m.group(2)}" if m else code.upper()


def match(conn: sqlite3.Connection, query: str, limit: int = 5, include_unverified: bool = False) -> list[dict[str, Any]]:
    codes = set(extract_error_codes(query))
    q_terms = set(tokenize(query))
    results = []
    sql = "SELECT * FROM troubleshooting" + ("" if include_unverified else " WHERE verified = 1")
    for row in conn.execute(sql):
        entry = dict(row)
        score = 0.0
        reasons = []
        if codes and _normalise_code(entry["error_code"]) in codes:
            score += 1.0
            reasons.append(f"error code {entry['error_code']}")
        kw_terms = set(tokenize(entry["keywords"].replace(",", " ")))
        symptom_terms = set(tokenize(entry["symptom"] + " " + entry["equipment"]))
        if q_terms:
            kw_hits = q_terms & kw_terms
            sym_hits = q_terms & symptom_terms
            score += 0.6 * len(kw_hits) / max(1, min(len(q_terms), len(kw_terms)))
            score += 0.3 * len(sym_hits) / max(1, len(q_terms))
            if kw_hits:
                reasons.append("keywords: " + ", ".join(sorted(kw_hits)))
        if score >= 0.2:
            entry["match_score"] = round(min(score, 1.5), 3)
            entry["match_reasons"] = reasons
            entry["verified"] = bool(entry["verified"])
            results.append(entry)
    results.sort(key=lambda e: e["match_score"], reverse=True)
    return results[:limit]


def list_entries(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    rows = [dict(r) for r in conn.execute("SELECT * FROM troubleshooting ORDER BY equipment, error_code")]
    for r in rows:
        r["verified"] = bool(r["verified"])
    return rows


def create_entry(conn: sqlite3.Connection, payload: dict[str, Any]) -> dict[str, Any]:
    required = ("equipment", "symptom", "keywords", "probable_cause", "fix")
    missing = [k for k in required if not str(payload.get(k, "")).strip()]
    if missing:
        raise ValueError(f"Missing required field(s): {', '.join(missing)}.")
    page = payload.get("source_page")
    cur = conn.execute(
        "INSERT INTO troubleshooting (error_code, equipment, symptom, keywords, probable_cause, fix, "
        "source_document, source_page, verified) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (payload.get("error_code"), payload["equipment"], payload["symptom"], payload["keywords"],
         payload["probable_cause"], payload["fix"], payload.get("source_document"),
         int(page) if page not in (None, "") else None,
         # New entries are unverified until an expert approves them.
         0),
    )
    conn.commit()
    row = dict(conn.execute("SELECT * FROM troubleshooting WHERE id = ?", (cur.lastrowid,)).fetchone())
    row["verified"] = bool(row["verified"])
    return row
