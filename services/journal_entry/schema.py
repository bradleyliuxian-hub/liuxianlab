"""Canonical Journal Line / Journal Entry schema.

The engine deliberately does not depend on Excel headers, Chinese column names,
customer templates, or pandas DataFrames. Every downstream layer consumes these
objects.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any, Dict, Iterable, Optional, Sequence, Tuple

from .errors import JournalEntryError

DEBIT = "debit"
CREDIT = "credit"
MIXED = "mixed"
SIDES = (DEBIT, CREDIT)

# Currency precision is explicit, not a magic number at each call site.
CURRENCY_PRECISION = Decimal("0.01")
ZERO = Decimal("0.00")

# Balance tolerance is shared by schema validation and the contra engine.
AMOUNT_TOLERANCE = Decimal("0.01")


def clean_text(value: Any) -> Optional[str]:
    """Return stripped text, or None for blank/NaN-like values."""

    if value is None:
        return None
    text = str(value).strip()
    if not text or text.lower() in {"nan", "none", "null"}:
        return None
    return text


def _decimal(value: Any, field_name: str) -> Decimal:
    """Convert a value to Decimal without keeping binary float arithmetic.

    Floats are accepted only because openpyxl returns them for numeric cells;
    they are converted through ``str(value)`` immediately.
    """

    if value is None or value == "":
        return ZERO
    if isinstance(value, bool):
        raise JournalEntryError(
            "布尔值不能作为金额。",
            details={"field": field_name, "value": value},
        )
    if isinstance(value, float):
        try:
            value = Decimal(str(value))
        except InvalidOperation as exc:
            raise JournalEntryError(
                "金额无法解析。",
                details={"field": field_name, "value": value},
            ) from exc
    elif isinstance(value, int):
        value = Decimal(value)
    elif not isinstance(value, Decimal):
        try:
            value = Decimal(str(value).strip())
        except (InvalidOperation, ValueError) as exc:
            raise JournalEntryError(
                "金额无法解析。",
                details={"field": field_name, "value": value},
            ) from exc
    if not value.is_finite():
        raise JournalEntryError(
            "金额必须是有限数字。",
            details={"field": field_name, "value": str(value)},
        )
    return value.quantize(CURRENCY_PRECISION, rounding=ROUND_HALF_UP)


def quantize_amount(value: Any, field_name: str = "amount") -> Decimal:
    """Quantize to the configured currency precision."""

    return _decimal(value, field_name)


def amount_to_string(value: Decimal) -> str:
    """Stable two-decimal serialization used by structured results."""

    return format(quantize_amount(value), ".2f")


def amounts_equal(
    left: Decimal,
    right: Decimal,
    tolerance: Decimal = AMOUNT_TOLERANCE,
) -> bool:
    return abs(quantize_amount(left) - quantize_amount(right)) <= tolerance


@dataclass(frozen=True)
class JournalLine:
    """One canonical journal line, traceable back to its Excel source row."""

    voucher_id: str
    sheet_name: str
    source_row: int

    account_code: Optional[str] = None
    account_name: Optional[str] = None
    detail_account: Optional[str] = None

    debit: Decimal = ZERO
    credit: Decimal = ZERO

    date: Optional[date] = None
    period: Optional[str] = None
    entity: Optional[str] = None

    currency: Optional[str] = None
    original_amount: Optional[Decimal] = None

    description: Optional[str] = None
    preparer: Optional[str] = None
    line_id: str = ""

    def __post_init__(self) -> None:
        voucher_id = clean_text(self.voucher_id)
        account_code = clean_text(self.account_code)
        account_name = clean_text(self.account_name)
        sheet_name = clean_text(self.sheet_name)

        if not voucher_id:
            raise JournalEntryError(
                "voucher_id 不能为空。",
                details={"field": "voucher_id"},
            )
        if not account_code and not account_name:
            raise JournalEntryError(
                "account_code 与 account_name 至少需要一个。",
                details={"field": "account"},
            )
        if not sheet_name:
            raise JournalEntryError(
                "sheet_name 不能为空。",
                details={"field": "sheet_name"},
            )
        if not isinstance(self.source_row, int) or self.source_row < 1:
            raise JournalEntryError(
                "source_row 必须是 >= 1 的整数。",
                details={"field": "source_row", "value": self.source_row},
            )

        debit = quantize_amount(self.debit, "debit")
        credit = quantize_amount(self.credit, "credit")
        original_amount = (
            None
            if self.original_amount is None
            else quantize_amount(self.original_amount, "original_amount")
        )

        if self.date is not None and not isinstance(self.date, date):
            raise JournalEntryError(
                "date 必须是 datetime.date 或 None。",
                details={"field": "date", "value": str(self.date)},
            )

        object.__setattr__(self, "voucher_id", voucher_id)
        object.__setattr__(self, "account_code", account_code)
        object.__setattr__(self, "account_name", account_name)
        object.__setattr__(self, "sheet_name", sheet_name)
        object.__setattr__(self, "debit", debit)
        object.__setattr__(self, "credit", credit)
        object.__setattr__(self, "original_amount", original_amount)
        object.__setattr__(self, "period", clean_text(self.period))
        object.__setattr__(self, "entity", clean_text(self.entity))
        object.__setattr__(self, "currency", clean_text(self.currency))
        object.__setattr__(self, "description", clean_text(self.description))
        object.__setattr__(self, "preparer", clean_text(self.preparer))
        object.__setattr__(
            self,
            "line_id",
            clean_text(self.line_id) or "%s:%d" % (sheet_name, self.source_row),
        )

    @property
    def internal_line_key(self) -> str:
        """Collision-free identity within a workbook.

        The external business ``line_id`` is allowed to repeat. Solver identity
        uses this length-prefixed sheet/row key instead, so two real rows can
        never collapse into one node.
        """

        return "%d:%s:%d" % (len(self.sheet_name), self.sheet_name, self.source_row)

    @property
    def account_key(self) -> str:
        """Stable accounting identifier: code first, then name."""

        if self.account_code:
            return self.account_code
        return self.account_name or ""

    @property
    def account_label(self) -> str:
        if self.account_name and self.account_code:
            return "%s %s" % (self.account_code, self.account_name)
        return self.account_name or self.account_code or ""

    @property
    def net_amount(self) -> Decimal:
        return quantize_amount(self.debit - self.credit, "net_amount")

    @property
    def is_zero(self) -> bool:
        return self.debit == ZERO and self.credit == ZERO

    @property
    def original_side(self) -> str:
        if self.debit != ZERO and self.credit == ZERO:
            return DEBIT
        if self.credit != ZERO and self.debit == ZERO:
            return CREDIT
        if self.debit != ZERO and self.credit != ZERO:
            return MIXED
        return "zero"

    def to_dict(self) -> Dict[str, Any]:
        return {
            "entity": self.entity,
            "period": self.period,
            "date": self.date.isoformat() if self.date else None,
            "voucher_id": self.voucher_id,
            "line_id": self.line_id,
            "internal_line_key": self.internal_line_key,
            "account_code": self.account_code,
            "account_name": self.account_name,
            "detail_account": self.detail_account,
            "debit": amount_to_string(self.debit),
            "credit": amount_to_string(self.credit),
            "currency": self.currency,
            "original_amount": (
                None
                if self.original_amount is None
                else amount_to_string(self.original_amount)
            ),
            "description": self.description,
            "preparer": self.preparer,
            "sheet_name": self.sheet_name,
            "source_row": self.source_row,
        }


def _unique_join(values: Iterable[Optional[str]], separator: str = " | ") -> Optional[str]:
    seen = []
    for value in values:
        text = clean_text(value)
        if text and text not in seen:
            seen.append(text)
    return separator.join(seen) if seen else None


@dataclass(frozen=True)
class JournalEntry:
    """One voucher reconstructed from canonical JournalLine objects."""

    voucher_id: str
    lines: Tuple[JournalLine, ...]

    date: Optional[date] = None
    period: Optional[str] = None
    entity: Optional[str] = None

    total_debit: Decimal = ZERO
    total_credit: Decimal = ZERO
    imbalance: Decimal = ZERO

    account_codes: Tuple[str, ...] = field(default_factory=tuple)
    account_names: Tuple[str, ...] = field(default_factory=tuple)

    description: Optional[str] = None
    preparer: Optional[str] = None
    validation_flags: Tuple[str, ...] = field(default_factory=tuple)

    @classmethod
    def from_lines(cls, lines: Sequence[JournalLine]) -> "JournalEntry":
        ordered = tuple(
            sorted(
                lines,
                key=lambda line: (
                    line.sheet_name,
                    line.source_row,
                    line.line_id,
                ),
            )
        )
        if not ordered:
            raise JournalEntryError("JournalEntry 不能由空 lines 创建。")

        voucher_ids = {line.voucher_id for line in ordered}
        if len(voucher_ids) != 1:
            raise JournalEntryError(
                "JournalEntry 的 lines 必须属于同一个 voucher。",
                details={"voucher_ids": sorted(voucher_ids)},
            )

        internal_keys = [line.internal_line_key for line in ordered]
        if len(set(internal_keys)) != len(internal_keys):
            raise JournalEntryError(
                "同一 JournalEntry 内存在重复的 internal line identity。",
                details={"internal_line_keys": internal_keys},
            )

        entities = {line.entity for line in ordered if line.entity}
        periods = {line.period for line in ordered if line.period}
        dates = {line.date for line in ordered if line.date}

        total_debit = quantize_amount(
            sum((line.debit for line in ordered), ZERO),
            "total_debit",
        )
        total_credit = quantize_amount(
            sum((line.credit for line in ordered), ZERO),
            "total_credit",
        )
        imbalance = quantize_amount(total_debit - total_credit, "imbalance")

        flags = []
        if imbalance != ZERO:
            flags.append("unbalanced")
            if abs(imbalance) <= AMOUNT_TOLERANCE:
                flags.append("within_tolerance")
                flags.append("rounding_residual")
        if len(entities) > 1:
            flags.append("mixed_entities")
        if len(periods) > 1:
            flags.append("mixed_periods")
        if len(dates) > 1:
            flags.append("mixed_dates")

        return cls(
            voucher_id=ordered[0].voucher_id,
            lines=ordered,
            date=(sorted(dates)[0] if dates else None),
            period=(sorted(periods)[0] if periods else None),
            entity=(sorted(entities)[0] if entities else None),
            total_debit=total_debit,
            total_credit=total_credit,
            imbalance=imbalance,
            account_codes=tuple(
                sorted(
                    {
                        line.account_code
                        for line in ordered
                        if line.account_code
                    }
                )
            ),
            account_names=tuple(
                sorted(
                    {
                        line.account_name
                        for line in ordered
                        if line.account_name
                    }
                )
            ),
            description=_unique_join(line.description for line in ordered),
            preparer=_unique_join(line.preparer for line in ordered),
            validation_flags=tuple(flags),
        )

    @property
    def exactly_balanced(self) -> bool:
        """Accounting identity is exact: total debit == total credit."""

        return self.imbalance == ZERO

    @property
    def is_within_tolerance(self) -> bool:
        """The absolute difference is inside the configured tolerance."""

        return abs(self.imbalance) <= AMOUNT_TOLERANCE

    @property
    def is_balanced(self) -> bool:
        """Compatibility alias for exact balance, never a tolerance claim."""

        return self.exactly_balanced

    def to_dict(self) -> Dict[str, Any]:
        return {
            "voucher_id": self.voucher_id,
            "date": self.date.isoformat() if self.date else None,
            "period": self.period,
            "entity": self.entity,
            "total_debit": amount_to_string(self.total_debit),
            "total_credit": amount_to_string(self.total_credit),
            "imbalance": amount_to_string(self.imbalance),
            "exactly_balanced": self.exactly_balanced,
            "is_within_tolerance": self.is_within_tolerance,
            "is_balanced": self.is_balanced,
            "account_codes": list(self.account_codes),
            "account_names": list(self.account_names),
            "description": self.description,
            "preparer": self.preparer,
            "validation_flags": list(self.validation_flags),
            "lines": [line.to_dict() for line in self.lines],
        }


def make_voucher_key(line: JournalLine) -> Tuple[str, str, str, str]:
    """Return a stable grouping key that prevents cross-period collisions.

    Strategy:
    - entity (when present)
    - period when present
    - otherwise the exact date
    - otherwise no discriminator (documented limitation)
    - voucher_id

    This intentionally does NOT group by voucher_id alone: January "记-001"
    and February "记-001" must remain separate.
    """

    entity = line.entity or ""
    if line.period:
        return (entity, "period", line.period, line.voucher_id)
    if line.date:
        return (entity, "date", line.date.isoformat(), line.voucher_id)
    return (entity, "none", "", line.voucher_id)
