"""Bounded, deterministic multi-line contra allocation solver.

The solver works in integer minor units (cents) so conservation is exact and
does not depend on float rounding. It searches only inside one voucher.

Algorithm:
1. Normalize debit/credit nodes to positive minor-unit amounts.
2. If the voucher is unbalanced, add a virtual node on the deficient side so
   the search can still allocate the balanced portion. Virtual edges are
   removed by the engine and become unallocated amounts.
3. Use iterative deepening on the number of allocation edges. The minimum is
   max(number of debit nodes, number of credit nodes); the maximum is
   n + m - 1, which is sufficient for a transportation-problem basic solution.
4. For a single debit node, enumerate candidate splits by filling whole credit
   buckets plus at most one partial bucket. This avoids enumerating every cent
   split while still covering transportation extreme points.
5. Stop on solution count or search-state limits.
6. Deduplicate by an edge signature.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from itertools import combinations
from typing import List, Optional, Sequence, Set, Tuple

from ..schema import quantize_amount
from .models import AllocationEdge, ContraSolution, NormalizedNode

VIRTUAL_DEBIT_ID = "__virtual_debit__"
VIRTUAL_CREDIT_ID = "__virtual_credit__"


@dataclass(frozen=True)
class SolverConfig:
    max_nodes: int = 24
    max_solutions: int = 200
    max_search_states: int = 200_000

    def __post_init__(self) -> None:
        if self.max_nodes < 2:
            raise ValueError("max_nodes must be >= 2")
        if self.max_solutions < 1:
            raise ValueError("max_solutions must be >= 1")
        if self.max_search_states < 1:
            raise ValueError("max_search_states must be >= 1")


@dataclass(frozen=True)
class SolveOutcome:
    solutions: Tuple[ContraSolution, ...]
    solution_limit_reached: bool = False
    complexity_limited: bool = False
    states_explored: int = 0
    warnings: Tuple[str, ...] = ()
    virtual_node_ids: Tuple[str, ...] = ()


def _to_minor(amount: Decimal) -> int:
    return int(
        (quantize_amount(amount) * Decimal(100)).to_integral_value()
    )


def _from_nodes(nodes: Sequence[NormalizedNode]) -> List[Tuple[str, int]]:
    return [
        (node.node_id, _to_minor(node.amount))
        for node in nodes
        if _to_minor(node.amount) > 0
    ]


def _unique_node_id(base: str, used: Set[str]) -> str:
    if base not in used:
        return base
    index = 1
    while "%s_%d" % (base, index) in used:
        index += 1
    return "%s_%d" % (base, index)


def _can_allocate(amount: int, caps: Sequence[int], max_nonzero: int) -> bool:
    """Necessary capacity check for one debit under an edge budget."""

    if amount <= 0:
        return True
    if max_nonzero < 1:
        return False
    usable = sorted((cap for cap in caps if cap > 0), reverse=True)
    if not usable:
        return False
    top = usable[:max_nonzero]
    return sum(top) >= amount


def solve(
    debit_nodes: Sequence[NormalizedNode],
    credit_nodes: Sequence[NormalizedNode],
    config: Optional[SolverConfig] = None,
) -> SolveOutcome:
    config = config or SolverConfig()
    debit_items = _from_nodes(debit_nodes)
    credit_items = _from_nodes(credit_nodes)

    if not debit_items or not credit_items:
        return SolveOutcome(solutions=())

    used_ids = {node_id for node_id, _ in debit_items}
    used_ids.update(node_id for node_id, _ in credit_items)

    total_debit = sum(amount for _, amount in debit_items)
    total_credit = sum(amount for _, amount in credit_items)
    virtual_ids = []

    if total_debit != total_credit:
        if total_debit < total_credit:
            virtual_id = _unique_node_id(VIRTUAL_DEBIT_ID, used_ids)
            virtual_ids.append(virtual_id)
            debit_items.append((virtual_id, total_credit - total_debit))
        else:
            virtual_id = _unique_node_id(VIRTUAL_CREDIT_ID, used_ids)
            virtual_ids.append(virtual_id)
            credit_items.append((virtual_id, total_debit - total_credit))

    if len(debit_items) + len(credit_items) > config.max_nodes:
        return SolveOutcome(
            solutions=(),
            complexity_limited=True,
            warnings=("node_limit_reached",),
        )

    # Deterministic search order: larger nodes first, then node id.
    debit_items.sort(key=lambda item: (-item[1], item[0]))
    credit_items.sort(key=lambda item: (-item[1], item[0]))

    debit_amounts = [amount for _, amount in debit_items]
    credit_amounts = [amount for _, amount in credit_items]
    credit_ids = [node_id for node_id, _ in credit_items]

    debit_suffix = [0] * (len(debit_amounts) + 1)
    for index in range(len(debit_amounts) - 1, -1, -1):
        debit_suffix[index] = debit_suffix[index + 1] + debit_amounts[index]

    states = [0]
    complexity_limited = [False]
    final_solutions: List[ContraSolution] = []
    final_solution_limit = [False]

    min_edges = max(len(debit_items), len(credit_items))
    max_edges = len(debit_items) + len(credit_items) - 1

    for edge_budget in range(min_edges, max_edges + 1):
        solutions: List[ContraSolution] = []
        seen_signatures: Set[Tuple[str, ...]] = set()
        solution_limit_reached = [False]

        def allocations_for_debit(
            amount: int,
            remaining_caps: Sequence[int],
            max_nonzero: int,
        ):
            """Yield (allocation tuple, nonzero edge count).

            Candidate allocations fill a subset of buckets completely and use
            at most one additional partial bucket. This is the standard
            transportation extreme-point shape and avoids cent-by-cent search.
            """

            n = len(remaining_caps)
            seen_allocations = set()
            max_full = min(max_nonzero, n)

            for full_count in range(0, max_full + 1):
                for full_indices in combinations(range(n), full_count):
                    states[0] += 1
                    if states[0] > config.max_search_states:
                        complexity_limited[0] = True
                        return
                    full_sum = sum(remaining_caps[index] for index in full_indices)
                    if full_sum > amount:
                        continue
                    remainder = amount - full_sum
                    if remainder == 0:
                        allocation = [0] * n
                        for index in full_indices:
                            allocation[index] = remaining_caps[index]
                        key = tuple(allocation)
                        if key not in seen_allocations:
                            seen_allocations.add(key)
                            yield key, sum(1 for take in allocation if take)
                        continue

                    if full_count >= max_nonzero:
                        continue

                    full_set = set(full_indices)
                    for partial_index in range(n):
                        if partial_index in full_set:
                            continue
                        cap = remaining_caps[partial_index]
                        if cap < remainder or cap <= 0:
                            continue
                        allocation = [0] * n
                        for index in full_indices:
                            allocation[index] = remaining_caps[index]
                        allocation[partial_index] = remainder
                        key = tuple(allocation)
                        if key not in seen_allocations:
                            seen_allocations.add(key)
                            yield key, sum(1 for take in allocation if take)

        def dfs(
            debit_index: int,
            remaining_caps: List[int],
            edges: List[AllocationEdge],
            remaining_edge_budget: int,
        ) -> None:
            states[0] += 1
            if states[0] > config.max_search_states:
                complexity_limited[0] = True
                return
            if len(solutions) >= config.max_solutions:
                solution_limit_reached[0] = True
                return

            remaining_debits = len(debit_items) - debit_index
            if remaining_edge_budget < remaining_debits:
                return

            if debit_index >= len(debit_items):
                if not any(remaining_caps):
                    solution = ContraSolution.from_edges(tuple(edges))
                    if solution.signature not in seen_signatures:
                        seen_signatures.add(solution.signature)
                        solutions.append(solution)
                return

            if sum(remaining_caps) != debit_suffix[debit_index]:
                return

            debit_id = debit_items[debit_index][0]
            amount = debit_amounts[debit_index]
            min_edges_after = remaining_debits - 1
            max_nonzero = remaining_edge_budget - min_edges_after
            if max_nonzero < 1:
                return

            for allocation, used in allocations_for_debit(
                amount,
                remaining_caps,
                max_nonzero,
            ):
                if complexity_limited[0] or solution_limit_reached[0]:
                    return
                next_budget = remaining_edge_budget - used
                next_remaining = [
                    remaining_caps[index] - allocation[index]
                    for index in range(len(remaining_caps))
                ]

                next_index = debit_index + 1
                if next_index < len(debit_items):
                    next_remaining_debits = len(debit_items) - next_index
                    next_max_nonzero = next_budget - (next_remaining_debits - 1)
                    if not _can_allocate(
                        debit_amounts[next_index],
                        next_remaining,
                        next_max_nonzero,
                    ):
                        continue

                next_edges = list(edges)
                for index, take in enumerate(allocation):
                    if take:
                        next_edges.append(
                            AllocationEdge(
                                debit_node_id=debit_id,
                                credit_node_id=credit_ids[index],
                                amount_minor=take,
                            )
                        )
                dfs(
                    next_index,
                    next_remaining,
                    next_edges,
                    next_budget,
                )
                if complexity_limited[0] or solution_limit_reached[0]:
                    return

        dfs(0, list(credit_amounts), [], edge_budget)

        if complexity_limited[0]:
            final_solutions = solutions
            final_solution_limit[0] = solution_limit_reached[0]
            break
        if solutions:
            final_solutions = solutions
            final_solution_limit[0] = solution_limit_reached[0]
            break

    warnings = []
    if final_solution_limit[0]:
        warnings.append("solution_limit_reached")
    if complexity_limited[0]:
        warnings.append("search_state_limit_reached")

    return SolveOutcome(
        solutions=tuple(final_solutions),
        solution_limit_reached=final_solution_limit[0],
        complexity_limited=complexity_limited[0],
        states_explored=states[0],
        warnings=tuple(warnings),
        virtual_node_ids=tuple(virtual_ids),
    )
