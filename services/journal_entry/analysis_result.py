"""Unified serializable result contract for Journal Entry Analysis."""

from __future__ import annotations

from collections import Counter
from typing import Any, Dict, Mapping, Tuple

from .accounting_features import voucher_key_for_entry
from .schema import amount_to_string


def _balance_summary(entries) -> Dict[str, int]:
    exact = sum(1 for entry in entries if entry.exactly_balanced)
    within_only = sum(
        1
        for entry in entries
        if not entry.exactly_balanced and entry.is_within_tolerance
    )
    unbalanced = sum(1 for entry in entries if not entry.is_within_tolerance)
    return {
        "exact_balanced_voucher_count": exact,
        "within_tolerance_only_voucher_count": within_only,
        "unbalanced_voucher_count": unbalanced,
    }


def _contra_summary(results) -> Dict[str, Any]:
    counts = Counter()
    warning_counts = Counter()
    allocation_count = 0
    for result in results:
        counts["analyzed"] += 1
        if result.allocations:
            counts["with_allocations"] += 1
        if result.ambiguous:
            counts["ambiguous"] += 1
        if result.complexity_limited:
            counts["complexity_limited"] += 1
        if result.solution_limit_reached:
            counts["solution_limit_reached"] += 1
        if result.unallocated_debit or result.unallocated_credit:
            counts["has_unallocated"] += 1
        allocation_count += len(result.allocations)
        for warning in result.warnings:
            warning_counts[warning] += 1
    return {
        "analyzed_voucher_count": counts.get("analyzed", 0),
        "with_allocations_voucher_count": counts.get("with_allocations", 0),
        "ambiguous_voucher_count": counts.get("ambiguous", 0),
        "complexity_limited_voucher_count": counts.get("complexity_limited", 0),
        "solution_limit_reached_voucher_count": counts.get(
            "solution_limit_reached", 0
        ),
        "unallocated_voucher_count": counts.get("has_unallocated", 0),
        "allocation_count": allocation_count,
        "warning_counts": dict(sorted(warning_counts.items())),
    }


def build_analysis_result(
    *,
    job_id: str,
    original_filename: str,
    normalization,
    business_result,
    contra_results: Mapping[str, Any],
    anomaly_result,
    export_filename: str,
    generated_at: str,
) -> Dict[str, Any]:
    entries = normalization.entries
    balance = _balance_summary(entries)
    business_by_key = {
        item.voucher_key: item for item in business_result.classifications
    }
    anomaly_by_key = {item.voucher_key: item for item in anomaly_result.scores}
    findings_by_key = {}
    for finding in anomaly_result.findings:
        findings_by_key.setdefault(finding.voucher_key, []).append(finding)

    vouchers = []
    for entry in sorted(entries, key=voucher_key_for_entry):
        entry_key = voucher_key_for_entry(entry)
        classification = business_by_key.get(entry_key)
        contra = contra_results.get(entry_key)
        anomaly = anomaly_by_key.get(entry_key)
        voucher_findings = findings_by_key.get(entry_key, [])
        vouchers.append(
            {
                "voucher_key": entry_key,
                "voucher_id": entry.voucher_id,
                "date": entry.date.isoformat() if entry.date else None,
                "period": entry.period,
                "entity": entry.entity,
                "total_debit": amount_to_string(entry.total_debit),
                "total_credit": amount_to_string(entry.total_credit),
                "imbalance": amount_to_string(entry.imbalance),
                "exactly_balanced": entry.exactly_balanced,
                "is_within_tolerance": entry.is_within_tolerance,
                "validation_flags": list(entry.validation_flags),
                "line_count": len(entry.lines),
                "lines": [line.to_dict() for line in entry.lines],
                "business_classification": (
                    classification.to_dict() if classification else None
                ),
                "contra": contra.to_dict() if contra else None,
                "anomaly": (
                    {
                        "risk_score": amount_to_string(anomaly.risk_score),
                        "risk_level": anomaly.risk_level,
                        "components": {
                            key: amount_to_string(value)
                            for key, value in sorted(anomaly.components.items())
                        },
                        "business_group": anomaly.business_group,
                        "finding_codes": sorted(
                            {finding.code for finding in voucher_findings}
                        ),
                    }
                    if anomaly
                    else None
                ),
            }
        )

    cleaning_summary = {
        "raw_row_count": normalization.raw_row_count,
        "line_count": len(normalization.lines),
        "voucher_count": len(entries),
        "issue_count": len(normalization.issues),
        "row_warning_count": len(normalization.row_warnings),
        "largest_voucher_line_count": max(
            (len(entry.lines) for entry in entries),
            default=0,
        ),
        **balance,
    }
    voucher_summary = {
        "voucher_count": len(entries),
        **balance,
        "largest_voucher_line_count": cleaning_summary[
            "largest_voucher_line_count"
        ],
    }
    warnings = []
    for value in (
        normalization.warnings
        + business_result.warnings
        + anomaly_result.warnings
    ):
        if value not in warnings:
            warnings.append(value)

    return {
        "schema_version": 1,
        "job_id": job_id,
        "status": "completed",
        "generated_at": generated_at,
        "input_metadata": {
            "original_filename": original_filename,
            "sheet_name": normalization.sheet_name,
            "header_row": normalization.header_row,
            "amount_layout": normalization.mapping.amount_layout.layout,
            "positive_side": normalization.mapping.amount_layout.positive_side,
            "source_filename": original_filename,
        },
        "mapping": normalization.mapping.to_dict(),
        "cleaning_summary": cleaning_summary,
        "validation_issues": [
            issue.to_dict() for issue in normalization.issues
        ],
        "row_warnings": [
            warning.to_dict() for warning in normalization.row_warnings
        ],
        "voucher_summary": voucher_summary,
        "business_classification_summary": dict(
            business_result.summary
        ),
        "contra_summary": _contra_summary(list(contra_results.values())),
        "anomaly_summary": dict(anomaly_result.summary),
        "findings": [finding.to_dict() for finding in anomaly_result.findings],
        "vouchers": vouchers,
        "export_reference": {"filename": export_filename},
        "warnings": warnings,
    }
