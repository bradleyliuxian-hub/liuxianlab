"""Deterministic business-classification scoring."""

from __future__ import annotations

from collections import defaultdict
from decimal import Decimal
from typing import Any, Dict, Iterable, List, Mapping, Tuple

from .constants import (
    ACCOUNT_ANCHORS,
    BUSINESS_CODES,
    BUSINESS_LABELS,
    BUS_EMPLOYEE_LOAN,
    BUS_ENTITY_CURRENT,
    BUS_OTHER,
    DESCRIPTION_KEYWORDS,
    EMPLOYEE_WORDS,
    ENTITY_COUNTERPARTY_WORDS,
    BusinessClassificationConfig,
)
from .features import BusinessFeatures
from .models import BusinessCandidate
from .rules import structural_scores


def _contains(text: str, keyword: str) -> bool:
    return bool(keyword and keyword in text)


def _account_anchor_component(features: BusinessFeatures) -> Tuple[Dict[str, Decimal], Dict[str, List[Dict[str, Any]]]]:
    scores: Dict[str, Decimal] = defaultdict(lambda: Decimal("0"))
    evidence: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    seen = set()
    for feature in features.lines:
        name = feature.account_name
        if not name:
            continue
        for code, anchors in ACCOUNT_ANCHORS.items():
            for keyword, base_points in anchors:
                key = (code, feature.account_key, keyword, feature.side)
                if key in seen or not _contains(name, keyword):
                    continue
                seen.add(key)
                # Amount share is supportive but never fully suppresses an anchor.
                weight = Decimal("0.60") + min(feature.amount_share, Decimal("0.40"))
                points = (base_points * weight).quantize(Decimal("0.01"))
                scores[code] += points
                evidence[code].append({
                    "account": feature.account_key,
                    "account_name": name,
                    "side": feature.side,
                    "keyword": keyword,
                    "amount_share": format(feature.amount_share, "f"),
                    "points": format(points, ".2f"),
                })
    return dict(scores), dict(evidence)


def _description_component(features: BusinessFeatures) -> Tuple[Dict[str, Decimal], Dict[str, List[Dict[str, str]]]]:
    scores: Dict[str, Decimal] = defaultdict(lambda: Decimal("0"))
    evidence: Dict[str, List[Dict[str, str]]] = defaultdict(list)
    text = features.description
    if not text:
        return {}, {}
    for code, keywords in DESCRIPTION_KEYWORDS.items():
        for keyword, points in keywords:
            if keyword in text:
                scores[code] += points
                evidence[code].append({"keyword": keyword, "points": format(points, ".2f")})

    # Employee vs entity current-account disambiguation.
    employee_hit = any(word in text for word in EMPLOYEE_WORDS)
    entity_hit = any(word in text for word in ENTITY_COUNTERPARTY_WORDS)
    if employee_hit and not entity_hit:
        scores[BUS_EMPLOYEE_LOAN] += Decimal("12")
    if entity_hit and not employee_hit:
        scores[BUS_ENTITY_CURRENT] += Decimal("12")
    return dict(scores), dict(evidence)


def score_business_candidates(
    features: BusinessFeatures,
    config: BusinessClassificationConfig,
) -> Tuple[BusinessCandidate, ...]:
    structural = structural_scores(features)
    account_scores, account_evidence = _account_anchor_component(features)
    description_scores, description_evidence = _description_component(features)

    candidates = []
    for code in BUSINESS_CODES:
        if code == BUS_OTHER:
            continue
        structural_score, structural_rules = structural.get(code, (Decimal("0"), ()))
        account_score = min(account_scores.get(code, Decimal("0")), Decimal("55"))
        description_score = min(description_scores.get(code, Decimal("0")), Decimal("35"))
        total = min(Decimal("100"), structural_score + account_score + description_score)
        if total <= 0:
            continue
        candidates.append(
            BusinessCandidate(
                code=code,
                label=BUSINESS_LABELS[code],
                score=total.quantize(Decimal("0.01")),
                components={
                    "structure": structural_score.quantize(Decimal("0.01")),
                    "account": account_score.quantize(Decimal("0.01")),
                    "description": description_score.quantize(Decimal("0.01")),
                },
                evidence={
                    "structural_rules": list(structural_rules),
                    "account_matches": account_evidence.get(code, []),
                    "description_matches": description_evidence.get(code, []),
                },
            )
        )

    candidates.sort(key=lambda item: (-item.score, item.code))
    return tuple(candidates[: config.candidate_limit])
