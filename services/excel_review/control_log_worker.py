#!/usr/bin/env python3
"""Excel Review Assistant - Multi-file Control Log worker (CLI).

Usage:
    python -m services.excel_review.control_log_worker --control-dir <dir>

Database-free. Reads ``input.json`` (jobs + their already-extracted items)
from the control directory, writes ``control_log.json`` (snapshot) and
``control_log.xlsx``, and reports via ``status.json``. The Node route reads
status.json back to fill the DB row.
"""

import argparse
import json
import sys
import traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from services.excel_review import control_log  # noqa: E402
from services.excel_review.status import (  # noqa: E402
    STATUS_REVIEW_READY,
    Reporter,
    ReviewError,
)


def run(control_dir, reporter):
    input_path = control_dir / "input.json"
    if not input_path.exists():
        raise ReviewError("Control Log 输入数据不存在。")

    try:
        payload = json.loads(input_path.read_text(encoding="utf-8"))
    except ValueError as exc:
        raise ReviewError("Control Log 输入数据无法解析。") from exc

    jobs = payload.get("jobs") or []
    items_by_job = payload.get("itemsByJob") or {}
    if not jobs:
        raise ReviewError("没有可用于生成 Control Log 的任务。")

    reporter.update(30, "正在汇总 %d 个文件…" % len(jobs))

    snapshot = control_log.build_snapshot(
        payload.get("controlLogId", control_dir.name),
        payload.get("name") or "Control Log",
        jobs,
        items_by_job,
        created_at=payload.get("createdAt"),
    )

    reporter.update(70, "正在生成 Control Log 文件…")

    control_log.write_snapshot(control_dir / "control_log.json", snapshot)
    control_log.build_control_log_workbook(control_dir / "control_log.xlsx", snapshot)

    counts = control_log.snapshot_counts(snapshot)
    message = "已汇总 %d 个文件，共 %d 个问题。" % (
        counts["fileCount"], counts["questionCount"])

    reporter.finish(
        STATUS_REVIEW_READY,
        message=message,
        progress=100,
        item_count=counts["questionCount"],
        result=counts,
    )


def main(argv=None):
    parser = argparse.ArgumentParser(description="Liuxian Lab Excel Review Control Log worker")
    parser.add_argument("--control-dir", required=True)
    args = parser.parse_args(argv)

    control_dir = Path(args.control_dir).resolve()
    reporter = Reporter(control_dir)

    try:
        run(control_dir, reporter)
    except ReviewError as exc:
        reporter.fail(str(exc))
        return 1
    except Exception as exc:  # noqa: BLE001
        traceback.print_exc()
        reporter.fail(
            "生成 Control Log 时发生未预期的错误。",
            error="%s: %s" % (type(exc).__name__, exc),
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
