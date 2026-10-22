#!/usr/bin/env python3
"""Journal Entry Analysis worker.

Usage:
    python -m services.journal_entry.worker --job-dir <dir>

Reads request.json + source.xlsx/source.xls from the job directory, runs the
canonical normalization, business classification, contra analysis, and anomaly
analysis, then writes result.json, report.xlsx, the browser UI projection,
and status.json. The UI projection is a transform of the canonical result only.
"""

from __future__ import annotations

import argparse
import json
import sys
import traceback
from datetime import datetime, timezone
from pathlib import Path

from .accounting_features import voucher_key_for_entry
from .analysis_result import build_analysis_result
from .anomaly import analyze_anomalies
from .business import classify_entries
from .contra import ContraEngine
from .errors import JournalEntryError
from .export import build_export
from .job_io import normalize_request, read_json
from .status import Reporter
from .ui_projection import build_ui_projection

EXPORT_FILENAME = "journal-entry-analysis-report.xlsx"
RESULT_FILENAME = "result.json"


def run(job_dir: Path, reporter: Reporter) -> dict:
    meta = read_json(job_dir / "meta.json", default={}) or {}
    original_filename = str(meta.get("originalFilename") or "workbook.xlsx")

    reporter.update(5, "正在读取序时账…")
    normalization = normalize_request(job_dir)
    reporter.update(
        25,
        "已重建 %d 张凭证，正在分类…" % len(normalization.entries),
    )

    business_result = classify_entries(normalization.entries)
    reporter.update(45, "正在分析对方科目…")

    contra_engine = ContraEngine()
    contra_results = {}
    for index, entry in enumerate(normalization.entries, start=1):
        contra_results[voucher_key_for_entry(entry)] = contra_engine.analyze(entry)
        if index % 100 == 0:
            reporter.update(
                45 + min(30, int(index / max(1, len(normalization.entries)) * 30)),
                "正在分析对方科目… %d/%d" % (index, len(normalization.entries)),
            )

    reporter.update(80, "正在检测异常凭证…")
    anomaly_result = analyze_anomalies(
        normalization.entries,
        contra_results=contra_results,
    )
    reporter.update(90, "正在生成结果与 Excel 报告…")

    generated_at = datetime.now(timezone.utc).isoformat()
    payload = build_analysis_result(
        job_id=job_dir.name,
        original_filename=original_filename,
        normalization=normalization,
        business_result=business_result,
        contra_results=contra_results,
        anomaly_result=anomaly_result,
        export_filename=EXPORT_FILENAME,
        generated_at=generated_at,
    )

    result_path = job_dir / RESULT_FILENAME
    result_path.write_text(
        json.dumps(
            payload,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        )
        + "\n",
        encoding="utf-8",
    )

    export_path = job_dir / EXPORT_FILENAME
    build_export(export_path, payload)
    reporter.update(97, "正在生成浏览索引…")
    build_ui_projection(payload, job_dir / "ui")
    reporter.update(99, "正在完成…")
    cleaning = payload.get("cleaning_summary", {})
    business = payload.get("business_classification_summary", {})
    reporter.finish(
        message="序时账分析完成。",
        progress=100,
        result={
            "raw_row_count": cleaning.get("raw_row_count"),
            "line_count": cleaning.get("line_count"),
            "voucher_count": len(normalization.entries),
            "issue_count": cleaning.get("issue_count"),
            "unbalanced_voucher_count": cleaning.get(
                "unbalanced_voucher_count"
            ),
            "business_classified_count": business.get("classified_count"),
            "business_voucher_count": business.get("voucher_count"),
            "finding_count": len(anomaly_result.findings),
            "finding_voucher_count": anomaly_result.summary.get(
                "finding_voucher_count", 0
            ),
            "review_rate": anomaly_result.summary.get("review_rate", "0"),
        },
    )
    return payload


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Liuxian Lab Journal Entry worker")
    parser.add_argument("--job-dir", required=True)
    args = parser.parse_args(argv)

    job_dir = Path(args.job_dir).resolve()
    reporter = Reporter(job_dir)
    try:
        run(job_dir, reporter)
    except JournalEntryError as exc:
        reporter.fail(exc.message, error=exc.code)
        return 1
    except Exception as exc:  # noqa: BLE001
        traceback.print_exc()
        reporter.fail(
            "序时账分析失败，请检查文件或映射。",
            error="%s: %s" % (type(exc).__name__, exc),
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
