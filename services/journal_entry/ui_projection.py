"""Build and write the lightweight browser projection for a completed result.

This module only transforms an already-computed canonical result. It never
re-runs normalization, business classification, contra allocation or anomaly
scoring.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import tempfile
import zlib
from pathlib import Path
from typing import Any, Dict, List, Mapping, Tuple

UI_DIRNAME = "ui"
SUMMARY_FILENAME = "summary.json"
VOUCHERS_FILENAME = "vouchers.ndjson"
FINDINGS_FILENAME = "findings.json"
DETAILS_FILENAME = "details.bin"
DETAILS_INDEX_FILENAME = "details.idx.json"
PROJECTION_VERSION = 1

SUMMARY_KEYS = (
    "schema_version",
    "job_id",
    "generated_at",
    "input_metadata",
    "cleaning_summary",
    "voucher_summary",
    "business_classification_summary",
    "contra_summary",
    "anomaly_summary",
    "warnings",
)

LINE_KEYS = (
    "sheet_name",
    "source_row",
    "line_id",
    "account_code",
    "account_name",
    "debit",
    "credit",
    "description",
    "internal_line_key",
)

CANDIDATE_KEYS = ("code", "label", "score")


def _json_bytes(value: Any) -> bytes:
    return (
        json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
        + "\n"
    ).encode("utf-8")


def _write_file(path: Path, data: bytes) -> None:
    with open(path, "wb") as handle:
        handle.write(data)
    os.chmod(path, 0o600)


def _summary(payload: Mapping[str, Any]) -> Dict[str, Any]:
    summary = {key: payload.get(key) for key in SUMMARY_KEYS if key in payload}
    summary["projection_version"] = PROJECTION_VERSION
    return summary


def _business_detail(value: Any) -> Any:
    if not isinstance(value, Mapping):
        return None
    candidates = []
    for candidate in value.get("candidates") or []:
        if not isinstance(candidate, Mapping):
            continue
        candidates.append(
            {key: candidate.get(key) for key in CANDIDATE_KEYS if key in candidate}
        )
    return {
        "business_code": value.get("business_code"),
        "business_label": value.get("business_label"),
        "confidence": value.get("confidence"),
        "confidence_level": value.get("confidence_level"),
        "score": value.get("score"),
        "is_hard_rule": value.get("is_hard_rule"),
        "reason": value.get("reason"),
        "professional_interpretation": value.get("professional_interpretation"),
        "candidates": candidates,
    }


def _contra_detail(value: Any) -> Any:
    if not isinstance(value, Mapping):
        return None
    allocations = []
    for item in value.get("allocations") or []:
        if not isinstance(item, Mapping):
            continue
        allocations.append(
            {
                "source_internal_key": item.get("source_internal_key"),
                "source_line_id": item.get("source_line_id"),
                "target_internal_key": item.get("target_internal_key"),
                "target_line_id": item.get("target_line_id"),
                "amount": item.get("amount"),
                "method": item.get("method"),
            }
        )

    def unallocated(items):
        return [
            {
                "account_name": item.get("account_name"),
                "node_id": item.get("node_id"),
                "amount": item.get("amount"),
            }
            for item in (items or [])
            if isinstance(item, Mapping)
        ]

    return {
        "allocations": allocations,
        "unallocated_debit": unallocated(value.get("unallocated_debit")),
        "unallocated_credit": unallocated(value.get("unallocated_credit")),
        "method": value.get("method"),
        "confidence": value.get("confidence"),
        "ambiguous": bool(value.get("ambiguous")),
        "complexity_limited": bool(value.get("complexity_limited")),
        "solution_limit_reached": bool(value.get("solution_limit_reached")),
        "solution_count": value.get("solution_count"),
        "node_count": value.get("node_count"),
        "warnings": list(value.get("warnings") or []),
    }


def _anomaly_detail(value: Any) -> Any:
    if not isinstance(value, Mapping):
        return None
    return {
        "risk_score": value.get("risk_score"),
        "risk_level": value.get("risk_level"),
        "business_group": value.get("business_group"),
        "components": dict(value.get("components") or {}),
        "finding_codes": list(value.get("finding_codes") or []),
    }


def _voucher_row(
    voucher: Mapping[str, Any], finding_count: int
) -> Dict[str, Any]:
    business = voucher.get("business_classification")
    contra = voucher.get("contra")
    anomaly = voucher.get("anomaly")
    row = {
        "k": voucher.get("voucher_key"),
        "i": voucher.get("voucher_id"),
        "d": voucher.get("date"),
        "p": voucher.get("period"),
        "e": voucher.get("entity"),
        "n": voucher.get("line_count"),
        "td": voucher.get("total_debit"),
        "tc": voucher.get("total_credit"),
        "im": voucher.get("imbalance"),
        "b": bool(voucher.get("exactly_balanced")),
        "w": bool(voucher.get("is_within_tolerance")),
        "fc": finding_count,
        "rc": bool(contra),
    }
    if isinstance(business, Mapping):
        row.update(
            {
                "bc": business.get("business_code"),
                "bl": business.get("business_label"),
                "bcl": business.get("confidence_level"),
                "bcf": business.get("confidence"),
                "bsc": business.get("score"),
                "br": business.get("reason"),
            }
        )
    if isinstance(anomaly, Mapping):
        row["rs"] = anomaly.get("risk_score")
        row["rl"] = anomaly.get("risk_level")
    if isinstance(contra, Mapping):
        allocations = contra.get("allocations") or []
        unallocated = list(contra.get("unallocated_debit") or []) + list(
            contra.get("unallocated_credit") or []
        )
        flags = []
        if contra.get("ambiguous"):
            flags.append("ambiguous")
        if contra.get("complexity_limited"):
            flags.append("limited")
        if contra.get("solution_limit_reached"):
            flags.append("solution_limit")
        row["ct"] = {
            "ca": len(allocations),
            "cu": len(unallocated),
            "cm": contra.get("method"),
            "cc": contra.get("confidence"),
            "cf": flags,
            "cw": list(contra.get("warnings") or []),
        }
    return row


def _finding_row(finding: Mapping[str, Any]) -> Dict[str, Any]:
    return {
        "voucher_key": finding.get("voucher_key"),
        "voucher_id": finding.get("voucher_id"),
        "date": finding.get("date"),
        "code": finding.get("code"),
        "severity": finding.get("severity"),
        "risk_score": finding.get("risk_score"),
        "business_group": finding.get("business_group"),
        "reason": finding.get("reason"),
    }


def _detail_record(
    voucher: Mapping[str, Any], findings: List[Mapping[str, Any]]
) -> Dict[str, Any]:
    detail = {
        "voucher_key": voucher.get("voucher_key"),
        "voucher_id": voucher.get("voucher_id"),
        "date": voucher.get("date"),
        "period": voucher.get("period"),
        "entity": voucher.get("entity"),
        "total_debit": voucher.get("total_debit"),
        "total_credit": voucher.get("total_credit"),
        "imbalance": voucher.get("imbalance"),
        "exactly_balanced": bool(voucher.get("exactly_balanced")),
        "is_within_tolerance": bool(voucher.get("is_within_tolerance")),
        "validation_flags": list(voucher.get("validation_flags") or []),
        "line_count": voucher.get("line_count"),
        "lines": [
            {key: line.get(key) for key in LINE_KEYS if key in line}
            for line in (voucher.get("lines") or [])
            if isinstance(line, Mapping)
        ],
        "business_classification": _business_detail(
            voucher.get("business_classification")
        ),
        "contra": _contra_detail(voucher.get("contra")),
        "anomaly": _anomaly_detail(voucher.get("anomaly")),
    }
    return {
        "voucher": detail,
        "findings": [dict(item) for item in findings],
    }


def build_ui_projection(
    payload: Mapping[str, Any], output_dir: Path
) -> Dict[str, Any]:
    """Write summary/voucher/finding/detail artifacts atomically.

    The canonical result is not modified. All generated files are owner-local,
    mode 0600, inside a mode 0700 UI directory.
    """

    if not isinstance(payload, Mapping):
        raise ValueError("result payload must be an object")
    vouchers = payload.get("vouchers")
    findings = payload.get("findings")
    if not isinstance(vouchers, list) or not isinstance(findings, list):
        raise ValueError("result payload is missing vouchers/findings")

    output_dir = Path(output_dir).resolve()
    parent = output_dir.parent
    parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temp_dir = Path(
        tempfile.mkdtemp(prefix=f".{output_dir.name}.tmp-", dir=str(parent))
    )
    os.chmod(temp_dir, 0o700)

    findings_by_key: Dict[str, List[Mapping[str, Any]]] = {}
    for finding in findings:
        if not isinstance(finding, Mapping):
            continue
        key = finding.get("voucher_key")
        if key:
            findings_by_key.setdefault(str(key), []).append(finding)

    voucher_rows = 0
    finding_rows: List[Dict[str, Any]] = []
    detail_index: Dict[str, List[int]] = {}
    try:
        for finding in findings:
            if isinstance(finding, Mapping):
                finding_rows.append(_finding_row(finding))

        details_path = temp_dir / DETAILS_FILENAME
        vouchers_path = temp_dir / VOUCHERS_FILENAME
        with open(details_path, "wb") as details, open(vouchers_path, "wb") as rows_file:
            for voucher in vouchers:
                if not isinstance(voucher, Mapping):
                    continue
                key = voucher.get("voucher_key")
                if not key:
                    continue
                key = str(key)
                voucher_findings = findings_by_key.get(key, [])
                rows_file.write(_json_bytes(_voucher_row(voucher, len(voucher_findings))))
                voucher_rows += 1
                raw = _json_bytes(_detail_record(voucher, voucher_findings))
                data = zlib.compress(raw, 6)
                offset = details.tell()
                details.write(data)
                detail_index[key] = [offset, len(data)]

        os.chmod(details_path, 0o600)
        os.chmod(vouchers_path, 0o600)
        _write_file(
            temp_dir / SUMMARY_FILENAME,
            _json_bytes(_summary(payload)),
        )
        _write_file(temp_dir / FINDINGS_FILENAME, _json_bytes(finding_rows))
        _write_file(temp_dir / DETAILS_INDEX_FILENAME, _json_bytes(detail_index))
        os.chmod(temp_dir, 0o700)

        if output_dir.exists():
            stale = parent / f".{output_dir.name}.stale-{os.getpid()}"
            if stale.exists():
                shutil.rmtree(stale, ignore_errors=True)
            os.replace(output_dir, stale)
            os.replace(temp_dir, output_dir)
            shutil.rmtree(stale, ignore_errors=True)
        else:
            os.replace(temp_dir, output_dir)
    except Exception:
        shutil.rmtree(temp_dir, ignore_errors=True)
        raise

    return {
        "dir": str(output_dir),
        "summary_bytes": (output_dir / SUMMARY_FILENAME).stat().st_size,
        "vouchers_bytes": (output_dir / VOUCHERS_FILENAME).stat().st_size,
        "findings_bytes": (output_dir / FINDINGS_FILENAME).stat().st_size,
        "details_bytes": (output_dir / DETAILS_FILENAME).stat().st_size,
        "details_index_bytes": (output_dir / DETAILS_INDEX_FILENAME).stat().st_size,
        "voucher_rows": voucher_rows,
        "findings": len(finding_rows),
    }


def build_ui_projection_from_result(
    result_path: Path, output_dir: Path
) -> Dict[str, Any]:
    result_path = Path(result_path)
    payload = json.loads(result_path.read_text(encoding="utf-8"))
    return build_ui_projection(payload, output_dir)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Build Journal Entry UI projection")
    parser.add_argument("--result", required=True)
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args(argv)
    try:
        stats = build_ui_projection_from_result(
            Path(args.result), Path(args.output_dir)
        )
    except Exception as exc:  # noqa: BLE001
        print("ui projection failed: %s" % type(exc).__name__, file=sys.stderr)
        return 1
    print(json.dumps(stats, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
