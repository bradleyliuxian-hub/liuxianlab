import unittest
from decimal import Decimal
from pathlib import Path

from services.journal_entry.contra import (
    ContraEngine,
    SolverConfig,
    normalize_voucher,
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


def normalized_nodes(**kwargs):
    journal = JournalEntry.from_lines([JournalLine(**kwargs)])
    return normalize_voucher(journal)


class GrossPreservationTests(unittest.TestCase):
    def test_both_side_net_debit_preserves_gross_amounts(self):
        normalized = normalized_nodes(
            voucher_id="V",
            account_name="A",
            debit=Decimal("100"),
            credit=Decimal("40"),
            sheet_name="S",
            source_row=2,
        )
        self.assertEqual(len(normalized.debit_nodes), 1)
        node = normalized.debit_nodes[0]
        self.assertEqual(node.economic_side, "debit")
        self.assertEqual(node.amount, Decimal("60.00"))
        self.assertEqual(node.original_debit, Decimal("100.00"))
        self.assertEqual(node.original_credit, Decimal("40.00"))
        self.assertTrue(node.converted)
        self.assertIn("both_sides_netted", normalized.warnings)
        payload = node.to_dict()
        self.assertEqual(payload["original_debit"], "100.00")
        self.assertEqual(payload["original_credit"], "40.00")
        self.assertEqual(payload["internal_line_key"], "1:S:2")

    def test_both_side_net_credit_preserves_gross_amounts(self):
        normalized = normalized_nodes(
            voucher_id="V",
            account_name="A",
            debit=Decimal("40"),
            credit=Decimal("100"),
            sheet_name="S",
            source_row=2,
        )
        self.assertEqual(len(normalized.credit_nodes), 1)
        node = normalized.credit_nodes[0]
        self.assertEqual(node.economic_side, "credit")
        self.assertEqual(node.amount, Decimal("60.00"))
        self.assertEqual(node.original_debit, Decimal("40.00"))
        self.assertEqual(node.original_credit, Decimal("100.00"))
        self.assertTrue(node.converted)

    def test_both_side_equal_amounts_produce_no_node(self):
        normalized = normalized_nodes(
            voucher_id="V",
            account_name="A",
            debit=Decimal("100"),
            credit=Decimal("100"),
            sheet_name="S",
            source_row=2,
        )
        self.assertEqual(normalized.node_count, 0)
        self.assertIn("both_sides_netted", normalized.warnings)
        self.assertIn("zero_line_skipped", normalized.warnings)

    def test_negative_gross_amounts_are_preserved(self):
        normalized = normalized_nodes(
            voucher_id="V",
            account_name="A",
            debit=Decimal("-100"),
            credit=Decimal("40"),
            sheet_name="S",
            source_row=2,
        )
        self.assertEqual(len(normalized.credit_nodes), 1)
        node = normalized.credit_nodes[0]
        self.assertEqual(node.amount, Decimal("140.00"))
        self.assertEqual(node.original_debit, Decimal("-100.00"))
        self.assertEqual(node.original_credit, Decimal("40.00"))
        self.assertTrue(node.converted)
        self.assertIn("negative_amount_normalized", normalized.warnings)

    def test_negative_credit_gross_amounts_are_preserved(self):
        normalized = normalized_nodes(
            voucher_id="V",
            account_name="A",
            debit=Decimal("100"),
            credit=Decimal("-40"),
            sheet_name="S",
            source_row=2,
        )
        self.assertEqual(len(normalized.debit_nodes), 1)
        node = normalized.debit_nodes[0]
        self.assertEqual(node.amount, Decimal("140.00"))
        self.assertEqual(node.original_debit, Decimal("100.00"))
        self.assertEqual(node.original_credit, Decimal("-40.00"))
        self.assertTrue(node.converted)


class NegativeAndZeroTests(unittest.TestCase):
    def test_negative_debit_and_credit_become_economic_sides(self):
        journal = entry(
            "V-neg",
            [
                ("红字现金", -100, 0),
                ("红字收入", 0, -100),
            ],
        )
        result = ContraEngine().analyze(journal)
        self.assertEqual(result.method, "normalized")
        self.assertEqual(len(result.allocations), 1)
        self.assertEqual(result.allocations[0].amount, Decimal("100.00"))
        self.assertEqual(result.unallocated_debit, ())
        self.assertEqual(result.unallocated_credit, ())
        self.assertIn("negative_amount_normalized", result.warnings)
        self.assertEqual(result.confidence, Decimal("1.00"))

    def test_zero_line_is_ignored_but_reported(self):
        journal = entry(
            "V-zero",
            [
                ("现金", 100, 0),
                ("收入", 0, 100),
                ("零行", 0, 0),
            ],
        )
        result = ContraEngine().analyze(journal)
        self.assertEqual(result.node_count, 2)
        self.assertEqual(len(result.allocations), 1)
        self.assertIn("zero_line_skipped", result.warnings)

    def test_same_account_on_both_sides_is_supported_with_warning(self):
        journal = entry(
            "V-same",
            [
                ("内部往来", 100, 0),
                ("内部往来", 0, 100),
            ],
        )
        engine = ContraEngine()
        result = engine.analyze(journal)
        self.assertEqual(len(result.allocations), 1)
        self.assertIn("same_account_on_both_sides", result.warnings)
        self.assertEqual(result.confidence, Decimal("1.00"))
        self.assertEqual(
            engine.analyze(journal).to_dict(),
            result.to_dict(),
        )

    def test_duplicate_identical_lines(self):
        journal = entry(
            "V-duplicate",
            [
                ("A", 100, 0),
                ("A", 100, 0),
                ("B", 0, 100),
                ("B", 0, 100),
            ],
        )
        result = ContraEngine().analyze(journal)
        self.assertEqual(result.solution_count, 2)
        self.assertTrue(result.ambiguous)
        self.assertEqual(len(result.allocations), 2)
        self.assertEqual(result.unallocated_debit, ())
        self.assertEqual(result.unallocated_credit, ())

    def test_duplicate_external_line_id_does_not_collapse_rows(self):
        journal = JournalEntry.from_lines(
            [
                JournalLine(
                    voucher_id="V-identity",
                    line_id="SAME",
                    account_name="D1",
                    debit=Decimal("100"),
                    sheet_name="S",
                    source_row=10,
                ),
                JournalLine(
                    voucher_id="V-identity",
                    line_id="SAME",
                    account_name="D2",
                    debit=Decimal("100"),
                    sheet_name="S",
                    source_row=11,
                ),
                JournalLine(
                    voucher_id="V-identity",
                    line_id="C1",
                    account_name="C1",
                    credit=Decimal("100"),
                    sheet_name="S",
                    source_row=12,
                ),
                JournalLine(
                    voucher_id="V-identity",
                    line_id="C2",
                    account_name="C2",
                    credit=Decimal("100"),
                    sheet_name="S",
                    source_row=13,
                ),
            ]
        )
        normalized = normalize_voucher(journal)
        result = ContraEngine().analyze(journal)

        self.assertEqual(len(journal.lines), 4)
        self.assertEqual(
            {line.internal_line_key for line in journal.lines},
            {"1:S:10", "1:S:11", "1:S:12", "1:S:13"},
        )
        self.assertEqual(
            {node.node_id for node in normalized.debit_nodes},
            {"1:S:10:debit", "1:S:11:debit"},
        )
        self.assertEqual(len(result.allocations), 2)
        self.assertEqual(
            {item.source_internal_key for item in result.allocations},
            {"1:S:10", "1:S:11"},
        )
        self.assertEqual(
            {item.source_line_id for item in result.allocations},
            {"SAME"},
        )
        self.assertEqual(
            {item.target_internal_key for item in result.allocations},
            {"1:S:12", "1:S:13"},
        )
        serialized = result.to_dict()["allocations"]
        self.assertEqual(
            {item["source_internal_key"] for item in serialized},
            {"1:S:10", "1:S:11"},
        )
        self.assertEqual(result.solution_count, 2)
        self.assertTrue(result.ambiguous)
        self.assertIsNone(result.confidence)

        debit_total = {}
        credit_total = {}
        for item in result.allocations:
            debit_total[item.source_internal_key] = (
                debit_total.get(item.source_internal_key, Decimal("0"))
                + item.amount
            )
            credit_total[item.target_internal_key] = (
                credit_total.get(item.target_internal_key, Decimal("0"))
                + item.amount
            )
        self.assertEqual(debit_total, {"1:S:10": Decimal("100.00"), "1:S:11": Decimal("100.00")})
        self.assertEqual(credit_total, {"1:S:12": Decimal("100.00"), "1:S:13": Decimal("100.00")})


class BalanceAndLimitTests(unittest.TestCase):
    def test_one_cent_rounding_residual_is_reported(self):
        journal = entry(
            "V-cent",
            [
                ("现金", 100, 0),
                ("收入", 0, 99.99),
            ],
        )
        result = ContraEngine().analyze(journal)
        self.assertEqual(result.allocations[0].amount, Decimal("99.99"))
        self.assertEqual(len(result.unallocated_debit), 1)
        self.assertEqual(result.unallocated_debit[0].amount, Decimal("0.01"))
        self.assertEqual(result.unallocated_debit[0].internal_line_key, "1:S:2")
        self.assertEqual(
            result.unallocated_debit[0].to_dict()["internal_line_key"],
            "1:S:2",
        )
        self.assertIn("rounding_residual", result.warnings)
        self.assertIn("unbalanced_voucher", result.warnings)
        self.assertIn("partially_unallocated", result.warnings)
        self.assertIsNone(result.confidence)

    def test_unbalanced_voucher_returns_partial_result(self):
        journal = entry(
            "V-unbalanced",
            [
                ("现金", 100, 0),
                ("收入", 0, 80),
            ],
        )
        result = ContraEngine().analyze(journal)
        self.assertEqual(result.allocations[0].amount, Decimal("80.00"))
        self.assertEqual(result.unallocated_debit[0].amount, Decimal("20.00"))
        self.assertEqual(result.unallocated_debit[0].internal_line_key, "1:S:2")
        self.assertIn("unbalanced_voucher", result.warnings)
        self.assertIn("partially_unallocated", result.warnings)
        self.assertFalse(result.complexity_limited)

    def test_node_limit_returns_complexity_limited(self):
        rows = []
        for index in range(6):
            rows.append(("D%d" % index, 10, 0))
        for index in range(6):
            rows.append(("C%d" % index, 0, 10))
        journal = entry("V-limit", rows)
        result = ContraEngine(
            SolverConfig(max_nodes=10)
        ).analyze(journal)
        self.assertTrue(result.complexity_limited)
        self.assertEqual(result.allocations, ())
        self.assertIn("node_limit_reached", result.warnings)
        self.assertIn("complexity_limit_reached", result.warnings)

    def test_search_state_limit_is_reported(self):
        journal = entry(
            "V-search-limit",
            [
                ("A", 100, 0),
                ("B", 200, 0),
                ("C", 0, 150),
                ("D", 0, 150),
            ],
        )
        result = ContraEngine(
            SolverConfig(max_search_states=5)
        ).analyze(journal)
        self.assertTrue(result.complexity_limited)
        self.assertIn("search_state_limit_reached", result.warnings)

    def test_solution_limit_is_reported(self):
        journal = entry(
            "V-sol-limit",
            [
                ("A", 100, 0),
                ("B", 100, 0),
                ("C", 0, 100),
                ("D", 0, 100),
            ],
        )
        result = ContraEngine(
            SolverConfig(max_solutions=1)
        ).analyze(journal)
        self.assertTrue(result.solution_limit_reached)
        self.assertEqual(result.solution_count, 1)
        self.assertIsNone(result.confidence)
        self.assertIn("solution_limit_reached", result.warnings)

    def test_no_credit_nodes_leaves_debit_unallocated(self):
        journal = entry("V-no-credit", [("现金", 100, 0)])
        result = ContraEngine().analyze(journal)
        self.assertEqual(result.allocations, ())
        self.assertEqual(len(result.unallocated_debit), 1)
        self.assertEqual(result.unallocated_debit[0].amount, Decimal("100.00"))

    def test_no_debit_nodes_leaves_credit_unallocated(self):
        journal = entry("V-no-debit", [("收入", 0, 100)])
        result = ContraEngine().analyze(journal)
        self.assertEqual(result.allocations, ())
        self.assertEqual(len(result.unallocated_credit), 1)
        self.assertEqual(result.unallocated_credit[0].amount, Decimal("100.00"))



class NegativeFixtureTests(unittest.TestCase):
    def test_negative_fixture(self):
        normalized = normalize_file(FIXTURES / "journal_negative.xlsx")
        self.assertEqual(len(normalized.entries), 2)
        engine = ContraEngine()
        first = engine.analyze(normalized.entries[0])
        second = engine.analyze(normalized.entries[1])
        self.assertEqual(first.method, "normalized")
        self.assertEqual(len(first.allocations), 1)
        self.assertEqual(first.unallocated_debit, ())
        self.assertEqual(first.unallocated_credit, ())
        self.assertEqual(
            sum((item.amount for item in second.unallocated_credit), Decimal("0.00")),
            Decimal("200.00"),
        )


if __name__ == "__main__":
    unittest.main()
