"""Feature extraction for deterministic voucher business classification."""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from decimal import Decimal
from typing import Dict, Iterable, Tuple

from ..accounting_features import classify_account_category, voucher_key_for_entry
from ..schema import CREDIT, DEBIT, ZERO, JournalEntry, quantize_amount


@dataclass(frozen=True)
class BusinessLineFeature:
    account_key: str
    account_code: str
    account_name: str
    category: str
    side: str
    amount: Decimal
    amount_share: Decimal


@dataclass(frozen=True)
class BusinessFeatures:
    voucher_key: str
    voucher_id: str
    description: str
    lines: Tuple[BusinessLineFeature, ...]
    debit_categories: Tuple[str, ...]
    credit_categories: Tuple[str, ...]
    all_categories: Tuple[str, ...]
    debit_account_names: Tuple[str, ...]
    credit_account_names: Tuple[str, ...]
    all_account_names: Tuple[str, ...]
    sheet_names: Tuple[str, ...]
    source_rows: Tuple[int, ...]
    has_negative_lines: bool


def _effective_line(line) -> Tuple[str, Decimal]:
    """Return economic side and magnitude while preserving red-letter meaning.

    Positive debit -> debit; negative debit -> credit.
    Positive credit -> credit; negative credit -> debit.
    A mixed line is represented by its net economic side.
    """

    net = quantize_amount(line.debit - line.credit, "business_net")
    if net > ZERO:
        return DEBIT, net
    if net < ZERO:
        return CREDIT, abs(net)
    return "zero", ZERO


def extract_business_features(entry: JournalEntry) -> BusinessFeatures:
    prepared = []
    total = ZERO
    for line in entry.lines:
        side, amount = _effective_line(line)
        if side == "zero" or amount == ZERO:
            continue
        total += amount
        category = classify_account_category(line.account_code, line.account_name).category
        prepared.append((line, side, amount, category))

    total = quantize_amount(total, "business_total")
    result = []
    debit_categories = set()
    credit_categories = set()
    debit_names = set()
    credit_names = set()
    all_names = set()

    for line, side, amount, category in prepared:
        share = Decimal("0") if total == ZERO else (amount / total).quantize(Decimal("0.000001"))
        name = str(line.account_name or "").strip()
        result.append(
            BusinessLineFeature(
                account_key=line.account_key,
                account_code=str(line.account_code or ""),
                account_name=name,
                category=category,
                side=side,
                amount=amount,
                amount_share=share,
            )
        )
        all_names.add(name)
        if side == DEBIT:
            debit_categories.add(category)
            debit_names.add(name)
        else:
            credit_categories.add(category)
            credit_names.add(name)

    return BusinessFeatures(
        voucher_key=voucher_key_for_entry(entry),
        voucher_id=entry.voucher_id,
        description=str(entry.description or ""),
        lines=tuple(result),
        debit_categories=tuple(sorted(debit_categories)),
        credit_categories=tuple(sorted(credit_categories)),
        all_categories=tuple(sorted(debit_categories | credit_categories)),
        debit_account_names=tuple(sorted(name for name in debit_names if name)),
        credit_account_names=tuple(sorted(name for name in credit_names if name)),
        all_account_names=tuple(sorted(name for name in all_names if name)),
        sheet_names=tuple(sorted({line.sheet_name for line in entry.lines})),
        source_rows=tuple(sorted({line.source_row for line in entry.lines})),
        has_negative_lines=any(line.debit < ZERO or line.credit < ZERO for line in entry.lines),
    )
