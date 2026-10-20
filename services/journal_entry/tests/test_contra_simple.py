import unittest
from decimal import Decimal
from pathlib import Path

from services.journal_entry.contra import ContraEngine, normalize_voucher
from services.journal_entry.normalize import normalize_file
from services.journal_entry.schema import JournalEntry, JournalLine


def entry(voucher_id, rows):
    lines = []
    for index, (account, debit, credit) in enumerate(rows, start=2):
        lines.append(
            JournalLine(
                voucher_id=voucher_id,
                account_name=account,
                debit=Decimal(str(debit)),
                credit=Decimal(str(credit)),
                sheet_name="序时账",
                source_row=index,
            )
        )
    return JournalEntry.from_lines(lines)


FIXTURES = Path(__file__).resolve().parent / "fixtures"


def allocated(result, node_id):
    return sum(
        (
            allocation.amount
            for allocation in result.allocations
            if allocation.source_node_id == node_id
        ),
        Decimal("0.00"),
    )


class ContraSimpleTests(unittest.TestCase):
    def assert_conservation(self, journal, result):
        normalized = normalize_voucher(journal)
        for node in normalized.debit_nodes:
            self.assertEqual(allocated(result, node.node_id), node.amount)
        for node in normalized.credit_nodes:
            total = sum(
                (
                    allocation.amount
                    for allocation in result.allocations
                    if allocation.target_node_id == node.node_id
                ),
                Decimal("0.00"),
            )
            self.assertEqual(total, node.amount)

    def test_one_debit_one_credit_is_direct(self):
        journal = entry("V-1", [("现金", 100, 0), ("收入", 0, 100)])
        result = ContraEngine().analyze(journal)
        self.assertEqual(result.method, "direct")
        self.assertEqual(result.solution_count, 1)
        self.assertEqual(result.confidence, Decimal("1.00"))
        self.assertEqual(len(result.allocations), 1)
        self.assertEqual(result.allocations[0].amount, Decimal("100.00"))
        self.assertEqual(result.unallocated_debit, ())
        self.assertEqual(result.unallocated_credit, ())
        self.assert_conservation(journal, result)

    def test_one_debit_three_credits(self):
        journal = entry(
            "V-2",
            [
                ("现金", 300, 0),
                ("收入A", 0, 100),
                ("收入B", 0, 100),
                ("收入C", 0, 100),
            ],
        )
        result = ContraEngine().analyze(journal)
        self.assertEqual(result.method, "exhaustive")
        self.assertEqual(len(result.allocations), 3)
        self.assertFalse(result.ambiguous)
        self.assertEqual(result.confidence, Decimal("1.00"))
        self.assertEqual(result.unallocated_debit, ())
        self.assertEqual(result.unallocated_credit, ())
        self.assert_conservation(journal, result)

    def test_three_debits_one_credit(self):
        journal = entry(
            "V-3",
            [
                ("现金A", 100, 0),
                ("现金B", 100, 0),
                ("现金C", 100, 0),
                ("收入", 0, 300),
            ],
        )
        result = ContraEngine().analyze(journal)
        self.assertEqual(len(result.allocations), 3)
        self.assertEqual(result.confidence, Decimal("1.00"))
        self.assertEqual(result.unallocated_debit, ())
        self.assertEqual(result.unallocated_credit, ())
        self.assert_conservation(journal, result)

    def test_decimal_amounts_do_not_use_float_rounding(self):
        journal = entry(
            "V-4",
            [("现金", "0.10", 0), ("收入", 0, "0.10")],
        )
        result = ContraEngine().analyze(journal)
        self.assertEqual(result.allocations[0].amount, Decimal("0.10"))
        self.assertEqual(result.confidence, Decimal("1.00"))



class ContraSimpleFixtureTests(unittest.TestCase):
    def test_simple_fixture(self):
        normalized = normalize_file(FIXTURES / "journal_contra_simple.xlsx")
        self.assertEqual(len(normalized.entries), 3)
        engine = ContraEngine()
        for journal in normalized.entries:
            result = engine.analyze(journal)
            self.assertEqual(result.unallocated_debit, ())
            self.assertEqual(result.unallocated_credit, ())
            self.assertEqual(
                sum(
                    (item.amount for item in result.allocations),
                    Decimal("0.00"),
                ),
                journal.total_debit,
            )


if __name__ == "__main__":
    unittest.main()
