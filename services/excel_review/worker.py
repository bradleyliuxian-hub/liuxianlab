#!/usr/bin/env python3
"""Excel Review Assistant worker (CLI).

Usage:
    python -m services.excel_review.worker --job-dir <dir>

The worker is database-free. It reads the source workbook, extracts all
comments/notes (legacy + Microsoft 365 threaded), writes review.xlsx and
extracted.json, and reports progress via status.json. It exits 0 on
success, non-zero on failure.
"""

import argparse
import json
import sys
import traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from services.excel_review import parser, review_workbook  # noqa: E402
from services.excel_review.status import (  # noqa: E402
    STATUS_REVIEW_READY,
    Reporter,
    ReviewError,
)


def _read_source_filename(job_dir):
    meta_path = job_dir / "meta.json"
    if meta_path.exists():
        try:
            data = json.loads(meta_path.read_text(encoding="utf-8"))
            name = data.get("originalFilename")
            if name:
                return str(name)
        except (OSError, ValueError):
            pass
    return "source.xlsx"


def run(job_dir, reporter):
    source_path = job_dir / "source.xlsx"
    if not source_path.exists():
        raise ReviewError("源文件不存在。")

    source_filename = _read_source_filename(job_dir)

    reporter.update(8, "正在读取工作簿…")
    extracted = parser.extract(source_path, source_filename=source_filename)
    items = extracted["items"]
    statistics = extracted["statistics"]
    question_count = statistics["questions_total"]

    reporter.update(
        40,
        "已发现 %d 个问题，正在生成复核文件…" % question_count,
        status="processing",
    )

    review_path = job_dir / "review.xlsx"
    rows = review_workbook.build_review_workbook(
        review_path,
        items,
        job_dir.name,
        extracted["sourceSha256"],
        source_filename,
        statistics,
    )
    if rows:
        token = rows[0]["mapping_token"]
    else:
        token = review_workbook.compute_mapping_token([])
    extracted["mappingToken"] = token
    extracted["jobId"] = job_dir.name
    review_workbook.verify_openable(review_path)

    (job_dir / "extracted.json").write_text(
        json.dumps(extracted, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    if question_count == 0:
        message = "未发现可复核的批注。"
    else:
        message = "已生成复核文件，共 %d 个问题。" % question_count

    warnings = extracted.get("warnings") or []
    if warnings:
        message = "%s %s" % (message, " ".join(warnings))

    reporter.finish(
        STATUS_REVIEW_READY,
        message=message,
        progress=100,
        item_count=question_count,
        result={
            "itemCount": question_count,
            "statistics": statistics,
            "sourceSha256": extracted["sourceSha256"],
            "mappingVersion": extracted["mappingVersion"],
            "reviewToken": token,
            "hasThreaded": extracted.get("hasThreaded", False),
            "warnings": warnings,
        },
    )


def main(argv=None):
    argument_parser = argparse.ArgumentParser(
        description="Liuxian Lab Excel Review worker"
    )
    argument_parser.add_argument("--job-dir", required=True)
    args = argument_parser.parse_args(argv)

    job_dir = Path(args.job_dir).resolve()
    reporter = Reporter(job_dir)

    try:
        run(job_dir, reporter)
    except ReviewError as exc:
        reporter.fail(str(exc))
        return 1
    except Exception as exc:  # noqa: BLE001
        traceback.print_exc()
        reporter.fail(
            "处理过程中发生未预期的错误，请稍后重试或更换文件。",
            error="%s: %s" % (type(exc).__name__, exc),
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
