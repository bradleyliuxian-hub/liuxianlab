"""Header alias detection and canonical record building."""

from __future__ import annotations

import re
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

from .schema import (
    COLUMN_ALIASES,
    DATE_FIELDS,
    FIELD_LABELS,
    NUMERIC_FIELDS,
    REQUIRED_FIELDS,
    _normalize,
)


class ColumnMappingError(ValueError):
    """Raised when the uploaded header cannot satisfy the required schema."""


def _canonical_headers(headers: Sequence[Any]) -> List[str]:
    cleaned: List[str] = []
    used: Dict[str, int] = {}
    for index, raw in enumerate(headers):
        name = str(raw).strip() if raw is not None else ""
        if not name:
            name = f"未命名列{index + 1}"
        if name in used:
            used[name] += 1
            name = f"{name} ({used[name]})"
        else:
            used[name] = 1
        cleaned.append(name)
    return cleaned


def detect_mapping(headers: Sequence[str]) -> Dict[str, Any]:
    """Map canonical fields to the uploaded header names.

    Exact alias matches win. Fuzzy matches are only accepted when a single
    header is the obvious candidate, so an unfamiliar SAP export cannot silently
    bind ``数量`` to ``订单数量``.
    """
    headers = _canonical_headers(headers)
    normalized = [(header, _normalize(header)) for header in headers]
    used: set[str] = set()
    mapping: Dict[str, str] = {}
    ambiguous: Dict[str, List[str]] = {}

    for field in FIELD_LABELS:
        aliases = [_normalize(alias) for alias in COLUMN_ALIASES.get(field, ())]
        exact = [
            header for header, norm in normalized
            if header not in used and norm in aliases
        ]
        if len(exact) == 1:
            mapping[field] = exact[0]
            used.add(exact[0])
            continue
        if len(exact) > 1:
            ambiguous[field] = exact
            continue

        fuzzy: List[Tuple[int, str]] = []
        for header, norm in normalized:
            if header in used or not norm:
                continue
            for alias in aliases:
                if len(alias) < 2:
                    continue
                if norm == alias:
                    score = 1000 + len(alias)
                elif norm.startswith(alias) or norm.endswith(alias):
                    score = 500 + len(alias)
                elif alias in norm:
                    score = 300 + len(alias)
                elif norm in alias and len(norm) >= 3:
                    score = 100 + len(norm)
                else:
                    continue
                fuzzy.append((score, header))
                break
        if not fuzzy:
            continue
        fuzzy.sort(key=lambda item: (-item[0], headers.index(item[1])))
        best_score = fuzzy[0][0]
        best = [header for score, header in fuzzy if score == best_score]
        if len(best) == 1:
            mapping[field] = best[0]
            used.add(best[0])
        else:
            ambiguous[field] = best

    missing = [field for field in REQUIRED_FIELDS if field not in mapping]
    return {
        "mapping": mapping,
        "headers": headers,
        "missing": missing,
        "missing_labels": [FIELD_LABELS[field] for field in missing],
        "ambiguous": ambiguous,
        "used": sorted(used),
    }


def resolve_mapping(headers: Sequence[str], explicit: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
    detection = detect_mapping(headers)
    if not explicit:
        return detection
    clean_headers = _canonical_headers(headers)
    mapping = dict(detection["mapping"])
    invalid: List[str] = []
    for field, header in explicit.items():
        if field not in FIELD_LABELS:
            invalid.append(f"未知字段 {field}")
            continue
        if header not in clean_headers:
            invalid.append(f"字段 {FIELD_LABELS[field]} 指向不存在的列 {header}")
            continue
        mapping[field] = header
    missing = [field for field in REQUIRED_FIELDS if field not in mapping]
    detection.update({
        "mapping": mapping,
        "missing": missing,
        "missing_labels": [FIELD_LABELS[field] for field in missing],
        "invalid": invalid,
    })
    return detection


def _to_decimal(value: Any, field: str, source_row: int) -> Tuple[Decimal, Optional[str]]:
    if value is None or value == "":
        if field == "quantity":
            return Decimal("0"), f"第 {source_row} 行数量为空，已按 0 处理（不参与对抵）。"
        return Decimal("0"), None
    if isinstance(value, Decimal):
        return value, None
    if isinstance(value, bool):
        raise ValueError(f"第 {source_row} 行{field}不是有效数字。")
    if isinstance(value, (int, float)):
        return Decimal(str(value)), None
    text = str(value).strip().replace(",", "").replace(" ", "")
    if not text:
        return Decimal("0"), None
    if text.startswith("(") and text.endswith(")"):
        text = f"-{text[1:-1]}"
    text = re.sub(r"^[¥￥$€£]", "", text)
    text = text.replace("%", "")
    try:
        return Decimal(text), None
    except InvalidOperation as error:
        raise ValueError(f"第 {source_row} 行{field}不是有效数字：{value!r}") from error


_DATE_FORMATS = ("%Y-%m-%d", "%Y/%m/%d", "%Y.%m.%d", "%Y%m%d", "%d.%m.%Y", "%d/%m/%Y")


def _to_date(value: Any) -> Any:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    text = str(value).strip()
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(text, fmt).date().isoformat()
        except ValueError:
            continue
    return text


def build_records(
    headers: Sequence[str],
    rows: Iterable[Dict[str, Any]],
    mapping: Dict[str, str],
) -> Tuple[List[Dict[str, Any]], List[str]]:
    """Convert raw rows into canonical records consumed by the FIFO engine."""
    clean_headers = _canonical_headers(headers)
    missing = [field for field in REQUIRED_FIELDS if field not in mapping]
    if missing:
        raise ColumnMappingError(
            "缺少必要字段：" + "、".join(FIELD_LABELS[field] for field in missing)
        )
    for field, header in mapping.items():
        if header not in clean_headers:
            raise ColumnMappingError(f"字段 {FIELD_LABELS[field]} 对应的列 {header} 不存在。")

    records: List[Dict[str, Any]] = []
    warnings: List[str] = []
    for row in rows:
        source_row = int(row.get("_source_row") or 0)
        record: Dict[str, Any] = {
            "source_row": source_row,
            "raw": {header: row.get(header) for header in clean_headers},
        }
        for field, header in mapping.items():
            value = row.get(header)
            if field in NUMERIC_FIELDS:
                parsed, warning = _to_decimal(value, FIELD_LABELS[field], source_row)
                record[field] = parsed
                if warning:
                    warnings.append(warning)
            elif field in DATE_FIELDS:
                record[field] = _to_date(value)
            else:
                record[field] = "" if value is None else str(value).strip()
        for field in FIELD_LABELS:
            if field in record:
                continue
            if field in NUMERIC_FIELDS:
                record[field] = Decimal("0")
            elif field in DATE_FIELDS:
                record[field] = None
            else:
                record[field] = ""
        records.append(record)
    return records, warnings
