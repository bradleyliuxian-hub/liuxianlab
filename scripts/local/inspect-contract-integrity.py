#!/usr/bin/env python3
"""
Local, read-only diagnostic for the v1.1.1 critical integrity gate.

Runs the deterministic critical checks against an existing parsed
artifact directory. Does NOT run MinerU and does NOT write anything.

Usage:

    .mineru/bin/python scripts/local/inspect-contract-integrity.py \
        --artifact-dir storage/contracts/<id>/parsed \
        --original-name "RSH..."

By default it reads document.draft.md if present, else
document.raw.md, plus document.middle.json when present.
"""

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(
    0,
    str(Path(__file__).resolve().parents[2]),
)

from services.contract_review.critical_integrity import (  # noqa: E402
    compare_critical_observations,
    evaluate_critical_integrity,
)


def _pick_markdown(artifact_dir):

    for name in (
        "document.raw.md",
        "document.draft.md",
    ):

        candidate = artifact_dir / name

        if candidate.is_file():
            return candidate

    return None


def main():

    parser = argparse.ArgumentParser()

    parser.add_argument(
        "--artifact-dir",
        required=True,
    )

    parser.add_argument(
        "--original-name",
        default="",
    )

    parser.add_argument(
        "--cross-tier",
        action="store_true",
        help="Also compare against --standard-artifact-dir.",
    )

    parser.add_argument(
        "--standard-artifact-dir",
        default=None,
    )

    args = parser.parse_args()

    artifact_dir = Path(args.artifact_dir)

    markdown = _pick_markdown(artifact_dir)

    if markdown is None:

        raise SystemExit(
            "No document.draft.md / document.raw.md in "
            f"{artifact_dir}"
        )

    middle = artifact_dir / "document.middle.json"

    result = evaluate_critical_integrity(
        markdown_path=str(markdown),
        middle_json_path=(
            str(middle)
            if middle.is_file()
            else None
        ),
        original_name=args.original_name,
    )

    print(
        json.dumps(
            {
                "profileVersion": result["profileVersion"],
                "finalTier": "n/a",
                "requiresStandard": result["requiresStandard"],
                "observations": result["observations"],
                "findings": result["findings"],
                "metrics": result["metrics"],
            },
            ensure_ascii=False,
            indent=2,
        )
    )

    if (
        args.cross_tier
        and args.standard_artifact_dir
    ):

        standard_dir = Path(
            args.standard_artifact_dir
        )

        standard_markdown = _pick_markdown(
            standard_dir
        )

        standard_middle = (
            standard_dir / "document.middle.json"
        )

        standard_result = evaluate_critical_integrity(
            markdown_path=str(standard_markdown),
            middle_json_path=(
                str(standard_middle)
                if standard_middle.is_file()
                else None
            ),
            original_name=args.original_name,
        )

        cross = compare_critical_observations(
            result,
            standard_result,
        )

        print("=== cross-tier ===")

        print(
            json.dumps(
                cross,
                ensure_ascii=False,
                indent=2,
            )
        )


if __name__ == "__main__":
    main()
