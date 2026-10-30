"""Models for automatic summary structure inference."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List


class SemanticType(str, Enum):
    ITEM = "item"
    DATE = "date"
    PERSON = "person"
    DEPARTMENT = "department"
    ORGANIZATION = "organization"
    COUNTERPARTY = "counterparty"
    REFERENCE = "reference"
    PLACEHOLDER = "placeholder"
    UNKNOWN = "unknown"


SEMANTIC_TYPES = {item.value for item in SemanticType}


@dataclass(frozen=True)
class DerivedFieldSpec:
    key: str
    label: str
    semantic_type: SemanticType
    part_index: int
    confidence: float

    def to_dict(self) -> Dict[str, Any]:
        return {
            "key": self.key,
            "label": self.label,
            "semantic_type": self.semantic_type.value,
            "part_index": self.part_index,
            "confidence": round(self.confidence, 4),
        }

    @classmethod
    def from_dict(cls, value: Dict[str, Any]) -> "DerivedFieldSpec":
        return cls(
            key=str(value.get("key") or ""),
            label=str(value.get("label") or "字段"),
            semantic_type=SemanticType(str(value.get("semantic_type") or "unknown")),
            part_index=int(value.get("part_index") or 0),
            confidence=float(value.get("confidence") or 0.0),
        )


@dataclass
class SummaryStructureRule:
    account_code: str
    account_name: str
    parser_type: str
    delimiter: str | None
    fields: List[DerivedFieldSpec]
    structural_confidence: float
    semantic_confidence: float
    overall_confidence: float
    status: str
    sample_count: int
    matched_count: int
    warnings: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "account_code": self.account_code,
            "account_name": self.account_name,
            "parser_type": self.parser_type,
            "delimiter": self.delimiter,
            "fields": [item.to_dict() for item in self.fields],
            "structural_confidence": round(self.structural_confidence, 4),
            "semantic_confidence": round(self.semantic_confidence, 4),
            "overall_confidence": round(self.overall_confidence, 4),
            "status": self.status,
            "sample_count": self.sample_count,
            "matched_count": self.matched_count,
            "warnings": list(self.warnings),
        }

    @classmethod
    def from_dict(cls, value: Dict[str, Any]) -> "SummaryStructureRule":
        return cls(
            account_code=str(value.get("account_code") or ""),
            account_name=str(value.get("account_name") or ""),
            parser_type=str(value.get("parser_type") or "none"),
            delimiter=value.get("delimiter"),
            fields=[
                DerivedFieldSpec.from_dict(item)
                for item in (value.get("fields") or [])
                if isinstance(item, dict)
            ],
            structural_confidence=float(value.get("structural_confidence") or 0.0),
            semantic_confidence=float(value.get("semantic_confidence") or 0.0),
            overall_confidence=float(value.get("overall_confidence") or 0.0),
            status=str(value.get("status") or "none"),
            sample_count=int(value.get("sample_count") or 0),
            matched_count=int(value.get("matched_count") or 0),
            warnings=list(value.get("warnings") or []),
        )

    def signature(self) -> str:
        return "|".join([
            self.account_code,
            self.parser_type,
            str(self.delimiter or ""),
            ",".join(f"{item.part_index}:{item.semantic_type.value}" for item in self.fields),
        ])
