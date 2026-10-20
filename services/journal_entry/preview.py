"""Inspect / preview CLI for Journal Entry Analysis.

Usage:
    python -m services.journal_entry.preview --job-dir <dir> --inspect
    python -m services.journal_entry.preview --job-dir <dir> --preview

Inspect writes inspection.json. Preview writes preview.json. Neither prints
financial data to stdout.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from .errors import JournalEntryError
from .job_io import find_source_path, load_request, normalize_request, write_json
from .mapping import CANONICAL_FIELDS, suggest_mapping
from .reader import WorkbookReader, detect_header_row


def _balance_summary(entries):
    exact = sum(1 for entry in entries if entry.exactly_balanced)
    within_only = sum(
        1
        for entry in entries
        if not entry.exactly_balanced and entry.is_within_tolerance
    )
    unbalanced = sum(1 for entry in entries if not entry.is_within_tolerance)
    return {
        "exactly_balanced_voucher_count": exact,
        "within_tolerance_only_voucher_count": within_only,
        "unbalanced_voucher_count": unbalanced,
    }


def build_inspection(job_dir: Path) -> dict:
    source = find_source_path(job_dir)
    reader = WorkbookReader(source)
    sheets = reader.list_sheets()
    if not sheets:
        raise JournalEntryError("工作簿没有工作表。")
    request = {}
    try:
        request = load_request(job_dir)
    except JournalEntryError:
        request = {}

    selected = request.get("sheetName")
    if selected not in [sheet.name for sheet in sheets]:
        selected = max(sheets, key=lambda sheet: sheet.max_row).name

    inspection = reader.inspect_sheet(selected, sample_rows=30)
    header_row = request.get("headerRow")
    if header_row is None:
        header_row = inspection.header_candidates[0].row_number if inspection.header_candidates else detect_header_row(inspection.sample_rows)
    headers = []
    data_row_count = 0
    if header_row:
        headers, rows, _ = reader.read_table(selected, int(header_row))
        data_row_count = len(rows)

    mapping_error = None
    suggested = {}
    explicit = {}
    amount_layout = None
    ambiguous = {}
    ambiguous_candidates = {}
    warnings = []
    if headers:
        try:
            explicit_meta = {}
            if request.get("amountLayout"):
                explicit_meta["amount_layout"] = request.get("amountLayout")
            if request.get("positiveSide"):
                explicit_meta["positive_side"] = request.get("positiveSide")
            mapping = suggest_mapping(
                headers,
                explicit=explicit_meta or None,
                header_row=int(header_row) if header_row else None,
                sheet_name=selected,
            )
            suggested = {
                name: field.to_dict()
                for name, field in mapping.fields.items()
            }
            explicit = {
                name: field.column_index
                for name, field in mapping.fields.items()
                if field.column_index is not None
            }
            amount_layout = mapping.amount_layout.to_dict()
            ambiguous = {
                name: list(values)
                for name, values in mapping.ambiguous.items()
            }
            ambiguous_candidates = {
                name: [dict(candidate) for candidate in candidates]
                for name, candidates in mapping.ambiguous_candidates.items()
            }
            warnings = list(mapping.warnings)
        except JournalEntryError as exc:
            mapping_error = exc.to_dict()

    return {
        "ok": True,
        "sourceFilename": source.name,
        "sheetCount": len(sheets),
        "sheets": [sheet.to_dict() for sheet in sheets],
        "selectedSheet": selected,
        "headerRow": int(header_row) if header_row else None,
        "headerCandidates": [
            candidate.to_dict() for candidate in inspection.header_candidates
        ],
        "headers": [str(value) for value in headers],
        "dataRowCount": data_row_count,
        "canonicalFields": list(CANONICAL_FIELDS),
        "suggestedMapping": suggested,
        "explicitMapping": explicit,
        "amountLayout": amount_layout,
        "ambiguous": ambiguous,
        "ambiguousCandidates": ambiguous_candidates,
        "mappingError": mapping_error,
        "warnings": warnings,
    }


def build_preview(job_dir: Path) -> dict:
    normalization = normalize_request(job_dir)
    issues = list(normalization.issues)
    issue_limit = 200
    balance = _balance_summary(normalization.entries)
    return {
        "ok": True,
        "mapping": normalization.mapping.to_dict(),
        "cleaningSummary": {
            "rawRowCount": normalization.raw_row_count,
            "lineCount": len(normalization.lines),
            "voucherCount": len(normalization.entries),
            "issueCount": len(issues),
            "rowWarningCount": len(normalization.row_warnings),
            "largestVoucherLineCount": max(
                (len(entry.lines) for entry in normalization.entries),
                default=0,
            ),
            **balance,
        },
        "issuesTotal": len(issues),
        "issues": [issue.to_dict() for issue in issues[:issue_limit]],
        "rowWarnings": [
            warning.to_dict()
            for warning in normalization.row_warnings[:issue_limit]
        ],
        "sampleVouchers": [
            entry.to_dict() for entry in normalization.entries[:3]
        ],
        "canStart": bool(normalization.entries and normalization.lines),
        "warnings": list(normalization.warnings),
    }


def run(job_dir: Path, inspect: bool) -> int:
    output = job_dir / ("inspection.json" if inspect else "preview.json")
    try:
        payload = build_inspection(job_dir) if inspect else build_preview(job_dir)
    except JournalEntryError as exc:
        payload = {"ok": False, "error": exc.to_dict()}
    except Exception as exc:  # noqa: BLE001
        payload = {
            "ok": False,
            "error": {
                "code": "PREVIEW_INTERNAL_ERROR",
                "message": "预览处理失败。",
                "details": {"type": type(exc).__name__},
            },
        }
    write_json(output, payload)
    return 0


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Journal Entry preview CLI")
    parser.add_argument("--job-dir", required=True)
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--inspect", action="store_true")
    group.add_argument("--preview", action="store_true")
    args = parser.parse_args(argv)
    return run(Path(args.job_dir).resolve(), inspect=args.inspect)


if __name__ == "__main__":
    raise SystemExit(main())
