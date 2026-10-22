import unittest

from services.journal_entry.errors import ColumnMappingError
from services.journal_entry.mapping import (
    normalize_header,
    suggest_mapping,
)


class HeaderAliasTests(unittest.TestCase):
    def test_normalizes_spaces_and_punctuation(self):
        self.assertEqual(normalize_header(" 借方金额（本位币） "), "借方金额本位币")
        self.assertEqual(normalize_header("Voucher No."), "voucherno")
        self.assertEqual(normalize_header("Account_Name"), "accountname")

    def test_chinese_alias_mapping(self):
        headers = [
            "日期",
            "凭证号",
            "科目编码",
            "科目名称",
            "借方金额",
            "贷方金额",
            "摘要",
            "制单人",
        ]
        mapping = suggest_mapping(headers)
        self.assertEqual(mapping.source_column("voucher_id"), "凭证号")
        self.assertEqual(mapping.source_column("account_code"), "科目编码")
        self.assertEqual(mapping.source_column("account_name"), "科目名称")
        self.assertEqual(mapping.source_column("debit"), "借方金额")
        self.assertEqual(mapping.source_column("credit"), "贷方金额")
        self.assertEqual(mapping.source_column("description"), "摘要")
        self.assertEqual(mapping.source_column("preparer"), "制单人")
        self.assertEqual(mapping.to_dict()["fields"]["debit"]["confidence"], 1.0)

    def test_english_alias_mapping(self):
        headers = [
            "Voucher No",
            "Date",
            "Account Name",
            "Debit Amount",
            "Credit Amount",
            "Description",
            "Currency",
        ]
        mapping = suggest_mapping(headers)
        self.assertEqual(mapping.source_column("voucher_id"), "Voucher No")
        self.assertEqual(mapping.source_column("debit"), "Debit Amount")
        self.assertEqual(mapping.source_column("credit"), "Credit Amount")
        self.assertEqual(mapping.source_column("currency"), "Currency")

    def test_direction_amount_auto_layout(self):
        headers = ["日期", "凭证号数", "科目编码", "科目名称", "方向", "金额"]
        mapping = suggest_mapping(headers)
        self.assertEqual(mapping.amount_layout.layout, "direction_amount")
        self.assertEqual(mapping.source_column("voucher_id"), "凭证号数")
        self.assertEqual(mapping.amount_layout.direction_column, "方向")
        self.assertEqual(mapping.amount_layout.amount_column, "金额")
        self.assertEqual(
            mapping.to_dict()["amount_layout"]["layout"],
            "direction_amount",
        )

    def test_direction_amount_wins_when_only_one_debit_column_exists(self):
        headers = ["凭证号", "科目名称", "借方金额", "方向", "金额"]
        mapping = suggest_mapping(headers)
        self.assertEqual(mapping.amount_layout.layout, "direction_amount")
        self.assertEqual(mapping.amount_layout.direction_column, "方向")
        self.assertEqual(mapping.amount_layout.amount_column, "金额")

    def test_direction_amount_wins_when_only_one_credit_column_exists(self):
        headers = ["凭证号", "科目名称", "贷方金额", "方向", "金额"]
        mapping = suggest_mapping(headers)
        self.assertEqual(mapping.amount_layout.layout, "direction_amount")
        self.assertEqual(mapping.amount_layout.direction_column, "方向")
        self.assertEqual(mapping.amount_layout.amount_column, "金额")

    def test_duplicate_description_candidates_are_exposed(self):
        headers = ["凭证号", "科目名称", "借方金额", "贷方金额", "摘要", "摘要"]
        mapping = suggest_mapping(headers)
        self.assertIn("description", mapping.ambiguous)
        candidates = mapping.to_dict()["ambiguous_candidates"]["description"]
        self.assertEqual([item["column_index"] for item in candidates], [5, 6])

    def test_explicit_index_selects_duplicate_header(self):
        headers = ["凭证号", "科目名称", "借方金额", "贷方金额", "摘要", "摘要"]
        mapping = suggest_mapping(
            headers,
            explicit={
                "voucher_id": "凭证号",
                "account_name": "科目名称",
                "debit": "借方金额",
                "credit": "贷方金额",
                "description": 6,
            },
        )
        self.assertNotIn("description", mapping.ambiguous)
        self.assertEqual(mapping.source_index("description", headers), 5)
        self.assertEqual(mapping.get("description").column_index, 6)

    def test_account_code_alone_is_sufficient(self):
        headers = ["凭证号", "科目编码", "借方金额", "贷方金额"]
        mapping = suggest_mapping(headers)
        self.assertEqual(mapping.source_column("account_code"), "科目编码")
        self.assertIsNone(mapping.source_column("account_name"))

    def test_explicit_mapping_overrides_alias(self):
        headers = ["凭证号", "科目", "借方", "贷方", "备注"]
        mapping = suggest_mapping(
            headers,
            explicit={
                "voucher_id": "凭证号",
                "account_name": "科目",
                "debit": "借方",
                "credit": "贷方",
                "description": "备注",
            },
        )
        self.assertEqual(mapping.get("description").method, "explicit")
        self.assertEqual(mapping.source_column("description"), "备注")

    def test_source_index_resolves_columns(self):
        headers = ["日期", "凭证号", "科目名称", "借方金额", "贷方金额"]
        mapping = suggest_mapping(headers)
        self.assertEqual(mapping.source_index("voucher_id", headers), 1)
        self.assertEqual(mapping.source_index("debit", headers), 3)


class MappingErrorTests(unittest.TestCase):
    def test_missing_debit_or_credit_is_rejected(self):
        headers = ["凭证号", "科目名称", "借方金额"]
        with self.assertRaises(ColumnMappingError) as context:
            suggest_mapping(headers)
        self.assertIn("credit", context.exception.details["missing_fields"])

    def test_missing_account_is_rejected(self):
        headers = ["凭证号", "借方金额", "贷方金额"]
        with self.assertRaises(ColumnMappingError) as context:
            suggest_mapping(headers)
        self.assertIn(
            "account_code_or_account_name",
            context.exception.details["missing_fields"],
        )

    def test_ambiguous_required_amount_has_candidate_indices(self):
        headers = ["凭证号", "科目名称", "方向", "金额", "金额"]
        with self.assertRaises(ColumnMappingError) as context:
            suggest_mapping(headers)
        details = context.exception.details
        self.assertEqual(details["amount_layout"], "direction_amount")
        self.assertIn("amount", details["ambiguous"])
        self.assertEqual(
            [item["column_index"] for item in details["ambiguous_candidates"]["amount"]],
            [4, 5],
        )

    def test_ambiguous_duplicate_headers_are_not_guessed(self):
        headers = ["凭证号", "科目名称", "借方金额", "借方金额", "贷方金额"]
        with self.assertRaises(ColumnMappingError) as context:
            suggest_mapping(headers)
        self.assertIn("debit", context.exception.details["ambiguous"])

    def test_unknown_explicit_field_is_rejected(self):
        headers = ["凭证号", "科目名称", "借方金额", "贷方金额"]
        with self.assertRaises(ColumnMappingError):
            suggest_mapping(headers, explicit={"unknown": "凭证号"})

    def test_explicit_column_must_exist(self):
        headers = ["凭证号", "科目名称", "借方金额", "贷方金额"]
        with self.assertRaises(ColumnMappingError):
            suggest_mapping(
                headers,
                explicit={
                    "voucher_id": "不存在",
                    "account_name": "科目名称",
                    "debit": "借方金额",
                    "credit": "贷方金额",
                },
            )

    def test_explicit_one_based_column_index_is_supported(self):
        headers = ["凭证号", "科目名称", "借方金额", "贷方金额"]
        mapping = suggest_mapping(
            headers,
            explicit={
                "voucher_id": 1,
                "account_name": 2,
                "debit": 3,
                "credit": 4,
            },
        )
        self.assertEqual(mapping.source_column("debit"), "借方金额")


if __name__ == "__main__":
    unittest.main()

class CounterpartyMappingTests(unittest.TestCase):
    def test_customer_supplier_counterparty_aliases(self):
        from services.journal_entry.mapping import suggest_mapping
        mapping = suggest_mapping([
            "日期", "凭证号", "科目编码", "客户编码", "客户名称",
            "供应商编码", "供应商名称", "往来单位", "借方金额", "贷方金额",
        ])
        self.assertEqual(mapping.get("customer_code").source_column, "客户编码")
        self.assertEqual(mapping.get("customer_name").source_column, "客户名称")
        self.assertEqual(mapping.get("supplier_code").source_column, "供应商编码")
        self.assertEqual(mapping.get("supplier_name").source_column, "供应商名称")
        self.assertEqual(mapping.get("counterparty_name").source_column, "往来单位")
        self.assertIsNone(mapping.get("counterparty_code"))
