import unittest
from decimal import Decimal

from services.journal_entry.business import classify_entry, classify_entries
from services.journal_entry.business.constants import (
    BUS_DAILY_EXPENSE,
    BUS_DEBT_FINANCING,
    BUS_DEPOSIT_GUARANTEE,
    BUS_DEPRECIATION_AMORTIZATION,
    BUS_EMPLOYEE_LOAN,
    BUS_ENTITY_CURRENT,
    BUS_FX_GAIN_LOSS,
    BUS_GOVERNMENT_GRANT,
    BUS_INTERNAL_FUND_TRANSFER,
    BUS_INVENTORY_PURCHASE,
    BUS_LONG_TERM_ASSET,
    BUS_MANUFACTURING,
    BUS_OTHER,
    BUS_PAYROLL,
    BUS_RESEARCH_DEVELOPMENT,
    BUS_SALES_REVENUE,
    BUS_TAX,
)
from services.journal_entry.schema import JournalEntry, JournalLine


def entry(voucher_id, rows, description=None, period="2026-01", entity="E"):
    lines = []
    for idx, row in enumerate(rows, start=2):
        code, name, debit, credit = row
        lines.append(
            JournalLine(
                voucher_id=voucher_id,
                account_code=code,
                account_name=name,
                debit=Decimal(str(debit)),
                credit=Decimal(str(credit)),
                description=description,
                period=period,
                entity=entity,
                sheet_name="S",
                source_row=idx,
            )
        )
    return JournalEntry.from_lines(lines)


class BusinessClassificationTests(unittest.TestCase):
    def test_payroll(self):
        result = classify_entry(entry("P", [("2211", "应付职工薪酬", 100, 0), ("1002", "银行存款", 0, 100)], "发放工资"))
        self.assertEqual(result.business_code, BUS_PAYROLL)
        self.assertGreaterEqual(result.score, Decimal("70"))

    def test_tax(self):
        result = classify_entry(entry("T", [("2221", "应交税费", 100, 0), ("1002", "银行存款", 0, 100)], "缴纳增值税"))
        self.assertEqual(result.business_code, BUS_TAX)

    def test_inventory_purchase(self):
        result = classify_entry(entry("I", [("1403", "原材料", 100, 0), ("2202", "应付账款", 0, 100)], "采购材料"))
        self.assertEqual(result.business_code, BUS_INVENTORY_PURCHASE)

    def test_long_term_asset(self):
        result = classify_entry(entry("A", [("1601", "固定资产", 100, 0), ("1002", "银行存款", 0, 100)], "购置设备"))
        self.assertEqual(result.business_code, BUS_LONG_TERM_ASSET)

    def test_depreciation_hard_rule(self):
        result = classify_entry(entry("D", [("6602", "管理费用", 100, 0), ("1602", "累计折旧", 0, 100)], "计提本月折旧"))
        self.assertEqual(result.business_code, BUS_DEPRECIATION_AMORTIZATION)
        self.assertTrue(result.is_hard_rule)

    def test_sales_revenue(self):
        result = classify_entry(entry("S", [("1122", "应收账款", 100, 0), ("6001", "主营业务收入", 0, 100)], "确认销售收入"))
        self.assertEqual(result.business_code, BUS_SALES_REVENUE)

    def test_debt_financing(self):
        result = classify_entry(entry("F", [("1002", "银行存款", 100, 0), ("2001", "短期借款", 0, 100)], "收到银行贷款"))
        self.assertEqual(result.business_code, BUS_DEBT_FINANCING)

    def test_daily_expense(self):
        result = classify_entry(entry("E", [("6602", "管理费用-差旅费", 100, 0), ("1002", "银行存款", 0, 100)], "员工差旅报销"))
        self.assertEqual(result.business_code, BUS_DAILY_EXPENSE)

    def test_employee_loan_hard_rule(self):
        result = classify_entry(entry("EL", [("1221", "其他应收款-员工", 100, 0), ("1002", "银行存款", 0, 100)], "员工暂借款"))
        self.assertEqual(result.business_code, BUS_EMPLOYEE_LOAN)
        self.assertTrue(result.is_hard_rule)

    def test_entity_current_not_employee(self):
        result = classify_entry(entry("EC", [("1221", "其他应收款", 100, 0), ("1002", "银行存款", 0, 100)], "支付关联公司往来款"))
        self.assertEqual(result.business_code, BUS_ENTITY_CURRENT)

    def test_deposit_hard_rule(self):
        result = classify_entry(entry("DG", [("1221", "其他应收款", 100, 0), ("1002", "银行存款", 0, 100)], "支付投标保证金"))
        self.assertEqual(result.business_code, BUS_DEPOSIT_GUARANTEE)
        self.assertTrue(result.is_hard_rule)

    def test_manufacturing(self):
        result = classify_entry(entry("M", [("5001", "生产成本", 100, 0), ("1403", "原材料", 0, 100)], "生产领料"))
        self.assertEqual(result.business_code, BUS_MANUFACTURING)

    def test_research_development(self):
        result = classify_entry(entry("R", [("6604", "研发费用", 100, 0), ("1002", "银行存款", 0, 100)], "研发项目测试费"))
        self.assertEqual(result.business_code, BUS_RESEARCH_DEVELOPMENT)

    def test_government_grant(self):
        result = classify_entry(entry("G", [("1002", "银行存款", 100, 0), ("6301", "其他收益", 0, 100)], "收到政府补助"))
        self.assertEqual(result.business_code, BUS_GOVERNMENT_GRANT)

    def test_internal_fund_transfer_hard_rule(self):
        result = classify_entry(entry("CASH", [("1002", "银行存款-A", 100, 0), ("1002", "银行存款-B", 0, 100)], "内部转款"))
        self.assertEqual(result.business_code, BUS_INTERNAL_FUND_TRANSFER)
        self.assertTrue(result.is_hard_rule)
        self.assertEqual(result.confidence, Decimal("1.0000"))

    def test_fx_hard_rule(self):
        result = classify_entry(entry("FX", [("6603", "财务费用", 100, 0), ("1002", "银行存款", 0, 100)], "期末汇兑损益"))
        self.assertEqual(result.business_code, BUS_FX_GAIN_LOSS)

    def test_ambiguous_is_conservative_other(self):
        result = classify_entry(entry("O", [(None, "自定义科目甲", 100, 0), (None, "自定义科目乙", 0, 100)], "普通业务"))
        self.assertEqual(result.business_code, BUS_OTHER)
        self.assertEqual(result.confidence_level, "LOW")

    def test_red_letter_direction_does_not_crash(self):
        result = classify_entry(entry("RED", [("6602", "管理费用", -100, 0), ("1002", "银行存款", 100, 0)], "冲销差旅费"))
        self.assertTrue(result.source_rows)

    def test_batch_summary_and_stable_order(self):
        entries = [
            entry("B", [("2221", "应交税费", 100, 0), ("1002", "银行存款", 0, 100)], "缴税"),
            entry("A", [("2211", "应付职工薪酬", 100, 0), ("1002", "银行存款", 0, 100)], "发工资"),
        ]
        result = classify_entries(entries)
        self.assertEqual(result.summary["voucher_count"], 2)
        self.assertEqual(result.summary["classified_count"], 2)
        keys = [item.voucher_key for item in result.classifications]
        self.assertEqual(keys, sorted(keys))
        self.assertEqual(result.to_dict(), classify_entries(list(reversed(entries))).to_dict())

    def test_result_traceability_and_candidate_evidence(self):
        result = classify_entry(entry("TRACE", [("1122", "应收账款", 100, 0), ("6001", "主营业务收入", 0, 100)], "销售收入"))
        payload = result.to_dict()
        self.assertEqual(payload["source_rows"], [2, 3])
        self.assertTrue(payload["candidates"])
        self.assertIn("components", payload["candidates"][0])
        self.assertIsNone(payload["professional_interpretation"])


if __name__ == "__main__":
    unittest.main()


class MissingBusinessBucketTests(unittest.TestCase):
    def test_interest_income_expense_bucket(self):
        result = classify_entry(
            entry(
                "INT",
                [("6603", "财务费用-利息支出", 100, 0), ("1002", "银行存款", 0, 100)],
                "支付贷款利息",
            )
        )
        self.assertEqual(result.business_code, "JE-B008")

    def test_investment_principal_bucket(self):
        result = classify_entry(
            entry(
                "INV",
                [("1511", "长期股权投资", 100, 0), ("1002", "银行存款", 0, 100)],
                "支付投资款",
            )
        )
        self.assertEqual(result.business_code, "JE-B013")

    def test_dividend_bucket(self):
        result = classify_entry(
            entry(
                "DIV",
                [("2232", "应付股利", 100, 0), ("1002", "银行存款", 0, 100)],
                "支付股东股利",
            )
        )
        self.assertEqual(result.business_code, "JE-B014")


class GovernmentGrantBoundaryTests(unittest.TestCase):
    def test_explicit_government_grant_description(self):
        result = classify_entry(
            entry(
                "GOV1",
                [("1002", "银行存款", 100, 0), ("6301", "其他收益", 0, 100)],
                "收到政府补助",
            )
        )
        self.assertEqual(result.business_code, "JE-B017")

    def test_deferred_income_structure(self):
        result = classify_entry(
            entry(
                "GOV2",
                [("2401", "递延收益", 100, 0), ("6301", "其他收益", 0, 100)],
                "本期确认政府补助",
            )
        )
        self.assertEqual(result.business_code, "JE-B017")

    def test_other_income_from_scrap_disposal_is_not_grant(self):
        result = classify_entry(
            entry(
                "NON_GOV1",
                [("1002", "银行存款", 100, 0), ("6301", "其他收益", 0, 100)],
                "处置废旧物资收益",
            )
        )
        self.assertNotEqual(result.business_code, "JE-B017")

    def test_other_income_from_penalty_compensation_is_not_grant(self):
        result = classify_entry(
            entry(
                "NON_GOV2",
                [("1002", "银行存款", 100, 0), ("6301", "其他收益", 0, 100)],
                "收到违约赔偿款",
            )
        )
        self.assertNotEqual(result.business_code, "JE-B017")


class BusinessModuleBoundaryTests(unittest.TestCase):
    def test_business_does_not_import_anomaly_internals(self):
        import ast
        from pathlib import Path

        business_dir = Path(__file__).resolve().parents[1] / "business"
        for path in sorted(business_dir.glob("*.py")):
            tree = ast.parse(path.read_text(encoding="utf-8"))
            for node in ast.walk(tree):
                if isinstance(node, ast.ImportFrom):
                    module = node.module or ""
                    self.assertNotIn("anomaly", module, path.name)
                elif isinstance(node, ast.Import):
                    for alias in node.names:
                        self.assertNotIn("anomaly", alias.name, path.name)


class InvestmentIncomeCategoryTests(unittest.TestCase):
    def test_6111_and_name_are_investment_income(self):
        from services.journal_entry.accounting_features import (
            CATEGORY_INVESTMENT_INCOME,
            classify_account_category,
        )

        by_code = classify_account_category("6111", "投资收益")
        by_name = classify_account_category("9999", "投资收益")
        self.assertEqual(by_code.category, CATEGORY_INVESTMENT_INCOME)
        self.assertEqual(by_name.category, CATEGORY_INVESTMENT_INCOME)

    def test_investment_income_is_not_sales_revenue_or_principal(self):
        result = classify_entry(
            entry(
                "INV_INCOME",
                [("1002", "银行存款", 100, 0), ("6111", "投资收益", 0, 100)],
                "收到投资收益",
            )
        )
        self.assertNotEqual(result.business_code, "JE-B006")
        self.assertNotEqual(result.business_code, "JE-B013")
        self.assertEqual(result.business_code, "JE-B020")

    def test_true_sales_and_principal_remain_unchanged(self):
        sales = classify_entry(
            entry(
                "SALES",
                [("1122", "应收账款", 100, 0), ("6001", "主营业务收入", 0, 100)],
                "确认销售收入",
            )
        )
        principal = classify_entry(
            entry(
                "PRINCIPAL",
                [("1511", "长期股权投资", 100, 0), ("1002", "银行存款", 0, 100)],
                "支付投资款",
            )
        )
        self.assertEqual(sales.business_code, "JE-B006")
        self.assertEqual(principal.business_code, "JE-B013")

    def test_business_and_anomaly_share_investment_income_category(self):
        from services.journal_entry.accounting_features import (
            CATEGORY_INVESTMENT_INCOME,
        )
        from services.journal_entry.anomaly.constants import (
            CATEGORY_INVESTMENT_INCOME as ANOMALY_CATEGORY,
        )
        from services.journal_entry.anomaly.features import extract_features
        from services.journal_entry.business.features import (
            extract_business_features,
        )

        journal = entry(
            "SHARED",
            [("1002", "银行存款", 100, 0), ("6111", "投资收益", 0, 100)],
            "收到投资收益",
        )
        business_features = extract_business_features(journal)
        anomaly_features = extract_features(journal)
        business_categories = {
            line.account_key: line.category for line in business_features.lines
        }
        anomaly_categories = dict(anomaly_features.account_categories)
        self.assertEqual(CATEGORY_INVESTMENT_INCOME, ANOMALY_CATEGORY)
        self.assertEqual(
            business_categories["6111"],
            CATEGORY_INVESTMENT_INCOME,
        )
        self.assertEqual(
            anomaly_categories["6111"],
            CATEGORY_INVESTMENT_INCOME,
        )
        self.assertNotEqual(anomaly_features.business_group, "revenue_receipt")
