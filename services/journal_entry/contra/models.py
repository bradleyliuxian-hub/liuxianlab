"""Structured contra models. No user-facing prose strings."""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Any, Dict, Optional, Tuple

from ..schema import amount_to_string

METHOD_DIRECT = "direct"
METHOD_NORMALIZED = "normalized"
METHOD_EXHAUSTIVE = "exhaustive"


@dataclass(frozen=True)
class NormalizedNode:
    node_id: str
    internal_line_key: str
    line_id: str
    account_key: str
    account_code: Optional[str]
    account_name: Optional[str]
    economic_side: str
    amount: Decimal
    original_side: str
    original_debit: Decimal
    original_credit: Decimal
    original_amount: Decimal
    sheet_name: str
    source_row: int
    converted: bool = False
    warnings: Tuple[str, ...] = ()

    def to_dict(self) -> Dict[str, Any]:
        return {
            "node_id": self.node_id,
            "internal_line_key": self.internal_line_key,
            "line_id": self.line_id,
            "account_key": self.account_key,
            "account_code": self.account_code,
            "account_name": self.account_name,
            "economic_side": self.economic_side,
            "amount": amount_to_string(self.amount),
            "original_side": self.original_side,
            "original_debit": amount_to_string(self.original_debit),
            "original_credit": amount_to_string(self.original_credit),
            "original_amount": amount_to_string(self.original_amount),
            "sheet_name": self.sheet_name,
            "source_row": self.source_row,
            "converted": self.converted,
            "warnings": list(self.warnings),
        }


@dataclass(frozen=True)
class AllocationEdge:
    debit_node_id: str
    credit_node_id: str
    amount_minor: int

    @property
    def amount(self) -> Decimal:
        return (Decimal(self.amount_minor) / Decimal(100)).quantize(Decimal("0.01"))

    def to_dict(self) -> Dict[str, Any]:
        return {
            "debit_node_id": self.debit_node_id,
            "credit_node_id": self.credit_node_id,
            "amount": amount_to_string(self.amount),
        }


@dataclass(frozen=True)
class ContraSolution:
    edges: Tuple[AllocationEdge, ...]
    edge_count: int
    split_count: int
    signature: Tuple[str, ...]

    @classmethod
    def from_edges(cls, edges: Tuple[AllocationEdge, ...]) -> "ContraSolution":
        ordered = tuple(
            sorted(
                edges,
                key=lambda edge: (
                    edge.debit_node_id,
                    edge.credit_node_id,
                    edge.amount_minor,
                ),
            )
        )
        outgoing = {}
        incoming = {}
        for edge in ordered:
            outgoing[edge.debit_node_id] = outgoing.get(edge.debit_node_id, 0) + 1
            incoming[edge.credit_node_id] = incoming.get(edge.credit_node_id, 0) + 1
        split_count = sum(1 for count in outgoing.values() if count > 1)
        split_count += sum(1 for count in incoming.values() if count > 1)
        signature = tuple(
            "%s|%s|%d"
            % (edge.debit_node_id, edge.credit_node_id, edge.amount_minor)
            for edge in ordered
        )
        return cls(
            edges=ordered,
            edge_count=len(ordered),
            split_count=split_count,
            signature=signature,
        )

    def to_dict(self) -> Dict[str, Any]:
        return {
            "edge_count": self.edge_count,
            "split_count": self.split_count,
            "edges": [edge.to_dict() for edge in self.edges],
        }


@dataclass(frozen=True)
class ContraAllocation:
    source_internal_key: str
    source_line_id: str
    source_side: str
    target_internal_key: str
    target_line_id: str
    target_side: str
    amount: Decimal
    method: str
    source_node_id: str
    target_node_id: str
    confidence: Optional[Decimal] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "source_internal_key": self.source_internal_key,
            "source_line_id": self.source_line_id,
            "source_side": self.source_side,
            "target_internal_key": self.target_internal_key,
            "target_line_id": self.target_line_id,
            "target_side": self.target_side,
            "amount": amount_to_string(self.amount),
            "method": self.method,
            "source_node_id": self.source_node_id,
            "target_node_id": self.target_node_id,
            "confidence": (
                None
                if self.confidence is None
                else format(self.confidence, ".2f")
            ),
        }


@dataclass(frozen=True)
class UnallocatedAmount:
    internal_line_key: str
    line_id: str
    node_id: str
    side: str
    amount: Decimal
    account_name: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "internal_line_key": self.internal_line_key,
            "line_id": self.line_id,
            "node_id": self.node_id,
            "side": self.side,
            "amount": amount_to_string(self.amount),
            "account_name": self.account_name,
        }


@dataclass(frozen=True)
class ContraAnalysisResult:
    voucher_id: str
    allocations: Tuple[ContraAllocation, ...]
    unallocated_debit: Tuple[UnallocatedAmount, ...]
    unallocated_credit: Tuple[UnallocatedAmount, ...]
    solution_count: int
    method: str
    confidence: Optional[Decimal]
    warnings: Tuple[str, ...] = ()
    ambiguous: bool = False
    complexity_limited: bool = False
    solution_limit_reached: bool = False
    node_count: int = 0
    states_explored: int = 0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "voucher_id": self.voucher_id,
            "allocations": [item.to_dict() for item in self.allocations],
            "unallocated_debit": [
                item.to_dict() for item in self.unallocated_debit
            ],
            "unallocated_credit": [
                item.to_dict() for item in self.unallocated_credit
            ],
            "solution_count": self.solution_count,
            "method": self.method,
            "confidence": (
                None
                if self.confidence is None
                else format(self.confidence, ".2f")
            ),
            "warnings": list(self.warnings),
            "ambiguous": self.ambiguous,
            "complexity_limited": self.complexity_limited,
            "solution_limit_reached": self.solution_limit_reached,
            "node_count": self.node_count,
            "states_explored": self.states_explored,
        }
