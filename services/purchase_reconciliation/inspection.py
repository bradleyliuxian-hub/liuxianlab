"""Workbook inspection used before the user starts a reconciliation."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Any, Dict

from .column_mapper import resolve_mapping
from .excel_reader import WorkbookReadError, inspect_workbook, list_sheets
from .job_io import read_json, update_status, write_json_atomic
from .schema import public_field_schema


def _source_path(job_dir: Path) -> Path:
    meta = read_json(job_dir / "meta.json", {}) or {}
    source = meta.get("sourcePath") or meta.get("source_path")
    if source:
        path = Path(source)
        return path if path.is_absolute() else (job_dir / path).resolve()
    for candidate in ("source.xlsx", "source.xlsm"):
        path = job_dir / candidate
        if path.exists():
            return path
    raise FileNotFoundError("找不到上传的源文件。")


def inspect(job_dir: Path) -> Dict[str, Any]:
    request = read_json(job_dir / "request.json", {}) or {}
    sheet_name = (request.get("sheetName") or "").strip() or None
    header_row = request.get("headerRow")
    header_row = int(header_row) if header_row not in (None, "") else None
    source = _source_path(job_dir)

    try:
        inspection = inspect_workbook(source, sheet_name=sheet_name, header_row=header_row)
    except WorkbookReadError as error:
        return {
            "ok": False,
            "error": str(error),
            "sheets": list_sheets(source),
            "selectedSheet": sheet_name,
            "headerRow": header_row or 1,
            "headers": [],
            "dataRowCount": 0,
            "sampleRows": [],
        }

    mapping = resolve_mapping(inspection["headers"], request.get("mapping") or None)
    return {
        "ok": True,
        "sheets": inspection["sheets"],
        "selectedSheet": inspection["selected_sheet"],
        "headerRow": inspection["header_row"],
        "headers": inspection["headers"],
        "dataRowCount": inspection["data_row_count"],
        "sampleRows": inspection["sample_rows"],
        "mapping": mapping["mapping"],
        "missing": mapping["missing"],
        "missingLabels": mapping["missing_labels"],
        "ambiguous": mapping["ambiguous"],
        "invalidMapping": mapping.get("invalid", []),
        "fieldSchema": public_field_schema(),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Inspect a workbook for reconciliation")
    parser.add_argument("--job-dir", required=True)
    args = parser.parse_args(argv)
    job_dir = Path(args.job_dir)
    try:
        payload = inspect(job_dir)
        write_json_atomic(job_dir / "inspection.json", payload)
        return 0
    except (WorkbookReadError, FileNotFoundError, ValueError) as error:
        write_json_atomic(job_dir / "inspection.json", {"ok": False, "error": str(error)})
        update_status(job_dir, message=str(error))
        return 2
    except Exception as error:  # pragma: no cover - defensive
        write_json_atomic(job_dir / "inspection.json", {"ok": False, "error": f"识别失败：{error}"})
        return 1


if __name__ == "__main__":
    sys.exit(main())
