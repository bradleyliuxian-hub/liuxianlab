"""Apply an inferred rule to a single summary."""

from __future__ import annotations

from typing import Any, Dict

from .models import SemanticType, SummaryStructureRule
from .semantics import parse_date_candidate
from .tokenizer import normalize_parts


def tokenize_using_rule(description: str, rule: SummaryStructureRule) -> list[str]:
    text = str(description or "").strip()
    if not text:
        return []
    if not rule.delimiter or rule.delimiter not in text:
        return [text]
    return normalize_parts(text.split(rule.delimiter))


def extract_derived_fields(description: str, rule: SummaryStructureRule) -> Dict[str, Any]:
    if rule.status != "auto" or not rule.fields:
        return {}
    parts = tokenize_using_rule(description, rule)
    result: Dict[str, Any] = {}
    for field in rule.fields:
        raw = parts[field.part_index] if field.part_index < len(parts) else ""
        if field.semantic_type == SemanticType.DATE:
            parsed = parse_date_candidate(raw)
            result[field.key] = parsed if parsed is not None else (raw or None)
        else:
            result[field.key] = raw or None
    return result
