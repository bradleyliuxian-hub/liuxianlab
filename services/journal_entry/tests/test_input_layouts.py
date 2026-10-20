import unittest

from services.journal_entry.errors import NormalizationError
from services.journal_entry.input_layouts import (
    LAYOUT_DEBIT_CREDIT,
    LAYOUT_DIRECTION_AMOUNT,
    AmountLayoutSpec,
    is_excel_error_value,
    normalize_direction,
    normalize_positive_side,
)


class DirectionParsingTests(unittest.TestCase):
    def test_debit_aliases(self):
        for value in ("借", "借方", "D", "debit", "DR", " 借 "):
            with self.subTest(value=value):
                self.assertEqual(normalize_direction(value), "debit")

    def test_credit_aliases(self):
        for value in ("贷", "贷方", "C", "credit", "CR", " 贷 "):
            with self.subTest(value=value):
                self.assertEqual(normalize_direction(value), "credit")

    def test_blank_direction(self):
        self.assertIsNone(normalize_direction(None))
        self.assertIsNone(normalize_direction(""))
        self.assertIsNone(normalize_direction("   "))

    def test_invalid_direction_is_structured(self):
        with self.assertRaises(NormalizationError) as context:
            normalize_direction("收")
        self.assertEqual(context.exception.details["reason"], "invalid_direction")

    def test_excel_error_direction_is_structured(self):
        with self.assertRaises(NormalizationError) as context:
            normalize_direction("#NAME?")
        self.assertEqual(context.exception.details["reason"], "excel_error_value")

    def test_positive_side(self):
        self.assertEqual(normalize_positive_side("debit"), "debit")
        self.assertEqual(normalize_positive_side("借"), "debit")
        self.assertEqual(normalize_positive_side("credit"), "credit")
        self.assertEqual(normalize_positive_side("贷"), "credit")
        self.assertIsNone(normalize_positive_side(""))
        with self.assertRaises(NormalizationError):
            normalize_positive_side("both")


class ErrorValueTests(unittest.TestCase):
    def test_excel_error_values(self):
        for value in ("#NAME?", "#VALUE!", "#REF!", "#DIV/0!", "#N/A", "#NUM!", "#NULL!"):
            with self.subTest(value=value):
                self.assertTrue(is_excel_error_value(value))
        self.assertFalse(is_excel_error_value("正常文本"))
        self.assertFalse(is_excel_error_value(None))
        self.assertFalse(is_excel_error_value(100))


class LayoutModelTests(unittest.TestCase):
    def test_layout_serialization(self):
        spec = AmountLayoutSpec(
            layout=LAYOUT_DIRECTION_AMOUNT,
            direction_column="方向",
            amount_column="金额",
        )
        payload = spec.to_dict()
        self.assertEqual(payload["layout"], "direction_amount")
        self.assertEqual(payload["direction_column"], "方向")
        self.assertIsNone(payload["positive_side"])

    def test_default_layout(self):
        spec = AmountLayoutSpec(layout=LAYOUT_DEBIT_CREDIT)
        self.assertEqual(spec.layout, "debit_credit")


if __name__ == "__main__":
    unittest.main()
