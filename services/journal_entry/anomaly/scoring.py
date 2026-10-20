"""Deterministic, explainable risk components and voucher scores."""

from __future__ import annotations

from decimal import Decimal
from typing import Dict, Sequence, Tuple

from ..schema import amount_to_string, quantize_amount
from .constants import (
    AnomalyConfig,
    GROUP_OTHER,
    SEVERITY_HIGH,
    SEVERITY_INFO,
    SEVERITY_LOW,
    SEVERITY_MEDIUM,
)
from .frequency import AnomalyContext, BaselineStats, percentile_rank
from .materiality import calculate_materiality, clamp
from .models import VoucherAnomalyScore, VoucherFeatures

ZERO = Decimal("0")
ONE = Decimal("1")
HUNDRED = Decimal("100")


def _ratio(value: Decimal) -> str:
    return format(value.quantize(Decimal("0.000001")), "f")


def _rare_strength(ratio: Decimal, threshold: Decimal) -> Decimal:
    if threshold <= 0:
        return ZERO
    if ratio >= threshold:
        return ZERO
    return clamp((threshold - ratio) / threshold)


def _count_strength(count: int, config: AnomalyConfig) -> Decimal:
    if count <= 0:
        return ZERO
    if count <= config.rarity_count_full_max:
        return ONE
    if count <= config.rarity_count_strong_max:
        return config.rarity_count_strong_strength
    if count <= config.rarity_count_moderate_max:
        return config.rarity_count_moderate_strength
    if count <= config.rarity_count_weak_max:
        return config.rarity_count_weak_strength
    return ZERO


def _diversity_factor(diversity: Decimal, maximum: Decimal) -> Decimal:
    if maximum <= 0 or maximum >= ONE:
        return ONE
    return clamp((ONE - diversity) / (ONE - maximum))


def _rarity_measure(
    *,
    count: int,
    population: int,
    config: AnomalyConfig,
    diversity_factor: Decimal = ONE,
) -> Dict[str, object]:
    if count <= 0 or population <= 0:
        return {
            "count": count,
            "ratio": "0.000000",
            "count_strength": "0.000000",
            "ratio_strength": "0.000000",
            "diversity_factor": _ratio(diversity_factor),
            "strength": "0.000000",
        }
    ratio = Decimal(count) / Decimal(population)
    count_strength = _count_strength(count, config)
    ratio_strength = _rare_strength(ratio, config.rare_ratio)
    strength = min(count_strength, ratio_strength) * diversity_factor
    return {
        "count": count,
        "ratio": _ratio(ratio),
        "count_strength": _ratio(count_strength),
        "ratio_strength": _ratio(ratio_strength),
        "diversity_factor": _ratio(diversity_factor),
        "strength": _ratio(strength),
    }


def _pair_key(debit_account: str, credit_account: str) -> str:
    return "D:%s->C:%s" % (debit_account, credit_account)


def _component(
    name: str,
    score: Decimal,
    max_score: Decimal,
    strength: Decimal,
    evidence: Dict[str, object],
) -> Dict[str, object]:
    return {
        "name": name,
        "score": amount_to_string(score),
        "max_score": amount_to_string(max_score),
        "strength": _ratio(strength),
        "evidence": evidence,
    }


def calculate_rarity(
    feature: VoucherFeatures,
    stats: BaselineStats,
    config: AnomalyConfig,
) -> Tuple[Decimal, Decimal, Dict[str, object]]:
    evidence: Dict[str, object] = {
        "feature": "rarity",
        "frequency_enabled": stats.frequency_enabled,
        "population_size": stats.population_size,
        "rare_ratio_threshold": _ratio(config.rare_ratio),
        "signature_diversity": _ratio(stats.signature_diversity),
        "combination_diversity": _ratio(stats.combination_diversity),
        "pair_diversity": _ratio(stats.pair_diversity),
        "count_bands": {
            "full_max": config.rarity_count_full_max,
            "strong_max": config.rarity_count_strong_max,
            "moderate_max": config.rarity_count_moderate_max,
            "weak_max": config.rarity_count_weak_max,
        },
    }
    if not stats.frequency_enabled:
        evidence["disabled_reason"] = "population_below_minimum"
        return ZERO, ZERO, evidence

    population = stats.population_size

    signature_factor = _diversity_factor(
        stats.signature_diversity,
        config.max_signature_diversity,
    )
    signature_count = stats.signature_count(feature.directional_signature)
    signature_measure = _rarity_measure(
        count=signature_count,
        population=population,
        config=config,
        diversity_factor=signature_factor,
    )
    signature_strength = Decimal(signature_measure["strength"])
    signature_score = (
        config.max_signature_rarity_score * signature_strength
    ).quantize(Decimal("0.01"))

    combination_factor = _diversity_factor(
        stats.combination_diversity,
        config.max_combination_diversity,
    )
    combination_count = stats.combination_count(feature.account_signature)
    combination_measure = _rarity_measure(
        count=combination_count,
        population=population,
        config=config,
        diversity_factor=combination_factor,
    )
    combination_strength = Decimal(combination_measure["strength"])
    combination_score = (
        config.max_combination_rarity_score * combination_strength
    ).quantize(Decimal("0.01"))

    pair_factor = _diversity_factor(
        stats.pair_diversity,
        config.max_pair_diversity,
    )
    pair_measures = []
    for debit_account in feature.debit_accounts:
        for credit_account in feature.credit_accounts:
            count = stats.pair_count(debit_account, credit_account)
            measure = _rarity_measure(
                count=count,
                population=population,
                config=config,
                diversity_factor=pair_factor,
            )
            pair_measures.append(
                {
                    "debit": debit_account,
                    "credit": credit_account,
                    "pair_key": _pair_key(
                        debit_account,
                        credit_account,
                    ),
                    **measure,
                }
            )
    pair_measures.sort(
        key=lambda item: (
            -Decimal(item["strength"]),
            item["pair_key"],
        )
    )
    pair_strength = (
        Decimal(pair_measures[0]["strength"])
        if pair_measures
        else ZERO
    )
    pair_score = (
        config.max_pair_rarity_score * pair_strength
    ).quantize(Decimal("0.01"))

    rarity_score = min(
        config.max_rarity_score,
        pair_score + combination_score + signature_score,
    )
    rarity_strength = (
        rarity_score / config.max_rarity_score
        if config.max_rarity_score > 0
        else ZERO
    ).quantize(Decimal("0.000001"))

    pair_evidence = {
        "feature": "directional_pair_rarity",
        "pair_diversity": _ratio(stats.pair_diversity),
        "rarest_pair": pair_measures[0] if pair_measures else None,
        "pairs": pair_measures[:5],
        "strength": _ratio(pair_strength),
        "score": amount_to_string(pair_score),
    }
    combination_evidence = {
        "feature": "account_combination_rarity",
        "signature": feature.account_signature,
        "combination_diversity": _ratio(stats.combination_diversity),
        **combination_measure,
        "score": amount_to_string(combination_score),
    }
    signature_evidence = {
        "feature": "voucher_signature_rarity",
        "signature": feature.directional_signature,
        "signature_diversity": _ratio(stats.signature_diversity),
        **signature_measure,
        "score": amount_to_string(signature_score),
    }

    evidence.update(
        {
            "signature": feature.directional_signature,
            "signature_count": signature_count,
            "signature_ratio": signature_measure["ratio"],
            "signature_diversity_factor": _ratio(signature_factor),
            "signature_strength": _ratio(signature_strength),
            "signature_score": amount_to_string(signature_score),
            "combination_signature": feature.account_signature,
            "combination_count": combination_count,
            "combination_ratio": combination_measure["ratio"],
            "combination_diversity_factor": _ratio(combination_factor),
            "combination_strength": _ratio(combination_strength),
            "combination_score": amount_to_string(combination_score),
            "rarest_pairs": pair_measures[:5],
            "pair_strength": _ratio(pair_strength),
            "pair_score": amount_to_string(pair_score),
            "pair_evidence": pair_evidence,
            "combination_evidence": combination_evidence,
            "signature_evidence": signature_evidence,
            "rarity_strength": _ratio(rarity_strength),
            "score": amount_to_string(rarity_score),
        }
    )
    return rarity_score, rarity_strength, evidence


def calculate_cross_group(
    feature: VoucherFeatures,
    stats: BaselineStats,
    config: AnomalyConfig,
) -> Tuple[Decimal, Decimal, Dict[str, object]]:
    evidence: Dict[str, object] = {
        "feature": "business_group_distance",
        "assigned_group": feature.business_group,
        "population_size": stats.population_size,
        "min_group_size": config.min_group_size,
    }
    if feature.business_group == GROUP_OTHER:
        evidence["disabled_reason"] = "other_group"
        return ZERO, ZERO, evidence
    if stats.population_size < config.min_group_size:
        evidence["disabled_reason"] = "population_below_min_group_size"
        return ZERO, ZERO, evidence

    profile = stats.group_profile(feature.business_group)
    if profile is None or profile.size < config.min_group_size:
        evidence["disabled_reason"] = "group_below_min_size"
        return ZERO, ZERO, evidence
    if not profile.typical_categories:
        evidence["disabled_reason"] = "group_has_no_typical_categories"
        return ZERO, ZERO, evidence
    if feature.unknown_account_ratio > Decimal("0.50"):
        evidence["disabled_reason"] = "high_unknown_account_ratio"
        return ZERO, ZERO, evidence

    categories = set(feature.category_set)
    if not categories:
        evidence["disabled_reason"] = "no_categories"
        return ZERO, ZERO, evidence

    typical = set(profile.typical_categories)
    coverage_assigned = Decimal(
        len(categories & typical)
    ) / Decimal(len(categories))

    best_group = None
    best_coverage = ZERO
    for group, other in sorted(stats.group_profiles.items()):
        if group == feature.business_group:
            continue
        if other.size < config.min_group_size or not other.typical_categories:
            continue
        other_typical = set(other.typical_categories)
        coverage = Decimal(
            len(categories & other_typical)
        ) / Decimal(len(categories))
        if coverage > best_coverage:
            best_coverage = coverage
            best_group = group

    mismatch = clamp(ONE - coverage_assigned)
    divergence = clamp(best_coverage - coverage_assigned)
    strength = clamp(
        Decimal("0.5") * mismatch + Decimal("0.5") * divergence
    )
    score = (config.max_cross_group_score * strength).quantize(
        Decimal("0.01")
    )

    evidence.update(
        {
            "group_size": profile.size,
            "voucher_categories": list(feature.category_set),
            "assigned_typical_categories": list(profile.typical_categories),
            "assigned_coverage": _ratio(coverage_assigned),
            "nearest_group": best_group,
            "nearest_coverage": _ratio(best_coverage),
            "mismatch": _ratio(mismatch),
            "divergence": _ratio(divergence),
            "strength": _ratio(strength),
            "score": amount_to_string(score),
        }
    )
    return score, strength, evidence


def calculate_within_group(
    feature: VoucherFeatures,
    stats: BaselineStats,
    config: AnomalyConfig,
) -> Tuple[Decimal, Decimal, Dict[str, object]]:
    evidence: Dict[str, object] = {
        "feature": "within_group_position",
        "business_group": feature.business_group,
        "min_group_size": config.min_group_size,
    }
    profile = stats.group_profile(feature.business_group)
    if profile is None or profile.size < config.min_group_size:
        evidence["disabled_reason"] = "group_below_min_size"
        return ZERO, ZERO, evidence

    amount_percentile = percentile_rank(
        feature.gross_amount,
        profile.amounts,
    )
    line_percentile = percentile_rank(
        Decimal(feature.line_count),
        profile.line_counts,
    )
    span = ONE - config.within_group_percentile_floor
    amount_high = clamp(
        (amount_percentile - config.within_group_percentile_floor) / span
        if span > 0
        else ZERO
    )
    line_high = clamp(
        (line_percentile - config.within_group_percentile_floor) / span
        if span > 0
        else ZERO
    )
    strength = (
        Decimal("0.7") * amount_high + Decimal("0.3") * line_high
    )
    score = (config.max_within_group_score * strength).quantize(
        Decimal("0.01")
    )

    evidence.update(
        {
            "group_size": profile.size,
            "amount_percentile": _ratio(amount_percentile),
            "line_count_percentile": _ratio(line_percentile),
            "amount_high_strength": _ratio(amount_high),
            "line_count_high_strength": _ratio(line_high),
            "strength": _ratio(strength),
            "score": amount_to_string(score),
        }
    )
    return score, strength, evidence


def risk_level_for_score(score: Decimal, config: AnomalyConfig) -> str:
    if score >= config.high_threshold:
        return SEVERITY_HIGH
    if score >= config.medium_threshold:
        return SEVERITY_MEDIUM
    if score >= config.low_threshold:
        return SEVERITY_LOW
    return SEVERITY_INFO


def score_voucher(
    feature: VoucherFeatures,
    context: AnomalyContext,
) -> VoucherAnomalyScore:
    stats = context.stats_for(feature)
    config = context.config

    rarity_score, rarity_strength, rarity_evidence = calculate_rarity(
        feature, stats, config
    )
    group_score, group_strength, group_evidence = calculate_cross_group(
        feature, stats, config
    )
    within_score, within_strength, within_evidence = calculate_within_group(
        feature, stats, config
    )
    materiality = calculate_materiality(feature, stats, config)

    total = quantize_amount(
        rarity_score
        + group_score
        + within_score
        + materiality.score,
        "risk_score",
    )
    total = clamp(total, ZERO, HUNDRED)
    level = risk_level_for_score(total, config)

    components = {
        "rarity": rarity_score,
        "cross_group": group_score,
        "within_group": within_score,
        "materiality": materiality.score,
    }
    evidence = {
        "baseline_key": stats.baseline_key,
        "population_size": stats.population_size,
        "frequency_enabled": stats.frequency_enabled,
        "components": {
            "rarity": _component(
                "rarity",
                rarity_score,
                config.max_rarity_score,
                rarity_strength,
                rarity_evidence,
            ),
            "cross_group": _component(
                "cross_group",
                group_score,
                config.max_cross_group_score,
                group_strength,
                group_evidence,
            ),
            "within_group": _component(
                "within_group",
                within_score,
                config.max_within_group_score,
                within_strength,
                within_evidence,
            ),
            "materiality": _component(
                "materiality",
                materiality.score,
                config.max_materiality_score,
                materiality.strength,
                materiality.evidence,
            ),
        },
    }

    return VoucherAnomalyScore(
        voucher_key=feature.voucher_key,
        voucher_id=feature.voucher_id,
        risk_score=total,
        risk_level=level,
        components=components,
        evidence=evidence,
        business_group=feature.business_group,
        gross_amount=feature.gross_amount,
    )


def score_entries(
    features: Sequence[VoucherFeatures],
    context: AnomalyContext,
) -> Tuple[VoucherAnomalyScore, ...]:
    scores = [score_voucher(feature, context) for feature in features]
    scores.sort(key=lambda item: (-item.risk_score, item.voucher_key))
    return tuple(scores)
