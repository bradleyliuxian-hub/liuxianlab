"""Structured business-classification result models."""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Any, Dict, Mapping, Optional, Tuple


def _decimal_string(value: Decimal, places: str = "0.01") -> str:
    return format(value.quantize(Decimal(places)), "f")


@dataclass(frozen=True)
class BusinessCandidate:
    code: str
    label: str
    score: Decimal
    components: Mapping[str, Decimal]
    evidence: Mapping[str, Any]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "code": self.code,
            "label": self.label,
            "score": _decimal_string(self.score),
            "components": {
                key: _decimal_string(value)
                for key, value in sorted(self.components.items())
            },
            "evidence": self.evidence,
        }


@dataclass(frozen=True)
class BusinessClassification:
    voucher_key: str
    voucher_id: str
    business_code: str
    business_label: str
    score: Decimal
    confidence: Decimal
    confidence_level: str
    reason: str
    evidence: Mapping[str, Any]
    candidates: Tuple[BusinessCandidate, ...]
    sheet_names: Tuple[str, ...]
    source_rows: Tuple[int, ...]
    is_hard_rule: bool = False
    professional_interpretation: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "voucher_key": self.voucher_key,
            "voucher_id": self.voucher_id,
            "business_code": self.business_code,
            "business_label": self.business_label,
            "score": _decimal_string(self.score),
            "confidence": _decimal_string(self.confidence, "0.0001"),
            "confidence_level": self.confidence_level,
            "reason": self.reason,
            "evidence": self.evidence,
            "candidates": [candidate.to_dict() for candidate in self.candidates],
            "sheet_names": list(self.sheet_names),
            "source_rows": list(self.source_rows),
            "is_hard_rule": self.is_hard_rule,
            "professional_interpretation": self.professional_interpretation,
        }


@dataclass(frozen=True)
class BusinessClassificationResult:
    classifications: Tuple[BusinessClassification, ...]
    summary: Mapping[str, Any]
    warnings: Tuple[str, ...] = ()

    def to_dict(self) -> Dict[str, Any]:
        return {
            "classifications": [item.to_dict() for item in self.classifications],
            "summary": self.summary,
            "warnings": list(self.warnings),
        }
