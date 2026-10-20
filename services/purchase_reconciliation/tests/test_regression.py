from __future__ import annotations

import os
import unittest
from decimal import Decimal
from pathlib import Path

from services.purchase_reconciliation.column_mapper import build_records, resolve_mapping
from services.purchase_reconciliation.engine import reconcile
from services.purchase_reconciliation.excel_reader import inspect_workbook, read_rows


FIXTURE = os.environ.get("PURCHASE_RECONCILIATION_FIXTURE", "")


class SapRegressionTest(unittest.TestCase):
    """Regression against the real SAP export when it is available locally.

    The workbook is not committed (it contains real vendor data). Point
    PURCHASE_RECONCILIATION_FIXTURE at it to enable this test.
    """

    @unittest.skipUnless(FIXTURE and Path(FIXTURE).exists(), "PURCHASE_RECONCILIATION_FIXTURE not set")
    def test_reference_numbers(self):
        inspection = inspect_workbook(FIXTURE)
        self.assertEqual(inspection["data_row_count"], 34297)
        headers, rows, _sheet = read_rows(FIXTURE, header_row=inspection["header_row"])
        mapping = resolve_mapping(headers)
        self.assertEqual(mapping["missing"], [])
        records, warnings = build_records(headers, rows, mapping["mapping"])
        self.assertEqual(warnings, [])
        result = reconcile(records, headers=headers)
        expected = {
            "original_record_count": 34297,
            "match_segment_count": 634,
            "matched_record_count": 948,
            "remaining_record_count": 33501,
            "original_positive_amount": Decimal("585797117.31"),
            "original_negative_amount_abs": Decimal("14931444.40"),
            "matched_amount": Decimal("14913418.90"),
            "unmatched_negative_amount_abs": Decimal("18025.50"),
            "final_net_amount": Decimal("570865672.91"),
            "conservation_difference": Decimal("0.00"),
        }
        for key, value in expected.items():
            self.assertEqual(result.metrics[key], value, key)
        self.assertTrue(result.metrics["conservation_ok"])


if __name__ == "__main__":
    unittest.main()
