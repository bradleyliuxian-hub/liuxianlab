import unittest
from decimal import Decimal

from services.journal_entry.schema import JournalEntry, JournalLine
from services.journal_entry.anomaly import analyze_anomalies


def synthetic_entry(index):
    amount = Decimal(100 + (index % 100))
    voucher = "V%05d" % index
    return JournalEntry.from_lines(
        [
            JournalLine(
                voucher_id=voucher,
                account_code="6602",
                account_name="管理费用",
                debit=amount,
                period="2026-01",
                entity="E",
                sheet_name="S",
                source_row=2,
            ),
            JournalLine(
                voucher_id=voucher,
                account_code="1002",
                account_name="银行存款",
                credit=amount,
                period="2026-01",
                entity="E",
                sheet_name="S",
                source_row=3,
            ),
        ]
    )


class PerformanceTests(unittest.TestCase):
    def test_5000_vouchers_complete_without_quadratic_scan(self):
        entries = [synthetic_entry(index) for index in range(5000)]
        result = analyze_anomalies(entries)
        self.assertEqual(len(result.scores), 5000)
        self.assertLess(len(result.findings), len(entries))
        self.assertLess(
            max(score.risk_score for score in result.scores),
            Decimal("100"),
        )


if __name__ == "__main__":
    unittest.main()
