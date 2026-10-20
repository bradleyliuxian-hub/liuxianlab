"""Structured anomaly features, scores, findings, and result container."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Any, Dict, Mapping, Optional, Tuple

from ..schema import amount_to_string


def make_stable_finding_id(code: str, voucher_key: str) -> str:
    """Deterministic finding id; no random UUID."""

    digest = hashlib.sha256(
        ("%s|%s" % (code, voucher_key)).encode("utf-8")
    ).hexdigest()
    return "%s:%s" % (code, digest[:16])


def _ratio(value: Decimal) -> str:
    return format(value.quantize(Decimal("0.000001")), "f")


@dataclass(frozen=True)
class VoucherFeatures:
    voucher_key: str
    voucher_id: str
    date: Optional[date]
    period: Optional[str]
    entity: Optional[str]

    total_debit: Decimal
    total_credit: Decimal
    gross_amount: Decimal

    line_count: int
    account_count: int

    debit_accounts: Tuple[str, ...]
    credit_accounts: Tuple[str, ...]
    all_accounts: Tuple[str, ...]

    account_signature: str
    directional_signature: str
    account_multiset_signature: str

    description: Optional[str]
    preparer: Optional[str]

    has_negative_lines: bool
    has_mixed_side_lines: bool
    is_balanced: bool
    is_within_tolerance: bool
    validation_flags: Tuple[str, ...]

    business_group: str

    account_categories: Tuple[Tuple[str, str], ...]
    category_set: Tuple[str, ...]
    unknown_account_count: int
    unknown_account_ratio: Decimal

    contra_ambiguous: Optional[bool] = None
    contra_unallocated: Optional[Decimal] = None
    contra_solution_count: Optional[int] = None
    contra_complexity_limited: Optional[bool] = None
    contra_warnings: Tuple[str, ...] = ()

    sheet_names: Tuple[str, ...] = ()
    source_rows: Tuple[int, ...] = ()

    def category_set_normalized(self) -> Tuple[str, ...]:
        return self.category_set

    def to_dict(self) -> Dict[str, Any]:
        return {
            "voucher_key": self.voucher_key,
            "voucher_id": self.voucher_id,
            "date": self.date.isoformat() if self.date else None,
            "period": self.period,
            "entity": self.entity,
            "total_debit": amount_to_string(self.total_debit),
            "total_credit": amount_to_string(self.total_credit),
            "gross_amount": amount_to_string(self.gross_amount),
            "line_count": self.line_count,
            "account_count": self.account_count,
            "debit_accounts": list(self.debit_accounts),
            "credit_accounts": list(self.credit_accounts),
            "all_accounts": list(self.all_accounts),
            "account_signature": self.account_signature,
            "directional_signature": self.directional_signature,
            "account_multiset_signature": self.account_multiset_signature,
            "description": self.description,
            "preparer": self.preparer,
            "has_negative_lines": self.has_negative_lines,
            "has_mixed_side_lines": self.has_mixed_side_lines,
            "is_balanced": self.is_balanced,
            "is_within_tolerance": self.is_within_tolerance,
            "validation_flags": list(self.validation_flags),
            "business_group": self.business_group,
            "account_categories": [
                [account, category] for account, category in self.account_categories
            ],
            "category_set": list(self.category_set),
            "unknown_account_count": self.unknown_account_count,
            "unknown_account_ratio": _ratio(self.unknown_account_ratio),
            "contra_ambiguous": self.contra_ambiguous,
            "contra_unallocated": (
                None
                if self.contra_unallocated is None
                else amount_to_string(self.contra_unallocated)
            ),
            "contra_solution_count": self.contra_solution_count,
            "contra_complexity_limited": self.contra_complexity_limited,
            "contra_warnings": list(self.contra_warnings),
            "sheet_names": list(self.sheet_names),
            "source_rows": list(self.source_rows),
        }


@dataclass(frozen=True)
class VoucherAnomalyScore:
    voucher_key: str
    voucher_id: str
    risk_score: Decimal
    risk_level: str
    components: Mapping[str, Decimal]
    evidence: Mapping[str, Any]
    business_group: str
    gross_amount: Decimal

    def to_dict(self) -> Dict[str, Any]:
        return {
            "voucher_key": self.voucher_key,
            "voucher_id": self.voucher_id,
            "risk_score": amount_to_string(self.risk_score),
            "risk_level": self.risk_level,
            "components": {
                key: amount_to_string(value)
                for key, value in sorted(self.components.items())
            },
            "evidence": self.evidence,
            "business_group": self.business_group,
            "gross_amount": amount_to_string(self.gross_amount),
        }


@dataclass(frozen=True)
class AnomalyFinding:
    id: str
    code: str
    type: str
    severity: str
    risk_score: Decimal

    voucher_key: str
    voucher_id: str
    date: Optional[date]
    period: Optional[str]
    entity: Optional[str]

    amount: Decimal
    accounts: Tuple[str, ...]
    account_signature: str
    business_group: str

    reason: str
    evidence: Mapping[str, Any]

    sheet_names: Tuple[str, ...]
    source_rows: Tuple[int, ...]
    professional_interpretation: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "code": self.code,
            "type": self.type,
            "severity": self.severity,
            "risk_score": amount_to_string(self.risk_score),
            "voucher_key": self.voucher_key,
            "voucher_id": self.voucher_id,
            "date": self.date.isoformat() if self.date else None,
            "period": self.period,
            "entity": self.entity,
            "amount": amount_to_string(self.amount),
            "accounts": list(self.accounts),
            "account_signature": self.account_signature,
            "business_group": self.business_group,
            "reason": self.reason,
            "evidence": self.evidence,
            "sheet_names": list(self.sheet_names),
            "source_rows": list(self.source_rows),
            "professional_interpretation": self.professional_interpretation,
        }


@dataclass(frozen=True)
class AnomalyResult:
    scores: Tuple[VoucherAnomalyScore, ...]
    findings: Tuple[AnomalyFinding, ...]
    summary: Mapping[str, Any]
    warnings: Tuple[str, ...] = ()

    def to_dict(self) -> Dict[str, Any]:
        return {
            "scores": [score.to_dict() for score in self.scores],
            "findings": [finding.to_dict() for finding in self.findings],
            "summary": self.summary,
            "warnings": list(self.warnings),
        }
