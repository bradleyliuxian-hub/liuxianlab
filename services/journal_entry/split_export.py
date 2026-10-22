"""Filter → group → split export engine.

Consumes completed child result.json canonical lines. It never opens source
workbooks and never runs Reader / Mapping / Normalize / Business / Contra /
Anomaly.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import zipfile
from collections import defaultdict
from dataclasses import dataclass
from datetime import date
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

from openpyxl import Workbook
from openpyxl.styles import Font
from openpyxl.utils import get_column_letter

from .export import HEADER_FILL, _write_sheet, safe_excel_text

SPLIT_SCHEMA_VERSION = 1

COLUMN_GROUPS = (
    ("core", "财务核心字段"),
    ("aux", "往来与辅助核算"),
    ("other", "其他业务字段"),
    ("source", "来源与系统追溯"),
    ("advanced", "高级系统字段"),
)
COLUMN_DEFINITIONS = (
    {"id": "date", "label": "日期", "group": "core", "default": True, "kind": "date"},
    {"id": "voucher_id", "label": "凭证号", "group": "core", "default": True, "kind": "text"},
    {"id": "description", "label": "摘要", "group": "core", "default": True, "kind": "text"},
    {"id": "account_code", "label": "科目编码", "group": "core", "default": True, "kind": "text"},
    {"id": "account_name", "label": "科目名称", "group": "core", "default": True, "kind": "text"},
    {"id": "detail_account", "label": "明细科目", "group": "core", "default": True, "kind": "text"},
    {"id": "debit", "label": "借方金额", "group": "core", "default": True, "kind": "amount"},
    {"id": "credit", "label": "贷方金额", "group": "core", "default": True, "kind": "amount"},
    {"id": "customer_code", "label": "客户编码", "group": "aux", "default_if_data": True, "kind": "text"},
    {"id": "customer_name", "label": "客户名称", "group": "aux", "default_if_data": True, "kind": "text"},
    {"id": "supplier_code", "label": "供应商编码", "group": "aux", "default_if_data": True, "kind": "text"},
    {"id": "supplier_name", "label": "供应商名称", "group": "aux", "default_if_data": True, "kind": "text"},
    {"id": "counterparty_code", "label": "往来单位编码", "group": "aux", "default_if_data": True, "kind": "text"},
    {"id": "counterparty_name", "label": "往来单位名称", "group": "aux", "default_if_data": True, "kind": "text"},
    {"id": "entity", "label": "主体", "group": "other", "default_if_data": True, "kind": "text"},
    {"id": "period", "label": "会计期间", "group": "other", "default_if_data": True, "kind": "text"},
    {"id": "currency", "label": "币种", "group": "other", "default_if_data": True, "kind": "text"},
    {"id": "original_amount", "label": "原币金额", "group": "other", "default_if_data": True, "kind": "amount"},
    {"id": "preparer", "label": "制单人", "group": "other", "default_if_data": True, "kind": "text"},
    {"id": "original_filename", "label": "原始文件", "group": "source", "kind": "text"},
    {"id": "sheet_name", "label": "源 Sheet", "group": "source", "kind": "text"},
    {"id": "source_row", "label": "源行号", "group": "source", "kind": "number"},
    {"id": "line_id", "label": "外部行 ID", "group": "advanced", "advanced": True, "kind": "text"},
    {"id": "internal_line_key", "label": "内部行标识（系统追溯）", "group": "advanced", "advanced": True, "kind": "key"},
    {"id": "job_id", "label": "任务 ID（系统字段）", "group": "advanced", "advanced": True, "kind": "key"},
    {"id": "voucher_key", "label": "凭证内部标识（系统字段）", "group": "advanced", "advanced": True, "kind": "key"},
)
COLUMN_BY_ID = {item["id"]: item for item in COLUMN_DEFINITIONS}
DEFAULT_COLUMN_ORDER = (
    "date", "voucher_id", "description", "account_code", "account_name",
    "detail_account", "customer_code", "customer_name", "supplier_code",
    "supplier_name", "counterparty_code", "counterparty_name", "debit",
    "credit", "currency", "original_amount", "preparer", "entity", "period",
    "original_filename", "sheet_name", "source_row", "line_id",
    "internal_line_key", "job_id", "voucher_key",
)
DEFAULT_MAX_GROUPS_MULTI_SHEET = 200
DEFAULT_MAX_GROUPS_ZIP = 500
DEFAULT_MAX_ROWS_PER_SHEET = 1_048_000
BLANK_LABELS = {
    "account": "未指定科目",
    "customer": "未指定客户",
    "supplier": "未指定供应商",
    "counterparty": "未指定往来单位",
    "month": "未指定月份",
    "period": "未指定会计期间",
    "entity": "未指定主体",
    "source_file": "未指定来源文件",
}
GROUP_BY_VALUES = (
    "account", "customer", "supplier", "counterparty",
    "month", "period", "entity", "source_file",
)
GROUP_BY_LABELS = {
    "account": "科目", "customer": "客户", "supplier": "供应商",
    "counterparty": "往来单位", "month": "月份", "period": "会计期间",
    "entity": "主体", "source_file": "来源文件",
}
ILLEGAL_SHEET = re.compile(r"[\[\]:*?/\\]")
ILLEGAL_FILENAME = re.compile(r'[\u0000-\u001f\u007f/\\:*?"<>|]+')


class SplitExportError(Exception):
    pass


@dataclass
class Record:
    job_id: str
    filename: str
    position: int
    voucher_key: str
    voucher_id: str
    date: Optional[str]
    period: Optional[str]
    entity: Optional[str]
    line: Dict[str, Any]


def _decimal(value: Any) -> Decimal:
    if value in (None, ""):
        return Decimal("0.00")
    try:
        return Decimal(str(value)).quantize(Decimal("0.01"))
    except (InvalidOperation, ValueError):
        return Decimal("0.00")


def _text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def _safe_excel(value: Any) -> Any:
    return safe_excel_text(value)


def _parse_date(value: Any) -> Optional[date]:
    text = _text(value)
    if not text:
        return None
    try:
        return date.fromisoformat(text[:10])
    except ValueError:
        return None


def load_records(jobs: Sequence[Dict[str, Any]]) -> List[Record]:
    records: List[Record] = []
    for job in jobs:
        path = Path(str(job.get("result_path") or ""))
        if not path.exists():
            raise SplitExportError(f"结果文件不存在：{path.name}")
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            raise SplitExportError(f"结果文件无法读取：{path.name}") from exc
        if not isinstance(payload, dict) or not isinstance(payload.get("vouchers"), list):
            raise SplitExportError(f"结果文件结构不完整：{path.name}")
        job_id = str(job.get("job_id") or "")
        filename = str(job.get("original_filename") or "")
        position = int(job.get("position") or 0)
        for voucher in payload.get("vouchers") or []:
            if not isinstance(voucher, dict):
                continue
            voucher_key = str(voucher.get("voucher_key") or voucher.get("voucher_id") or "")
            voucher_id = str(voucher.get("voucher_id") or "")
            for line in voucher.get("lines") or []:
                if not isinstance(line, dict):
                    continue
                records.append(Record(
                    job_id=job_id,
                    filename=filename,
                    position=position,
                    voucher_key=voucher_key,
                    voucher_id=voucher_id,
                    date=_text(line.get("date") or voucher.get("date")) or None,
                    period=_text(line.get("period") or voucher.get("period")) or None,
                    entity=_text(line.get("entity") or voucher.get("entity")) or None,
                    line=line,
                ))
    return records


def _list(value: Any) -> List[str]:
    if value in (None, ""):
        return []
    if isinstance(value, (list, tuple)):
        return [str(item).strip() for item in value if str(item).strip()]
    return [str(value).strip()] if str(value).strip() else []


def _matches(value: Any, values: Sequence[str]) -> bool:
    if not values:
        return True
    text = _text(value)
    return text in values if text else False


def _matches_pair(code: Any, name: Any, values: Sequence[str]) -> bool:
    if not values:
        return True
    return _text(code) in values or _text(name) in values


def _min_max_ok(value: Decimal, minimum: Any, maximum: Any) -> bool:
    if minimum not in (None, ""):
        try:
            if value < Decimal(str(minimum)):
                return False
        except InvalidOperation:
            raise SplitExportError("金额筛选值无效。")
    if maximum not in (None, ""):
        try:
            if value > Decimal(str(maximum)):
                return False
        except InvalidOperation:
            raise SplitExportError("金额筛选值无效。")
    return True


def apply_filters(records: Sequence[Record], filters: Dict[str, Any]) -> List[Record]:
    filters = filters or {}
    source_files = _list(filters.get("source_files"))
    entities = _list(filters.get("entities"))
    months = _list(filters.get("months"))
    periods = _list(filters.get("periods"))
    account_codes = _list(filters.get("account_codes"))
    account_names = _list(filters.get("account_names"))
    account_values = _list(filters.get("account_values"))
    customer_codes = _list(filters.get("customer_codes"))
    customer_names = _list(filters.get("customer_names"))
    customer_values = _list(filters.get("customer_values"))
    supplier_codes = _list(filters.get("supplier_codes"))
    supplier_names = _list(filters.get("supplier_names"))
    supplier_values = _list(filters.get("supplier_values"))
    counterparty_codes = _list(filters.get("counterparty_codes"))
    counterparty_names = _list(filters.get("counterparty_names"))
    counterparty_values = _list(filters.get("counterparty_values"))
    date_from = _parse_date(filters.get("date_from"))
    date_to = _parse_date(filters.get("date_to"))
    if filters.get("date_from") and date_from is None:
        raise SplitExportError("起始日期无效。")
    if filters.get("date_to") and date_to is None:
        raise SplitExportError("结束日期无效。")

    result = []
    for record in records:
        line = record.line
        if source_files and record.filename not in source_files:
            continue
        if entities and _text(record.entity) not in entities:
            continue
        record_date = _parse_date(record.date)
        if (date_from or date_to) and record_date is None:
            continue
        if date_from and record_date < date_from:
            continue
        if date_to and record_date > date_to:
            continue
        month = record_date.isoformat()[:7] if record_date else ""
        if months and month not in months:
            continue
        if periods and _text(record.period) not in periods:
            continue
        if account_codes and not _matches(line.get("account_code"), account_codes):
            continue
        if account_names and not _matches(line.get("account_name"), account_names):
            continue
        if account_values and not (
            _matches(line.get("account_code"), account_values)
            or _matches(line.get("account_name"), account_values)
        ):
            continue
        if customer_codes and not _matches(line.get("customer_code"), customer_codes):
            continue
        if customer_names and not _matches(line.get("customer_name"), customer_names):
            continue
        if customer_values and not _matches_pair(
            line.get("customer_code"), line.get("customer_name"), customer_values
        ):
            continue
        if supplier_codes and not _matches(line.get("supplier_code"), supplier_codes):
            continue
        if supplier_names and not _matches(line.get("supplier_name"), supplier_names):
            continue
        if supplier_values and not _matches_pair(
            line.get("supplier_code"), line.get("supplier_name"), supplier_values
        ):
            continue
        if counterparty_codes and not _matches(line.get("counterparty_code"), counterparty_codes):
            continue
        if counterparty_names and not _matches(line.get("counterparty_name"), counterparty_names):
            continue
        if counterparty_values and not _matches_pair(
            line.get("counterparty_code"), line.get("counterparty_name"), counterparty_values
        ):
            continue
        if not _min_max_ok(_decimal(line.get("debit")), filters.get("debit_min"), filters.get("debit_max")):
            continue
        if not _min_max_ok(_decimal(line.get("credit")), filters.get("credit_min"), filters.get("credit_max")):
            continue
        result.append(record)
    return result


def _dimension_identity(
    record: Record,
    dimension: str,
    group_options: Dict[str, Any],
) -> Tuple[str, str]:
    line = record.line
    if dimension == "account":
        code = _text(line.get("account_code"))
        name = _text(line.get("account_name"))
        prefix = group_options.get("account_prefix_length")
        if prefix not in (None, ""):
            try:
                prefix = int(prefix)
            except (TypeError, ValueError):
                raise SplitExportError("科目级次必须为整数。")
            if prefix < 1 or prefix > 20:
                raise SplitExportError("科目级次必须在 1–20 之间。")
            if code:
                return code[:prefix], code[:prefix]
        value = code or name
        display = f"{code} {name}".strip() if code and name else value
        return (value, display) if value else ("__blank__", BLANK_LABELS["account"])
    if dimension in ("customer", "supplier", "counterparty"):
        code = _text(line.get(f"{dimension}_code"))
        name = _text(line.get(f"{dimension}_name"))
        value = code or name
        display = name or code
        return (value, display) if value else ("__blank__", BLANK_LABELS[dimension])
    if dimension == "month":
        parsed = _parse_date(record.date)
        if not parsed:
            return "__blank__", BLANK_LABELS["month"]
        month = parsed.isoformat()[:7]
        return month, month
    if dimension == "period":
        value = _text(record.period)
        return (value, value) if value else ("__blank__", BLANK_LABELS["period"])
    if dimension == "entity":
        value = _text(record.entity)
        return (value, value) if value else ("__blank__", BLANK_LABELS["entity"])
    if dimension == "source_file":
        value = _text(record.filename)
        return (f"{record.job_id}:{value}", value) if value else ("__blank__", BLANK_LABELS["source_file"])
    raise SplitExportError("不支持的拆分维度。")


def _group_identity(
    record: Record,
    dimensions: Sequence[str],
    group_options: Dict[str, Any],
) -> Tuple[Tuple[Tuple[str, str], ...], Dict[str, str], Dict[str, str], str]:
    key_parts = []
    values = {}
    raw_values = {}
    labels = []
    for dimension in dimensions:
        raw, label = _dimension_identity(record, dimension, group_options or {})
        key_parts.append((dimension, raw))
        raw_values[dimension] = raw
        values[dimension] = label
        labels.append(label)
    return tuple(key_parts), values, raw_values, " / ".join(labels)


def group_records(
    records: Sequence[Record],
    dimensions: Sequence[str],
    group_options: Dict[str, Any],
) -> List[Dict[str, Any]]:
    groups: Dict[Tuple[Tuple[str, str], ...], Dict[str, Any]] = {}
    for record in records:
        key, values, raw_values, display = _group_identity(
            record, dimensions, group_options or {}
        )
        group = groups.setdefault(key, {
            "group_key": json.dumps(
                [{"dimension": dimension, "value": raw_values[dimension]} for dimension in dimensions],
                ensure_ascii=False, separators=(",", ":"),
            ),
            "display_name": display,
            "values": values,
            "raw_values": raw_values,
            "rows": [],
            "vouchers": set(),
            "debit": Decimal("0.00"),
            "credit": Decimal("0.00"),
        })
        group["rows"].append(record)
        group["vouchers"].add((record.job_id, record.voucher_key))
        group["debit"] += _decimal(record.line.get("debit"))
        group["credit"] += _decimal(record.line.get("credit"))
    result = []
    for group in groups.values():
        result.append({
            **group,
            "line_count": len(group["rows"]),
            "voucher_count": len(group["vouchers"]),
            "debit_total": group["debit"].quantize(Decimal("0.01")),
            "credit_total": group["credit"].quantize(Decimal("0.01")),
        })
    result.sort(key=lambda item: tuple(str(value) for value in item["raw_values"].values()))
    return result


def _normalize_dimensions(raw: Any) -> List[str]:
    if isinstance(raw, str):
        dimensions = [raw] if raw else []
    elif isinstance(raw, (list, tuple)):
        dimensions = [str(item) for item in raw if str(item)]
    elif raw in (None, ""):
        dimensions = []
    else:
        raise SplitExportError("拆分维度无效。")
    if not 1 <= len(dimensions) <= 3:
        raise SplitExportError("拆分维度数量必须为 1–3 个。")
    if len(set(dimensions)) != len(dimensions):
        raise SplitExportError("拆分维度不能重复。")
    for dimension in dimensions:
        if dimension not in GROUP_BY_VALUES:
            raise SplitExportError("不支持的拆分维度。")
    return dimensions


def _limits(request: Dict[str, Any]) -> Dict[str, int]:
    raw = request.get("limits") or {}
    mode = request.get("output_mode") or "multi_sheet"
    default_groups = (
        DEFAULT_MAX_GROUPS_ZIP if mode == "zip" else DEFAULT_MAX_GROUPS_MULTI_SHEET
    )
    return {
        "max_groups": max(1, int(raw.get("max_groups") or default_groups)),
        "max_rows_per_sheet": max(
            1, min(1_048_575, int(raw.get("max_rows_per_sheet") or DEFAULT_MAX_ROWS_PER_SHEET))
        ),
    }


def preview_split(request: Dict[str, Any]) -> Dict[str, Any]:
    dimensions = _normalize_dimensions(request.get("group_by"))
    if request.get("row_mode") not in (None, "", "matched_only"):
        raise SplitExportError("FULL VOUCHER MODE NOT IMPLEMENTED")
    jobs = list(request.get("jobs") or [])
    records = load_records(jobs)
    filtered = apply_filters(records, request.get("filters") or {})
    groups = group_records(filtered, dimensions, request.get("group_options") or {})
    stats = _column_statistics(filtered)
    selected_columns = _normalize_columns(request.get("columns"), stats)
    limits = _limits(request)
    warnings = []
    for dimension in dimensions:
        if dimension in ("customer", "supplier", "counterparty"):
            field = f"{dimension}_name"
            code_field = f"{dimension}_code"
            if not any(
                _text(record.line.get(field)) or _text(record.line.get(code_field))
                for record in records
            ):
                warnings.append(f"{dimension}_not_mapped")
    if any(
        any(value in BLANK_LABELS.values() for value in group["values"].values())
        for group in groups
    ):
        warnings.append("blank_group_included")
    group_count = len(groups)
    limit_exceeded = group_count > limits["max_groups"]
    if limit_exceeded:
        warnings.append("group_limit_exceeded")
    vouchers = {(record.job_id, record.voucher_key) for record in filtered}
    return {
        "schema_version": SPLIT_SCHEMA_VERSION,
        "matched_lines": len(filtered),
        "matched_vouchers": len(vouchers),
        "completed_files": len(jobs),
        "source_file_count": len({record.filename for record in filtered}),
        "group_count": group_count,
        "group_by": dimensions,
        "dimensions": dimensions,
        "group_options": request.get("group_options") or {},
        "output_mode": request.get("output_mode") or "multi_sheet",
        "row_mode": request.get("row_mode") or "matched_only",
        "limits": limits,
        "limit_exceeded": limit_exceeded,
        "warnings": warnings,
        "column_stats": stats,
        "selected_columns": selected_columns,
        "column_order": selected_columns,
        "included_job_ids": [str(job.get("job_id")) for job in jobs],
        "groups": [
            {
                "group_key": group["group_key"],
                "display_name": group["display_name"],
                "values": group["values"],
                "raw_values": group["raw_values"],
                "line_count": group["line_count"],
                "voucher_count": group["voucher_count"],
                "debit_total": format(group["debit_total"], ".2f"),
                "credit_total": format(group["credit_total"], ".2f"),
            }
            for group in groups
        ],
    }


def dimension_options(request: Dict[str, Any]) -> Dict[str, Any]:
    dimension = str(request.get("dimension") or "")
    if dimension not in GROUP_BY_VALUES and dimension not in ("account",):
        raise SplitExportError("不支持的维度。")
    jobs = list(request.get("jobs") or [])
    records = load_records(jobs)
    query = _text(request.get("q")).casefold()
    limit = max(1, min(200, int(request.get("limit") or 50)))
    counts: Dict[str, Dict[str, Any]] = {}
    blank = 0
    for record in records:
        line = record.line
        if dimension == "account":
            code = _text(line.get("account_code"))
            name = _text(line.get("account_name"))
            value = code or name
            label = f"{code} {name}".strip() or value
            extra = {"code": code, "name": name}
        elif dimension in ("customer", "supplier", "counterparty"):
            code = _text(line.get(f"{dimension}_code"))
            name = _text(line.get(f"{dimension}_name"))
            value = code or name
            label = name or code
            extra = {"code": code, "name": name}
        elif dimension == "month":
            parsed = _parse_date(record.date)
            value = parsed.isoformat()[:7] if parsed else ""
            label = value
            extra = {}
        elif dimension == "period":
            value = _text(record.period)
            label = value
            extra = {}
        elif dimension == "entity":
            value = _text(record.entity)
            label = value
            extra = {}
        else:
            value = _text(record.filename)
            label = value
            extra = {}
        if not value:
            blank += 1
            continue
        entry = counts.setdefault(value, {"value": value, "label": label, "count": 0, **extra})
        entry["count"] += 1
        if label and not entry.get("label"):
            entry["label"] = label
    options = list(counts.values())
    if query:
        options = [
            option for option in options
            if query in str(option.get("value", "")).casefold()
            or query in str(option.get("label", "")).casefold()
            or query in str(option.get("code", "")).casefold()
            or query in str(option.get("name", "")).casefold()
        ]
    options.sort(key=lambda item: (-item["count"], str(item["label"] or item["value"])))
    total = len(options)
    return {
        "dimension": dimension,
        "options": options[:limit],
        "total": total,
        "truncated": total > limit,
        "blank_count": blank,
    }


def _safe_sheet_name(display: Any, used: set) -> str:
    raw = ILLEGAL_SHEET.sub("_", _text(display)).strip("'") or "未命名"
    base = raw[:31]
    candidate = base
    index = 2
    while candidate.casefold() in used:
        suffix = f"_{index}"
        candidate = f"{base[:31 - len(suffix)]}{suffix}"
        index += 1
    used.add(candidate.casefold())
    return candidate


def _safe_file_name(display: Any, fallback: str = "group") -> str:
    name = _text(display).replace("\\", "/").split("/")[-1]
    name = ILLEGAL_FILENAME.sub("_", name).strip(" .")
    return (name or fallback)[:80]


def _column_value(record: Record, column_id: str) -> Any:
    line = record.line
    if column_id == "date":
        return record.date
    if column_id == "voucher_id":
        return record.voucher_id
    if column_id == "entity":
        return record.entity
    if column_id == "period":
        return record.period
    if column_id == "original_filename":
        return record.filename
    if column_id == "job_id":
        return record.job_id
    if column_id == "voucher_key":
        return record.voucher_key
    if column_id == "debit":
        return _decimal(line.get("debit"))
    if column_id == "credit":
        return _decimal(line.get("credit"))
    if column_id == "original_amount":
        return _decimal(line.get("original_amount")) if line.get("original_amount") not in (None, "") else None
    return line.get(column_id)


def _is_empty(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        return not value.strip()
    return False


def _column_statistics(records: Sequence[Record]) -> Dict[str, Dict[str, Any]]:
    total = len(records)
    stats: Dict[str, Dict[str, Any]] = {}
    for definition in COLUMN_DEFINITIONS:
        column_id = definition["id"]
        non_empty = sum(0 if _is_empty(_column_value(record, column_id)) else 1 for record in records)
        stats[column_id] = {
            "id": column_id,
            "label": definition["label"],
            "group": definition["group"],
            "advanced": bool(definition.get("advanced")),
            "non_empty_count": non_empty,
            "total_count": total,
            "entirely_empty": non_empty == 0,
        }
    return stats


def _normalize_columns(raw: Any, stats: Dict[str, Dict[str, Any]]) -> List[str]:
    explicit = raw is not None
    if not explicit:
        return [
            column_id for column_id in DEFAULT_COLUMN_ORDER
            if (
                COLUMN_BY_ID[column_id].get("default")
                or (
                    COLUMN_BY_ID[column_id].get("default_if_data")
                    and not stats[column_id]["entirely_empty"]
                )
            )
        ]
    if not isinstance(raw, (list, tuple)) or not raw:
        raise SplitExportError("至少选择 1 个导出字段。")
    selected: List[str] = []
    for value in raw:
        column_id = str(value or "").strip()
        if column_id not in COLUMN_BY_ID:
            raise SplitExportError("导出字段无效。")
        if column_id in selected:
            raise SplitExportError("导出字段不能重复。")
        selected.append(column_id)
    if not selected:
        raise SplitExportError("至少选择 1 个导出字段。")
    return selected


def _style_data_sheet(sheet, columns: Sequence[str]) -> None:
    for index, column_id in enumerate(columns, start=1):
        definition = COLUMN_BY_ID[column_id]
        letter = get_column_letter(index)
        if definition["kind"] == "amount":
            for cell in sheet[letter][1:]:
                cell.number_format = "#,##0.00"
        if definition["kind"] == "date":
            for cell in sheet[letter][1:]:
                cell.number_format = "yyyy-mm-dd"
        width = {
            "date": 12, "description": 52, "account_name": 28,
            "customer_name": 24, "supplier_name": 24,
            "counterparty_name": 24, "account_code": 18,
            "customer_code": 18, "supplier_code": 18, "counterparty_code": 18,
            "original_filename": 28, "sheet_name": 18, "source_row": 10,
            "job_id": 24, "line_id": 18, "internal_line_key": 28,
            "voucher_key": 32, "voucher_id": 20, "detail_account": 24,
            "entity": 18, "period": 14, "currency": 10, "preparer": 14,
        }.get(column_id, 20)
        sheet.column_dimensions[letter].width = width
    sheet.freeze_panes = "A2"
    sheet.auto_filter.ref = sheet.dimensions


def _standard_headers(columns: Sequence[str]) -> List[str]:
    return [COLUMN_BY_ID[column_id]["label"] for column_id in columns]


def _standard_row(record: Record, columns: Sequence[str]) -> List[Any]:
    values = []
    for column_id in columns:
        value = _column_value(record, column_id)
        if COLUMN_BY_ID[column_id]["kind"] in ("text", "key"):
            value = _safe_excel(value or "")
        values.append(value)
    return values


def _description_rows(request: Dict[str, Any], preview: Dict[str, Any], group: Optional[Dict[str, Any]] = None) -> List[List[Any]]:
    scope = request.get("scope") or {}
    rows = [
        ["生成时间", request.get("generated_at") or ""],
        ["数据范围", f"{scope.get('type', '')}:{scope.get('id', '')}"],
        ["筛选条件", json.dumps(request.get("filters") or {}, ensure_ascii=False, sort_keys=True)[:4000]],
        ["拆分维度", json.dumps(preview.get("group_by"), ensure_ascii=False)],
        ["输出模式", request.get("output_mode")],
        ["输出范围", request.get("row_mode") or "matched_only"],
        ["匹配行数", preview.get("matched_lines")],
        ["匹配凭证数", preview.get("matched_vouchers")],
        ["分组数量", preview.get("group_count")],
        ["来源文件数", preview.get("source_file_count")],
        ["导出字段", json.dumps(preview.get("selected_columns"), ensure_ascii=False)],
    ]
    if group:
        rows.extend([
            ["分组名称", group["display_name"]],
            ["分组行数", group["line_count"]],
            ["分组凭证数", group["voucher_count"]],
        ])
    return rows


def _write_description(workbook, request, preview, group=None):
    sheet = workbook.create_sheet("拆分说明")
    sheet.append(["项目", "内容"])
    for cell in sheet[1]:
        cell.font = Font(bold=True)
        cell.fill = HEADER_FILL
    for label, value in _description_rows(request, preview, group):
        sheet.append([_safe_excel(label), _safe_excel(value)])
    sheet.column_dimensions["A"].width = 18
    sheet.column_dimensions["B"].width = 90


def _build_multi_sheet(path: Path, request: Dict[str, Any], preview: Dict[str, Any], groups: Sequence[Dict[str, Any]]) -> None:
    workbook = Workbook()
    default = workbook.active
    workbook.remove(default)
    _write_description(workbook, request, preview)
    index = workbook.create_sheet("分组索引")
    dimensions = preview.get("dimensions") or []
    dimension_headers = [GROUP_BY_LABELS.get(dimension, dimension) for dimension in dimensions]
    index.append(dimension_headers + ["Sheet 名称", "部分", "行数", "凭证数", "借方合计", "贷方合计"])
    for cell in index[1]:
        cell.font = Font(bold=True)
        cell.fill = HEADER_FILL
    used = {"拆分说明", "分组索引"}
    max_rows = _limits(request)["max_rows_per_sheet"]
    for group in groups:
        source_rows = group["rows"]
        record_parts = [source_rows[i:i + max_rows] for i in range(0, len(source_rows), max_rows)] or [[]]
        columns = preview["selected_columns"]
        parts = [[_standard_row(record, columns) for record in part] for part in record_parts]
        for part_index, part in enumerate(parts, start=1):
            part_records = record_parts[part_index - 1]
            name = group["display_name"] if len(parts) == 1 else f"{group['display_name']}_{part_index}"
            sheet_name = _safe_sheet_name(name, used)
            sheet = workbook.create_sheet(sheet_name)
            _write_sheet(sheet, _standard_headers(columns), part)
            _style_data_sheet(sheet, columns)
            part_vouchers = len({(record.job_id, record.voucher_key) for record in part_records})
            part_debit = sum((_decimal(record.line.get("debit")) for record in part_records), Decimal("0.00"))
            part_credit = sum((_decimal(record.line.get("credit")) for record in part_records), Decimal("0.00"))
            index.append(
                [_safe_excel(group["values"].get(dimension, "")) for dimension in dimensions]
                + [
                    sheet_name, part_index, len(part), part_vouchers,
                    part_debit.quantize(Decimal("0.01")),
                    part_credit.quantize(Decimal("0.01")),
                ]
            )
    index.freeze_panes = "A2"
    index.column_dimensions["A"].width = 34
    index.column_dimensions["B"].width = 34
    workbook.save(path)
    try:
        path.chmod(0o600)
    except OSError:
        pass


def _build_group_workbook(path: Path, request: Dict[str, Any], preview: Dict[str, Any], group: Dict[str, Any], rows: Sequence[Record], part: int, part_count: int) -> None:
    workbook = Workbook()
    default = workbook.active
    workbook.remove(default)
    _write_description(workbook, request, preview, group)
    sheet = workbook.create_sheet("序时账")
    columns = preview["selected_columns"]
    _write_sheet(sheet, _standard_headers(columns), [_standard_row(record, columns) for record in rows])
    _style_data_sheet(sheet, columns)
    workbook.save(path)
    try:
        path.chmod(0o600)
    except OSError:
        pass


def build_split_output(output_dir: Path, request: Dict[str, Any]) -> Dict[str, Any]:
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    output_mode = request.get("output_mode") or "multi_sheet"
    if output_mode not in ("multi_sheet", "zip"):
        raise SplitExportError("不支持的输出模式。")
    preview = preview_split(request)
    if preview["matched_lines"] == 0:
        raise SplitExportError("筛选结果为 0 行，无法生成。")
    if preview["limit_exceeded"]:
        raise SplitExportError(
            f"预计生成 {preview['group_count']} 个分组，超过当前输出上限 {preview['limits']['max_groups']}。"
        )
    jobs = list(request.get("jobs") or [])
    records = load_records(jobs)
    filtered = apply_filters(records, request.get("filters") or {})
    dimensions = _normalize_dimensions(request.get("group_by"))
    groups = group_records(filtered, dimensions, request.get("group_options") or {})
    max_rows = preview["limits"]["max_rows_per_sheet"]
    manifest_groups = []
    if output_mode == "multi_sheet":
        output_path = output_dir / "split-export.xlsx"
        _build_multi_sheet(output_path, request, preview, groups)
        for group in groups:
            manifest_groups.append({
                "group_key": group["group_key"],
                "display_name": group["display_name"],
                "values": group["values"],
                "raw_values": group["raw_values"],
                "line_count": group["line_count"],
                "voucher_count": group["voucher_count"],
                "output_filename": output_path.name,
            })
        return {
            "output_mode": output_mode,
            "output_file": output_path.name,
            "group_count": len(groups),
            "matched_lines": len(filtered),
            "matched_vouchers": len({(record.job_id, record.voucher_key) for record in filtered}),
            "selected_columns": preview["selected_columns"],
            "manifest": {
                "schema_version": SPLIT_SCHEMA_VERSION,
                "selected_columns": preview["selected_columns"],
                "scope": request.get("scope"),
                "generated_at": request.get("generated_at"),
                "filters": request.get("filters") or {},
                "group_by": dimensions,
                "dimensions": dimensions,
                "group_options": request.get("group_options") or {},
                "output_mode": output_mode,
                "row_mode": request.get("row_mode") or "matched_only",
                "matched_lines": len(filtered),
                "matched_vouchers": len({(record.job_id, record.voucher_key) for record in filtered}),
                "group_count": len(groups),
                "selected_columns": preview["selected_columns"],
                "groups": manifest_groups,
            },
        }

    zip_path = output_dir / "split-export.zip"
    used = set()
    sequence = 1
    for group in groups:
        source_rows = group["rows"]
        parts = [source_rows[i:i + max_rows] for i in range(0, len(source_rows), max_rows)] or [[]]
        for part_index, part in enumerate(parts, start=1):
            stem = _safe_file_name(group["display_name"])
            filename = f"{sequence:03d}-{stem}"
            if len(parts) > 1:
                filename += f"-part{part_index:03d}"
            filename += ".xlsx"
            while filename.casefold() in used:
                filename = f"{sequence:03d}-{stem}-{sequence}.xlsx"
            used.add(filename.casefold())
            sequence += 1
            _build_group_workbook(
                output_dir / filename, request, preview, group, part,
                part_index, len(parts)
            )
            part_vouchers = len({(record.job_id, record.voucher_key) for record in part})
            manifest_groups.append({
                "group_key": group["group_key"],
                "display_name": group["display_name"],
                "values": group["values"],
                "raw_values": group["raw_values"],
                "line_count": len(part),
                "voucher_count": part_vouchers,
                "output_filename": filename,
                "part": part_index,
                "part_count": len(parts),
            })
    manifest = {
        "schema_version": SPLIT_SCHEMA_VERSION,
        "scope": request.get("scope"),
        "generated_at": request.get("generated_at"),
        "filters": request.get("filters") or {},
        "group_by": dimensions,
        "dimensions": dimensions,
        "group_options": request.get("group_options") or {},
        "output_mode": output_mode,
        "row_mode": request.get("row_mode") or "matched_only",
        "matched_lines": len(filtered),
        "matched_vouchers": len({(record.job_id, record.voucher_key) for record in filtered}),
        "group_count": len(groups),
        "selected_columns": preview["selected_columns"],
        "groups": manifest_groups,
    }
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED, allowZip64=True) as archive:
        archive.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
        for item in manifest_groups:
            archive.write(output_dir / item["output_filename"], arcname=item["output_filename"])
    try:
        zip_path.chmod(0o600)
    except OSError:
        pass
    return {
        "output_mode": output_mode,
        "output_file": zip_path.name,
        "group_count": len(groups),
        "matched_lines": len(filtered),
        "matched_vouchers": len({(record.job_id, record.voucher_key) for record in filtered}),
        "selected_columns": preview["selected_columns"],
        "manifest": manifest,
    }


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Liuxian Lab split export engine")
    parser.add_argument("--mode", choices=("preview", "dimensions", "generate"), required=True)
    parser.add_argument("--request", required=True)
    parser.add_argument("--output", required=False)
    parser.add_argument("--output-dir", required=False)
    args = parser.parse_args(argv)
    try:
        request = json.loads(Path(args.request).read_text(encoding="utf-8"))
        if args.mode == "preview":
            payload = preview_split(request)
        elif args.mode == "dimensions":
            payload = dimension_options(request)
        else:
            payload = build_split_output(Path(args.output_dir), request)
        if args.output:
            Path(args.output).write_text(
                json.dumps(payload, ensure_ascii=False), encoding="utf-8"
            )
            try:
                Path(args.output).chmod(0o600)
            except OSError:
                pass
        else:
            print(json.dumps(payload, ensure_ascii=False))
        return 0
    except SplitExportError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    except Exception as exc:  # noqa: BLE001
        print(f"拆分导出失败：{type(exc).__name__}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
