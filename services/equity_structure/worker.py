"""Background worker for equity-structure OCR."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import List

from .job_io import read_json, update_status, write_json_atomic
from .service import analyze_image


class WorkerError(RuntimeError):
    pass


def _source_path(job_dir: Path) -> Path:
    meta = read_json(job_dir / "meta.json", {}) or {}
    source = meta.get("sourceFile") or meta.get("sourcePath")
    if not source:
        raise WorkerError("任务缺少源文件信息。")
    path = Path(source)
    return path if path.is_absolute() else (job_dir / path)


def _progress(job_dir: Path):
    def callback(percent: int, message: str) -> None:
        update_status(
            job_dir,
            status="running",
            progress=max(0, min(100, int(percent))),
            message=message,
        )
    return callback


def run(job_dir: Path) -> None:
    update_status(job_dir, status="running", progress=2, message="正在启动股权结构识别…")
    source = _source_path(job_dir)
    if not source.exists():
        raise WorkerError("源图片不存在或已过期。")
    raw = source.read_bytes()
    if not raw:
        raise WorkerError("源图片为空。")

    result = analyze_image(raw, progress=_progress(job_dir))
    result_dir = job_dir / "result"
    result_dir.mkdir(parents=True, exist_ok=True)
    result_path = result_dir / "result.json"
    payload = result.to_dict()
    write_json_atomic(result_path, payload)
    summary = {
        "title": result.title,
        "core_company": result.core_company,
        "node_count": len(result.nodes),
        "edge_count": len(result.edges),
        "excluded_count": len(result.excluded),
        "correction_count": len(result.dictionary_corrections),
        "overall_confidence": result.quality.overall_confidence,
        "warnings": result.warnings,
    }
    update_status(
        job_dir,
        status="completed",
        progress=100,
        message="识别完成。",
        summary=summary,
        diagnostics=result.diagnostics.to_dict(),
        resultPath=str(result_path.relative_to(job_dir)),
    )


def main(argv: List[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Equity structure OCR worker")
    parser.add_argument("--job-dir", required=True)
    args = parser.parse_args(argv)
    job_dir = Path(args.job_dir)
    try:
        run(job_dir)
        return 0
    except Exception as error:
        update_status(
            job_dir,
            status="failed",
            progress=100,
            message="识别失败。",
            error=str(error)[:800],
        )
        return 2


if __name__ == "__main__":
    sys.exit(main())
