import json
import tempfile
import unittest
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path

from services.journal_entry.contra import ContraEngine
from services.journal_entry.errors import NormalizationError
from services.journal_entry.mapping import suggest_mapping
from services.journal_entry.normalize import (
    normalize_file,
    normalize_table,
    parse_amount,
    parse_date,
)
from services.journal_entry.tests.fixture_factory import (
    BASIC_HEADERS,
    write_workbook,
)

FIXTURES = Path(__file__).resolve().parent / "fixtures"


class AmountParsingTests(unittest.TestCase):
    def test_supported_amount_forms(self):
        cases = {
            100: Decimal("100.00"),
            100.00: Decimal("100.00"),
            "100.00": Decimal("100.00"),
            "1,000.00": Decimal("1000.00"),
            "(1,000.00)": Decimal("-1000.00"),
            -100: Decimal("-100.00"),
            "￥1,000.00": Decimal("1000.00"),
            "USD 1,000.00": Decimal("1000.00"),
            "1,000.00-": Decimal("-1000.00"),
        }
        for raw, expected in cases.items():
            with self.subTest(raw=raw):
                self.assertEqual(parse_amount(raw).value, expected)

    def test_empty_zero_negative_states(self):
        self.assertEqual(parse_amount(None).state, "empty")
        self.assertEqual(parse_amount("").state, "empty")
        self.assertEqual(parse_amount("-").state, "empty")
        self.assertEqual(parse_amount("0.00").state, "zero")
        self.assertEqual(parse_amount("100").state, "positive")
        self.assertEqual(parse_amount("-100").state, "negative")

    def test_invalid_amount_is_not_coerced(self):
        for raw in ("ABC", "1.2.3", True):
            with self.subTest(raw=raw):
                with self.assertRaises(NormalizationError):
                    parse_amount(raw)

    def test_float_is_immediately_converted(self):
        parsed = parse_amount(0.1)
        self.assertEqual(parsed.value, Decimal("0.10"))
        self.assertIsInstance(parsed.value, Decimal)


class DateParsingTests(unittest.TestCase):
    def test_supported_dates(self):
        self.assertEqual(parse_date(date(2026, 1, 2)), date(2026, 1, 2))
        self.assertEqual(parse_date(datetime(2026, 1, 2, 9, 30)), date(2026, 1, 2))
        for raw in ("2026-01-02", "2026/01/02", "2026.01.02", "20260102", "2026年1月2日"):
            with self.subTest(raw=raw):
                self.assertEqual(parse_date(raw), date(2026, 1, 2))

    def test_blank_date_is_none(self):
        self.assertIsNone(parse_date(None))
        self.assertIsNone(parse_date(""))

    def test_invalid_date_is_structured(self):
        with self.assertRaises(NormalizationError):
            parse_date("2026-13-40")


class FileNormalizationTests(unittest.TestCase):
    def test_basic_fixture_reconstructs_three_vouchers(self):
        result = normalize_file(FIXTURES / "journal_basic.xlsx")
        self.assertEqual(result.header_row, 1)
        self.assertEqual(len(result.lines), 6)
        self.assertEqual(len(result.entries), 3)
        self.assertEqual(result.issues, ())
        self.assertEqual(
            [entry.voucher_id for entry in result.entries],
            ["记-001", "记-002", "记-001"],
        )
        self.assertEqual(
            [entry.period for entry in result.entries],
            ["2026-01", "2026-01", "2026-02"],
        )
        self.assertTrue(all(entry.is_balanced for entry in result.entries))

    def test_duplicate_voucher_id_is_split_by_period(self):
        result = normalize_file(FIXTURES / "journal_duplicate_voucher.xlsx")
        self.assertEqual(len(result.entries), 2)
        self.assertEqual(
            [len(entry.lines) for entry in result.entries],
            [4, 2],
        )
        self.assertEqual(
            [entry.voucher_id for entry in result.entries],
            ["记-001", "记-001"],
        )

    def test_header_offset_is_detected(self):
        result = normalize_file(FIXTURES / "journal_headers_offset.xlsx")
        self.assertEqual(result.header_row, 4)
        self.assertEqual(len(result.entries), 1)
        self.assertEqual(result.entries[0].voucher_id, "记-101")
        self.assertEqual(result.entries[0].total_debit, Decimal("300.00"))

    def test_unbalanced_vouchers_are_flagged_not_blocked(self):
        result = normalize_file(FIXTURES / "journal_unbalanced.xlsx")
        self.assertEqual(len(result.entries), 2)
        by_id = {entry.voucher_id: entry for entry in result.entries}
        self.assertFalse(by_id["记-201"].is_balanced)
        self.assertFalse(by_id["记-201"].exactly_balanced)
        self.assertTrue(by_id["记-201"].is_within_tolerance)
        self.assertIn("unbalanced", by_id["记-201"].validation_flags)
        self.assertIn("within_tolerance", by_id["记-201"].validation_flags)
        self.assertIn("rounding_residual", by_id["记-201"].validation_flags)
        self.assertFalse(by_id["记-202"].is_balanced)
        self.assertFalse(by_id["记-202"].is_within_tolerance)
        self.assertIn("unbalanced", by_id["记-202"].validation_flags)

    def test_negative_amounts_survive_normalization(self):
        result = normalize_file(FIXTURES / "journal_negative.xlsx")
        self.assertEqual(len(result.entries), 2)
        first = result.entries[0]
        self.assertEqual(first.lines[0].debit, Decimal("-100.00"))
        self.assertEqual(first.lines[1].credit, Decimal("-100.00"))

    def test_invalid_amount_row_becomes_issue(self):
        headers = list(BASIC_HEADERS)
        rows = [
            headers,
            [date(2026, 1, 1), "2026-01", "记-901", "1001", "库存现金", "", "ABC", 0, "bad", "", "CNY"],
            [date(2026, 1, 1), "2026-01", "记-901", "6001", "收入", "", 0, 100, "good", "", "CNY"],
        ]
        with tempfile.TemporaryDirectory() as tmp:
            path = write_workbook(Path(tmp) / "bad.xlsx", rows)
            result = normalize_file(path)
        self.assertEqual(len(result.issues), 1)
        self.assertEqual(result.issues[0].field, "debit")
        self.assertEqual(len(result.entries), 1)
        self.assertEqual(len(result.entries[0].lines), 1)

    def test_invalid_date_row_becomes_issue(self):
        headers = ["日期", "凭证号", "科目名称", "借方金额", "贷方金额"]
        rows = [
            headers,
            ["not-a-date", "记-902", "库存现金", 100, 0],
            [date(2026, 1, 1), "记-902", "收入", 0, 100],
        ]
        with tempfile.TemporaryDirectory() as tmp:
            path = write_workbook(Path(tmp) / "bad-date.xlsx", rows)
            result = normalize_file(path)
        self.assertEqual(len(result.issues), 1)
        self.assertEqual(result.issues[0].field, "date")

    def test_explicit_mapping_is_accepted(self):
        headers = ["日期", "凭证号", "科目名称", "借方金额", "贷方金额"]
        rows = [
            headers,
            [date(2026, 1, 1), "记-903", "库存现金", 10, 0],
            [date(2026, 1, 1), "记-903", "收入", 0, 10],
        ]
        mapping = suggest_mapping(
            headers,
            explicit={
                "voucher_id": "凭证号",
                "account_name": "科目名称",
                "debit": "借方金额",
                "credit": "贷方金额",
            },
        )
        with tempfile.TemporaryDirectory() as tmp:
            path = write_workbook(Path(tmp) / "explicit.xlsx", rows)
            result = normalize_file(path, mapping=mapping)
        self.assertEqual(len(result.entries), 1)
        self.assertEqual(result.entries[0].voucher_id, "记-903")

    def test_same_period_same_voucher_different_dates_is_one_entry(self):
        headers = ["日期", "期间", "凭证号", "科目名称", "借方金额", "贷方金额"]
        mapping = suggest_mapping(headers)
        rows = [
            [date(2026, 1, 1), "2026-01", "记-777", "现金", 100, 0],
            [date(2026, 1, 2), "2026-01", "记-777", "收入", 0, 100],
        ]
        result = normalize_table(
            sheet_name="S",
            header_row=1,
            headers=headers,
            rows=rows,
            mapping=mapping,
        )
        self.assertEqual(len(result.entries), 1)
        self.assertEqual(result.entries[0].voucher_id, "记-777")
        self.assertIn("mixed_dates", result.entries[0].validation_flags)

    def test_explicit_header_row_is_respected(self):
        result = normalize_file(
            FIXTURES / "journal_headers_offset.xlsx",
            header_row=4,
            mapping={
                "voucher_id": "凭证号",
                "account_name": "科目名称",
                "debit": "借方金额",
                "credit": "贷方金额",
            },
        )
        self.assertEqual(result.header_row, 4)
        self.assertEqual(len(result.entries), 1)
        self.assertEqual(result.entries[0].voucher_id, "记-101")

    def test_golden_basic_fixture_is_stable(self):
        expected_path = FIXTURES / "expected_basic.json"
        expected = json.loads(expected_path.read_text(encoding="utf-8"))
        result = normalize_file(FIXTURES / "journal_basic.xlsx")
        engine = ContraEngine()

        contra = []
        for entry in result.entries:
            payload = engine.analyze(entry).to_dict()
            payload.pop("states_explored", None)
            contra.append(payload)

        self.assertEqual(
            [entry.to_dict() for entry in result.entries],
            expected["entries"],
        )
        expected_contra = []
        for item in expected["contra"]:
            item = dict(item)
            item.pop("states_explored", None)
            expected_contra.append(item)
        self.assertEqual(contra, expected_contra)
        self.assertEqual(result.header_row, expected["header_row"])
        self.assertEqual(result.mapping.to_dict(), expected["mapping"])

    def test_normalize_table_skips_blank_rows(self):
        headers = ["凭证号", "科目名称", "借方金额", "贷方金额"]
        mapping = suggest_mapping(headers)
        rows = [
            ["记-904", "现金", 100, 0],
            [None, None, None, None],
            ["记-904", "收入", 0, 100],
        ]
        result = normalize_table(
            sheet_name="S",
            header_row=1,
            headers=headers,
            rows=rows,
            mapping=mapping,
        )
        self.assertEqual(len(result.lines), 2)
        self.assertEqual(len(result.entries), 1)


if __name__ == "__main__":
    unittest.main()
