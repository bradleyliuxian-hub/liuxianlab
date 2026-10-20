"""Stable anomaly codes, categories, groups, and the V1 configuration."""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Tuple

# Stable rule codes. Do not renumber after golden tests exist.
RULE_UNUSUAL_ACCOUNT_COMBINATION = "JE-A001"
RULE_RARE_VOUCHER_SIGNATURE = "JE-A002"
RULE_CROSS_GROUP_ANOMALY = "JE-A003"
RULE_WITHIN_GROUP_OUTLIER = "JE-A004"
RULE_MATERIAL_AMOUNT = "JE-A005"

RULE_CODES: Tuple[str, ...] = (
    RULE_UNUSUAL_ACCOUNT_COMBINATION,
    RULE_RARE_VOUCHER_SIGNATURE,
    RULE_CROSS_GROUP_ANOMALY,
    RULE_WITHIN_GROUP_OUTLIER,
    RULE_MATERIAL_AMOUNT,
)

SEVERITY_HIGH = "HIGH"
SEVERITY_MEDIUM = "MEDIUM"
SEVERITY_LOW = "LOW"
SEVERITY_INFO = "INFO"
SEVERITIES: Tuple[str, ...] = (
    SEVERITY_HIGH,
    SEVERITY_MEDIUM,
    SEVERITY_LOW,
    SEVERITY_INFO,
)

# Account categories. Unknown is deliberately explicit.
from ..accounting_features import (
    ACCOUNT_CATEGORIES,
    CATEGORY_CASH_BANK,
    CATEGORY_RECEIVABLE,
    CATEGORY_PREPAID,
    CATEGORY_INVENTORY,
    CATEGORY_FIXED_ASSET,
    CATEGORY_INTANGIBLE,
    CATEGORY_LONG_TERM_DEFERRED,
    CATEGORY_PAYABLE,
    CATEGORY_ADVANCE_RECEIPT,
    CATEGORY_PAYROLL,
    CATEGORY_TAX,
    CATEGORY_EQUITY,
    CATEGORY_REVENUE,
    CATEGORY_OTHER_INCOME,
    CATEGORY_COST,
    CATEGORY_EXPENSE,
    CATEGORY_LOAN,
    CATEGORY_INVESTMENT,
    CATEGORY_INVESTMENT_INCOME,
    CATEGORY_PROFIT,
    CATEGORY_UNKNOWN,
)

# Business groups. V1 is deliberately rule-based and finite.
GROUP_CASH_BANK_TRANSFER = "cash_bank_transfer"
GROUP_REVENUE_RECEIPT = "revenue_receipt"
GROUP_PURCHASE_PAYMENT = "purchase_payment"
GROUP_EXPENSE_PAYMENT = "expense_payment"
GROUP_PAYROLL = "payroll"
GROUP_TAX = "tax"
GROUP_ASSET_ACQUISITION = "asset_acquisition"
GROUP_FINANCING = "financing"
GROUP_EQUITY = "equity"
GROUP_OTHER = "other"

BUSINESS_GROUPS: Tuple[str, ...] = (
    GROUP_CASH_BANK_TRANSFER,
    GROUP_REVENUE_RECEIPT,
    GROUP_PURCHASE_PAYMENT,
    GROUP_EXPENSE_PAYMENT,
    GROUP_PAYROLL,
    GROUP_TAX,
    GROUP_ASSET_ACQUISITION,
    GROUP_FINANCING,
    GROUP_EQUITY,
    GROUP_OTHER,
)


@dataclass(frozen=True)
class AnomalyConfig:
    """Deterministic V1 thresholds and component maxima.

    Total component maximum is 100:

    rarity 35 + cross_group 25 + within_group 20 + materiality 20.
    """

    min_population_for_frequency: int = 20
    min_group_size: int = 5

    rare_ratio: Decimal = Decimal("0.10")
    max_signature_diversity: Decimal = Decimal("0.50")
    max_combination_diversity: Decimal = Decimal("0.50")
    max_pair_diversity: Decimal = Decimal("0.80")

    # Absolute occurrence bands. Ratio alone is not enough.
    rarity_count_full_max: int = 1
    rarity_count_strong_max: int = 3
    rarity_count_moderate_max: int = 5
    rarity_count_weak_max: int = 10
    rarity_count_strong_strength: Decimal = Decimal("0.75")
    rarity_count_moderate_strength: Decimal = Decimal("0.50")
    rarity_count_weak_strength: Decimal = Decimal("0.25")

    max_rarity_score: Decimal = Decimal("35")
    max_pair_rarity_score: Decimal = Decimal("20")
    max_combination_rarity_score: Decimal = Decimal("10")
    max_signature_rarity_score: Decimal = Decimal("5")
    max_cross_group_score: Decimal = Decimal("25")
    max_within_group_score: Decimal = Decimal("20")
    max_materiality_score: Decimal = Decimal("20")

    high_threshold: Decimal = Decimal("75")
    medium_threshold: Decimal = Decimal("35")
    low_threshold: Decimal = Decimal("20")
    finding_threshold: Decimal = Decimal("20")

    cross_group_finding_strength: Decimal = Decimal("0.25")
    within_group_finding_strength: Decimal = Decimal("0.50")
    materiality_finding_score: Decimal = Decimal("10")

    a001_pair_strength_threshold: Decimal = Decimal("0.50")
    a001_combination_strength_threshold: Decimal = Decimal("0.50")
    a002_signature_strength_threshold: Decimal = Decimal("0.50")
    a002_max_signature_count: int = 3

    high_review_rate_warning_threshold: Decimal = Decimal("0.50")

    within_group_percentile_floor: Decimal = Decimal("0.90")
    materiality_percentile_floor: Decimal = Decimal("0.95")
    materiality_share_reference: Decimal = Decimal("0.10")

    typical_category_threshold: Decimal = Decimal("0.50")

    def __post_init__(self) -> None:
        if self.min_population_for_frequency < 1:
            raise ValueError("min_population_for_frequency must be >= 1")
        if self.min_group_size < 1:
            raise ValueError("min_group_size must be >= 1")
        if not (Decimal("0") < self.rare_ratio <= Decimal("1")):
            raise ValueError("rare_ratio must be in (0, 1]")
        if not (Decimal("0") <= self.low_threshold <= self.medium_threshold <= self.high_threshold <= Decimal("100")):
            raise ValueError("risk thresholds must be ordered within 0..100")
        if not (
            1
            <= self.rarity_count_full_max
            <= self.rarity_count_strong_max
            <= self.rarity_count_moderate_max
            <= self.rarity_count_weak_max
        ):
            raise ValueError("rarity count bands must be ordered")
        if (
            self.max_pair_rarity_score
            + self.max_combination_rarity_score
            + self.max_signature_rarity_score
            != self.max_rarity_score
        ):
            raise ValueError("rarity subcomponent maxima must sum to max_rarity_score")
        total = (
            self.max_rarity_score
            + self.max_cross_group_score
            + self.max_within_group_score
            + self.max_materiality_score
        )
        if total != Decimal("100"):
            raise ValueError("score component maxima must sum to 100")


DEFAULT_ANOMALY_CONFIG = AnomalyConfig()
