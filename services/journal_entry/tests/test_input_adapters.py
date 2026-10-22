import tempfile
import unittest
from decimal import Decimal
from pathlib import Path

from openpyxl import Workbook

from services.journal_entry.contra import ContraEngine, normalize_voucher
from services.journal_entry.errors import ColumnMappingError
from services.journal_entry.mapping import suggest_mapping
from services.journal_entry.normalize import normalize_file, normalize_table
from services.journal_entry.reader import WorkbookReader
from services.journal_entry.tests.fixture_factory import write_workbook
from services.journal_entry.anomaly import analyze_anomalies

FIXTURES = Path(__file__).resolve().parent / "fixtures"


class DirectionAmountAdapterTests(unittest.TestCase):
    def test_auto_detects_direction_amount_layout(self):
        result = normalize_file(FIXTURES / "journal_direction_amount.xlsx")
        self.assertEqual(result.mapping.amount_layout.layout, "direction_amount")
        self.assertEqual(result.mapping.source_column("direction"), "方向")
        self.assertEqual(result.mapping.source_column("amount"), "金额")
        self.assertEqual(result.mapping.source_column("voucher_id"), "凭证号数")
        self.assertEqual(len(result.lines), 8)
        self.assertEqual(len(result.entries), 3)
        self.assertEqual(result.issues, ())

        by_id = {entry.voucher_id: entry for entry in result.entries}
        self.assertEqual(by_id["记-0001"].total_debit, Decimal("100.00"))
        self.assertEqual(by_id["记-0001"].total_credit, Decimal("100.00"))
        self.assertEqual(by_id["记-0002"].total_debit, Decimal("80.00"))
        self.assertEqual(by_id["记-0002"].total_credit, Decimal("80.00"))
        self.assertEqual(by_id["记-0003"].total_debit, Decimal("0.00"))
        self.assertEqual(by_id["记-0003"].total_credit, Decimal("0.00"))
        self.assertTrue(by_id["记-0002"].lines[2].debit == Decimal("-20.00"))
        self.assertTrue(by_id["记-0002"].lines[3].credit == Decimal("-20.00"))
        first_line = by_id["记-0001"].lines[0]
        self.assertEqual(first_line.currency, "CNY")
        self.assertEqual(first_line.original_amount, Decimal("100.00"))
        self.assertEqual(
            {line.source_row for line in result.lines},
            set(range(2, 10)),
        )
        self.assertEqual(
            len({line.internal_line_key for line in result.lines}),
            8,
        )

    def test_duplicate_description_is_ambiguous_by_auto(self):
        reader = WorkbookReader(FIXTURES / "journal_direction_amount.xlsx")
        headers, _rows, _ = reader.read_table("序时账", 1)
        mapping = suggest_mapping(headers)
        self.assertIn("description", mapping.ambiguous)
        candidates = mapping.to_dict()["ambiguous_candidates"]["description"]
        self.assertEqual([candidate["column_index"] for candidate in candidates], [6, 13])
        self.assertEqual([candidate["header"] for candidate in candidates], ["摘要", "摘要"])

    def test_explicit_description_index_6_resolves_duplicate(self):
        result = normalize_file(
            FIXTURES / "journal_direction_amount.xlsx",
            mapping={"description": 6},
        )
        self.assertNotIn("description", result.mapping.ambiguous)
        self.assertEqual(result.mapping.source_index("description", calculate_headers(result)), 5)
        self.assertEqual(result.lines[0].description, "办公费")

    def test_explicit_description_index_13_emits_row_warning(self):
        result = normalize_file(
            FIXTURES / "journal_direction_amount.xlsx",
            mapping={"description": 13},
        )
        self.assertEqual(result.lines[0].description, None)
        self.assertTrue(result.row_warnings)
        self.assertEqual(result.row_warnings[0].code, "EXCEL_ERROR_VALUE_IGNORED")
        self.assertEqual(result.row_warnings[0].column_index, 13)

    def test_invalid_direction_is_row_issue(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = write_workbook(
                Path(tmp) / "invalid-direction.xlsx",
                [
                    ["日期", "凭证号", "科目名称", "方向", "金额"],
                    ["2025-01-01", "V1", "现金", "收", 100],
                    ["2025-01-01", "V1", "收入", "", 0],
                ],
            )
            result = normalize_file(path)
        self.assertEqual(len(result.lines), 1)
        self.assertEqual(len(result.issues), 1)
        self.assertEqual(result.issues[0].code, "invalid_direction")
        self.assertEqual(result.issues[0].field, "direction")
        self.assertEqual(result.lines[0].debit, Decimal("0.00"))

    def test_excel_error_in_amount_is_row_issue(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = write_workbook(
                Path(tmp) / "error-amount.xlsx",
                [
                    ["日期", "凭证号", "科目名称", "方向", "金额"],
                    ["2025-01-01", "V1", "现金", "借", "#NAME?"],
                ],
            )
            result = normalize_file(path)
        self.assertEqual(len(result.lines), 0)
        self.assertEqual(result.issues[0].code, "excel_error_value")
        self.assertEqual(result.issues[0].column_index, 5)

    def test_formula_without_cached_value_is_row_issue(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "formula.xlsx"
            workbook = Workbook()
            sheet = workbook.active
            sheet.title = "S"
            sheet.append(["日期", "凭证号", "科目名称", "方向", "金额"])
            sheet.append(["2025-01-01", "V1", "现金", "借", "=1+1"])
            workbook.save(path)
            workbook.close()
            result = normalize_file(path)
        self.assertEqual(len(result.lines), 0)
        self.assertEqual(result.issues[0].code, "missing_cached_formula_value")
        self.assertEqual(result.issues[0].column_index, 5)


class SignedAmountAdapterTests(unittest.TestCase):
    def test_signed_amount_requires_positive_side(self):
        with self.assertRaises(ColumnMappingError) as context:
            suggest_mapping(
                ["日期", "凭证号", "科目名称", "借正代付"],
                explicit={"signed_amount": "借正代付"},
            )
        self.assertEqual(context.exception.details["reason"], "missing_positive_side")

    def test_signed_amount_positive_debit(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = write_workbook(
                Path(tmp) / "signed.xlsx",
                [
                    ["日期", "凭证号", "科目名称", "借正代付"],
                    ["2025-01-01", "V1", "现金", 100],
                    ["2025-01-01", "V1", "收入", -100],
                ],
            )
            result = normalize_file(
                path,
                mapping={
                    "signed_amount": "借正代付",
                    "positive_side": "debit",
                },
            )
        entry = result.entries[0]
        self.assertEqual(entry.total_debit, Decimal("100.00"))
        self.assertEqual(entry.total_credit, Decimal("100.00"))
        self.assertEqual(entry.lines[0].debit, Decimal("100.00"))
        self.assertEqual(entry.lines[0].credit, Decimal("0.00"))
        self.assertEqual(entry.lines[1].debit, Decimal("0.00"))
        self.assertEqual(entry.lines[1].credit, Decimal("100.00"))

    def test_signed_amount_zero(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = write_workbook(
                Path(tmp) / "signed-zero.xlsx",
                [
                    ["日期", "凭证号", "科目名称", "金额"],
                    ["2025-01-01", "V1", "现金", 0],
                    ["2025-01-01", "V1", "收入", 0],
                ],
            )
            result = normalize_file(
                path,
                mapping={
                    "signed_amount": "金额",
                    "positive_side": "debit",
                },
            )
        entry = result.entries[0]
        self.assertEqual(entry.total_debit, Decimal("0.00"))
        self.assertEqual(entry.total_credit, Decimal("0.00"))
        self.assertEqual(entry.lines[0].debit, Decimal("0.00"))
        self.assertEqual(entry.lines[0].credit, Decimal("0.00"))

    def test_signed_amount_positive_credit(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = write_workbook(
                Path(tmp) / "signed-credit.xlsx",
                [
                    ["日期", "凭证号", "科目名称", "借正代付"],
                    ["2025-01-01", "V1", "现金", 100],
                    ["2025-01-01", "V1", "收入", -100],
                ],
            )
            result = normalize_file(
                path,
                mapping={
                    "signed_amount": "借正代付",
                    "positive_side": "credit",
                },
            )
        entry = result.entries[0]
        self.assertEqual(entry.lines[0].credit, Decimal("100.00"))
        self.assertEqual(entry.lines[1].debit, Decimal("100.00"))


class DuplicateLineIdIdentityTests(unittest.TestCase):
    def test_duplicate_external_line_id_keeps_distinct_internal_keys(self):
        result = normalize_file(FIXTURES / "journal_duplicate_line_id.xlsx")
        self.assertEqual(len(result.entries), 2)
        self.assertEqual(len(result.lines), 4)

        by_voucher = {entry.voucher_id: entry for entry in result.entries}
        for voucher_id in ("SA-001", "SA-002"):
            entry = by_voucher[voucher_id]
            self.assertEqual(len(entry.lines), 2)
            self.assertEqual([line.line_id for line in entry.lines], ["001", "001"])
            internal_keys = [line.internal_line_key for line in entry.lines]
            self.assertEqual(len(set(internal_keys)), 2)
            serialized = entry.to_dict()["lines"]
            self.assertEqual(
                {line["internal_line_key"] for line in serialized},
                set(internal_keys),
            )

        allocation = ContraEngine().analyze(by_voucher["SA-001"])
        self.assertGreaterEqual(len(allocation.allocations), 1)
        for item in allocation.allocations:
            self.assertEqual(item.source_line_id, "001")
            self.assertEqual(item.target_line_id, "001")
            self.assertNotEqual(
                item.source_internal_key,
                item.target_internal_key,
            )


class CompatibilityAndLargeInputTests(unittest.TestCase):
    def test_debit_credit_layout_still_works(self):
        result = normalize_file(FIXTURES / "journal_basic.xlsx")
        self.assertEqual(result.mapping.amount_layout.layout, "debit_credit")
        self.assertEqual(len(result.entries), 3)

    def test_large_single_voucher_is_not_rejected(self):
        headers = ["日期", "凭证号", "科目名称", "方向", "金额"]
        rows = []
        for index in range(159):
            rows.append(["2025-01-01", "BIG", "D%03d" % index, "借", 1])
        for index in range(159):
            rows.append(["2025-01-01", "BIG", "C%03d" % index, "贷", 1])
        mapping = suggest_mapping(headers)
        result = normalize_table(
            sheet_name="S",
            header_row=1,
            headers=headers,
            rows=rows,
            mapping=mapping,
        )
        self.assertEqual(len(result.entries), 1)
        self.assertEqual(len(result.entries[0].lines), 318)
        self.assertEqual(result.entries[0].total_debit, Decimal("159.00"))
        self.assertEqual(result.entries[0].total_credit, Decimal("159.00"))
        self.assertEqual(
            len({line.internal_line_key for line in result.lines}),
            318,
        )

    def test_end_to_end_core_pipeline(self):
        normalized = normalize_file(FIXTURES / "journal_direction_amount.xlsx")
        contra = [ContraEngine().analyze(entry) for entry in normalized.entries]
        self.assertEqual(len(contra), 3)
        entries_by_id = {entry.voucher_id: entry for entry in normalized.entries}
        for result in contra:
            entry = entries_by_id[result.voucher_id]
            accounted = (
                sum((item.amount for item in result.allocations), Decimal("0.00"))
                + sum((item.amount for item in result.unallocated_debit), Decimal("0.00"))
                + sum((item.amount for item in result.unallocated_credit), Decimal("0.00"))
            )
            self.assertEqual(accounted, normalize_voucher(entry).total_debit)

        anomaly = analyze_anomalies(normalized.entries)
        self.assertEqual(len(anomaly.scores), 3)
        self.assertEqual(len(anomaly.findings), 0)

    def test_10000_direction_lines_normalize(self):
        headers = ["日期", "凭证号", "科目名称", "方向", "金额"]
        rows = []
        for index in range(5000):
            voucher = "P%05d" % index
            rows.append(["2025-01-01", voucher, "费用", "借", 100])
            rows.append(["2025-01-01", voucher, "银行", "贷", 100])
        mapping = suggest_mapping(headers)
        result = normalize_table(
            sheet_name="S",
            header_row=1,
            headers=headers,
            rows=rows,
            mapping=mapping,
        )
        self.assertEqual(len(result.lines), 10000)
        self.assertEqual(len(result.entries), 5000)


def calculate_headers(result):
    reader = WorkbookReader(FIXTURES / "journal_direction_amount.xlsx")
    headers, _rows, _ = reader.read_table("序时账", result.header_row)
    return headers


if __name__ == "__main__":
    unittest.main()
