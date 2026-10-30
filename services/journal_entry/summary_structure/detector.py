"""Delimiter and structural stability detection."""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from typing import Dict, List, Sequence

from .semantics import parse_date_candidate, score_department, score_organization
from .tokenizer import AUTO_DELIMITERS, normalize_parts


@dataclass
class DelimiterResult:
    delimiter: str
    coverage: float
    part_stability: float
    score: float
    semantic_support: float


def score_delimiter(summaries: Sequence[str], delimiter: str) -> Dict[str, object]:
    total = len(summaries)
    if not total:
        return {"coverage": 0.0, "part_stability": 0.0, "score": 0.0, "part_counts": {}}
    split_rows = [
        normalize_parts(value.split(delimiter))
        for value in summaries
        if delimiter in value
    ]
    split_rows = [row for row in split_rows if row]
    coverage = len(split_rows) / total
    if not split_rows:
        return {"coverage": coverage, "part_stability": 0.0, "score": 0.0, "part_counts": {}}
    counts = Counter(len(parts) for parts in split_rows)
    dominant = max(counts.values())
    part_stability = dominant / len(split_rows)
    score = coverage * 0.60 + part_stability * 0.40
    return {
        "coverage": coverage,
        "part_stability": part_stability,
        "part_counts": dict(counts),
        "score": score,
    }


def semantic_support(rows: Sequence[Sequence[str]], known: set[str]) -> float:
    if not rows:
        return 0.0
    support = 0.0
    for part_index in range(1, max((len(row) for row in rows), default=0)):
        values = [row[part_index] for row in rows if part_index < len(row) and row[part_index]]
        if not values:
            continue
        date_ratio = sum(1 for value in values if parse_date_candidate(value)) / len(values)
        org_ratio = sum(
            1 for value in values if score_organization(value, known) >= 0.86
        ) / len(values)
        dept_ratio = sum(1 for value in values if score_department(value) >= 0.82) / len(values)
        support = max(support, date_ratio, org_ratio, dept_ratio)
    return support


def detect_best_delimiter(summaries: Sequence[str], known: set[str]) -> DelimiterResult | None:
    best = None
    for delimiter in AUTO_DELIMITERS:
        stats = score_delimiter(summaries, delimiter)
        if not stats["part_counts"]:
            continue
        rows = [
            normalize_parts(value.split(delimiter))
            for value in summaries
            if delimiter in value
        ]
        support = semantic_support(rows, known)
        combined = float(stats["score"]) + support * 0.15
        candidate = DelimiterResult(
            delimiter=delimiter,
            coverage=float(stats["coverage"]),
            part_stability=float(stats["part_stability"]),
            score=combined,
            semantic_support=support,
        )
        if best is None or candidate.score > best.score:
            best = candidate
    return best


def choose_structure_length(rows: Sequence[Sequence[str]]) -> (int, float, int):
    lengths = [len(row) for row in rows if row]
    if not lengths:
        return 0, 0.0, 0
    counts = Counter(lengths)
    total = len(lengths)
    max_len = max(lengths)
    chosen = max_len
    for length in range(max_len, 1, -1):
        at_least = sum(count for value, count in counts.items() if value >= length - 1)
        exact = counts.get(length, 0)
        if at_least / total >= 0.80 and exact >= max(1, int(total * 0.10)):
            chosen = length
            break
    else:
        chosen = counts.most_common(1)[0][0]
    matched = sum(count for value, count in counts.items() if value >= chosen - 1)
    union_ratio = matched / total
    exact_ratio = counts.get(chosen, 0) / total
    structural = union_ratio * 0.9 + exact_ratio * 0.1
    return chosen, min(0.99, structural), matched
