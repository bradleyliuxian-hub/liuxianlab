import json
import unittest
from decimal import Decimal

from services.journal_entry.schema import JournalEntry, JournalLine
from services.journal_entry.anomaly import (
    DEFAULT_ANOMALY_CONFIG,
    AnomalyConfig,
    analyze_anomalies,
    build_anomaly_context,
    extract_all_features,
    score_entries,
)
from services.journal_entry.anomaly.frequency import percentile_rank
from services.journal_entry.anomaly.scoring import risk_level_for_score


def entry(voucher_id, debit_code="6602", debit_name="管理费用", credit_code="1002", credit_name="银行存款", amount="100", period="2026-01", entity="E", row=2):
    return JournalEntry.from_lines(
        [
            JournalLine(
                voucher_id=voucher_id,
                account_code=debit_code,
                account_name=debit_name,
                debit=Decimal(amount),
                period=period,
                entity=entity,
                sheet_name="S",
                source_row=row,
            ),
            JournalLine(
                voucher_id=voucher_id,
                account_code=credit_code,
                account_name=credit_name,
                credit=Decimal(amount),
                period=period,
                entity=entity,
                sheet_name="S",
                source_row=row + 1,
            ),
        ]
    )


def multi_entry(voucher_id, rows, amount=None):
    lines = []
    for index, (code, name, debit, credit) in enumerate(rows, start=2):
        lines.append(
            JournalLine(
                voucher_id=voucher_id,
                account_code=code,
                account_name=name,
                debit=Decimal(str(debit if amount is None else amount if debit else 0)),
                credit=Decimal(str(credit if amount is None else amount if credit else 0)),
                period="2026-01",
                entity="E",
                sheet_name="S",
                source_row=index,
            )
        )
    return JournalEntry.from_lines(lines)


def population_with_signature_count(count, total=200):
    entries = []
    for index in range(count):
        entries.append(
            entry(
                "T%04d" % index,
                debit_code="T1",
                debit_name="TargetDebit",
                credit_code="T2",
                credit_name="TargetCredit",
                amount="100",
            )
        )
    for index in range(total - count):
        entries.append(
            entry(
                "C%04d" % index,
                debit_code="C1",
                debit_name="CommonDebit",
                credit_code="C2",
                credit_name="CommonCredit",
                amount="100",
            )
        )
    return entries


class PercentileTests(unittest.TestCase):
    def test_percentile_ties_use_midrank(self):
        values = (Decimal("10"), Decimal("10"), Decimal("10"))
        self.assertEqual(percentile_rank(Decimal("10"), values), Decimal("0.500000"))

    def test_percentile_ordering(self):
        values = (Decimal("10"), Decimal("20"), Decimal("30"))
        self.assertEqual(percentile_rank(Decimal("10"), values), Decimal("0.166667"))
        self.assertEqual(percentile_rank(Decimal("20"), values), Decimal("0.500000"))
        self.assertEqual(percentile_rank(Decimal("30"), values), Decimal("0.833333"))

    def test_empty_population(self):
        self.assertEqual(percentile_rank(Decimal("10"), ()), Decimal("0"))


class ScoreTests(unittest.TestCase):
    def test_component_bounds_and_total(self):
        entries = [entry("V%03d" % i) for i in range(30)]
        entries.append(
            entry(
                "RARE",
                credit_code="4001",
                credit_name="实收资本",
                amount="500",
            )
        )
        result = analyze_anomalies(entries)
        for score in result.scores:
            total = sum(score.components.values())
            self.assertEqual(total, score.risk_score)
            self.assertGreaterEqual(score.risk_score, Decimal("0"))
            self.assertLessEqual(score.risk_score, Decimal("100"))
            self.assertLessEqual(
                score.components["rarity"],
                DEFAULT_ANOMALY_CONFIG.max_rarity_score,
            )
            self.assertLessEqual(
                score.components["cross_group"],
                DEFAULT_ANOMALY_CONFIG.max_cross_group_score,
            )
            self.assertLessEqual(
                score.components["within_group"],
                DEFAULT_ANOMALY_CONFIG.max_within_group_score,
            )
            self.assertLessEqual(
                score.components["materiality"],
                DEFAULT_ANOMALY_CONFIG.max_materiality_score,
            )

    def test_risk_thresholds(self):
        config = DEFAULT_ANOMALY_CONFIG
        self.assertEqual(risk_level_for_score(Decimal("0"), config), "INFO")
        self.assertEqual(risk_level_for_score(config.low_threshold, config), "LOW")
        self.assertEqual(risk_level_for_score(config.medium_threshold, config), "MEDIUM")
        self.assertEqual(risk_level_for_score(config.high_threshold, config), "HIGH")
        self.assertEqual(risk_level_for_score(Decimal("100"), config), "HIGH")

    def test_small_population_disables_frequency(self):
        entries = [entry("V%02d" % i) for i in range(5)]
        context = build_anomaly_context(entries)
        self.assertFalse(context.global_stats.frequency_enabled)
        scores = score_entries(entries, context=context)
        self.assertTrue(all(score.components["rarity"] == Decimal("0") for score in scores))
        result = analyze_anomalies(entries)
        self.assertIn("frequency_disabled_all_baselines", result.warnings)

    def test_high_diversity_disables_rarity(self):
        entries = []
        for index in range(100):
            entries.append(
                entry(
                    "V%03d" % index,
                    credit_code="1002%03d" % index,
                    amount="100",
                )
            )
        result = analyze_anomalies(entries)
        self.assertEqual(
            max(score.components["rarity"] for score in result.scores),
            Decimal("0"),
        )
        self.assertEqual(result.findings, ())
        self.assertIn("high_signature_diversity_scaled", result.warnings)

    def test_materiality_finding_is_never_alone(self):
        entries = [entry("V%03d" % i) for i in range(30)]
        entries.append(entry("BIG", amount="5000000"))
        result = analyze_anomalies(entries)
        by_voucher = {}
        for finding in result.findings:
            by_voucher.setdefault(finding.voucher_key, []).append(finding.code)
        for codes in by_voucher.values():
            if "JE-A005" in codes:
                self.assertGreater(len(codes), 1)

    def test_absolute_count_bands(self):
        rarity_scores = {}
        for count in (1, 3, 8, 30, 100):
            entries = population_with_signature_count(count, total=200)
            result = analyze_anomalies(entries)
            target = next(
                score for score in result.scores
                if score.voucher_id.startswith("T")
            )
            rarity_scores[count] = target.components["rarity"]
        self.assertGreater(rarity_scores[1], rarity_scores[3])
        self.assertGreater(rarity_scores[3], rarity_scores[8])
        self.assertEqual(rarity_scores[30], Decimal("0"))
        self.assertEqual(rarity_scores[100], Decimal("0"))

    def test_pair_counts_are_directional(self):
        entries = [
            entry("V1", debit_code="A", debit_name="A", credit_code="B", credit_name="B"),
            entry("V2", debit_code="B", debit_name="B", credit_code="A", credit_name="A"),
        ]
        context = build_anomaly_context(entries)
        stats = context.global_stats
        self.assertEqual(stats.pair_count("A", "B"), 1)
        self.assertEqual(stats.pair_count("B", "A"), 1)
        self.assertNotEqual(stats.pair_count("A", "B"), stats.pair_count("A", "A"))

    def test_count_100_of_1674_has_no_rarity_finding(self):
        entries = population_with_signature_count(100, total=1674)
        result = analyze_anomalies(entries)
        target = next(
            score for score in result.scores
            if score.voucher_id == "T0000"
        )
        self.assertEqual(target.components["rarity"], Decimal("0"))
        target_codes = {
            finding.code for finding in result.findings
            if finding.voucher_id == "T0000"
        }
        self.assertNotIn("JE-A002", target_codes)

    def test_rare_pair_can_trigger_a001_without_a002(self):
        entries = [
            entry(
                "C%03d" % index,
                debit_code="C1",
                debit_name="CommonDebit",
                credit_code="C2",
                credit_name="CommonCredit",
                amount="100",
            )
            for index in range(100)
        ]
        targets = [
            entry(
                "T%03d" % index,
                debit_code="T1",
                debit_name="TargetDebit",
                credit_code="T2",
                credit_name="TargetCredit",
                amount="1000000",
            )
            for index in range(4)
        ]
        result = analyze_anomalies(entries + targets)
        target_findings = [
            finding for finding in result.findings
            if finding.voucher_id == "T000"
        ]
        codes = {finding.code for finding in target_findings}
        self.assertIn("JE-A001", codes)
        self.assertNotIn("JE-A002", codes)

    def test_signature_can_trigger_a002_without_a001(self):
        common = []
        # Common account combination and common directional pairs.
        for index in range(50):
            common.append(
                multi_entry(
                    "S%03d" % index,
                    [
                        ("A", "A", 100, 0),
                        ("B", "B", 100, 0),
                        ("X", "X", 0, 100),
                        ("Y", "Y", 0, 100),
                    ],
                )
            )
        pair_patterns = [
            [("A", "A", 100, 0), ("B", "B", 0, 100)],
            [("A", "A", 100, 0), ("Y", "Y", 0, 100)],
            [("X", "X", 100, 0), ("B", "B", 0, 100)],
            [("X", "X", 100, 0), ("Y", "Y", 0, 100)],
        ]
        for pattern_index, pattern in enumerate(pair_patterns):
            for index in range(25):
                common.append(
                    multi_entry(
                        "P%d%03d" % (pattern_index, index),
                        pattern,
                    )
                )
        target = multi_entry(
            "TARGET",
            [
                ("A", "A", 1000000, 0),
                ("X", "X", 1000000, 0),
                ("B", "B", 0, 1000000),
                ("Y", "Y", 0, 1000000),
            ],
        )
        result = analyze_anomalies(common + [target])
        target_score = next(
            score for score in result.scores
            if score.voucher_id == "TARGET"
        )
        target_codes = {
            finding.code for finding in result.findings
            if finding.voucher_id == "TARGET"
        }
        rarity = target_score.evidence["components"]["rarity"]["evidence"]
        self.assertEqual(Decimal(str(rarity["pair_strength"])), Decimal("0"))
        self.assertGreater(Decimal(str(rarity["signature_strength"])), Decimal("0"))
        self.assertIn("JE-A002", target_codes)
        self.assertNotIn("JE-A001", target_codes)
        self.assertLess(target_score.risk_score, Decimal("75"))

    def test_high_review_rate_warning_is_diagnostic_only(self):
        entries = [entry("V%03d" % i) for i in range(30)]
        entries.append(entry("RARE", credit_code="4001", credit_name="实收资本"))
        result = analyze_anomalies(
            entries,
            config=AnomalyConfig(
                high_review_rate_warning_threshold=Decimal("0.01")
            ),
        )
        self.assertIn("high_review_rate", result.warnings)
        self.assertGreater(result.summary["finding_voucher_count"], 0)

    def test_result_evidence_is_json_serializable(self):
        entries = [entry("V%03d" % i) for i in range(30)]
        entries.append(entry("RARE", credit_code="4001", credit_name="实收资本"))
        payload = analyze_anomalies(entries).to_dict()
        json.dumps(payload, ensure_ascii=False)
        self.assertGreaterEqual(len(payload["findings"]), 1)


if __name__ == "__main__":
    unittest.main()
