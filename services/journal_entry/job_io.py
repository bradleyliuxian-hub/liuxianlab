"""Filesystem protocol shared by the Journal Entry preview and worker CLIs."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, Mapping, Optional

from .errors import JournalEntryError
from .normalize import normalize_file


def find_source_path(job_dir: Path) -> Path:
    job_dir = Path(job_dir)
    for name in ("source.xlsx", "source.xls"):
        candidate = job_dir / name
        if candidate.exists():
            return candidate
    raise JournalEntryError(
        "任务源文件不存在。",
        details={"job_dir": str(job_dir)},
    )


def read_json(path: Path, default=None):
    path = Path(path)
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise JournalEntryError(
            "任务 JSON 无法读取。",
            details={"path": path.name},
        ) from exc


def write_json(path: Path, payload: Any) -> None:
    path = Path(path)
    tmp = path.with_name(f".{path.name}.tmp")
    tmp.write_text(
        json.dumps(payload, ensure_ascii=False, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    tmp.replace(path)


def load_request(job_dir: Path) -> Dict[str, Any]:
    request = read_json(Path(job_dir) / "request.json", default=None)
    if not isinstance(request, dict):
        raise JournalEntryError("任务缺少映射请求。")
    return request


def explicit_mapping(request: Mapping[str, Any]) -> Dict[str, Any]:
    mapping = request.get("mapping")
    if not isinstance(mapping, dict):
        raise JournalEntryError(
            "映射参数无效。",
            details={"field": "mapping"},
        )
    result = dict(mapping)
    if request.get("amountLayout"):
        result["amount_layout"] = request.get("amountLayout")
    if request.get("positiveSide"):
        result["positive_side"] = request.get("positiveSide")
    return result


def normalize_request(job_dir: Path):
    request = load_request(job_dir)
    source = find_source_path(job_dir)
    sheet_name = request.get("sheetName")
    header_row = request.get("headerRow")
    if not sheet_name:
        raise JournalEntryError(
            "缺少工作表名称。",
            details={"field": "sheetName"},
        )
    try:
        header_row = int(header_row)
    except (TypeError, ValueError) as exc:
        raise JournalEntryError(
            "表头行无效。",
            details={"field": "headerRow", "value": header_row},
        ) from exc
    return normalize_file(
        source,
        sheet_name=str(sheet_name),
        header_row=header_row,
        mapping=explicit_mapping(request),
    )
