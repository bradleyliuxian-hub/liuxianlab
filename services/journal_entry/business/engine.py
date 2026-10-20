"""Public deterministic JournalEntry business-classification engine."""

from __future__ import annotations

from collections import Counter
from decimal import Decimal
from typing import Sequence, Tuple

from ..schema import JournalEntry
from .constants import (
    BUSINESS_LABELS,
    BUS_OTHER,
    DEFAULT_BUSINESS_CLASSIFICATION_CONFIG,
    BusinessClassificationConfig,
)
from .features import extract_business_features
from .models import BusinessCandidate, BusinessClassification, BusinessClassificationResult
from .rules import detect_hard_rule
from .scoring import score_business_candidates


def _confidence(score: Decimal, margin: Decimal, hard: bool, config: BusinessClassificationConfig) -> Tuple[Decimal, str]:
    if hard:
        return Decimal("1.0000"), "HIGH"
    score_factor = min(Decimal("1"), score / Decimal("100"))
    margin_factor = min(Decimal("1"), max(Decimal("0"), margin) / Decimal("30"))
    value = (score_factor * Decimal("0.75") + margin_factor * Decimal("0.25")).quantize(Decimal("0.0001"))
    if score >= config.high_confidence_score and margin >= config.high_confidence_margin:
        level = "HIGH"
    elif score >= config.medium_confidence_score and margin >= config.medium_confidence_margin:
        level = "MEDIUM"
    else:
        level = "LOW"
    return value, level


def classify_entry(
    entry: JournalEntry,
    config: BusinessClassificationConfig | None = None,
) -> BusinessClassification:
    config = config or DEFAULT_BUSINESS_CLASSIFICATION_CONFIG
    features = extract_business_features(entry)

    hard = detect_hard_rule(features)
    if hard is not None:
        code, rule, hard_evidence = hard
        candidate = BusinessCandidate(
            code=code,
            label=BUSINESS_LABELS[code],
            score=Decimal("100.00"),
            components={"hard_rule": Decimal("100.00")},
            evidence={"hard_rule": rule, **dict(hard_evidence)},
        )
        return BusinessClassification(
            voucher_key=features.voucher_key,
            voucher_id=features.voucher_id,
            business_code=code,
            business_label=BUSINESS_LABELS[code],
            score=Decimal("100.00"),
            confidence=Decimal("1.0000"),
            confidence_level="HIGH",
            reason="命中确定性业务规则：%s。" % rule,
            evidence={"hard_rule": rule, **dict(hard_evidence)},
            candidates=(candidate,),
            sheet_names=features.sheet_names,
            source_rows=features.source_rows,
            is_hard_rule=True,
        )

    candidates = score_business_candidates(features, config)
    if not candidates:
        return BusinessClassification(
            voucher_key=features.voucher_key,
            voucher_id=features.voucher_id,
            business_code=BUS_OTHER,
            business_label=BUSINESS_LABELS[BUS_OTHER],
            score=Decimal("0.00"),
            confidence=Decimal("0.0000"),
            confidence_level="LOW",
            reason="没有足够的确定性科目结构或摘要证据，归入其他业务。",
            evidence={"reason": "no_supported_signal"},
            candidates=(),
            sheet_names=features.sheet_names,
            source_rows=features.source_rows,
        )

    top = candidates[0]
    second_score = candidates[1].score if len(candidates) > 1 else Decimal("0")
    margin = top.score - second_score
    if top.score < config.min_primary_score or margin < config.min_clear_margin:
        confidence, level = _confidence(top.score, margin, False, config)
        return BusinessClassification(
            voucher_key=features.voucher_key,
            voucher_id=features.voucher_id,
            business_code=BUS_OTHER,
            business_label=BUSINESS_LABELS[BUS_OTHER],
            score=top.score,
            confidence=confidence,
            confidence_level="LOW",
            reason="候选业务证据不足或候选之间差距过小，保守归入其他业务。",
            evidence={
                "top_candidate": top.code,
                "top_score": format(top.score, ".2f"),
                "second_score": format(second_score, ".2f"),
                "margin": format(margin, ".2f"),
            },
            candidates=candidates,
            sheet_names=features.sheet_names,
            source_rows=features.source_rows,
        )

    confidence, level = _confidence(top.score, margin, False, config)
    evidence = {
        "top_score": format(top.score, ".2f"),
        "second_score": format(second_score, ".2f"),
        "margin": format(margin, ".2f"),
        "components": {key: format(value, ".2f") for key, value in sorted(top.components.items())},
        "matched": top.evidence,
    }
    return BusinessClassification(
        voucher_key=features.voucher_key,
        voucher_id=features.voucher_id,
        business_code=top.code,
        business_label=top.label,
        score=top.score,
        confidence=confidence,
        confidence_level=level,
        reason="科目结构、科目名称和摘要弱信号综合得分最高。",
        evidence=evidence,
        candidates=candidates,
        sheet_names=features.sheet_names,
        source_rows=features.source_rows,
    )


def classify_entries(
    entries: Sequence[JournalEntry] | JournalEntry,
    config: BusinessClassificationConfig | None = None,
) -> BusinessClassificationResult:
    if isinstance(entries, JournalEntry):
        entries = [entries]
    classifications = tuple(
        classify_entry(entry, config=config)
        for entry in entries
    )
    classifications = tuple(
        sorted(classifications, key=lambda item: (item.voucher_key, item.business_code))
    )
    counts = Counter(item.business_code for item in classifications)
    confidence_counts = Counter(item.confidence_level for item in classifications)
    summary = {
        "voucher_count": len(classifications),
        "classified_count": sum(1 for item in classifications if item.business_code != BUS_OTHER),
        "other_count": sum(1 for item in classifications if item.business_code == BUS_OTHER),
        "business_counts": {
            code: counts.get(code, 0)
            for code in sorted(BUSINESS_LABELS)
        },
        "business_labels": {
            code: BUSINESS_LABELS[code]
            for code in sorted(BUSINESS_LABELS)
        },
        "confidence_counts": {
            level: confidence_counts.get(level, 0)
            for level in ("HIGH", "MEDIUM", "LOW")
        },
    }
    warnings = ()
    if classifications and summary["other_count"] / len(classifications) > 0.50:
        warnings = ("high_other_classification_rate",)
    return BusinessClassificationResult(
        classifications=classifications,
        summary=summary,
        warnings=warnings,
    )


class BusinessClassificationEngine:
    def __init__(self, config: BusinessClassificationConfig | None = None):
        self.config = config or DEFAULT_BUSINESS_CLASSIFICATION_CONFIG

    def classify(self, entries: Sequence[JournalEntry] | JournalEntry) -> BusinessClassificationResult:
        return classify_entries(entries, config=self.config)
