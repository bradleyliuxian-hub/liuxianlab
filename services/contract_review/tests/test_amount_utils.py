import unittest
from decimal import Decimal

from services.contract_review import amount_utils


class ChineseAmountTests(unittest.TestCase):

    def test_forty_eight_wan(self):
        self.assertEqual(
            amount_utils.parse_chinese_amount("肆拾捌万元整"),
            Decimal("480000"),
        )

    def test_ninety_six_wan(self):
        self.assertEqual(
            amount_utils.parse_chinese_amount("玖拾陆万元整"),
            Decimal("960000"),
        )

    def test_sixteen_wan(self):
        self.assertEqual(
            amount_utils.parse_chinese_amount("拾陆万元整"),
            Decimal("160000"),
        )

    def test_one_million(self):
        self.assertEqual(
            amount_utils.parse_chinese_amount("壹佰万元整"),
            Decimal("1000000"),
        )

    def test_rmb_prefix(self):
        self.assertEqual(
            amount_utils.parse_chinese_amount("人民币肆拾捌万元整"),
            Decimal("480000"),
        )

    def test_simplified_digits(self):
        self.assertEqual(
            amount_utils.parse_chinese_amount("四十八万元整"),
            Decimal("480000"),
        )

    def test_jiao_and_fen(self):
        self.assertEqual(
            amount_utils.parse_chinese_amount("壹佰贰拾叁元肆角伍分"),
            Decimal("123.45"),
        )

    def test_malformed_unit_returns_none(self):
        self.assertIsNone(
            amount_utils.parse_chinese_amount("肆拾捌方元整")
        )

    def test_empty_returns_none(self):
        self.assertIsNone(
            amount_utils.parse_chinese_amount("")
        )


class AmountPrecisionTests(unittest.TestCase):

    def test_yuan_jiao_fen(self):
        self.assertEqual(
            amount_utils.parse_chinese_amount(
                "壹佰贰拾叁元肆角伍分"
            ),
            Decimal("123.45"),
        )

    def test_yuan_and_jiao(self):
        self.assertEqual(
            amount_utils.parse_chinese_amount("壹佰元伍角"),
            Decimal("100.50"),
        )

    def test_jiao_only(self):
        self.assertEqual(
            amount_utils.parse_chinese_amount("伍角"),
            Decimal("0.50"),
        )

    def test_fen_only(self):
        self.assertEqual(
            amount_utils.parse_chinese_amount("伍分"),
            Decimal("0.05"),
        )

    def test_arabic_decimal(self):
        self.assertEqual(
            amount_utils.parse_arabic_amount("¥123.45"),
            Decimal("123.45"),
        )

    def test_precision_never_rounded_to_integer(self):
        value = amount_utils.parse_chinese_amount(
            "壹佰贰拾叁元肆角伍分"
        )
        self.assertNotEqual(value, Decimal("123"))
        self.assertEqual(
            value,
            Decimal("123.45"),
        )

    def test_no_float_type(self):
        for value in (
            amount_utils.parse_chinese_amount("伍角"),
            amount_utils.parse_arabic_amount("¥123.45"),
        ):
            self.assertIsInstance(value, Decimal)


class MalformedNumericTests(unittest.TestCase):

    def test_two_decimal_separators_rejected(self):
        self.assertIsNone(
            amount_utils.parse_arabic_amount("626.400.00")
        )
        self.assertIsNone(
            amount_utils.parse_arabic_amount("¥540.000.00")
        )

    def test_two_decimal_separators_flagged(self):
        self.assertTrue(
            amount_utils.find_malformed_amounts("¥626.400.00元")
        )
        self.assertTrue(
            amount_utils.find_malformed_amounts("¥540.000.00元")
        )

    def test_no_substring_salvage_of_trailing_00(self):
        # Must never salvage "00元" as amount 0.
        amounts = amount_utils.find_money_amounts(
            "¥626.400.00元"
        )
        self.assertEqual(amounts, [])

    def test_valid_comma_thousands(self):
        self.assertEqual(
            amount_utils.parse_arabic_amount("626,400.00"),
            Decimal("626400.00"),
        )
        self.assertEqual(
            amount_utils.parse_arabic_amount("540,000.00"),
            Decimal("540000.00"),
        )
        self.assertEqual(
            amount_utils.find_malformed_amounts("¥626,400.00元"),
            [],
        )

    def test_date_is_not_malformed_money(self):
        self.assertEqual(
            amount_utils.find_malformed_amounts("2026.09.14"),
            [],
        )


class ArabicAmountTests(unittest.TestCase):

    def test_wan_suffix(self):
        self.assertEqual(
            amount_utils.parse_arabic_amount("48万元"),
            Decimal("480000"),
        )

    def test_yen_prefix(self):
        self.assertEqual(
            amount_utils.parse_arabic_amount("¥48万元"),
            Decimal("480000"),
        )

    def test_fullwidth_yen(self):
        self.assertEqual(
            amount_utils.parse_arabic_amount("￥480,000元"),
            Decimal("480000"),
        )

    def test_ninety_six_wan(self):
        self.assertEqual(
            amount_utils.parse_arabic_amount("96万元"),
            Decimal("960000"),
        )

    def test_yuan_suffix(self):
        self.assertEqual(
            amount_utils.parse_arabic_amount("480000元"),
            Decimal("480000"),
        )

    def test_yi_unit(self):
        self.assertEqual(
            amount_utils.parse_arabic_amount("1.2亿元"),
            Decimal("120000000"),
        )

    def test_bare_count_is_not_money(self):
        self.assertIsNone(
            amount_utils.parse_arabic_amount("共2年")
        )

    def test_last_amount_before_binds_nearest(self):
        line = "租赁费¥24万元/年/台（"
        self.assertEqual(
            amount_utils.last_amount_before(line, len(line)),
            Decimal("240000"),
        )

    def test_no_float_drift(self):
        value = amount_utils.parse_arabic_amount("¥8万元")
        self.assertEqual(value, Decimal("80000"))
        self.assertIsInstance(value, Decimal)


if __name__ == "__main__":
    unittest.main()
