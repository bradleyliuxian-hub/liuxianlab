"""Explainable Occam-style ranking for contra solutions.

The ranking is deliberately simple and deterministic:

1. fewer allocation edges is better (no unnecessary split);
2. fewer split nodes is better (a split node has more than one edge);
3. the canonical edge signature is the final tie-break.

No machine learning, semantic score, or hidden weights are used.
"""

from __future__ import annotations

from typing import Iterable, List

from .models import ContraSolution


def solution_sort_key(solution: ContraSolution):
    return (
        solution.edge_count,
        solution.split_count,
        solution.signature,
    )


def rank_solutions(
    solutions: Iterable[ContraSolution],
) -> List[ContraSolution]:
    return sorted(solutions, key=solution_sort_key)


def explain_ranking(solution: ContraSolution) -> dict:
    return {
        "edge_count": solution.edge_count,
        "split_count": solution.split_count,
        "canonical_signature": list(solution.signature),
        "rule": "fewer_edges_then_fewer_splits_then_signature",
    }
