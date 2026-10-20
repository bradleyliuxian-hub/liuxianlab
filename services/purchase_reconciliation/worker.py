"""Background worker: parse -> validate -> FIFO -> result files -> exports."""

from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List

from .column_mapper import ColumnMappingError, build_records, resolve_mapping
from .engine import reconcile
from .excel_reader import WorkbookReadError, read_rows
from .exporters import (
    matched_payload,
    remaining_payload,
    segment_payload,
    write_csv_zip,
    write_ndjson,
    write_xlsx,
)
from .job_io import read_json, to_jsonable, update_status, write_json_atomic
from .schema import DEFAULT_MATCH_FIELDS, FIELD_LABELS, ReconciliationConfig


class WorkerError(RuntimeError):
    pass


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _source_path(job_dir: Path) -> Path:
    meta = read_json(job_dir / "meta.json", {}) or {}
    source = meta.get("sourceFile") or meta.get("sourcePath")
    if not source:
        raise WorkerError("任务缺少源文件信息。")
    path = Path(source)
    return path if path.is_absolute() else (job_dir / path)


def _request(job_dir: Path) -> Dict[str, Any]:
    request = read_json(job_dir / "request.json", {}) or {}
    sheet_name = (request.get("sheetName") or "").strip() or None
    header_row = request.get("headerRow")
    header_row = int(header_row) if header_row not in (None, "") else 1
    match_fields = request.get("matchFields")
    if not isinstance(match_fields, list) or not match_fields:
        match_fields = list(DEFAULT_MATCH_FIELDS)
    match_fields = [str(field) for field in match_fields]
    unknown = [field for field in match_fields if field not in FIELD_LABELS]
    if unknown:
        raise WorkerError("未知的匹配字段：" + "、".join(unknown))
    mapping = request.get("mapping")
    if mapping is not None and not isinstance(mapping, dict):
        raise WorkerError("字段映射格式不正确。")
    return {
        "sheetName": sheet_name,
        "headerRow": header_row,
        "matchFields": tuple(match_fields),
        "mapping": mapping or None,
    }


def run(job_dir: Path) -> None:
    update_status(job_dir, status="running", progress=5, message="正在读取任务信息…")
    request = _request(job_dir)
    source = _source_path(job_dir)
    if not source.exists():
        raise WorkerError("源文件不存在或已过期。")

    update_status(job_dir, progress=12, message="正在流式解析 Excel 数据…")
    started = time.time()
    headers, raw_rows, sheet_name = read_rows(
        source,
        sheet_name=request["sheetName"],
        header_row=request["headerRow"],
    )
    if not raw_rows:
        raise WorkerError("没有可对抵的数据行。")

    update_status(job_dir, progress=25, message=f"已读取 {len(raw_rows):,} 行，正在校验字段…")
    mapping = resolve_mapping(headers, request["mapping"])
    if mapping["missing"]:
        labels = "、".join(FIELD_LABELS[field] for field in mapping["missing"])
        raise WorkerError("缺少必要字段：" + labels)

    records, warnings = build_records(headers, raw_rows, mapping["mapping"])
    update_status(job_dir, progress=40, message="正在构建业务键并执行 FIFO…")

    config = ReconciliationConfig(match_fields=request["matchFields"])
    result = reconcile(records, config=config, headers=headers, warnings=warnings)
    update_status(job_dir, progress=62, message="FIFO 对抵完成，正在生成结果数据…")

    result_dir = job_dir / "result"
    result_dir.mkdir(parents=True, exist_ok=True)
    segment_count = write_ndjson(
        result_dir / "segments.ndjson",
        (segment_payload(segment) for segment in result.segments),
    )
    matched_count = write_ndjson(
        result_dir / "matched.ndjson",
        (matched_payload(row) for row in result.matched_records),
    )
    remaining_count = write_ndjson(
        result_dir / "remaining.ndjson",
        (remaining_payload(row) for row in result.remaining_rows),
    )

    meta = read_json(job_dir / "meta.json", {}) or {}
    summary = {
        **result.summary(),
        "source": {
            "filename": meta.get("originalFilename") or source.name,
            "sheetName": sheet_name,
            "headerRow": request["headerRow"],
            "headers": headers,
        },
        "counts": {
            "segments": segment_count,
            "matchedRecords": matched_count,
            "remainingRows": remaining_count,
        },
        "generatedAt": _now(),
        "durationSeconds": round(time.time() - started, 2),
        "status": "completed",
    }
    write_json_atomic(result_dir / "summary.json", summary)
    update_status(job_dir, progress=80, message="结果已生成，正在打包 CSV…")

    csv_path = result_dir / "reconciliation-result-csv.zip"
    write_csv_zip(csv_path, result)

    update_status(
        job_dir,
        status="completed",
        progress=88,
        message="CSV 已就绪，Dashboard 可查看；正在生成 XLSX…",
        result=to_jsonable(summary),
        csv=str(csv_path.relative_to(job_dir)),
        xlsx="generating",
    )

    xlsx_path = result_dir / "reconciliation-result.xlsx"
    try:
        write_xlsx(xlsx_path, result, source_name=meta.get("originalFilename") or source.name)
    except Exception as error:  # XLSX failure must not discard a valid analysis
        update_status(
            job_dir,
            progress=100,
            message="分析完成，但 XLSX 生成失败；CSV 仍可下载。",
            xlsx="error",
            xlsxError=str(error)[:500],
        )
        return

    update_status(
        job_dir,
        progress=100,
        message="对抵完成。",
        xlsx="ready",
        xlsxPath=str(xlsx_path.relative_to(job_dir)),
    )


def main(argv: List[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Purchase/reconciliation FIFO worker")
    parser.add_argument("--job-dir", required=True)
    args = parser.parse_args(argv)
    job_dir = Path(args.job_dir)
    try:
        run(job_dir)
        return 0
    except (WorkerError, ColumnMappingError, WorkbookReadError, ValueError) as error:
        update_status(
            job_dir,
            status="failed",
            progress=100,
            message="对抵失败。",
            error=str(error)[:500],
        )
        return 2
    except Exception as error:  # pragma: no cover - defensive
        update_status(
            job_dir,
            status="failed",
            progress=100,
            message="对抵失败。",
            error=f"处理失败：{error}"[:500],
        )
        return 1


if __name__ == "__main__":
    sys.exit(main())
