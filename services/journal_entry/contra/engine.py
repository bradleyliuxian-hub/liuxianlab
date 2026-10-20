"""Contra account analysis engine for one JournalEntry."""

from __future__ import annotations

from decimal import Decimal
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

from ..schema import CREDIT, DEBIT, JournalEntry
from .models import (
    METHOD_DIRECT,
    METHOD_EXHAUSTIVE,
    METHOD_NORMALIZED,
    ContraAllocation,
    ContraAnalysisResult,
    ContraSolution,
    NormalizedNode,
    UnallocatedAmount,
)
from .normalizer import NormalizedVoucher, normalize_voucher
from .ranking import rank_solutions
from .solver import SolverConfig, SolveOutcome, solve

ONE = Decimal("1.00")
ZERO_AMOUNT = Decimal("0.00")


def _minor_to_decimal(value: int) -> Decimal:
    return (Decimal(value) / Decimal(100)).quantize(Decimal("0.01"))


def _actual_edges(
    solution: ContraSolution,
    virtual_ids: Sequence[str],
) -> Tuple:
    virtual = set(virtual_ids)
    return tuple(
        edge
        for edge in solution.edges
        if edge.debit_node_id not in virtual and edge.credit_node_id not in virtual
    )


def _method(
    normalized: NormalizedVoucher,
    solution: Optional[ContraSolution],
    virtual_ids: Sequence[str],
) -> str:
    converted = any(
        node.converted
        for node in normalized.debit_nodes + normalized.credit_nodes
    )
    if solution is None:
        return METHOD_NORMALIZED if converted else METHOD_EXHAUSTIVE

    actual = _actual_edges(solution, virtual_ids)
    if (
        len(normalized.debit_nodes) == 1
        and len(normalized.credit_nodes) == 1
        and len(actual) == 1
        and not converted
    ):
        return METHOD_DIRECT
    if converted:
        return METHOD_NORMALIZED
    return METHOD_EXHAUSTIVE


def _unallocated(
    nodes: Sequence[NormalizedNode],
    allocated_minor: Dict[str, int],
    side: str,
) -> Tuple[UnallocatedAmount, ...]:
    result = []
    for node in nodes:
        remaining = node.amount - _minor_to_decimal(
            allocated_minor.get(node.node_id, 0)
        )
        if remaining > ZERO_AMOUNT:
            result.append(
                UnallocatedAmount(
                    internal_line_key=node.internal_line_key,
                    line_id=node.line_id,
                    node_id=node.node_id,
                    side=side,
                    amount=remaining,
                    account_name=node.account_name,
                )
            )
    result.sort(key=lambda item: (item.node_id, item.internal_line_key, item.line_id))
    return tuple(result)


def _build_result(
    entry: JournalEntry,
    normalized: NormalizedVoucher,
    outcome: SolveOutcome,
) -> ContraAnalysisResult:
    ranked = rank_solutions(outcome.solutions)
    best = ranked[0] if ranked else None

    virtual_ids = outcome.virtual_node_ids
    actual_edges = _actual_edges(best, virtual_ids) if best else ()

    debit_allocated: Dict[str, int] = {}
    credit_allocated: Dict[str, int] = {}
    for edge in actual_edges:
        debit_allocated[edge.debit_node_id] = (
            debit_allocated.get(edge.debit_node_id, 0) + edge.amount_minor
        )
        credit_allocated[edge.credit_node_id] = (
            credit_allocated.get(edge.credit_node_id, 0) + edge.amount_minor
        )

    unallocated_debit = _unallocated(
        normalized.debit_nodes,
        debit_allocated,
        DEBIT,
    )
    unallocated_credit = _unallocated(
        normalized.credit_nodes,
        credit_allocated,
        CREDIT,
    )

    solution_count = len(ranked)
    ambiguous = solution_count > 1
    limited = outcome.complexity_limited or outcome.solution_limit_reached
    has_unallocated = bool(unallocated_debit or unallocated_credit)
    # Global uniqueness is only proven for one-sided voucher shapes
    # (1:1, 1:N, N:1). For N:M, a unique minimal-edge solution can still have
    # alternative solutions with more edges, so confidence is withheld.
    single_sided = (
        len(normalized.debit_nodes) == 1
        or len(normalized.credit_nodes) == 1
    )
    confidence = (
        ONE
        if (
            single_sided
            and solution_count == 1
            and not limited
            and not has_unallocated
        )
        else None
    )

    allocations = []
    if best is not None:
        debit_map = {node.node_id: node for node in normalized.debit_nodes}
        credit_map = {node.node_id: node for node in normalized.credit_nodes}
        for edge in actual_edges:
            debit_node = debit_map.get(edge.debit_node_id)
            credit_node = credit_map.get(edge.credit_node_id)
            if debit_node is None or credit_node is None:
                # A virtual edge should have been filtered, but never invent
                # an allocation if a node cannot be traced.
                continue
            allocations.append(
                ContraAllocation(
                    source_internal_key=debit_node.internal_line_key,
                    source_line_id=debit_node.line_id,
                    source_side=DEBIT,
                    target_internal_key=credit_node.internal_line_key,
                    target_line_id=credit_node.line_id,
                    target_side=CREDIT,
                    amount=_minor_to_decimal(edge.amount_minor),
                    method=_method(normalized, best, virtual_ids),
                    source_node_id=debit_node.node_id,
                    target_node_id=credit_node.node_id,
                    confidence=confidence,
                )
            )

    warnings = list(normalized.warnings)
    warnings.extend(outcome.warnings)
    if ambiguous:
        warnings.append("multiple_equivalent_solutions")
    if has_unallocated:
        warnings.append("partially_unallocated")
    if outcome.solution_limit_reached:
        warnings.append("solution_limit_reached")
    if outcome.complexity_limited:
        warnings.append("complexity_limit_reached")

    return ContraAnalysisResult(
        voucher_id=entry.voucher_id,
        allocations=tuple(allocations),
        unallocated_debit=unallocated_debit,
        unallocated_credit=unallocated_credit,
        solution_count=solution_count,
        method=_method(normalized, best, virtual_ids),
        confidence=confidence,
        warnings=tuple(_dedupe(warnings)),
        ambiguous=ambiguous,
        complexity_limited=outcome.complexity_limited,
        solution_limit_reached=outcome.solution_limit_reached,
        node_count=normalized.node_count,
        states_explored=outcome.states_explored,
    )


def _dedupe(values: Iterable[str]) -> List[str]:
    result = []
    for value in values:
        if value not in result:
            result.append(value)
    return result


class ContraEngine:
    """Reusable engine object for a future worker or batch runner."""

    def __init__(self, config: Optional[SolverConfig] = None) -> None:
        self.config = config or SolverConfig()

    def analyze(self, entry: JournalEntry) -> ContraAnalysisResult:
        normalized = normalize_voucher(entry)
        outcome = solve(
            normalized.debit_nodes,
            normalized.credit_nodes,
            self.config,
        )
        return _build_result(entry, normalized, outcome)

    def analyze_many(
        self,
        entries: Iterable[JournalEntry],
    ) -> Tuple[ContraAnalysisResult, ...]:
        return tuple(self.analyze(entry) for entry in entries)


def analyze_voucher(
    entry: JournalEntry,
    config: Optional[SolverConfig] = None,
) -> ContraAnalysisResult:
    return ContraEngine(config=config).analyze(entry)
