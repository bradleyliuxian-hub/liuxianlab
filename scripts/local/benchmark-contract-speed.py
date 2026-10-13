#!/usr/bin/env python3
"""
Contract Digitization v1.1 speed benchmark.

Two modes:

  --mock   (default)  Deterministic harness. No MinerU. Uses the real
                      worker orchestration + cache + quality gate with a
                      synthetic parser, so the cache/cold/warm effect is
                      measurable and repeatable.

  --real              Real MinerU. Runs mineru_service.parse_contract on
                      the given PDF for each tier and reports real timing.
                      Requires .mineru and is slow (minutes per tier).

Examples:

  .mineru/bin/python scripts/local/benchmark-contract-speed.py --mock
  .mineru/bin/python scripts/local/benchmark-contract-speed.py \
      --real --pdf storage/contracts/<id>/source.pdf --tiers basic,standard

Output: console table (+ --json FILE).
"""

import argparse
import json
import sys
import tempfile
import time
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]

sys.path.insert(0, str(PROJECT_ROOT))

from services.contract_review import parse_cache  # noqa: E402


GOOD_TEXT = "甲方与乙方签订设备租赁合同，约定租赁期限与租金。 " * 200
BAD_TEXT = "[Illegible] " * 60


def _fmt(value):
    if value is None:
        return "-"
    if isinstance(value, float):
        return f"{value:.1f}"
    return str(value)


def _print_table(rows):
    columns = [
        "mode",
        "run",
        "actualTier",
        "fallbackUsed",
        "cacheHit",
        "totalMs",
        "basicParseMs",
        "standardParseMs",
        "markdownChars",
        "pageCount",
        "issueCount",
    ]

    widths = {
        column: max(
            len(column),
            max(
                (len(_fmt(row.get(column))) for row in rows),
                default=0,
            ),
        )
        for column in columns
    }

    header = "  ".join(
        column.ljust(widths[column])
        for column in columns
    )

    print(header)
    print("-" * len(header))

    for row in rows:
        print(
            "  ".join(
                _fmt(row.get(column)).ljust(widths[column])
                for column in columns
            )
        )


# ---------------------------------------------------------------------------
# Mock harness
# ---------------------------------------------------------------------------

def run_mock(args):
    import services.contract_review.worker as worker

    tmp = tempfile.TemporaryDirectory()
    root = Path(tmp.name)

    original = {
        "PROJECT_ROOT": worker.PROJECT_ROOT,
        "database": worker.database,
        "parse_contract": worker.parse_contract,
        "prepare_review_artifacts": worker.prepare_review_artifacts,
        "build_consistency_artifacts": worker.build_consistency_artifacts,
        "_sha256_file": worker._sha256_file,
        "cache_root": parse_cache.CACHE_ROOT,
    }

    worker.PROJECT_ROOT = root
    parse_cache.CACHE_ROOT = root / "contracts-cache"

    import hashlib

    def _fake_sha(path):
        # One stable sha per mode so "cold" is genuinely cold and
        # "warm" reuses the same owner+sha cache entry.
        name = str(path)

        for mode in ("fast", "accurate", "auto"):
            if f"bench-{mode}-" in name:
                return hashlib.sha256(
                    mode.encode("utf-8")
                ).hexdigest()

        return "d" * 64

    worker._sha256_file = _fake_sha

    # Simulated MinerU durations (seconds) per tier.
    tier_seconds = {
        "basic": args.basic_seconds,
        "standard": args.standard_seconds,
    }

    state = {
        "metadata": None,
        "issue_count": 0,
    }

    class FakeDatabase:
        def is_contract_deleted(self, contract_id):
            return False

        def update_contract_state(self, *a, **k):
            return {}

        def update_contract_progress(self, *a, **k):
            return {}

        def update_parse_metadata(self, contract_id, **fields):
            state["metadata"] = fields
            return True

        def delete_contract_row(self, contract_id):
            return None

    def fake_parse(contract, *, tier, on_stage=None):
        time.sleep(tier_seconds.get(tier, 0.05))

        parsed_dir = (
            (root / contract["file_path"]).resolve().parent
            / "parsed"
        )
        parsed_dir.mkdir(parents=True, exist_ok=True)

        text = GOOD_TEXT if args.auto_basic_pass else BAD_TEXT
        if tier == "standard":
            text = GOOD_TEXT

        raw = parsed_dir / "document.raw.md"
        raw.write_text(text, encoding="utf-8")

        pages = [
            {
                "page_idx": i,
                "blocks": [{"type": "text", "content": text[:200]}],
            }
            for i in range(4)
        ]

        middle = parsed_dir / "document.middle.json"
        middle.write_text(
            json.dumps({"pages": pages}),
            encoding="utf-8",
        )

        if on_stage:
            on_stage("layout")

        return {
            "output_path": str(raw),
            "markdown_path": str(raw),
            "middle_json_path": str(middle),
            "structured_json_path": None,
            "output_size": raw.stat().st_size,
            "tier": tier,
        }

    def prepare_review(raw, *, original_name, middle_json_path):
        state["issue_count"] = args.issue_count
        return {"draft_path": "d", "issues_path": "i", "issue_count": args.issue_count}

    worker.database = FakeDatabase()
    worker.parse_contract = fake_parse
    worker.prepare_review_artifacts = prepare_review
    worker.build_consistency_artifacts = lambda **k: {
        "fields_path": "f",
        "consistency_issue_count": 0,
    }

    rows = []

    try:
        for mode in ("fast", "accurate", "auto"):
            for run_label in ("cold", "warm"):
                contract_id = f"bench-{mode}-{run_label}"

                job_dir = root / "storage" / "contracts" / contract_id
                job_dir.mkdir(parents=True, exist_ok=True)
                (job_dir / "source.pdf").write_bytes(b"%PDF-1.4")

                contract = {
                    "id": contract_id,
                    "owner_username": args.owner,
                    "original_name": "contract.pdf",
                    "file_path": f"storage/contracts/{contract_id}/source.pdf",
                    "parse_mode_requested": mode,
                    "page_count": 4,
                }

                state["metadata"] = None

                start = time.monotonic()
                worker.process_contract(contract)
                total_ms = int((time.monotonic() - start) * 1000)

                meta = state["metadata"] or {}
                metrics = meta.get("parse_metrics") or {}

                rows.append({
                    "mode": mode,
                    "run": run_label,
                    "actualTier": meta.get("parse_tier_actual"),
                    "fallbackUsed": meta.get("parse_fallback_used"),
                    "cacheHit": meta.get("parse_cache_hit"),
                    "totalMs": total_ms,
                    "basicParseMs": metrics.get("basicParseMs"),
                    "standardParseMs": metrics.get("standardParseMs"),
                    "markdownChars": (metrics.get("qualityGate") or {}).get(
                        "metrics", {}
                    ).get("markdownChars"),
                    "pageCount": meta.get("page_count"),
                    "issueCount": state["issue_count"],
                })

    finally:
        worker.PROJECT_ROOT = original["PROJECT_ROOT"]
        worker.database = original["database"]
        worker.parse_contract = original["parse_contract"]
        worker.prepare_review_artifacts = original["prepare_review_artifacts"]
        worker.build_consistency_artifacts = original["build_consistency_artifacts"]
        worker._sha256_file = original["_sha256_file"]
        parse_cache.CACHE_ROOT = original["cache_root"]
        tmp.cleanup()

    return rows


# ---------------------------------------------------------------------------
# Real MinerU harness
# ---------------------------------------------------------------------------

def run_real(args):
    import uuid

    from services.contract_review import mineru_service
    from services.contract_review.quality_gate import evaluate_parse_quality

    pdf = Path(args.pdf).resolve()

    if not pdf.is_file():
        raise SystemExit(f"PDF not found: {pdf}")

    tiers = [
        tier.strip()
        for tier in args.tiers.split(",")
        if tier.strip()
    ]

    rows = []

    bench_root = (
        PROJECT_ROOT
        / "storage"
        / "contracts"
        / f"bench-{uuid.uuid4().hex}"
    )
    bench_root.mkdir(parents=True, exist_ok=True)

    try:
        for tier in tiers:
            job_dir = bench_root / tier
            job_dir.mkdir(parents=True, exist_ok=True)

            source = job_dir / "source.pdf"

            import shutil

            shutil.copy2(pdf, source)

            contract = {
                "id": tier,
                "file_path": str(
                    source.relative_to(PROJECT_ROOT)
                ),
            }

            start = time.monotonic()

            result = mineru_service.parse_contract(
                contract,
                tier=tier,
            )

            total_ms = int((time.monotonic() - start) * 1000)

            quality = evaluate_parse_quality(
                result["output_path"],
                middle_json_path=result.get("middle_json_path"),
            )

            markdown = Path(result["output_path"]).read_text(
                encoding="utf-8",
                errors="replace",
            )

            rows.append({
                "mode": tier,
                "run": "cold",
                "actualTier": tier,
                "fallbackUsed": False,
                "cacheHit": False,
                "totalMs": total_ms,
                "basicParseMs": total_ms if tier == "basic" else None,
                "standardParseMs": total_ms if tier == "standard" else None,
                "markdownChars": quality["metrics"].get("markdownChars"),
                "pageCount": quality["metrics"].get("pageCountParsed"),
                "issueCount": len(quality["reasons"]),
            })

    finally:
        import shutil

        shutil.rmtree(bench_root, ignore_errors=True)

    return rows


def main():
    parser = argparse.ArgumentParser()

    parser.add_argument("--pdf")
    parser.add_argument("--owner", default="benchmark")
    parser.add_argument("--json")
    parser.add_argument("--real", action="store_true")
    parser.add_argument("--mock", action="store_true")
    parser.add_argument("--tiers", default="basic,standard")

    parser.add_argument("--basic-seconds", type=float, default=0.05)
    parser.add_argument("--standard-seconds", type=float, default=0.15)
    parser.add_argument("--issue-count", type=int, default=0)
    parser.add_argument("--auto-basic-pass", action="store_true", default=True)

    args = parser.parse_args()

    if args.real:
        rows = run_real(args)
    else:
        rows = run_mock(args)

    _print_table(rows)

    print()
    print("mode legend: auto(自动) fast(快速) accurate(高精度)")
    print("cold = empty cache, warm = cache reuse")

    if args.json:
        Path(args.json).write_text(
            json.dumps(rows, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        print(f"JSON written: {args.json}")


if __name__ == "__main__":
    main()
