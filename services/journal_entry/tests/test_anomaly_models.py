import json
import unittest
from decimal import Decimal

from services.journal_entry.schema import JournalEntry, JournalLine
from services.journal_entry.anomaly import (
    DEFAULT_ANOMALY_CONFIG,
    AnomalyConfig,
    analyze_anomalies,
    extract_features,
    make_stable_finding_id,
)


def entry(voucher_id="V1"):
    return JournalEntry.from_lines(
        [
            JournalLine(
                voucher_id=voucher_id,
                account_code="6602",
                account_name="管理费用",
                debit=Decimal("100"),
                period="2026-01",
                entity="E",
                sheet_name="S",
                source_row=2,
            ),
            JournalLine(
                voucher_id=voucher_id,
                account_code="1002",
                account_name="银行存款",
                credit=Decimal("100"),
                period="2026-01",
                entity="E",
                sheet_name="S",
                source_row=3,
            ),
        ]
    )


class ConfigTests(unittest.TestCase):
    def test_default_components_sum_to_100(self):
        config = DEFAULT_ANOMALY_CONFIG
        self.assertEqual(
            config.max_rarity_score
            + config.max_cross_group_score
            + config.max_within_group_score
            + config.max_materiality_score,
            Decimal("100"),
        )
        self.assertLessEqual(config.low_threshold, config.medium_threshold)
        self.assertLessEqual(config.medium_threshold, config.high_threshold)
        self.assertEqual(
            config.max_pair_rarity_score
            + config.max_combination_rarity_score
            + config.max_signature_rarity_score,
            config.max_rarity_score,
        )
        self.assertLessEqual(config.rarity_count_full_max, config.rarity_count_strong_max)
        self.assertLessEqual(config.rarity_count_strong_max, config.rarity_count_moderate_max)
        self.assertLessEqual(config.rarity_count_moderate_max, config.rarity_count_weak_max)

    def test_invalid_threshold_order_is_rejected(self):
        with self.assertRaises(ValueError):
            AnomalyConfig(
                low_threshold=Decimal("50"),
                medium_threshold=Decimal("40"),
                high_threshold=Decimal("75"),
            )


class ModelSerializationTests(unittest.TestCase):
    def test_features_serialize_decimal_as_strings(self):
        payload = extract_features(entry()).to_dict()
        self.assertEqual(payload["gross_amount"], "100.00")
        self.assertEqual(payload["total_debit"], "100.00")
        self.assertEqual(payload["unknown_account_ratio"], "0.000000")
        json.dumps(payload, ensure_ascii=False)

    def test_stable_finding_id(self):
        first = make_stable_finding_id("JE-A001", "key")
        second = make_stable_finding_id("JE-A001", "key")
        other = make_stable_finding_id("JE-A002", "key")
        self.assertEqual(first, second)
        self.assertNotEqual(first, other)
        self.assertTrue(first.startswith("JE-A001:"))
        self.assertNotIn("-", first.split(":", 1)[1])

    def test_result_is_json_serializable(self):
        result = analyze_anomalies([entry("V1"), entry("V2")])
        payload = result.to_dict()
        json.dumps(payload, ensure_ascii=False)
        self.assertEqual(payload["summary"]["voucher_count"], 2)
        self.assertEqual(payload["summary"]["finding_count"], 0)

    def test_finding_schema_if_present(self):
        entries = [entry("V%03d" % i) for i in range(30)]
        rare = JournalEntry.from_lines(
            [
                JournalLine(
                    voucher_id="RARE",
                    account_code="6602",
                    account_name="管理费用",
                    debit=Decimal("100"),
                    period="2026-01",
                    entity="E",
                    sheet_name="S",
                    source_row=2,
                ),
                JournalLine(
                    voucher_id="RARE",
                    account_code="4001",
                    account_name="实收资本",
                    credit=Decimal("100"),
                    period="2026-01",
                    entity="E",
                    sheet_name="S",
                    source_row=3,
                ),
            ]
        )
        result = analyze_anomalies(entries + [rare])
        self.assertGreaterEqual(len(result.findings), 1)
        finding = result.findings[0].to_dict()
        for key in (
            "id",
            "code",
            "type",
            "severity",
            "risk_score",
            "voucher_key",
            "voucher_id",
            "amount",
            "accounts",
            "account_signature",
            "business_group",
            "reason",
            "evidence",
            "sheet_names",
            "source_rows",
            "professional_interpretation",
        ):
            self.assertIn(key, finding)
        self.assertIsNone(finding["professional_interpretation"])
        json.dumps(finding, ensure_ascii=False)


if __name__ == "__main__":
    unittest.main()
