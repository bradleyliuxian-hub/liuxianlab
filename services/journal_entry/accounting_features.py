"""Shared accounting category and voucher identity helpers.

Neutral module used by both Anomaly and Business Classification. It must not
import either subsystem.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Dict, Optional, Tuple

from .schema import JournalEntry, make_voucher_key

CATEGORY_CASH_BANK = "cash_bank"
CATEGORY_RECEIVABLE = "receivable"
CATEGORY_PREPAID = "prepaid"
CATEGORY_INVENTORY = "inventory"
CATEGORY_FIXED_ASSET = "fixed_asset"
CATEGORY_INTANGIBLE = "intangible"
CATEGORY_LONG_TERM_DEFERRED = "long_term_deferred"
CATEGORY_PAYABLE = "payable"
CATEGORY_ADVANCE_RECEIPT = "advance_receipt"
CATEGORY_PAYROLL = "payroll"
CATEGORY_TAX = "tax"
CATEGORY_EQUITY = "equity"
CATEGORY_REVENUE = "revenue"
CATEGORY_OTHER_INCOME = "other_income"
CATEGORY_COST = "cost"
CATEGORY_EXPENSE = "expense"
CATEGORY_LOAN = "loan"
CATEGORY_INVESTMENT = "investment"
CATEGORY_INVESTMENT_INCOME = "investment_income"
CATEGORY_PROFIT = "profit"
CATEGORY_UNKNOWN = "unknown"

ACCOUNT_CATEGORIES: Tuple[str, ...] = (
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


# Four-digit Chinese GAAP-style prefixes. Code rules win over name rules.
CODE_PREFIX_CATEGORIES: Dict[str, str] = {
    "1001": CATEGORY_CASH_BANK,
    "1002": CATEGORY_CASH_BANK,
    "1003": CATEGORY_CASH_BANK,
    "1012": CATEGORY_CASH_BANK,
    "1101": CATEGORY_INVESTMENT,
    "1121": CATEGORY_RECEIVABLE,
    "1122": CATEGORY_RECEIVABLE,
    "1123": CATEGORY_PREPAID,
    "1131": CATEGORY_RECEIVABLE,
    "1132": CATEGORY_RECEIVABLE,
    "1221": CATEGORY_RECEIVABLE,
    "1231": CATEGORY_RECEIVABLE,
    "1401": CATEGORY_INVENTORY,
    "1402": CATEGORY_INVENTORY,
    "1403": CATEGORY_INVENTORY,
    "1404": CATEGORY_INVENTORY,
    "1405": CATEGORY_INVENTORY,
    "1406": CATEGORY_INVENTORY,
    "1407": CATEGORY_INVENTORY,
    "1408": CATEGORY_INVENTORY,
    "1411": CATEGORY_INVENTORY,
    "1421": CATEGORY_INVENTORY,
    "1471": CATEGORY_INVENTORY,
    "1501": CATEGORY_INVESTMENT,
    "1511": CATEGORY_INVESTMENT,
    "1521": CATEGORY_INVESTMENT,
    "1601": CATEGORY_FIXED_ASSET,
    "1602": CATEGORY_FIXED_ASSET,
    "1603": CATEGORY_FIXED_ASSET,
    "1604": CATEGORY_FIXED_ASSET,
    "1605": CATEGORY_FIXED_ASSET,
    "1606": CATEGORY_FIXED_ASSET,
    "1701": CATEGORY_INTANGIBLE,
    "1702": CATEGORY_INTANGIBLE,
    "1801": CATEGORY_LONG_TERM_DEFERRED,
    "2001": CATEGORY_LOAN,
    "2501": CATEGORY_LOAN,
    "2201": CATEGORY_PAYABLE,
    "2202": CATEGORY_PAYABLE,
    "2203": CATEGORY_ADVANCE_RECEIPT,
    "2211": CATEGORY_PAYROLL,
    "2221": CATEGORY_TAX,
    "2241": CATEGORY_PAYABLE,
    "4001": CATEGORY_EQUITY,
    "4002": CATEGORY_EQUITY,
    "4101": CATEGORY_EQUITY,
    "4103": CATEGORY_EQUITY,
    "4104": CATEGORY_EQUITY,
    "5001": CATEGORY_COST,
    "5101": CATEGORY_COST,
    "5201": CATEGORY_COST,
    "5301": CATEGORY_COST,
    "6001": CATEGORY_REVENUE,
    "6051": CATEGORY_REVENUE,
    "6111": CATEGORY_INVESTMENT_INCOME,
    "6301": CATEGORY_OTHER_INCOME,
    "6401": CATEGORY_COST,
    "6402": CATEGORY_COST,
    "6403": CATEGORY_COST,
    "6601": CATEGORY_EXPENSE,
    "6602": CATEGORY_EXPENSE,
    "6603": CATEGORY_EXPENSE,
    "6604": CATEGORY_EXPENSE,
    "6701": CATEGORY_EXPENSE,
    "6711": CATEGORY_EXPENSE,
    "6801": CATEGORY_TAX,
    "6901": CATEGORY_PROFIT,
}

# Ordered name fallback. Earlier rules win.
NAME_CATEGORY_RULES: Tuple[Tuple[str, Tuple[str, ...]], ...] = (
    (CATEGORY_CASH_BANK, ("库存现金", "银行存款", "其他货币资金", "现金", "银行")),
    (CATEGORY_PAYROLL, ("应付职工薪酬", "应付工资", "社会保险费", "住房公积金", "工资")),
    (CATEGORY_TAX, ("应交税费", "应交增值税", "所得税", "税金及附加", "增值税")),
    (CATEGORY_REVENUE, ("主营业务收入", "其他业务收入", "营业收入", "收入")),
    (CATEGORY_COST, ("主营业务成本", "其他业务成本", "生产成本", "制造费用", "劳务成本", "成本")),
    (CATEGORY_EXPENSE, ("管理费用", "销售费用", "财务费用", "研发费用", "费用")),
    (CATEGORY_PAYABLE, ("应付账款", "应付票据", "其他应付款", "应付")),
    (CATEGORY_ADVANCE_RECEIPT, ("预收账款", "合同负债", "预收")),
    (CATEGORY_RECEIVABLE, ("应收账款", "应收票据", "其他应收款", "应收")),
    (CATEGORY_PREPAID, ("预付账款", "预付")),
    (CATEGORY_INVENTORY, ("原材料", "库存商品", "半成品", "在产品", "周转材料", "存货", "材料采购")),
    (CATEGORY_FIXED_ASSET, ("固定资产", "在建工程", "工程物资", "累计折旧", "固定资产清理")),
    (CATEGORY_INTANGIBLE, ("无形资产", "累计摊销")),
    (CATEGORY_LONG_TERM_DEFERRED, ("长期待摊费用", "长期待摊")),
    (CATEGORY_LOAN, ("短期借款", "长期借款", "借款")),
    (CATEGORY_EQUITY, ("实收资本", "资本公积", "盈余公积", "未分配利润", "所有者权益")),
    (CATEGORY_INVESTMENT_INCOME, ("投资收益",)),
    (CATEGORY_INVESTMENT, ("长期股权投资", "交易性金融资产", "投资性房地产")),
    (CATEGORY_PROFIT, ("本年利润", "利润分配", "以前年度损益调整")),
    (CATEGORY_OTHER_INCOME, ("其他收益", "营业外收入")),
)


@dataclass(frozen=True)
class AccountCategoryMatch:
    account: str
    category: str
    matched_by: str
    matched_value: str

    def to_dict(self) -> Dict[str, str]:
        return {
            "account": self.account,
            "category": self.category,
            "matched_by": self.matched_by,
            "matched_value": self.matched_value,
        }


def _normalized_code(value: str) -> str:
    digits = re.sub(r"\D", "", str(value or ""))
    return digits


def classify_account_category(
    account_code: Optional[str],
    account_name: Optional[str],
) -> AccountCategoryMatch:
    """Classify one account. Code rule first, name fallback, else unknown."""

    account = str(account_code or account_name or "").strip()
    code = _normalized_code(account_code or "")
    if len(code) >= 4:
        prefix = code[:4]
        category = CODE_PREFIX_CATEGORIES.get(prefix)
        if category:
            return AccountCategoryMatch(
                account=account,
                category=category,
                matched_by="code",
                matched_value=prefix,
            )

    name = str(account_name or "").strip()
    for category, keywords in NAME_CATEGORY_RULES:
        for keyword in keywords:
            if keyword and keyword in name:
                return AccountCategoryMatch(
                    account=account,
                    category=category,
                    matched_by="name",
                    matched_value=keyword,
                )

    return AccountCategoryMatch(
        account=account,
        category=CATEGORY_UNKNOWN,
        matched_by="unknown",
        matched_value="",
    )


def voucher_key_for_entry(entry: JournalEntry) -> str:
    """Stable, readable voucher key derived from the Phase 1 grouping key."""

    key = make_voucher_key(entry.lines[0])
    return "|".join(str(part) for part in key)
