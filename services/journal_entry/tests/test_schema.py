import unittest
from datetime import date
from decimal import Decimal

from services.journal_entry.errors import JournalEntryError
from services.journal_entry.schema import (
    AMOUNT_TOLERANCE,
    JournalEntry,
    JournalLine,
    amount_to_string,
    make_voucher_key,
    quantize_amount,
)


def line(**overrides):
    values = {
        "voucher_id": "记-001",
        "account_name": "库存现金",
        "debit": Decimal("100.00"),
        "sheet_name": "序时账",
        "source_row": 2,
    }
    values.update(overrides)
    return JournalLine(**values)


class JournalLineTests(unittest.TestCase):
    def test_line_derives_stable_id_and_account_key(self):
        item = line(account_code="1001", account_name="库存现金")
        self.assertEqual(item.line_id, "序时账:2")
        self.assertEqual(item.internal_line_key, "3:序时账:2")
        self.assertEqual(item.account_key, "1001")
        self.assertEqual(item.account_label, "1001 库存现金")

    def test_line_requires_voucher_account_sheet_and_row(self):
        with self.assertRaises(JournalEntryError):
            line(voucher_id="")
        with self.assertRaises(JournalEntryError):
            line(account_name="", account_code="")
        with self.assertRaises(JournalEntryError):
            line(sheet_name="")
        with self.assertRaises(JournalEntryError):
            line(source_row=0)

    def test_float_is_converted_to_decimal_and_quantized(self):
        item = line(debit=0.1, credit=None)
        self.assertIsInstance(item.debit, Decimal)
        self.assertEqual(item.debit, Decimal("0.10"))
        self.assertEqual(item.credit, Decimal("0.00"))

    def test_boolean_is_not_an_amount(self):
        with self.assertRaises(JournalEntryError):
            line(debit=True)

    def test_negative_debit_and_credit_are_preserved(self):
        item = line(debit=Decimal("-100.00"))
        self.assertEqual(item.debit, Decimal("-100.00"))
        self.assertEqual(item.net_amount, Decimal("-100.00"))
        self.assertEqual(item.original_side, "debit")

    def test_zero_line_is_allowed(self):
        item = line(debit=Decimal("0"), credit=Decimal("0"))
        self.assertTrue(item.is_zero)
        self.assertEqual(item.original_side, "zero")

    def test_line_to_dict_serializes_decimal_as_string(self):
        payload = line(original_amount=Decimal("100.5")).to_dict()
        self.assertEqual(payload["debit"], "100.00")
        self.assertEqual(payload["original_amount"], "100.50")
        self.assertEqual(payload["line_id"], "序时账:2")
        self.assertEqual(payload["internal_line_key"], "3:序时账:2")


class JournalEntryTests(unittest.TestCase):
    def test_entry_totals_accounts_and_balance(self):
        entry = JournalEntry.from_lines(
            [
                line(account_code="1001", account_name="库存现金", debit=Decimal("100")),
                line(
                    account_code="6001",
                    account_name="主营业务收入",
                    debit=Decimal("0"),
                    credit=Decimal("100"),
                    source_row=3,
                ),
            ]
        )
        self.assertEqual(entry.total_debit, Decimal("100.00"))
        self.assertEqual(entry.total_credit, Decimal("100.00"))
        self.assertEqual(entry.imbalance, Decimal("0.00"))
        self.assertTrue(entry.is_balanced)
        self.assertEqual(entry.account_codes, ("1001", "6001"))
        self.assertEqual(
            entry.account_names,
            ("主营业务收入", "库存现金"),
        )
        self.assertEqual(entry.validation_flags, ())

    def test_unbalanced_entry_is_flagged_but_not_rejected(self):
        entry = JournalEntry.from_lines(
            [line(debit=Decimal("100")), line(debit=Decimal("0"), credit=Decimal("90"), source_row=3)]
        )
        self.assertFalse(entry.is_balanced)
        self.assertFalse(entry.exactly_balanced)
        self.assertFalse(entry.is_within_tolerance)
        self.assertIn("unbalanced", entry.validation_flags)
        self.assertNotIn("within_tolerance", entry.validation_flags)
        self.assertNotIn("rounding_residual", entry.validation_flags)
        self.assertEqual(entry.imbalance, Decimal("10.00"))

    def test_tolerance_boundary_is_not_called_balanced(self):
        entry = JournalEntry.from_lines(
            [line(debit=Decimal("100")), line(debit=Decimal("0"), credit=Decimal("99.99"), source_row=3)]
        )
        self.assertFalse(entry.is_balanced)
        self.assertFalse(entry.exactly_balanced)
        self.assertTrue(entry.is_within_tolerance)
        self.assertEqual(entry.imbalance, Decimal("0.01"))
        self.assertIn("unbalanced", entry.validation_flags)
        self.assertIn("within_tolerance", entry.validation_flags)
        self.assertIn("rounding_residual", entry.validation_flags)

    def test_balance_quantization_boundaries_are_explicit(self):
        for residual in ("0.009", "0.010", "0.011"):
            with self.subTest(residual=residual):
                credit = quantize_amount(
                    Decimal("100") - Decimal(residual),
                    "credit",
                )
                self.assertEqual(credit, Decimal("99.99"))
                entry = JournalEntry.from_lines(
                    [
                        line(debit=Decimal("100")),
                        line(
                            debit=Decimal("0"),
                            credit=Decimal("100") - Decimal(residual),
                            source_row=3,
                        ),
                    ]
                )
                self.assertEqual(entry.total_credit, Decimal("99.99"))
                self.assertEqual(entry.imbalance, Decimal("0.01"))
                self.assertTrue(entry.is_within_tolerance)
                self.assertIn("rounding_residual", entry.validation_flags)

    def test_balance_outside_tolerance_is_not_rounding_residual(self):
        entry = JournalEntry.from_lines(
            [line(debit=Decimal("100")), line(debit=Decimal("0"), credit=Decimal("99.98"), source_row=3)]
        )
        self.assertEqual(entry.imbalance, Decimal("0.02"))
        self.assertFalse(entry.is_within_tolerance)
        self.assertIn("unbalanced", entry.validation_flags)
        self.assertNotIn("within_tolerance", entry.validation_flags)
        self.assertNotIn("rounding_residual", entry.validation_flags)

    def test_mixed_dates_are_flagged_with_same_period(self):
        entry = JournalEntry.from_lines(
            [
                line(date=date(2026, 1, 1), period="2026-01"),
                line(date=date(2026, 1, 2), period="2026-01", source_row=3),
            ]
        )
        self.assertEqual(entry.voucher_id, "记-001")
        self.assertEqual(entry.period, "2026-01")
        self.assertIn("mixed_dates", entry.validation_flags)

    def test_internal_identity_survives_duplicate_external_line_id(self):
        entry = JournalEntry.from_lines(
            [
                line(line_id="SAME", sheet_name="序时账", source_row=10, debit=Decimal("100")),
                line(line_id="SAME", sheet_name="序时账", source_row=11, debit=Decimal("100")),
                line(line_id="C1", sheet_name="序时账", source_row=12, credit=Decimal("200")),
            ]
        )
        self.assertEqual(len({item.internal_line_key for item in entry.lines}), 3)
        self.assertEqual([item.line_id for item in entry.lines[:2]], ["SAME", "SAME"])

    def test_duplicate_internal_identity_is_rejected(self):
        with self.assertRaises(JournalEntryError):
            JournalEntry.from_lines(
                [
                    line(line_id="A", sheet_name="序时账", source_row=10),
                    line(line_id="B", sheet_name="序时账", source_row=10),
                ]
            )

    def test_empty_entry_is_rejected(self):
        with self.assertRaises(JournalEntryError):
            JournalEntry.from_lines([])


class VoucherKeyTests(unittest.TestCase):
    def test_period_is_the_primary_discriminator(self):
        january = line(period="2026-01", date=date(2026, 1, 31))
        february = line(period="2026-02", date=date(2026, 2, 1))
        self.assertNotEqual(make_voucher_key(january), make_voucher_key(february))

    def test_date_is_used_when_period_is_absent(self):
        january = line(date=date(2026, 1, 31))
        february = line(date=date(2026, 2, 1))
        self.assertNotEqual(make_voucher_key(january), make_voucher_key(february))

    def test_same_period_and_voucher_share_a_key(self):
        left = line(period="2026-01", date=date(2026, 1, 1))
        right = line(period="2026-01", date=date(2026, 1, 2), source_row=3)
        self.assertEqual(make_voucher_key(left), make_voucher_key(right))


class AmountHelperTests(unittest.TestCase):
    def test_quantize_and_serialize(self):
        self.assertEqual(quantize_amount("1000.005"), Decimal("1000.01"))
        self.assertEqual(amount_to_string(Decimal("1000")), "1000.00")


if __name__ == "__main__":
    unittest.main()
