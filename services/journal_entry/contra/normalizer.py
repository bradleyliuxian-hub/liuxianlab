"""Sink-Source style normalization at the individual-line level.

The source project aggregates by account + original side and then moves
negative balances. This implementation keeps one node per canonical line (so
every allocation remains traceable to an Excel row) while applying the same
economic-direction idea:

- positive debit -> debit node
- negative debit -> credit node (red-letter debit)
- positive credit -> credit node
- negative credit -> debit node (red-letter credit)

A line with both debit and credit is reduced to its net economic side.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Any, Dict, List, Tuple

from ..schema import (
    AMOUNT_TOLERANCE,
    CREDIT,
    DEBIT,
    MIXED,
    ZERO,
    JournalEntry,
    JournalLine,
    amount_to_string,
    quantize_amount,
)
from .models import NormalizedNode

WARNING_NEGATIVE_NORMALIZED = "negative_amount_normalized"
WARNING_BOTH_SIDES_NETTED = "both_sides_netted"
WARNING_ZERO_LINE_SKIPPED = "zero_line_skipped"
WARNING_SAME_ACCOUNT_BOTH_SIDES = "same_account_on_both_sides"
WARNING_ROUNDING_RESIDUAL = "rounding_residual"
WARNING_UNBALANCED = "unbalanced_voucher"


@dataclass(frozen=True)
class NormalizedVoucher:
    voucher_id: str
    debit_nodes: Tuple[NormalizedNode, ...]
    credit_nodes: Tuple[NormalizedNode, ...]
    total_debit: Decimal
    total_credit: Decimal
    imbalance: Decimal
    warnings: Tuple[str, ...] = ()

    @property
    def node_count(self) -> int:
        return len(self.debit_nodes) + len(self.credit_nodes)

    @property
    def exactly_balanced(self) -> bool:
        return self.imbalance == ZERO

    @property
    def is_within_tolerance(self) -> bool:
        return abs(self.imbalance) <= AMOUNT_TOLERANCE

    @property
    def is_balanced(self) -> bool:
        return self.exactly_balanced

    def to_dict(self) -> Dict[str, Any]:
        return {
            "voucher_id": self.voucher_id,
            "debit_nodes": [node.to_dict() for node in self.debit_nodes],
            "credit_nodes": [node.to_dict() for node in self.credit_nodes],
            "total_debit": amount_to_string(self.total_debit),
            "total_credit": amount_to_string(self.total_credit),
            "imbalance": amount_to_string(self.imbalance),
            "exactly_balanced": self.exactly_balanced,
            "is_within_tolerance": self.is_within_tolerance,
            "node_count": self.node_count,
            "warnings": list(self.warnings),
        }


def _node_from_line(
    line: JournalLine,
    economic_side: str,
    amount: Decimal,
    warnings: Tuple[str, ...],
) -> NormalizedNode:
    return NormalizedNode(
        node_id="%s:%s" % (line.internal_line_key, economic_side),
        internal_line_key=line.internal_line_key,
        line_id=line.line_id,
        account_key=line.account_key,
        account_code=line.account_code,
        account_name=line.account_name,
        economic_side=economic_side,
        amount=quantize_amount(amount, "normalized_amount"),
        original_side=line.original_side,
        original_debit=line.debit,
        original_credit=line.credit,
        original_amount=line.net_amount,
        sheet_name=line.sheet_name,
        source_row=line.source_row,
        converted=(
            economic_side != line.original_side
            or line.debit < ZERO
            or line.credit < ZERO
            or line.original_side == MIXED
        ),
        warnings=warnings,
    )


def normalize_voucher(entry: JournalEntry) -> NormalizedVoucher:
    """Convert a JournalEntry into positive debit/credit nodes."""

    debit_nodes: List[NormalizedNode] = []
    credit_nodes: List[NormalizedNode] = []
    warnings: List[str] = []

    debit_accounts = set()
    credit_accounts = set()

    for line in entry.lines:
        net = quantize_amount(line.debit - line.credit, "net_amount")
        if net == ZERO:
            warnings.append(WARNING_ZERO_LINE_SKIPPED)
            if line.original_side == MIXED:
                warnings.append(WARNING_BOTH_SIDES_NETTED)
            continue

        economic_side = DEBIT if net > ZERO else CREDIT
        amount = abs(net)
        node_warnings = []
        if (
            (line.original_side == DEBIT and economic_side == CREDIT)
            or (line.original_side == CREDIT and economic_side == DEBIT)
            or line.debit < ZERO
            or line.credit < ZERO
        ):
            node_warnings.append(WARNING_NEGATIVE_NORMALIZED)
        if line.original_side == MIXED:
            node_warnings.append(WARNING_BOTH_SIDES_NETTED)

        node = _node_from_line(
            line,
            economic_side,
            amount,
            tuple(node_warnings),
        )
        if economic_side == DEBIT:
            debit_nodes.append(node)
            debit_accounts.add(node.account_key)
        else:
            credit_nodes.append(node)
            credit_accounts.add(node.account_key)

        warnings.extend(node_warnings)

    total_debit = quantize_amount(
        sum((node.amount for node in debit_nodes), ZERO),
        "total_debit",
    )
    total_credit = quantize_amount(
        sum((node.amount for node in credit_nodes), ZERO),
        "total_credit",
    )
    imbalance = quantize_amount(total_debit - total_credit, "imbalance")

    if debit_accounts & credit_accounts:
        warnings.append(WARNING_SAME_ACCOUNT_BOTH_SIDES)

    if imbalance != ZERO:
        warnings.append(WARNING_UNBALANCED)
        if abs(imbalance) <= AMOUNT_TOLERANCE:
            warnings.append(WARNING_ROUNDING_RESIDUAL)

    debit_nodes.sort(key=lambda node: (-node.amount, node.node_id))
    credit_nodes.sort(key=lambda node: (-node.amount, node.node_id))

    return NormalizedVoucher(
        voucher_id=entry.voucher_id,
        debit_nodes=tuple(debit_nodes),
        credit_nodes=tuple(credit_nodes),
        total_debit=total_debit,
        total_credit=total_credit,
        imbalance=imbalance,
        warnings=tuple(_dedupe(warnings)),
    )


def _dedupe(values: List[str]) -> List[str]:
    result = []
    for value in values:
        if value not in result:
            result.append(value)
    return result
