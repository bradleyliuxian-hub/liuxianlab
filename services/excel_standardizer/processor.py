#!/usr/bin/env python3
import argparse
import json
import os
import sys
import traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from openpyxl import load_workbook  # noqa: E402

from services.excel_standardizer.audit import AuditLog  # noqa: E402
from services.excel_standardizer.job_state import read_job, update_job  # noqa: E402
from services.excel_standardizer.preview import build_preview  # noqa: E402
from services.excel_standardizer.rules import (  # noqa: E402
    autofit_columns,
    header_style,
    normalize_dates,
    remove_empty_rows,
    sheet_settings,
    trim_text,
)

RULES = [
    ("trim_text", trim_text),
    ("normalize_dates", normalize_dates),
    ("header_style", header_style),
    ("autofit_columns", autofit_columns),
    ("sheet_settings", sheet_settings),
    ("remove_empty_rows", remove_empty_rows),
]


def load_profile(name: str):
    safe = "".join(ch for ch in name if ch.isalnum() or ch in "_-") or "default"
    path = ROOT / "config" / "excel_profiles" / f"{safe}.json"
    if not path.exists():
        raise FileNotFoundError(f"Excel profile not found: {safe}")
    data = json.loads(path.read_text(encoding="utf-8"))
    return safe, data


def workbook_summary(workbook):
    return {
        "sheetCount": len(workbook.worksheets),
        "sheets": [
            {
                "name": ws.title,
                "rows": ws.max_row,
                "columns": ws.max_column,
            }
            for ws in workbook.worksheets
        ],
    }


def set_recalculation_flags(workbook):
    try:
        workbook.calculation.fullCalcOnLoad = True
        workbook.calculation.forceFullCalc = True
        workbook.calculation.calcMode = "auto"
    except Exception:
        pass


def process(job_dir: Path, profile_name: str):
    input_path = job_dir / "input.xlsx"
    output_path = job_dir / "output.xlsx"
    changes_path = job_dir / "changes.jsonl"
    preview_path = job_dir / "preview.json"

    profile_name, profile = load_profile(profile_name)

    update_job(
        job_dir,
        status="validating",
        stage="validating",
        progress=5,
        message="正在检查 Excel 工作簿…",
        profile=profile_name,
    )

    if not input_path.exists():
        raise FileNotFoundError("input.xlsx not found")

    # data_only=False keeps formula expressions. keep_links=True preserves external-link metadata where supported.
    workbook = load_workbook(input_path, data_only=False, read_only=False, keep_links=True)
    initial_summary = workbook_summary(workbook)

    update_job(
        job_dir,
        status="processing",
        stage="processing",
        progress=12,
        message=f"已读取 {initial_summary['sheetCount']} 个工作表，开始执行标准化规则…",
        workbook=initial_summary,
    )

    audit = AuditLog(changes_path)
    try:
        enabled_rules = []
        rules_config = profile.get("rules", {})
        for name, module in RULES:
            config = rules_config.get(name, {})
            if config.get("enabled", name != "remove_empty_rows"):
                enabled_rules.append((name, module, config))

        total_rules = max(1, len(enabled_rules))
        for index, (name, module, config) in enumerate(enabled_rules, start=1):
            start_progress = 15 + int((index - 1) / total_rules * 58)
            update_job(
                job_dir,
                status="processing",
                stage=name,
                progress=start_progress,
                message=config.get("label") or f"正在执行规则：{name}",
            )
            module.apply(workbook, audit, config)

        set_recalculation_flags(workbook)

        update_job(
            job_dir,
            status="checking",
            stage="saving",
            progress=78,
            message="正在保存标准化后的工作簿…",
        )
        workbook.save(output_path)

        update_job(
            job_dir,
            status="checking",
            stage="checking",
            progress=86,
            message="正在校验输出文件…",
        )
        # Reopen in read-only mode to verify the generated workbook can be parsed.
        check_book = load_workbook(output_path, data_only=False, read_only=True, keep_links=True)
        check_summary = workbook_summary(check_book)
        check_book.close()

        update_job(
            job_dir,
            status="reporting",
            stage="reporting",
            progress=92,
            message="正在生成变更报告和网页预览…",
        )
        preview_config = profile.get("preview", {})
        build_preview(
            workbook,
            preview_path,
            max_rows=max(1, int(preview_config.get("rows", 50))),
            max_cols=max(1, int(preview_config.get("columns", 20))),
        )

        summary = audit.summary()
        summary.update({
            "sheetCount": check_summary["sheetCount"],
            "sheets": check_summary["sheets"],
            "inputBytes": input_path.stat().st_size,
            "outputBytes": output_path.stat().st_size,
            "rulesApplied": [name for name, _module, _config in enabled_rules],
        })

        result_path = job_dir / "result.json"
        result_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

        update_job(
            job_dir,
            status="completed",
            stage="completed",
            progress=100,
            message="Excel 标准化完成。",
            summary=summary,
            outputBytes=output_path.stat().st_size,
        )
    finally:
        audit.close()
        workbook.close()


def main():
    parser = argparse.ArgumentParser(description="Liuxian Lab Excel Standardizer")
    parser.add_argument("--job-dir", required=True)
    parser.add_argument("--profile", default="default")
    args = parser.parse_args()

    job_dir = Path(args.job_dir).resolve()
    try:
        process(job_dir, args.profile)
    except Exception as exc:
        error_text = f"{type(exc).__name__}: {exc}"
        traceback.print_exc()
        try:
            update_job(
                job_dir,
                status="failed",
                stage="failed",
                progress=100,
                message="Excel 处理失败，请查看错误信息。",
                error=error_text,
            )
        except Exception:
            pass
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
