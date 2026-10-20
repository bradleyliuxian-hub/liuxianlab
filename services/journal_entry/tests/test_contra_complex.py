import unittest
from decimal import Decimal
from pathlib import Path

from services.journal_entry.contra import (
    AllocationEdge,
    ContraEngine,
    ContraSolution,
    normalize_voucher,
    rank_solutions,
)
from services.journal_entry.normalize import normalize_file
from services.journal_entry.schema import JournalEntry, JournalLine


FIXTURES = Path(__file__).resolve().parent / "fixtures"


def entry(voucher_id, rows):
    lines = []
    for index, (account, debit, credit) in enumerate(rows, start=2):
        lines.append(
            JournalLine(
                voucher_id=voucher_id,
                account_name=account,
                debit=Decimal(str(debit)),
                credit=Decimal(str(credit)),
                sheet_name="S",
                source_row=index,
            )
        )
    return JournalEntry.from_lines(lines)


def edge(debit_id, credit_id, amount):
    return AllocationEdge(
        debit_node_id=debit_id,
        credit_node_id=credit_id,
        amount_minor=int(Decimal(str(amount)) * 100),
    )


def assert_conservation(testcase, journal, result):
    normalized = normalize_voucher(journal)
    for node in normalized.debit_nodes:
        total = sum(
            (
                allocation.amount
                for allocation in result.allocations
                if allocation.source_node_id == node.node_id
            ),
            Decimal("0.00"),
        )
        testcase.assertEqual(total, node.amount)
    for node in normalized.credit_nodes:
        total = sum(
            (
                allocation.amount
                for allocation in result.allocations
                if allocation.target_node_id == node.node_id
            ),
            Decimal("0.00"),
        )
        testcase.assertEqual(total, node.amount)


class ContraComplexTests(unittest.TestCase):
    def test_two_debits_two_credits(self):
        journal = entry(
            "V-2x2",
            [
                ("A", 100, 0),
                ("B", 200, 0),
                ("C", 0, 150),
                ("D", 0, 150),
            ],
        )
        result = ContraEngine().analyze(journal)
        self.assertEqual(result.solution_count, 2)
        self.assertTrue(result.ambiguous)
        self.assertFalse(result.complexity_limited)
        self.assertEqual(len(result.allocations), 3)
        self.assertIsNone(result.confidence)
        self.assertEqual(result.unallocated_debit, ())
        self.assertEqual(result.unallocated_credit, ())
        self.assertEqual(
            [
                (item.source_line_id, item.target_line_id, item.amount)
                for item in result.allocations
            ],
            [
                ("S:2", "S:4", Decimal("100.00")),
                ("S:3", "S:4", Decimal("50.00")),
                ("S:3", "S:5", Decimal("150.00")),
            ],
        )
        assert_conservation(self, journal, result)

    def test_three_debits_four_credits(self):
        journal = entry(
            "V-3x4",
            [
                ("A", 100, 0),
                ("B", 200, 0),
                ("C", 300, 0),
                ("W", 0, 150),
                ("X", 0, 150),
                ("Y", 0, 200),
                ("Z", 0, 100),
            ],
        )
        result = ContraEngine().analyze(journal)
        self.assertGreaterEqual(len(result.allocations), 4)
        self.assertLessEqual(len(result.allocations), 6)
        self.assertEqual(result.unallocated_debit, ())
        self.assertEqual(result.unallocated_credit, ())
        self.assertFalse(result.complexity_limited)
        assert_conservation(self, journal, result)

    def test_equal_two_by_two_prefers_two_edges(self):
        journal = entry(
            "V-equal",
            [
                ("A", 100, 0),
                ("B", 100, 0),
                ("C", 0, 100),
                ("D", 0, 100),
            ],
        )
        result = ContraEngine().analyze(journal)
        self.assertEqual(result.solution_count, 2)
        self.assertEqual(len(result.allocations), 2)
        self.assertEqual(
            {
                (item.source_line_id, item.target_line_id)
                for item in result.allocations
            },
            {("S:2", "S:4"), ("S:3", "S:5")},
        )
        assert_conservation(self, journal, result)

    def test_n_to_m_unique_minimal_is_not_called_confident(self):
        journal = entry(
            "V-2x2-unique-minimal",
            [
                ("A", 100, 0),
                ("B", 200, 0),
                ("C", 0, 100),
                ("D", 0, 200),
            ],
        )
        result = ContraEngine().analyze(journal)
        self.assertEqual(result.solution_count, 1)
        self.assertEqual(len(result.allocations), 2)
        self.assertFalse(result.ambiguous)
        # A unique minimal-edge N:M solution is not proof of global uniqueness.
        self.assertIsNone(result.confidence)

    def test_result_is_deterministic_across_runs(self):
        journal = entry(
            "V-deterministic",
            [
                ("A", 100, 0),
                ("B", 200, 0),
                ("C", 0, 150),
                ("D", 0, 150),
            ],
        )
        engine = ContraEngine()
        first = engine.analyze(journal).to_dict()
        for _ in range(100):
            self.assertEqual(engine.analyze(journal).to_dict(), first)

    def test_ranking_prefers_fewer_edges_then_split(self):
        two_edges = ContraSolution.from_edges(
            (
                edge("d1", "c1", 100),
                edge("d2", "c2", 100),
            )
        )
        three_edges = ContraSolution.from_edges(
            (
                edge("d1", "c1", 100),
                edge("d2", "c1", 50),
                edge("d2", "c2", 50),
            )
        )
        ranked = rank_solutions([three_edges, two_edges])
        self.assertIs(ranked[0], two_edges)
        self.assertIs(ranked[1], three_edges)



class ContraComplexFixtureTests(unittest.TestCase):
    def test_complex_fixture(self):
        normalized = normalize_file(FIXTURES / "journal_contra_complex.xlsx")
        self.assertEqual(len(normalized.entries), 3)
        engine = ContraEngine()
        results = [engine.analyze(item) for item in normalized.entries]

        self.assertEqual(results[0].solution_count, 2)
        self.assertEqual(len(results[0].allocations), 3)
        self.assertEqual(results[0].unallocated_debit, ())
        self.assertEqual(results[0].unallocated_credit, ())

        self.assertGreaterEqual(len(results[1].allocations), 4)
        self.assertEqual(results[1].unallocated_debit, ())
        self.assertEqual(results[1].unallocated_credit, ())

        self.assertEqual(len(results[2].allocations), 2)
        for journal, result in zip(normalized.entries, results):
            assert_conservation(self, journal, result)


if __name__ == "__main__":
    unittest.main()
