import unittest
from pathlib import Path

from services.journal_entry.normalize import normalize_file
from services.journal_entry.anomaly import (
    classify_account_category,
    classify_business_group,
    extract_features,
)

FIXTURES = Path(__file__).resolve().parent / "fixtures"


class AccountCategoryTests(unittest.TestCase):
    def test_code_rule_wins_over_name(self):
        match = classify_account_category("6602", "银行存款")
        self.assertEqual(match.category, "expense")
        self.assertEqual(match.matched_by, "code")

    def test_name_fallback(self):
        match = classify_account_category("9999", "主营业务收入")
        self.assertEqual(match.category, "revenue")
        self.assertEqual(match.matched_by, "name")

    def test_unknown_is_explicit(self):
        match = classify_account_category("9999", "未知科目")
        self.assertEqual(match.category, "unknown")
        self.assertEqual(match.matched_by, "unknown")

    def test_long_code_uses_four_digit_prefix(self):
        match = classify_account_category("660201001", "")
        self.assertEqual(match.category, "expense")


class BusinessGroupTests(unittest.TestCase):
    def group(self, debit, credit):
        return classify_business_group(debit, credit)

    def test_payroll(self):
        self.assertEqual(self.group(["expense"], ["payroll"]).group, "payroll")

    def test_tax(self):
        self.assertEqual(self.group(["tax"], ["cash_bank"]).group, "tax")

    def test_asset_acquisition(self):
        self.assertEqual(
            self.group(["fixed_asset"], ["cash_bank"]).group,
            "asset_acquisition",
        )

    def test_revenue_receipt(self):
        self.assertEqual(
            self.group(["receivable"], ["revenue"]).group,
            "revenue_receipt",
        )

    def test_purchase_payment(self):
        self.assertEqual(
            self.group(["inventory"], ["payable"]).group,
            "purchase_payment",
        )

    def test_expense_payment(self):
        self.assertEqual(
            self.group(["expense"], ["cash_bank"]).group,
            "expense_payment",
        )

    def test_cash_transfer(self):
        self.assertEqual(
            self.group(["cash_bank"], ["cash_bank"]).group,
            "cash_bank_transfer",
        )

    def test_financing(self):
        self.assertEqual(
            self.group(["cash_bank"], ["loan"]).group,
            "financing",
        )

    def test_equity(self):
        self.assertEqual(
            self.group(["cash_bank"], ["equity"]).group,
            "equity",
        )

    def test_other(self):
        self.assertEqual(
            self.group(["prepaid"], ["payable"]).group,
            "other",
        )

    def test_deterministic(self):
        left = self.group(["expense"], ["cash_bank"]).to_dict()
        right = self.group(["expense"], ["cash_bank"]).to_dict()
        self.assertEqual(left["group"], "expense_payment")
        self.assertEqual(left, right)


class FixtureGroupingTests(unittest.TestCase):
    def test_business_group_fixture(self):
        normalized = normalize_file(
            FIXTURES / "journal_anomaly_business_groups.xlsx"
        )
        groups = [
            extract_features(entry).business_group
            for entry in normalized.entries
        ]
        self.assertEqual(groups[:2], ["payroll", "payroll"])
        self.assertEqual(groups[2:4], ["expense_payment", "expense_payment"])
        self.assertEqual(groups[4:6], ["tax", "tax"])
        self.assertEqual(groups[6:8], ["asset_acquisition", "asset_acquisition"])
        self.assertEqual(groups[8:10], ["revenue_receipt", "revenue_receipt"])
        self.assertEqual(groups[10:12], ["purchase_payment", "purchase_payment"])
        self.assertEqual(groups[12:14], ["cash_bank_transfer", "cash_bank_transfer"])
        self.assertEqual(groups[14:16], ["financing", "financing"])
        self.assertEqual(groups[16:18], ["equity", "equity"])
        self.assertEqual(groups[18:20], ["other", "other"])


if __name__ == "__main__":
    unittest.main()
