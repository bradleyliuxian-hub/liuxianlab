from __future__ import annotations

import unittest
from decimal import Decimal

from services.purchase_reconciliation.engine import reconcile
from services.purchase_reconciliation.schema import ReconciliationConfig


def record(source_row, quantity, amount=None, *, supplier="V1", po="PO1", item="10", material="M1", unit="KG", price="10", per="1", movement="101", date="2026-01-01"):
    if amount is None:
        amount = Decimal(quantity) * Decimal(price)
    return {
        "source_row": source_row,
        "delivery_date": date,
        "supplier": supplier,
        "purchase_order": po,
        "purchase_order_item": item,
        "material_code": material,
        "material_description": "测试物料",
        "order_unit": unit,
        "quantity": Decimal(quantity),
        "unit_price": Decimal(price),
        "per": Decimal(per),
        "amount": Decimal(amount),
        "movement_type": movement,
        "raw": {
            "送货日期": date,
            "供应商": supplier,
            "采购订单": po,
            "采购订单项目": item,
            "物料编码": material,
            "订单单位": unit,
            "数量": str(quantity),
            "单价": str(price),
            "每": str(per),
            "总金额": str(amount),
            "移动类型": movement,
        },
    }


def metrics(result):
    return result.metrics


class FifoEngineTest(unittest.TestCase):
    def test_one_to_one(self):
        result = reconcile([
            record(2, "100", "1000"),
            record(3, "-100", "-1000", movement="122"),
        ])
        self.assertEqual(len(result.segments), 1)
        self.assertEqual(result.segments[0]["matched_quantity"], Decimal("100"))
        self.assertEqual(metrics(result)["remaining_record_count"], 0)
        self.assertEqual(metrics(result)["final_net_amount"], Decimal("0.00"))

    def test_one_positive_to_many_negatives(self):
        result = reconcile([
            record(2, "100", "1000"),
            record(3, "-30", "-300", movement="122"),
            record(4, "-20", "-200", movement="122"),
            record(5, "-50", "-500", movement="122"),
        ])
        self.assertEqual([s["matched_quantity"] for s in result.segments], [Decimal("30"), Decimal("20"), Decimal("50")])
        self.assertEqual(len(result.remaining_rows), 0)
        self.assertEqual(metrics(result)["conservation_difference"], Decimal("0.00"))

    def test_many_positives_to_one_negative(self):
        result = reconcile([
            record(2, "30", "300"),
            record(3, "20", "200"),
            record(4, "50", "500"),
            record(5, "-100", "-1000", movement="122"),
        ])
        self.assertEqual(len(result.segments), 3)
        self.assertEqual(len(result.remaining_rows), 0)

    def test_partial_positive_remaining(self):
        result = reconcile([
            record(2, "100", "1000"),
            record(3, "-30", "-300", movement="122"),
        ])
        remaining = result.remaining_rows[0]
        self.assertEqual(remaining["remaining_quantity"], Decimal("70"))
        self.assertEqual(remaining["remaining_amount"], Decimal("700"))

    def test_partial_negative_remaining(self):
        result = reconcile([
            record(2, "30", "300"),
            record(3, "-100", "-1000", movement="122"),
        ])
        remaining = result.remaining_rows[0]
        self.assertEqual(remaining["remaining_quantity"], Decimal("-70"))
        self.assertEqual(remaining["remaining_amount"], Decimal("-700"))
        self.assertEqual(metrics(result)["unmatched_negative_amount_abs"], Decimal("700.00"))

    def test_same_date_uses_source_row(self):
        result = reconcile([
            record(10, "10", "100"),
            record(11, "10", "100"),
            record(3, "-15", "-150", movement="122"),
        ])
        self.assertEqual(result.segments[0]["positive_source_row"], 10)
        self.assertEqual(result.segments[0]["matched_quantity"], Decimal("10"))
        self.assertEqual(result.segments[1]["positive_source_row"], 11)
        self.assertEqual(result.segments[1]["matched_quantity"], Decimal("5"))

    def test_different_price_never_matches(self):
        result = reconcile([
            record(2, "100", "1000", price="10"),
            record(3, "-100", "-1000", price="20", movement="122"),
        ])
        self.assertEqual(len(result.segments), 0)
        self.assertEqual(len(result.remaining_rows), 2)

    def test_different_po_item_material_unit_do_not_match(self):
        base = record(2, "100", "1000")
        for field, value in (
            ("purchase_order", "PO2"),
            ("purchase_order_item", "20"),
            ("material_code", "M2"),
            ("order_unit", "BOX"),
        ):
            negative = record(3, "-100", "-1000", movement="122")
            negative[field] = value
            result = reconcile([base, negative])
            self.assertEqual(len(result.segments), 0, field)
            self.assertEqual(len(result.remaining_rows), 2, field)

    def test_zero_quantity_is_ignored(self):
        result = reconcile([
            record(2, "0", "0"),
            record(3, "100", "1000"),
            record(4, "-100", "-1000", movement="122"),
        ])
        self.assertEqual(metrics(result)["zero_quantity_record_count"], 1)
        self.assertEqual(len(result.segments), 1)
        self.assertEqual(len(result.remaining_rows), 0)

    def test_zero_amount_still_reconciles_quantity(self):
        result = reconcile([
            record(2, "100", "0"),
            record(3, "-100", "0", movement="122"),
        ])
        self.assertEqual(len(result.segments), 1)
        self.assertEqual(result.segments[0]["matched_amount"], Decimal("0"))
        self.assertEqual(metrics(result)["conservation_difference"], Decimal("0.00"))

    def test_decimal_precision(self):
        result = reconcile([
            record(2, "3", "10.00", price="3.3333333333"),
            record(3, "-1", "-3.33", movement="122", price="3.3333333333"),
        ])
        self.assertEqual(result.segments[0]["matched_amount"], Decimal("10.00") / Decimal("3"))
        self.assertEqual(result.segments[0]["negative_amount_abs"], Decimal("3.33"))
        remaining = result.remaining_rows[0]
        self.assertEqual(remaining["remaining_quantity"], Decimal("2"))
        self.assertEqual(remaining["remaining_amount"], Decimal("10.00") * Decimal("2") / Decimal("3"))

    def test_configuration_custom_match_fields(self):
        result = reconcile(
            [record(2, "10", "100"), record(3, "-10", "-100", movement="122", po="PO2")],
            config=ReconciliationConfig(match_fields=("supplier", "material_code", "order_unit")),
        )
        self.assertEqual(len(result.segments), 1)

    def test_result_is_deterministic(self):
        rows = [
            record(2, "10", "100", date="2026-01-02"),
            record(3, "-4", "-40", movement="122", date="2026-01-03"),
            record(4, "-6", "-60", movement="122", date="2026-01-01"),
        ]
        first = reconcile(rows)
        second = reconcile(rows)
        self.assertEqual([s["match_id"] for s in first.segments], [s["match_id"] for s in second.segments])
        self.assertEqual(
            [(s["positive_source_row"], s["negative_source_row"]) for s in first.segments],
            [(s["positive_source_row"], s["negative_source_row"]) for s in second.segments],
        )

    def test_conservation_on_mixed_data(self):
        result = reconcile([
            record(2, "100", "1000"),
            record(3, "-30", "-300", movement="122"),
            record(4, "50", "500", date="2026-02-01"),
            record(5, "-80", "-800", movement="122", date="2026-02-02"),
        ])
        values = metrics(result)
        self.assertEqual(
            values["conservation_difference"],
            (values["original_positive_amount"] - values["original_negative_amount_abs"]) - values["final_net_amount"],
        )
        self.assertTrue(result.metrics["conservation_ok"])


if __name__ == "__main__":
    unittest.main()
