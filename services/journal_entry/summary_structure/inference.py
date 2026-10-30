"""Account-level summary structure inference."""

from __future__ import annotations

from collections import defaultdict
from typing import Any, Dict, Iterable, List, Mapping, Sequence

from .detector import choose_structure_length, detect_best_delimiter
from .models import DerivedFieldSpec, SemanticType, SummaryStructureRule
from .semantics import contextual_label, infer_part_semantic, normalize_entity_name
from .tokenizer import MAX_SAMPLES_PER_ACCOUNT, normalize_parts

AUTO_THRESHOLD = 0.92
REVIEW_THRESHOLD = 0.75
DELIMITER_THRESHOLD = 0.70


def _none_rule(account_code: str, account_name: str, sample_count: int, warning: str = "") -> SummaryStructureRule:
    return SummaryStructureRule(
        account_code=account_code,
        account_name=account_name,
        parser_type="none",
        delimiter=None,
        fields=[],
        structural_confidence=0.0,
        semantic_confidence=0.0,
        overall_confidence=0.0,
        status="none",
        sample_count=sample_count,
        matched_count=0,
        warnings=[warning] if warning else [],
    )


def infer_account_rule(
    *,
    account_code: str,
    account_name: str,
    summaries: Sequence[str],
    known_counterparties: set[str],
) -> SummaryStructureRule:
    clean = [str(value or "").strip() for value in summaries if str(value or "").strip()]
    sample_count = len(clean)
    if sample_count < 2:
        return _none_rule(account_code, account_name, sample_count, "insufficient_samples")
    best = detect_best_delimiter(clean[:MAX_SAMPLES_PER_ACCOUNT], known_counterparties)
    if best is None:
        return _none_rule(account_code, account_name, sample_count, "no_delimiter")
    if best.score < DELIMITER_THRESHOLD and best.semantic_support < 0.75:
        return _none_rule(account_code, account_name, sample_count, "unstable_delimiter")

    rows = [
        normalize_parts(value.split(best.delimiter))
        for value in clean[:MAX_SAMPLES_PER_ACCOUNT]
        if best.delimiter in value
    ]
    rows = [row for row in rows if row]
    if not rows:
        return _none_rule(account_code, account_name, sample_count, "no_tokens")
    length, structural_confidence, matched = choose_structure_length(rows)
    if length < 2:
        return _none_rule(account_code, account_name, sample_count, "single_part")

    fields: List[DerivedFieldSpec] = []
    confidences = []
    for part_index in range(length):
        values = [row[part_index] if part_index < len(row) else "" for row in rows]
        semantic_type, confidence, _scores = infer_part_semantic(
            values,
            account_name=account_name,
            known_counterparties=known_counterparties,
            part_index=part_index,
        )
        if semantic_type == SemanticType.PLACEHOLDER:
            continue
        if semantic_type in (SemanticType.UNKNOWN, SemanticType.ORGANIZATION):
            semantic_type = SemanticType.ITEM if part_index == 0 else SemanticType.REFERENCE
        label = contextual_label(semantic_type, account_name)
        fields.append(DerivedFieldSpec(
            key=f"summary:auto:{account_code}:part:{part_index}",
            label=label,
            semantic_type=semantic_type,
            part_index=part_index,
            confidence=confidence,
        ))
        confidences.append(confidence)

    if len(fields) < 2:
        return _none_rule(account_code, account_name, sample_count, "insufficient_fields")
    semantic_confidence = sum(confidences) / len(confidences)
    overall = structural_confidence * 0.60 + semantic_confidence * 0.40
    if overall >= AUTO_THRESHOLD:
        status = "auto"
    elif overall >= REVIEW_THRESHOLD:
        status = "review"
    else:
        status = "none"
    return SummaryStructureRule(
        account_code=account_code,
        account_name=account_name,
        parser_type="delimiter",
        delimiter=best.delimiter,
        fields=fields,
        structural_confidence=structural_confidence,
        semantic_confidence=semantic_confidence,
        overall_confidence=overall,
        status=status,
        sample_count=sample_count,
        matched_count=matched,
        warnings=[],
    )


def _value(item: Any, key: str) -> Any:
    if isinstance(item, Mapping):
        return item.get(key)
    return getattr(item, key, None)


def _lines(voucher: Any) -> Sequence[Any]:
    if isinstance(voucher, Mapping):
        return voucher.get("lines") or []
    return getattr(voucher, "lines", None) or []


def collect_account_summaries(vouchers: Sequence[Any]) -> Dict[str, Dict[str, Any]]:
    accounts: Dict[str, Dict[str, Any]] = {}
    known = set()
    for voucher in vouchers:
        for line in _lines(voucher):
            for key in ("customer_name", "supplier_name", "counterparty_name"):
                value = str(_value(line, key) or "").strip()
                if value:
                    known.add(normalize_entity_name(value))
    for voucher in vouchers:
        for line in _lines(voucher):
            code = str(_value(line, "account_code") or "").strip()
            name = str(_value(line, "account_name") or "").strip()
            description = str(_value(line, "description") or "").strip()
            if not code:
                continue
            entry = accounts.setdefault(code, {"code": code, "name": name, "summaries": [], "line_count": 0})
            entry["line_count"] += 1
            if name and not entry["name"]:
                entry["name"] = name
            if description:
                entry["summaries"].append(description)
    return accounts, known


def infer_summary_structure(vouchers: Sequence[Any]) -> Dict[str, Any]:
    accounts, known = collect_account_summaries(vouchers)
    rules = []
    auto = review = none = covered = total_lines = 0
    for code in sorted(accounts):
        entry = accounts[code]
        total_lines += int(entry["line_count"])
        rule = infer_account_rule(
            account_code=code,
            account_name=entry["name"],
            summaries=entry["summaries"],
            known_counterparties=known,
        )
        rules.append(rule)
        if rule.status == "auto":
            auto += 1
            covered += int(entry["line_count"])
        elif rule.status == "review":
            review += 1
        else:
            none += 1
    return {
        "version": 1,
        "account_count": len(accounts),
        "auto_rule_count": auto,
        "review_rule_count": review,
        "none_rule_count": none,
        "covered_line_count": covered,
        "total_line_count": total_lines,
        "rules": [rule.to_dict() for rule in rules],
    }
