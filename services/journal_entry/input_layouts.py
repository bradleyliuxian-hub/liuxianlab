"""Explicit source amount-layout models and cell-value helpers.

Source layouts must be converted into canonical debit/credit before they reach
JournalLine. Contra and anomaly never see direction columns or signed amounts.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Optional

from .errors import NormalizationError

LAYOUT_DEBIT_CREDIT = "debit_credit"
LAYOUT_DIRECTION_AMOUNT = "direction_amount"
LAYOUT_SIGNED_AMOUNT = "signed_amount"
AMOUNT_LAYOUTS = (
    LAYOUT_DEBIT_CREDIT,
    LAYOUT_DIRECTION_AMOUNT,
    LAYOUT_SIGNED_AMOUNT,
)

SIDE_DEBIT = "debit"
SIDE_CREDIT = "credit"
SIDES = (SIDE_DEBIT, SIDE_CREDIT)

DIRECTION_DEBIT_VALUES = frozenset(
    {"借", "借方", "借项", "d", "debit", "dr"}
)
DIRECTION_CREDIT_VALUES = frozenset(
    {"贷", "贷方", "贷项", "c", "credit", "cr"}
)

EXCEL_ERROR_VALUES = frozenset(
    {
        "#NULL!",
        "#DIV/0!",
        "#VALUE!",
        "#REF!",
        "#NAME?",
        "#NUM!",
        "#N/A",
        "#GETTING_DATA",
        "#SPILL!",
        "#CALC!",
        "#CONNECT!",
        "#BLOCKED!",
        "#UNKNOWN!",
        "#FIELD!",
        "#BUSY!",
    }
)


def is_excel_error_value(value: Any) -> bool:
    if value is None or isinstance(value, bool):
        return False
    return str(value).strip().upper() in EXCEL_ERROR_VALUES


def normalize_direction(value: Any) -> Optional[str]:
    """Return 'debit' / 'credit'; blank -> None; anything else is invalid."""

    if value is None:
        return None
    text = str(value).strip().lower().replace(" ", "").replace("\u3000", "")
    if not text:
        return None
    if is_excel_error_value(text):
        raise NormalizationError(
            "方向列是 Excel 错误值。",
            details={
                "field": "direction",
                "reason": "excel_error_value",
                "value": value,
            },
        )
    if text in DIRECTION_DEBIT_VALUES:
        return SIDE_DEBIT
    if text in DIRECTION_CREDIT_VALUES:
        return SIDE_CREDIT
    raise NormalizationError(
        "方向值无法识别。",
        details={
            "field": "direction",
            "reason": "invalid_direction",
            "value": value,
        },
    )


def normalize_positive_side(value: Any) -> Optional[str]:
    """Parse the explicit signed-amount convention side."""

    if value is None:
        return None
    text = str(value).strip().lower().replace(" ", "")
    if not text:
        return None
    if text in {"debit", "dr", "d", "借", "借方"}:
        return SIDE_DEBIT
    if text in {"credit", "cr", "c", "贷", "贷方"}:
        return SIDE_CREDIT
    raise NormalizationError(
        "positive_side 仅支持 debit / credit。",
        details={
            "field": "positive_side",
            "reason": "invalid_positive_side",
            "value": value,
        },
    )


@dataclass(frozen=True)
class AmountLayoutSpec:
    layout: str
    debit_column: Optional[str] = None
    credit_column: Optional[str] = None
    direction_column: Optional[str] = None
    amount_column: Optional[str] = None
    signed_amount_column: Optional[str] = None
    positive_side: Optional[str] = None

    def __post_init__(self) -> None:
        if self.layout not in AMOUNT_LAYOUTS:
            raise ValueError("unknown amount layout: %s" % (self.layout,))

    def to_dict(self) -> Dict[str, Any]:
        return {
            "layout": self.layout,
            "debit_column": self.debit_column,
            "credit_column": self.credit_column,
            "direction_column": self.direction_column,
            "amount_column": self.amount_column,
            "signed_amount_column": self.signed_amount_column,
            "positive_side": self.positive_side,
        }


DEFAULT_AMOUNT_LAYOUT = AmountLayoutSpec(layout=LAYOUT_DEBIT_CREDIT)
