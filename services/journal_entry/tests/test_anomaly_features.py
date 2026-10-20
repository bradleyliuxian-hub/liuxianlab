import unittest
from decimal import Decimal
from types import SimpleNamespace

from services.journal_entry.schema import JournalEntry, JournalLine
from services.journal_entry.anomaly import (
    extract_all_features,
    extract_features,
    voucher_key_for_entry,
)
from services.journal_entry.anomaly.features import _multiset_signature


def line(account_code, account_name, debit="0", credit="0", row=2, voucher="V1"):
    return JournalLine(
        voucher_id=voucher,
        account_code=account_code,
        account_name=account_name,
        debit=Decimal(str(debit)),
        credit=Decimal(str(credit)),
        period="2026-01",
        entity="E",
        sheet_name="S",
        source_row=row,
    )


def entry(voucher="V1", rows=None):
    rows = rows or [
        ("6602", "管理费用", 100, 0),
        ("1002", "银行存款", 0, 100),
    ]
    return JournalEntry.from_lines(
        [
            line(code, name, debit, credit, row=index, voucher=voucher)
            for index, (code, name, debit, credit) in enumerate(rows, start=2)
        ]
    )


class FeatureTests(unittest.TestCase):
    def test_signatures_are_sorted_and_stable(self):
        feature = extract_features(entry())
        self.assertEqual(feature.account_signature, "1002|6602")
        self.assertEqual(feature.directional_signature, "D:6602|C:1002")
        self.assertEqual(feature.account_multiset_signature, "1002x1|6602x1")
        self.assertEqual(
            feature.voucher_key,
            voucher_key_for_entry(entry()),
        )

    def test_signature_independent_of_line_order(self):
        left = extract_features(
            entry(rows=[("6602", "管理费用", 100, 0), ("1002", "银行存款", 0, 100)])
        )
        right = extract_features(
            entry(rows=[("1002", "银行存款", 0, 100), ("6602", "管理费用", 100, 0)])
        )
        self.assertEqual(left.account_signature, right.account_signature)
        self.assertEqual(left.directional_signature, right.directional_signature)

    def test_gross_amount_uses_max_absolute_side(self):
        feature = extract_features(
            entry(rows=[("6602", "管理费用", 100, 0), ("1002", "银行存款", 0, 90)])
        )
        self.assertEqual(feature.gross_amount, Decimal("100.00"))
        self.assertFalse(feature.is_balanced)
        self.assertFalse(feature.is_within_tolerance)

    def test_categories_code_priority_and_name_fallback(self):
        feature = extract_features(
            entry(
                rows=[
                    ("6602", "任意名称", 100, 0),
                    ("", "银行存款", 0, 100),
                ]
            )
        )
        categories = dict(feature.account_categories)
        self.assertEqual(categories["6602"], "expense")
        self.assertEqual(categories["银行存款"], "cash_bank")
        self.assertEqual(feature.unknown_account_count, 0)

    def test_unknown_account_is_visible(self):
        feature = extract_features(
            entry(
                rows=[
                    ("9999", "未知科目", 100, 0),
                    ("1002", "银行存款", 0, 100),
                ]
            )
        )
        self.assertEqual(feature.unknown_account_count, 1)
        self.assertEqual(feature.unknown_account_ratio, Decimal("0.500000"))

    def test_negative_and_mixed_side_flags(self):
        feature = extract_features(
            entry(
                rows=[
                    ("6602", "管理费用", -100, 0),
                    ("1002", "银行存款", 40, 100),
                ]
            )
        )
        self.assertTrue(feature.has_negative_lines)
        self.assertTrue(feature.has_mixed_side_lines)

    def test_optional_contra_context(self):
        contra = SimpleNamespace(
            ambiguous=True,
            solution_count=3,
            complexity_limited=False,
            warnings=("multiple_equivalent_solutions",),
            unallocated_debit=(SimpleNamespace(amount=Decimal("5")),),
            unallocated_credit=(SimpleNamespace(amount=Decimal("2")),),
        )
        feature = extract_features(entry(), contra_result=contra)
        self.assertTrue(feature.contra_ambiguous)
        self.assertEqual(feature.contra_solution_count, 3)
        self.assertEqual(feature.contra_unallocated, Decimal("7.00"))
        self.assertEqual(
            feature.contra_warnings,
            ("multiple_equivalent_solutions",),
        )

    def test_extract_all_features_maps_contra_by_voucher_key(self):
        journal = entry()
        key = voucher_key_for_entry(journal)
        contra = SimpleNamespace(
            ambiguous=False,
            solution_count=1,
            complexity_limited=False,
            warnings=(),
            unallocated_debit=(),
            unallocated_credit=(),
        )
        features = extract_all_features([journal], {key: contra})
        self.assertEqual(features[0].contra_solution_count, 1)
        self.assertEqual(features[0].contra_unallocated, Decimal("0.00"))

    def test_multiset_signature_keeps_duplicate_rows(self):
        value = _multiset_signature(
            entry(rows=[("1001", "现金", 100, 0), ("1001", "现金", 100, 0)]).lines
        )
        self.assertEqual(value, "1001x2")


if __name__ == "__main__":
    unittest.main()
