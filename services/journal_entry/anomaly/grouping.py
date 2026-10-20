"""Rule-based account categories and business groups.

No ML, no clustering library, no description keyword as the primary signal.
Account code rules take precedence; name keywords are a fallback; unresolved
accounts stay explicitly `unknown`.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Iterable, Tuple

from ..accounting_features import AccountCategoryMatch, classify_account_category
from .constants import (
    CATEGORY_ADVANCE_RECEIPT,
    CATEGORY_CASH_BANK,
    CATEGORY_COST,
    CATEGORY_EQUITY,
    CATEGORY_EXPENSE,
    CATEGORY_FIXED_ASSET,
    CATEGORY_INTANGIBLE,
    CATEGORY_INVENTORY,
    CATEGORY_INVESTMENT,
    CATEGORY_LONG_TERM_DEFERRED,
    CATEGORY_LOAN,
    CATEGORY_OTHER_INCOME,
    CATEGORY_PAYABLE,
    CATEGORY_PAYROLL,
    CATEGORY_PREPAID,
    CATEGORY_PROFIT,
    CATEGORY_RECEIVABLE,
    CATEGORY_REVENUE,
    CATEGORY_TAX,
    CATEGORY_UNKNOWN,
    GROUP_ASSET_ACQUISITION,
    GROUP_CASH_BANK_TRANSFER,
    GROUP_EQUITY,
    GROUP_EXPENSE_PAYMENT,
    GROUP_FINANCING,
    GROUP_OTHER,
    GROUP_PAYROLL,
    GROUP_PURCHASE_PAYMENT,
    GROUP_REVENUE_RECEIPT,
    GROUP_TAX,
)

@dataclass(frozen=True)
class BusinessGroupResult:
    group: str
    matched_rules: Tuple[str, ...]
    debit_categories: Tuple[str, ...]
    credit_categories: Tuple[str, ...]
    all_categories: Tuple[str, ...]

    def to_dict(self) -> Dict[str, object]:
        return {
            "group": self.group,
            "matched_rules": list(self.matched_rules),
            "debit_categories": list(self.debit_categories),
            "credit_categories": list(self.credit_categories),
            "all_categories": list(self.all_categories),
        }


def classify_business_group(
    debit_categories: Iterable[str],
    credit_categories: Iterable[str],
) -> BusinessGroupResult:
    """Deterministic V1 business-group classification.

    Rules are ordered; the first match wins. Description keywords are not used.
    """

    debit = set(debit_categories)
    credit = set(credit_categories)
    all_categories = debit | credit
    matched = []

    def choose(group: str, rule: str) -> BusinessGroupResult:
        matched.append(rule)
        return BusinessGroupResult(
            group=group,
            matched_rules=tuple(matched),
            debit_categories=tuple(sorted(debit)),
            credit_categories=tuple(sorted(credit)),
            all_categories=tuple(sorted(all_categories)),
        )

    if CATEGORY_PAYROLL in all_categories:
        return choose(GROUP_PAYROLL, "payroll_category")

    asset_debit = bool(
        debit & {CATEGORY_FIXED_ASSET, CATEGORY_INTANGIBLE, CATEGORY_INVESTMENT}
    )
    funding_credit = bool(
        credit & {CATEGORY_CASH_BANK, CATEGORY_PAYABLE, CATEGORY_LOAN}
    )
    if asset_debit and funding_credit:
        return choose(GROUP_ASSET_ACQUISITION, "asset_debit_with_funding_credit")

    if CATEGORY_EQUITY in credit and CATEGORY_CASH_BANK in debit:
        return choose(GROUP_EQUITY, "equity_credit_with_cash_debit")

    if CATEGORY_LOAN in all_categories and CATEGORY_CASH_BANK in all_categories:
        return choose(GROUP_FINANCING, "loan_with_cash")

    if (
        CATEGORY_REVENUE in credit
        and bool(
            debit
            & {
                CATEGORY_CASH_BANK,
                CATEGORY_RECEIVABLE,
                CATEGORY_ADVANCE_RECEIPT,
            }
        )
    ):
        return choose(GROUP_REVENUE_RECEIPT, "revenue_credit_with_receivable_or_cash")

    if (
        bool(debit & {CATEGORY_INVENTORY, CATEGORY_COST})
        and bool(
            credit
            & {CATEGORY_CASH_BANK, CATEGORY_PAYABLE, CATEGORY_LOAN}
        )
    ):
        return choose(GROUP_PURCHASE_PAYMENT, "inventory_or_cost_debit_with_funding_credit")

    if (
        CATEGORY_EXPENSE in debit
        and bool(
            credit
            & {CATEGORY_CASH_BANK, CATEGORY_PAYABLE, CATEGORY_PAYROLL}
        )
    ):
        return choose(GROUP_EXPENSE_PAYMENT, "expense_debit_with_funding_credit")

    if CATEGORY_TAX in all_categories and bool(
        all_categories & {CATEGORY_CASH_BANK, CATEGORY_PAYABLE, CATEGORY_EXPENSE}
    ):
        return choose(GROUP_TAX, "tax_with_cash_payable_or_expense")

    if CATEGORY_CASH_BANK in debit and CATEGORY_CASH_BANK in credit:
        return choose(GROUP_CASH_BANK_TRANSFER, "cash_bank_on_both_sides")

    if all_categories and all_categories <= {CATEGORY_CASH_BANK, CATEGORY_UNKNOWN}:
        return choose(GROUP_CASH_BANK_TRANSFER, "cash_bank_only")

    return choose(GROUP_OTHER, "no_rule_matched")
