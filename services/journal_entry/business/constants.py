"""Deterministic business-classification constants and configuration.

The classifier is intentionally rules/structure based. Scores are heuristic
match scores, not statistical probabilities.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import Dict, Tuple

# Stable business codes. Keep codes stable once consumed by UI/export.
BUS_PAYROLL = "JE-B001"
BUS_TAX = "JE-B002"
BUS_INVENTORY_PURCHASE = "JE-B003"
BUS_LONG_TERM_ASSET = "JE-B004"
BUS_DEPRECIATION_AMORTIZATION = "JE-B005"
BUS_SALES_REVENUE = "JE-B006"
BUS_DEBT_FINANCING = "JE-B007"
BUS_INTEREST = "JE-B008"
BUS_DAILY_EXPENSE = "JE-B009"
BUS_EMPLOYEE_LOAN = "JE-B010"
BUS_ENTITY_CURRENT = "JE-B011"
BUS_DEPOSIT_GUARANTEE = "JE-B012"
BUS_INVESTMENT_PRINCIPAL = "JE-B013"
BUS_DIVIDEND = "JE-B014"
BUS_MANUFACTURING = "JE-B015"
BUS_RESEARCH_DEVELOPMENT = "JE-B016"
BUS_GOVERNMENT_GRANT = "JE-B017"
BUS_INTERNAL_FUND_TRANSFER = "JE-B018"
BUS_FX_GAIN_LOSS = "JE-B019"
BUS_OTHER = "JE-B020"

BUSINESS_CODES: Tuple[str, ...] = (
    BUS_PAYROLL,
    BUS_TAX,
    BUS_INVENTORY_PURCHASE,
    BUS_LONG_TERM_ASSET,
    BUS_DEPRECIATION_AMORTIZATION,
    BUS_SALES_REVENUE,
    BUS_DEBT_FINANCING,
    BUS_INTEREST,
    BUS_DAILY_EXPENSE,
    BUS_EMPLOYEE_LOAN,
    BUS_ENTITY_CURRENT,
    BUS_DEPOSIT_GUARANTEE,
    BUS_INVESTMENT_PRINCIPAL,
    BUS_DIVIDEND,
    BUS_MANUFACTURING,
    BUS_RESEARCH_DEVELOPMENT,
    BUS_GOVERNMENT_GRANT,
    BUS_INTERNAL_FUND_TRANSFER,
    BUS_FX_GAIN_LOSS,
    BUS_OTHER,
)

BUSINESS_LABELS: Dict[str, str] = {
    BUS_PAYROLL: "职工薪酬",
    BUS_TAX: "税费",
    BUS_INVENTORY_PURCHASE: "存货采购",
    BUS_LONG_TERM_ASSET: "长期资产",
    BUS_DEPRECIATION_AMORTIZATION: "折旧摊销",
    BUS_SALES_REVENUE: "销售收入",
    BUS_DEBT_FINANCING: "借款筹资",
    BUS_INTEREST: "利息收支",
    BUS_DAILY_EXPENSE: "日常费用",
    BUS_EMPLOYEE_LOAN: "员工借款",
    BUS_ENTITY_CURRENT: "单位往来",
    BUS_DEPOSIT_GUARANTEE: "押金保证金",
    BUS_INVESTMENT_PRINCIPAL: "投资本金",
    BUS_DIVIDEND: "分红股利",
    BUS_MANUFACTURING: "生产制造",
    BUS_RESEARCH_DEVELOPMENT: "研发",
    BUS_GOVERNMENT_GRANT: "政府补助",
    BUS_INTERNAL_FUND_TRANSFER: "资金内部往来",
    BUS_FX_GAIN_LOSS: "汇兑损益",
    BUS_OTHER: "其他业务",
}

# Exact/sub-string account-name anchors. These are deliberately finite and
# conservative. They are reimplemented semantic rules, not copied source code.
ACCOUNT_ANCHORS: Dict[str, Tuple[Tuple[str, Decimal], ...]] = {
    BUS_PAYROLL: (("应付职工薪酬", Decimal("48")), ("应付工资", Decimal("48"))),
    BUS_TAX: (("应交税费", Decimal("45")), ("税金及附加", Decimal("38"))),
    BUS_INVENTORY_PURCHASE: (
        ("原材料", Decimal("45")), ("材料采购", Decimal("45")),
        ("在途物资", Decimal("45")), ("委托加工物资", Decimal("42")),
        ("库存商品", Decimal("25")), ("周转材料", Decimal("22")),
    ),
    BUS_LONG_TERM_ASSET: (
        ("固定资产", Decimal("45")), ("在建工程", Decimal("45")),
        ("工程物资", Decimal("38")), ("无形资产", Decimal("36")),
        ("使用权资产", Decimal("32")), ("长期待摊费用", Decimal("24")),
    ),
    BUS_DEPRECIATION_AMORTIZATION: (
        ("累计折旧", Decimal("48")), ("累计摊销", Decimal("48")),
        ("累计折耗", Decimal("45")),
    ),
    BUS_SALES_REVENUE: (
        ("主营业务收入", Decimal("50")), ("其他业务收入", Decimal("42")),
        ("合同资产", Decimal("28")),
    ),
    BUS_DEBT_FINANCING: (
        ("短期借款", Decimal("50")), ("长期借款", Decimal("50")),
        ("应付债券", Decimal("45")), ("长期债券", Decimal("45")),
    ),
    BUS_INTEREST: (
        ("应付利息", Decimal("48")), ("应收利息", Decimal("42")),
        ("财务费用", Decimal("25")),
    ),
    BUS_DAILY_EXPENSE: (
        ("管理费用", Decimal("32")), ("销售费用", Decimal("32")),
        ("办公费", Decimal("22")), ("差旅费", Decimal("25")),
        ("交通费", Decimal("22")), ("业务招待费", Decimal("24")),
    ),
    BUS_EMPLOYEE_LOAN: (("其他应收款", Decimal("22")),),
    BUS_ENTITY_CURRENT: (("其他应收款", Decimal("16")), ("其他应付款", Decimal("16"))),
    BUS_DEPOSIT_GUARANTEE: (("其他应收款", Decimal("18")), ("其他应付款", Decimal("16"))),
    BUS_INVESTMENT_PRINCIPAL: (
        ("长期股权投资", Decimal("50")), ("交易性金融资产", Decimal("48")),
        ("债权投资", Decimal("46")), ("其他债权投资", Decimal("45")),
        ("投资性房地产", Decimal("38")),
    ),
    BUS_DIVIDEND: (("应付股利", Decimal("50")), ("应收股利", Decimal("46")), ("利润分配", Decimal("38"))),
    BUS_MANUFACTURING: (
        ("生产成本", Decimal("50")), ("制造费用", Decimal("38")),
        ("劳务成本", Decimal("28")), ("工程施工", Decimal("28")),
    ),
    BUS_RESEARCH_DEVELOPMENT: (("研发支出", Decimal("50")), ("研发费用", Decimal("46"))),
    BUS_GOVERNMENT_GRANT: (("递延收益", Decimal("44")), ("营业外收入", Decimal("20"))),
    BUS_FX_GAIN_LOSS: (("财务费用", Decimal("18")),),
}

DESCRIPTION_KEYWORDS: Dict[str, Tuple[Tuple[str, Decimal], ...]] = {
    BUS_PAYROLL: (("工资", Decimal("28")), ("薪酬", Decimal("28")), ("社保", Decimal("22")), ("公积金", Decimal("22")), ("奖金", Decimal("18")), ("年终奖", Decimal("22"))),
    BUS_TAX: (("缴税", Decimal("25")), ("税款", Decimal("22")), ("增值税", Decimal("22")), ("所得税", Decimal("22")), ("附加税", Decimal("20"))),
    BUS_INVENTORY_PURCHASE: (("采购", Decimal("22")), ("购料", Decimal("24")), ("材料款", Decimal("22")), ("货款", Decimal("12"))),
    BUS_LONG_TERM_ASSET: (("固定资产", Decimal("22")), ("设备款", Decimal("22")), ("装修", Decimal("18")), ("工程款", Decimal("18"))),
    BUS_DEPRECIATION_AMORTIZATION: (("折旧", Decimal("35")), ("摊销", Decimal("35"))),
    BUS_SALES_REVENUE: (("销售", Decimal("18")), ("收入", Decimal("16")), ("收货款", Decimal("20")), ("回款", Decimal("16"))),
    BUS_DEBT_FINANCING: (("借款", Decimal("18")), ("贷款", Decimal("20")), ("还贷", Decimal("20")), ("归还借款", Decimal("22"))),
    BUS_INTEREST: (("利息", Decimal("32")), ("贴息", Decimal("22"))),
    BUS_DAILY_EXPENSE: (("报销", Decimal("18")), ("办公", Decimal("16")), ("差旅", Decimal("22")), ("交通", Decimal("16")), ("招待", Decimal("18")), ("租金", Decimal("15")), ("物业", Decimal("14"))),
    BUS_EMPLOYEE_LOAN: (("员工借款", Decimal("38")), ("个人借款", Decimal("38")), ("暂借", Decimal("34")), ("借支", Decimal("34")), ("暂支", Decimal("30"))),
    BUS_ENTITY_CURRENT: (("往来款", Decimal("28")), ("暂收", Decimal("24")), ("暂付", Decimal("24")), ("代收", Decimal("16")), ("代付", Decimal("16"))),
    BUS_DEPOSIT_GUARANTEE: (("押金", Decimal("38")), ("保证金", Decimal("38")), ("质保金", Decimal("38"))),
    BUS_INVESTMENT_PRINCIPAL: (("投资款", Decimal("30")), ("股权投资", Decimal("32")), ("购买理财", Decimal("24"))),
    BUS_DIVIDEND: (("分红", Decimal("38")), ("股利", Decimal("38")), ("股息", Decimal("34")), ("派息", Decimal("36"))),
    BUS_MANUFACTURING: (("生产", Decimal("18")), ("领料", Decimal("24")), ("完工入库", Decimal("26")), ("制造", Decimal("18"))),
    BUS_RESEARCH_DEVELOPMENT: (("研发", Decimal("36")), ("科研", Decimal("30")), ("技术开发", Decimal("28")), ("产品开发", Decimal("28"))),
    BUS_GOVERNMENT_GRANT: (("政府补助", Decimal("40")), ("政府补贴", Decimal("40")), ("财政补贴", Decimal("38")), ("财政拨款", Decimal("38")), ("稳岗返还", Decimal("34")), ("税收返还", Decimal("30"))),
    BUS_FX_GAIN_LOSS: (("汇兑", Decimal("50")), ("汇率", Decimal("34")), ("外币折算", Decimal("36"))),
}

# Words that distinguish employee advances from entity-to-entity current account.
ENTITY_COUNTERPARTY_WORDS: Tuple[str, ...] = (
    "公司", "单位", "集团", "客户", "供应商", "关联方", "子公司", "母公司", "分公司"
)
EMPLOYEE_WORDS: Tuple[str, ...] = ("员工", "个人", "职工", "备用金", "借支", "暂借", "暂支")

PERIOD_CLOSE_WORDS: Tuple[str, ...] = (
    "结转损益", "期间损益", "损益结转", "结转本期损益", "结转利润"
)


@dataclass(frozen=True)
class BusinessClassificationConfig:
    """Deterministic thresholds for classification.

    `score` is a 0..100 heuristic match score. `confidence` is a 0..1
    explainability-oriented certainty indicator, not a probability.
    """

    min_primary_score: Decimal = Decimal("35")
    min_clear_margin: Decimal = Decimal("8")
    high_confidence_score: Decimal = Decimal("70")
    high_confidence_margin: Decimal = Decimal("18")
    medium_confidence_score: Decimal = Decimal("50")
    medium_confidence_margin: Decimal = Decimal("10")
    candidate_limit: int = 5


DEFAULT_BUSINESS_CLASSIFICATION_CONFIG = BusinessClassificationConfig()
