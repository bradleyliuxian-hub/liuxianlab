"""Materiality evidence. Materiality alone is never treated as suspicion."""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Dict

from ..schema import amount_to_string
from .constants import AnomalyConfig
from .frequency import BaselineStats, percentile_rank
from .models import VoucherFeatures


def clamp(value: Decimal, low: Decimal = Decimal("0"), high: Decimal = Decimal("1")) -> Decimal:
    return max(low, min(high, value))


@dataclass(frozen=True)
class MaterialityResult:
    score: Decimal
    strength: Decimal
    percentile: Decimal
    share: Decimal
    evidence: Dict[str, object]


def calculate_materiality(
    feature: VoucherFeatures,
    stats: BaselineStats,
    config: AnomalyConfig,
) -> MaterialityResult:
    if stats.population_size <= 0 or stats.total_gross_amount <= 0:
        return MaterialityResult(
            score=Decimal("0"),
            strength=Decimal("0"),
            percentile=Decimal("0"),
            share=Decimal("0"),
            evidence={
                "feature": "materiality",
                "voucher_amount": amount_to_string(feature.gross_amount),
                "population_total": "0.00",
                "percentile": "0.000000",
                "share": "0.000000",
                "score": "0.00",
                "disabled_reason": "empty_population",
            },
        )

    percentile = percentile_rank(feature.gross_amount, stats.amounts)
    share = (feature.gross_amount / stats.total_gross_amount).quantize(
        Decimal("0.000001")
    )

    percentile_span = Decimal("1") - config.materiality_percentile_floor
    percentile_strength = clamp(
        (percentile - config.materiality_percentile_floor) / percentile_span
        if percentile_span > 0
        else Decimal("0")
    )
    share_strength = clamp(
        share / config.materiality_share_reference
        if config.materiality_share_reference > 0
        else Decimal("0")
    )
    strength = (
        Decimal("0.5") * percentile_strength
        + Decimal("0.5") * share_strength
    )
    score = (config.max_materiality_score * strength).quantize(
        Decimal("0.01")
    )

    return MaterialityResult(
        score=score,
        strength=strength.quantize(Decimal("0.000001")),
        percentile=percentile,
        share=share,
        evidence={
            "feature": "materiality",
            "voucher_amount": amount_to_string(feature.gross_amount),
            "population_total": amount_to_string(stats.total_gross_amount),
            "percentile": format(percentile, "f"),
            "share": format(share, "f"),
            "percentile_strength": format(
                percentile_strength.quantize(Decimal("0.000001")),
                "f",
            ),
            "share_strength": format(
                share_strength.quantize(Decimal("0.000001")),
                "f",
            ),
            "score": amount_to_string(score),
        },
    )
