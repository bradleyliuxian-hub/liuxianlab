"""Population statistics and baseline scopes for anomaly scoring.

V1 baseline strategy:

1. entity + period
2. period when entity is absent
3. whole dataset when period is absent or both are absent

No historical data, database, cross-job data, or per-user baseline is used.
"""

from __future__ import annotations

from bisect import bisect_left, bisect_right
from collections import Counter, defaultdict
from dataclasses import dataclass
from decimal import Decimal
from typing import Dict, Mapping, Optional, Sequence, Tuple

from .constants import AnomalyConfig, DEFAULT_ANOMALY_CONFIG
from .models import VoucherFeatures


@dataclass(frozen=True)
class GroupProfile:
    group: str
    size: int
    category_counts: Mapping[str, int]
    category_frequencies: Mapping[str, Decimal]
    typical_categories: Tuple[str, ...]
    signature_counts: Mapping[str, int]
    amounts: Tuple[Decimal, ...]
    line_counts: Tuple[int, ...]

    def to_dict(self) -> Dict[str, object]:
        return {
            "group": self.group,
            "size": self.size,
            "category_counts": dict(sorted(self.category_counts.items())),
            "category_frequencies": {
                key: format(value.quantize(Decimal("0.0001")), "f")
                for key, value in sorted(self.category_frequencies.items())
            },
            "typical_categories": list(self.typical_categories),
            "signature_counts": dict(sorted(self.signature_counts.items())),
            "amounts": [format(value, ".2f") for value in self.amounts],
            "line_counts": list(self.line_counts),
        }


@dataclass(frozen=True)
class BaselineStats:
    baseline_key: str
    population_size: int
    signature_counts: Mapping[str, int]
    combination_counts: Mapping[str, int]
    pair_counts: Mapping[str, int]
    amounts: Tuple[Decimal, ...]
    line_counts: Tuple[int, ...]
    total_gross_amount: Decimal
    signature_diversity: Decimal
    combination_diversity: Decimal
    pair_diversity: Decimal
    group_profiles: Mapping[str, GroupProfile]
    frequency_enabled: bool

    def signature_count(self, signature: str) -> int:
        return int(self.signature_counts.get(signature, 0))

    def combination_count(self, signature: str) -> int:
        return int(self.combination_counts.get(signature, 0))

    def pair_count(self, debit_account: str, credit_account: str) -> int:
        return int(
            self.pair_counts.get(
                _pair_key(debit_account, credit_account),
                0,
            )
        )

    def group_profile(self, group: str) -> Optional[GroupProfile]:
        return self.group_profiles.get(group)

    def to_dict(self) -> Dict[str, object]:
        return {
            "baseline_key": self.baseline_key,
            "population_size": self.population_size,
            "signature_diversity": format(
                self.signature_diversity.quantize(Decimal("0.000001")),
                "f",
            ),
            "combination_diversity": format(
                self.combination_diversity.quantize(Decimal("0.000001")),
                "f",
            ),
            "pair_diversity": format(
                self.pair_diversity.quantize(Decimal("0.000001")),
                "f",
            ),
            "total_gross_amount": format(self.total_gross_amount, ".2f"),
            "frequency_enabled": self.frequency_enabled,
            "group_sizes": {
                group: profile.size
                for group, profile in sorted(self.group_profiles.items())
            },
        }


@dataclass(frozen=True)
class AnomalyContext:
    features: Tuple[VoucherFeatures, ...]
    baselines: Mapping[str, BaselineStats]
    global_stats: BaselineStats
    config: AnomalyConfig
    features_by_key: Mapping[str, VoucherFeatures]

    def stats_for(self, feature: VoucherFeatures) -> BaselineStats:
        key = baseline_key_for_features(feature)
        stats = self.baselines.get(key)
        if stats is not None:
            return stats
        # No cross-entity fallback. A requested voucher outside the context
        # population gets an explicitly disabled empty baseline.
        return empty_baseline_stats(key, self.config)

    def baseline_key_for(self, feature: VoucherFeatures) -> str:
        return baseline_key_for_features(feature)


def baseline_key_for_features(feature: VoucherFeatures) -> str:
    if feature.entity and feature.period:
        return "entity_period|%s|%s" % (feature.entity, feature.period)
    if feature.entity:
        return "entity|%s|" % (feature.entity,)
    if feature.period:
        return "period||%s" % (feature.period,)
    return "global||"


def empty_baseline_stats(
    baseline_key: str,
    config: AnomalyConfig,
) -> BaselineStats:
    """Explicitly disabled baseline for a voucher outside the context."""

    return BaselineStats(
        baseline_key=baseline_key,
        population_size=0,
        signature_counts={},
        combination_counts={},
        pair_counts={},
        amounts=(),
        line_counts=(),
        total_gross_amount=Decimal("0"),
        signature_diversity=Decimal("0"),
        combination_diversity=Decimal("0"),
        pair_diversity=Decimal("0"),
        group_profiles={},
        frequency_enabled=False,
    )


def percentile_rank(value: Decimal, sorted_values: Sequence[Decimal]) -> Decimal:
    """Mid-rank empirical percentile, deterministic for ties.

    p = (count_less + 0.5 * count_equal) / n
    """

    n = len(sorted_values)
    if n == 0:
        return Decimal("0")
    lower = bisect_left(sorted_values, value)
    upper = bisect_right(sorted_values, value)
    equal = upper - lower
    rank = Decimal(lower) + Decimal(equal) / Decimal(2)
    return (rank / Decimal(n)).quantize(Decimal("0.000001"))


def _pair_key(debit_account: str, credit_account: str) -> str:
    return "D:%s->C:%s" % (debit_account, credit_account)


def build_baseline_stats(
    baseline_key: str,
    features: Sequence[VoucherFeatures],
    config: AnomalyConfig,
) -> BaselineStats:
    signature_counts = Counter()
    combination_counts = Counter()
    pair_counts = Counter()
    amounts = []
    line_counts = []
    total_gross = Decimal("0")

    group_category_counts = defaultdict(Counter)
    group_signatures = defaultdict(Counter)
    group_amounts = defaultdict(list)
    group_line_counts = defaultdict(list)
    group_sizes = Counter()

    for feature in features:
        signature_counts[feature.directional_signature] += 1
        combination_counts[feature.account_signature] += 1
        amounts.append(feature.gross_amount)
        line_counts.append(feature.line_count)
        total_gross += feature.gross_amount

        for debit_account in feature.debit_accounts:
            for credit_account in feature.credit_accounts:
                pair_counts[
                    _pair_key(debit_account, credit_account)
                ] += 1

        group = feature.business_group
        group_sizes[group] += 1
        group_signatures[group][feature.directional_signature] += 1
        group_amounts[group].append(feature.gross_amount)
        group_line_counts[group].append(feature.line_count)
        for category in sorted(set(feature.category_set)):
            group_category_counts[group][category] += 1

    group_profiles = {}
    for group, size in sorted(group_sizes.items()):
        if size <= 0:
            continue
        frequencies = {
            category: (Decimal(count) / Decimal(size)).quantize(
                Decimal("0.000001")
            )
            for category, count in sorted(group_category_counts[group].items())
        }
        typical = tuple(
            sorted(
                category
                for category, frequency in frequencies.items()
                if frequency >= config.typical_category_threshold
            )
        )
        group_profiles[group] = GroupProfile(
            group=group,
            size=size,
            category_counts=dict(sorted(group_category_counts[group].items())),
            category_frequencies=frequencies,
            typical_categories=typical,
            signature_counts=dict(sorted(group_signatures[group].items())),
            amounts=tuple(sorted(group_amounts[group])),
            line_counts=tuple(sorted(group_line_counts[group])),
        )

    population = len(features)
    signature_diversity = (
        Decimal(len(signature_counts)) / Decimal(population)
        if population
        else Decimal("0")
    )
    combination_diversity = (
        Decimal(len(combination_counts)) / Decimal(population)
        if population
        else Decimal("0")
    )
    pair_diversity = (
        Decimal(len(pair_counts)) / Decimal(population)
        if population
        else Decimal("0")
    )

    return BaselineStats(
        baseline_key=baseline_key,
        population_size=population,
        signature_counts=dict(sorted(signature_counts.items())),
        combination_counts=dict(sorted(combination_counts.items())),
        pair_counts=dict(sorted(pair_counts.items())),
        amounts=tuple(sorted(amounts)),
        line_counts=tuple(sorted(line_counts)),
        total_gross_amount=total_gross.quantize(Decimal("0.01")),
        signature_diversity=signature_diversity.quantize(
            Decimal("0.000001")
        ),
        combination_diversity=combination_diversity.quantize(
            Decimal("0.000001")
        ),
        pair_diversity=pair_diversity.quantize(Decimal("0.000001")),
        group_profiles=dict(sorted(group_profiles.items())),
        frequency_enabled=population >= config.min_population_for_frequency,
    )


def build_anomaly_context(
    features: Sequence[VoucherFeatures],
    config: Optional[AnomalyConfig] = None,
) -> AnomalyContext:
    config = config or DEFAULT_ANOMALY_CONFIG
    by_baseline = defaultdict(list)
    for feature in features:
        by_baseline[baseline_key_for_features(feature)].append(feature)

    baselines = {
        key: build_baseline_stats(key, tuple(values), config)
        for key, values in sorted(by_baseline.items())
    }
    global_stats = build_baseline_stats(
        "global||",
        tuple(features),
        config,
    )
    features_by_key = {feature.voucher_key: feature for feature in features}
    if len(features_by_key) != len(features):
        raise ValueError("duplicate voucher_key in anomaly input")

    return AnomalyContext(
        features=tuple(features),
        baselines=baselines,
        global_stats=global_stats,
        config=config,
        features_by_key=features_by_key,
    )
