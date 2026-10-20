"""Contra account analysis subpackage."""

from ..errors import ContraComplexityError
from .engine import ContraEngine, analyze_voucher
from .models import (
    METHOD_DIRECT,
    METHOD_EXHAUSTIVE,
    METHOD_NORMALIZED,
    AllocationEdge,
    ContraAllocation,
    ContraAnalysisResult,
    ContraSolution,
    NormalizedNode,
    UnallocatedAmount,
)
from .normalizer import NormalizedVoucher, normalize_voucher
from .ranking import rank_solutions
from .solver import SolverConfig, SolveOutcome, solve

__all__ = [
    "ContraComplexityError",
    "ContraEngine",
    "analyze_voucher",
    "METHOD_DIRECT",
    "METHOD_EXHAUSTIVE",
    "METHOD_NORMALIZED",
    "AllocationEdge",
    "ContraAllocation",
    "ContraAnalysisResult",
    "ContraSolution",
    "NormalizedNode",
    "UnallocatedAmount",
    "NormalizedVoucher",
    "normalize_voucher",
    "rank_solutions",
    "SolverConfig",
    "SolveOutcome",
    "solve",
]
