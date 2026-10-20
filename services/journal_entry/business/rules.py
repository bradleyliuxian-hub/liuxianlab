"""Hard rules and structural business signals."""

from __future__ import annotations

from decimal import Decimal
from typing import Dict, List, Mapping, Optional, Set, Tuple

from ..accounting_features import (
    CATEGORY_ADVANCE_RECEIPT,
    CATEGORY_CASH_BANK,
    CATEGORY_COST,
    CATEGORY_EQUITY,
    CATEGORY_EXPENSE,
    CATEGORY_FIXED_ASSET,
    CATEGORY_INTANGIBLE,
    CATEGORY_INVENTORY,
    CATEGORY_INVESTMENT,
    CATEGORY_LOAN,
    CATEGORY_OTHER_INCOME,
    CATEGORY_PAYABLE,
    CATEGORY_PAYROLL,
    CATEGORY_PROFIT,
    CATEGORY_RECEIVABLE,
    CATEGORY_REVENUE,
    CATEGORY_TAX,
)
from .constants import (
    BUS_DEBT_FINANCING,
    BUS_DEPOSIT_GUARANTEE,
    BUS_DEPRECIATION_AMORTIZATION,
    BUS_DIVIDEND,
    BUS_EMPLOYEE_LOAN,
    BUS_ENTITY_CURRENT,
    BUS_FX_GAIN_LOSS,
    BUS_GOVERNMENT_GRANT,
    BUS_INTERNAL_FUND_TRANSFER,
    BUS_INVENTORY_PURCHASE,
    BUS_INTEREST,
    BUS_LONG_TERM_ASSET,
    BUS_MANUFACTURING,
    BUS_PAYROLL,
    BUS_RESEARCH_DEVELOPMENT,
    BUS_SALES_REVENUE,
    BUS_TAX,
    BUS_DAILY_EXPENSE,
    BUS_INVESTMENT_PRINCIPAL,
    EMPLOYEE_WORDS,
    ENTITY_COUNTERPARTY_WORDS,
    PERIOD_CLOSE_WORDS,
)
from .features import BusinessFeatures


def _contains_any(text: str, words: Tuple[str, ...]) -> bool:
    return any(word and word in text for word in words)


def _name_contains(features: BusinessFeatures, words: Tuple[str, ...], side: Optional[str] = None) -> bool:
    if side == "debit":
        names = features.debit_account_names
    elif side == "credit":
        names = features.credit_account_names
    else:
        names = features.all_account_names
    return any(any(word in name for word in words) for name in names)


def detect_hard_rule(features: BusinessFeatures) -> Optional[Tuple[str, str, Mapping[str, object]]]:
    debit = set(features.debit_categories)
    credit = set(features.credit_categories)
    all_categories = debit | credit
    desc = features.description

    # Pure cash/bank transfer: strong mechanical classification.
    if debit and credit and debit <= {CATEGORY_CASH_BANK} and credit <= {CATEGORY_CASH_BANK}:
        return (
            BUS_INTERNAL_FUND_TRANSFER,
            "cash_bank_on_both_sides",
            {"debit_categories": sorted(debit), "credit_categories": sorted(credit)},
        )

    # Explicit deposit/guarantee language is highly specific and wins over
    # generic employee/current-account words.
    deposit_words = ("押金", "保证金", "质保金")
    if _contains_any(desc, deposit_words) and _name_contains(features, ("其他应收款", "其他应付款")):
        return (
            BUS_DEPOSIT_GUARANTEE,
            "deposit_keyword_with_current_account",
            {"matched_description": [word for word in deposit_words if word in desc]},
        )

    # Explicit employee advance/loan words + other receivable/payable pattern.
    if _contains_any(desc, EMPLOYEE_WORDS) and not _contains_any(desc, ENTITY_COUNTERPARTY_WORDS):
        if _name_contains(features, ("其他应收款", "其他应付款")):
            return (
                BUS_EMPLOYEE_LOAN,
                "employee_loan_keyword_with_current_account",
                {"matched_description": [word for word in EMPLOYEE_WORDS if word in desc]},
            )

    # FX gain/loss requires explicit FX language. Financial expense is supportive,
    # but not required because some charts use dedicated FX accounts.
    fx_words = ("汇兑", "汇率", "外币折算")
    if _contains_any(desc, fx_words):
        return (
            BUS_FX_GAIN_LOSS,
            "explicit_fx_description",
            {"matched_description": [word for word in fx_words if word in desc]},
        )

    # Depreciation/amortization becomes a hard rule only when description is explicit.
    dep_words = ("折旧", "摊销")
    if _contains_any(desc, dep_words) and _name_contains(features, ("累计折旧", "累计摊销", "累计折耗")):
        return (
            BUS_DEPRECIATION_AMORTIZATION,
            "explicit_depreciation_with_accumulated_account",
            {"matched_description": [word for word in dep_words if word in desc]},
        )

    # Period close is not a substantive operating bucket; force to other and expose reason.
    if _contains_any(desc, PERIOD_CLOSE_WORDS):
        from .constants import BUS_OTHER
        return (
            BUS_OTHER,
            "period_close_mechanical_entry",
            {"matched_description": [word for word in PERIOD_CLOSE_WORDS if word in desc]},
        )

    return None


def structural_scores(features: BusinessFeatures) -> Dict[str, Tuple[Decimal, Tuple[str, ...]]]:
    """Return deterministic structural scores and matched rule labels."""

    debit = set(features.debit_categories)
    credit = set(features.credit_categories)
    all_categories = debit | credit
    scores: Dict[str, Decimal] = {}
    rules: Dict[str, List[str]] = {}

    def add(code: str, points: str, rule: str) -> None:
        scores[code] = scores.get(code, Decimal("0")) + Decimal(points)
        rules.setdefault(code, []).append(rule)

    if CATEGORY_PAYROLL in all_categories:
        add(BUS_PAYROLL, "38", "payroll_category")
    if CATEGORY_PAYROLL in credit and (CATEGORY_EXPENSE in debit or CATEGORY_COST in debit):
        add(BUS_PAYROLL, "18", "payroll_credit_with_expense_or_cost_debit")
    if CATEGORY_PAYROLL in debit and CATEGORY_CASH_BANK in credit:
        add(BUS_PAYROLL, "18", "payroll_debit_with_cash_credit")

    if CATEGORY_TAX in all_categories:
        add(BUS_TAX, "34", "tax_category")
    if CATEGORY_TAX in debit and (CATEGORY_CASH_BANK in credit or CATEGORY_PAYABLE in credit):
        add(BUS_TAX, "16", "tax_debit_with_settlement_credit")

    if CATEGORY_INVENTORY in debit and (credit & {CATEGORY_CASH_BANK, CATEGORY_PAYABLE}):
        add(BUS_INVENTORY_PURCHASE, "38", "inventory_debit_with_cash_or_payable_credit")
    if CATEGORY_INVENTORY in all_categories:
        add(BUS_INVENTORY_PURCHASE, "15", "inventory_category_present")

    if debit & {CATEGORY_FIXED_ASSET, CATEGORY_INTANGIBLE, CATEGORY_INVESTMENT} and credit & {CATEGORY_CASH_BANK, CATEGORY_PAYABLE, CATEGORY_LOAN}:
        add(BUS_LONG_TERM_ASSET, "38", "long_term_asset_debit_with_funding_credit")
    if all_categories & {CATEGORY_FIXED_ASSET, CATEGORY_INTANGIBLE}:
        add(BUS_LONG_TERM_ASSET, "15", "long_term_asset_category_present")

    if CATEGORY_REVENUE in credit and debit & {CATEGORY_CASH_BANK, CATEGORY_RECEIVABLE, CATEGORY_ADVANCE_RECEIPT}:
        add(BUS_SALES_REVENUE, "42", "revenue_credit_with_cash_receivable_or_advance")
    elif CATEGORY_REVENUE in all_categories:
        add(BUS_SALES_REVENUE, "25", "revenue_category_present")

    if CATEGORY_LOAN in all_categories and CATEGORY_CASH_BANK in all_categories:
        add(BUS_DEBT_FINANCING, "46", "loan_with_cash")
    elif CATEGORY_LOAN in all_categories:
        add(BUS_DEBT_FINANCING, "26", "loan_category_present")

    if _name_contains(features, ("应付利息", "应收利息")):
        add(BUS_INTEREST, "42", "interest_account_present")
    if _name_contains(features, ("财务费用",)):
        add(BUS_INTEREST, "12", "financial_expense_present")

    if CATEGORY_EXPENSE in debit and credit & {CATEGORY_CASH_BANK, CATEGORY_PAYABLE, CATEGORY_RECEIVABLE}:
        add(BUS_DAILY_EXPENSE, "34", "expense_debit_with_settlement_credit")
    elif CATEGORY_EXPENSE in all_categories:
        add(BUS_DAILY_EXPENSE, "18", "expense_category_present")
    if CATEGORY_COST in debit and credit & {CATEGORY_CASH_BANK, CATEGORY_PAYABLE} and CATEGORY_INVENTORY not in all_categories:
        add(BUS_DAILY_EXPENSE, "24", "service_or_operating_cost_with_settlement_credit")

    if _name_contains(features, ("其他应收款", "其他应付款")):
        add(BUS_ENTITY_CURRENT, "14", "other_current_account_present")
    if (debit & {CATEGORY_RECEIVABLE, CATEGORY_PAYABLE}) and CATEGORY_CASH_BANK in credit:
        add(BUS_ENTITY_CURRENT, "24", "current_account_debit_with_cash_credit")
    if CATEGORY_CASH_BANK in debit and (credit & {CATEGORY_RECEIVABLE, CATEGORY_PAYABLE}):
        add(BUS_ENTITY_CURRENT, "24", "cash_debit_with_current_account_credit")

    if CATEGORY_INVESTMENT in all_categories and CATEGORY_CASH_BANK in all_categories:
        add(BUS_INVESTMENT_PRINCIPAL, "42", "investment_with_cash")
    elif CATEGORY_INVESTMENT in all_categories:
        add(BUS_INVESTMENT_PRINCIPAL, "24", "investment_category_present")

    if CATEGORY_PROFIT in all_categories and _name_contains(features, ("应付股利", "应收股利", "利润分配")):
        add(BUS_DIVIDEND, "40", "profit_or_dividend_account_present")

    if _name_contains(features, ("生产成本", "制造费用", "劳务成本", "工程施工")):
        add(BUS_MANUFACTURING, "40", "manufacturing_account_present")
    elif CATEGORY_COST in debit and CATEGORY_INVENTORY in credit:
        add(BUS_MANUFACTURING, "24", "cost_debit_with_inventory_credit")

    if _name_contains(features, ("研发支出", "研发费用")):
        add(BUS_RESEARCH_DEVELOPMENT, "48", "research_account_present")

    if CATEGORY_OTHER_INCOME in all_categories and _name_contains(features, ("递延收益",)):
        add(BUS_GOVERNMENT_GRANT, "25", "deferred_income_with_other_income")

    return {
        code: (min(score, Decimal("60")), tuple(rules.get(code, ())))
        for code, score in scores.items()
    }
