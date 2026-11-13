"""Importação de CSV de consumo (ex.: exportado da conta oficial), com prévia, mapeamento e deduplicação."""

from __future__ import annotations

import csv
import hashlib
import io
import json
import re
from datetime import UTC, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from ..storage.db import Database, now_ts

MAX_ROWS = 20000

HINTS = {
    "period_start": ["start", "inicio", "início", "date", "data", "day", "dia", "period"],
    "period_end": ["end", "fim", "término", "termino"],
    "bytes_total": ["total", "usage", "uso", "consumo", "data used", "gb"],
    "bytes_down": ["down", "download", "recebido"],
    "bytes_up": ["up", "upload", "enviado"],
}

UNIT = {"b": 1, "kb": 1e3, "mb": 1e6, "gb": 1e9, "tb": 1e12, "kib": 1024, "mib": 1024**2, "gib": 1024**3, "tib": 1024**4}


def parse_csv(content: str) -> tuple[list[str], list[dict[str, str]]]:
    sample = content[:4096]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t")
    except csv.Error:
        dialect = csv.excel
    reader = csv.DictReader(io.StringIO(content), dialect=dialect)
    rows = []
    for i, r in enumerate(reader):
        if i >= MAX_ROWS:
            raise ValueError(f"Arquivo excede {MAX_ROWS} linhas")
        rows.append({(k or "").strip(): (v or "").strip() for k, v in r.items() if k is not None})
    cols = [c.strip() for c in (reader.fieldnames or []) if c]
    return cols, rows


def suggest(cols: list[str]) -> dict[str, str | None]:
    out: dict[str, str | None] = {}
    used: set[str] = set()
    for field, hints in HINTS.items():
        match = next((c for c in cols if c not in used and any(h in c.lower() for h in hints)), None)
        out[field] = match
        if match:
            used.add(match)
    return out


def parse_bytes(raw: str, header: str) -> float | None:
    s = raw.strip().replace(" ", " ")
    if not s:
        return None
    m = re.match(r"^([\d.,]+)\s*([a-zA-Z]{1,3})?$", s)
    if not m:
        raise ValueError(f"valor de consumo inválido: {raw!r}")
    num = m.group(1)
    if "," in num and "." in num:
        num = num.replace(".", "").replace(",", ".") if num.rfind(",") > num.rfind(".") else num.replace(",", "")
    elif "," in num:
        num = num.replace(",", ".")
    value = float(num)
    unit = (m.group(2) or "").lower()
    if not unit:
        hm = re.search(r"\b(tib|gib|mib|kib|tb|gb|mb|kb)\b", header.lower())
        unit = hm.group(1) if hm else "b"
    if unit not in UNIT:
        raise ValueError(f"unidade desconhecida: {unit}")
    return value * UNIT[unit]


def parse_date(raw: str, tz: str) -> datetime:
    s = raw.strip()
    z = ZoneInfo(tz)
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%Y-%m-%d %H:%M", "%d/%m/%Y %H:%M", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(s, fmt).replace(tzinfo=z)
        except ValueError:
            continue
    try:
        d = datetime.fromisoformat(s.replace("Z", "+00:00"))
        return d if d.tzinfo else d.replace(tzinfo=z)
    except ValueError as exc:
        raise ValueError(f"data inválida: {raw!r}") from exc


def preview(db: Database, filename: str, content: str) -> dict[str, Any]:
    cols, rows = parse_csv(content)
    if not cols:
        raise ValueError("Cabeçalho não encontrado")
    sha = hashlib.sha256(content.encode("utf-8")).hexdigest()
    dup = db.scalar("SELECT 1 FROM usage_imports WHERE sha256 = ?", (sha,)) is not None
    return {"import_token": sha[:16], "columns": cols, "suggested": suggest(cols), "preview": rows[:8], "rows": len(rows),
            "duplicate_file": dup}


def commit(db: Database, filename: str, content: str, mapping: dict[str, str], tz: str) -> dict[str, Any]:
    cols, rows = parse_csv(content)
    for req in ("period_start", "bytes_total"):
        if not mapping.get(req) or mapping[req] not in cols:
            raise ValueError(f"Mapeamento obrigatório ausente: {req}")
    sha = hashlib.sha256(content.encode("utf-8")).hexdigest()
    parsed = []
    errors = []
    for i, r in enumerate(rows, start=2):
        try:
            start = parse_date(r[mapping["period_start"]], tz)
            end = parse_date(r[mapping["period_end"]], tz) if mapping.get("period_end") else start + timedelta(days=1)
            if end <= start:
                end = start + timedelta(days=1)
            total = parse_bytes(r[mapping["bytes_total"]], mapping["bytes_total"])
            if total is None:
                continue
            down = parse_bytes(r[mapping["bytes_down"]], mapping["bytes_down"]) if mapping.get("bytes_down") else None
            up = parse_bytes(r[mapping["bytes_up"]], mapping["bytes_up"]) if mapping.get("bytes_up") else None
            parsed.append((int(start.astimezone(UTC).timestamp()), int(end.astimezone(UTC).timestamp()), down, up, total))
        except (ValueError, KeyError) as exc:
            errors.append(f"linha {i}: {exc}")
    if errors and not parsed:
        raise ValueError("; ".join(errors[:5]))
    inserted = 0
    with db.tx() as c:
        existing = c.execute("SELECT id FROM usage_imports WHERE sha256 = ?", (sha,)).fetchone()
        if existing:
            import_id = existing[0]
        else:
            cur = c.execute("INSERT INTO usage_imports (filename, sha256, imported_at, rows, mapping_json) VALUES (?, ?, ?, ?, ?)",
                            (filename[:200], sha, now_ts(), len(parsed), json.dumps(mapping)))
            import_id = cur.lastrowid
        for p in parsed:
            cur = c.execute("""INSERT OR IGNORE INTO usage_imported (import_id, period_start, period_end, bytes_down, bytes_up,
                               bytes_total) VALUES (?, ?, ?, ?, ?, ?)""", (import_id, *p))
            inserted += cur.rowcount
    return {"inserted": inserted, "skipped": len(parsed) - inserted, "errors": errors[:20]}
