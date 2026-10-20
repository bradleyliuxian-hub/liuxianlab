import json
import unittest
from unittest import mock
from decimal import Decimal
from pathlib import Path

from services.journal_entry.schema import JournalEntry, JournalLine
from services.journal_entry.normalize import normalize_file
from services.journal_entry.anomaly import (
    analyze_anomalies,
    build_anomaly_context,
    extract_features,
    score_entries,
    voucher_key_for_entry,
)
from services.journal_entry.anomaly import engine as anomaly_engine

FIXTURES = Path(__file__).resolve().parent / "fixtures"


def entry(voucher_id, debit_code="6602", debit_name="管理费用", credit_code="1002", credit_name="银行存款", amount="100", period="2026-01", entity="E", row=2):
    return JournalEntry.from_lines(
        [
            JournalLine(voucher_id=voucher_id, account_code=debit_code, account_name=debit_name, debit=Decimal(amount), period=period, entity=entity, sheet_name="S", source_row=row),
            JournalLine(voucher_id=voucher_id, account_code=credit_code, account_name=credit_name, credit=Decimal(amount), period=period, entity=entity, sheet_name="S", source_row=row + 1),
        ]
    )


class CleanPopulationTests(unittest.TestCase):
    def test_clean_common_pattern_has_no_findings(self):
        entries = [entry("V%03d" % i) for i in range(40)]
        result = analyze_anomalies(entries)
        self.assertEqual(result.findings, ())
        self.assertEqual(result.summary["finding_severity_counts"]["HIGH"], 0)
        self.assertEqual(result.summary["finding_severity_counts"]["MEDIUM"], 0)
        self.assertLess(max(score.risk_score for score in result.scores), Decimal("20"))

    def test_empty_dataset(self):
        result = analyze_anomalies([])
        self.assertEqual(result.scores, ())
        self.assertEqual(result.findings, ())
        self.assertEqual(result.summary["voucher_count"], 0)
        self.assertEqual(result.summary["finding_count"], 0)

    def test_single_voucher(self):
        result = analyze_anomalies([entry("ONE")])
        self.assertEqual(len(result.scores), 1)
        self.assertEqual(result.findings, ())
        self.assertIn("frequency_disabled_all_baselines", result.warnings)

    def test_small_population_frequency_disabled(self):
        entries = [entry("V%02d" % i) for i in range(10)]
        result = analyze_anomalies(entries)
        self.assertEqual(result.findings, ())
        self.assertTrue(
            all(score.components["rarity"] == Decimal("0") for score in result.scores)
        )


class FixtureEngineTests(unittest.TestCase):
    def setUp(self):
        self.normalized = normalize_file(FIXTURES / "journal_anomaly_basic.xlsx")
        self.result = analyze_anomalies(self.normalized.entries)

    def test_findings_and_severity(self):
        self.assertEqual(len(self.normalized.entries), 33)
        self.assertEqual(len(self.result.findings), 7)
        by_voucher = {}
        for finding in self.result.findings:
            by_voucher.setdefault(finding.voucher_id, []).append(finding)
        self.assertEqual(
            [item.code for item in by_voucher["AN-RAREBIG"]],
            ["JE-A001", "JE-A002", "JE-A005"],
        )
        self.assertEqual(
            [item.code for item in by_voucher["AN-BIG"]],
            ["JE-A004", "JE-A005"],
        )
        self.assertEqual(
            [item.code for item in by_voucher["AN-RARE"]],
            ["JE-A001", "JE-A002"],
        )
        self.assertEqual(by_voucher["AN-RAREBIG"][0].severity, "MEDIUM")
        self.assertEqual(by_voucher["AN-RARE"][0].severity, "LOW")
        self.assertEqual(self.result.summary["finding_severity_counts"]["HIGH"], 0)
        self.assertEqual(self.result.summary["finding_severity_counts"]["MEDIUM"], 3)

    def test_ordering(self):
        keys = [
            (-finding.risk_score, finding.voucher_key, finding.code)
            for finding in self.result.findings
        ]
        self.assertEqual(keys, sorted(keys))

    def test_traceability(self):
        source_rows = {
            line.source_row
            for journal in self.normalized.entries
            for line in journal.lines
        }
        for finding in self.result.findings:
            self.assertTrue(finding.source_rows)
            self.assertTrue(set(finding.source_rows) <= source_rows)
            self.assertTrue(finding.sheet_names)
            self.assertIsNone(finding.professional_interpretation)
            self.assertIn("component_evidence", finding.evidence)

    def test_golden_anomaly_basic(self):
        expected = json.loads(
            (FIXTURES / "expected_anomaly_basic.json").read_text(encoding="utf-8")
        )
        actual = self.result.to_dict()
        self.assertEqual(actual["findings"], expected["findings"])
        self.assertEqual(actual["summary"], expected["summary"])
        self.assertEqual(actual["warnings"], expected["warnings"])
        self.assertEqual(
            [score["voucher_key"] for score in actual["scores"]],
            [score["voucher_key"] for score in expected["scores"]],
        )
        self.assertEqual(actual["scores"], expected["scores"])

    def test_summary(self):
        summary = self.result.summary
        self.assertEqual(summary["voucher_count"], 33)
        self.assertEqual(summary["scored_voucher_count"], 33)
        self.assertEqual(summary["finding_count"], 7)
        self.assertEqual(summary["finding_voucher_count"], 3)
        self.assertEqual(summary["review_rate"], "0.090909")
        self.assertEqual(summary["finding_severity_counts"]["LOW"], 4)
        self.assertEqual(summary["finding_severity_counts"]["MEDIUM"], 3)
        self.assertEqual(summary["voucher_risk_level_counts"]["INFO"], 30)
        self.assertEqual(summary["voucher_risk_level_counts"]["LOW"], 2)
        self.assertEqual(summary["voucher_risk_level_counts"]["MEDIUM"], 1)
        self.assertEqual(summary["voucher_risk_level_counts"]["HIGH"], 0)
        self.assertEqual(summary["rarity_positive_voucher_count"], 2)
        self.assertEqual(summary["pair_rarity_positive_voucher_count"], 2)
        self.assertEqual(summary["combination_rarity_positive_voucher_count"], 2)
        self.assertEqual(summary["signature_rarity_positive_voucher_count"], 2)
        self.assertEqual(summary["code_counts"]["JE-A001"], 2)
        self.assertEqual(summary["code_counts"]["JE-A002"], 2)
        self.assertEqual(summary["code_counts"]["JE-A003"], 0)
        self.assertEqual(summary["code_counts"]["JE-A004"], 1)
        self.assertEqual(summary["code_counts"]["JE-A005"], 2)

    def test_a001_and_a002_use_independent_evidence(self):
        rare_findings = {
            finding.code: finding
            for finding in self.result.findings
            if finding.voucher_id == "AN-RARE"
        }
        a001 = rare_findings["JE-A001"].evidence["component_evidence"]
        a002 = rare_findings["JE-A002"].evidence["component_evidence"]
        self.assertIn("pair", a001)
        self.assertIn("combination", a001)
        self.assertNotIn("signature", a001)
        self.assertIn("signature", a002)
        self.assertNotIn("pair", a002)


class EntityBaselineIsolationTests(unittest.TestCase):
    def test_entity_only_baselines_are_separate_and_disabled(self):
        entries = [
            entry("A%02d" % i, entity="A", period=None)
            for i in range(12)
        ] + [
            entry("B%02d" % i, entity="B", period=None)
            for i in range(12)
        ]
        context = build_anomaly_context(entries)
        self.assertEqual(
            sorted(context.baselines.keys()),
            ["entity|A|", "entity|B|"],
        )
        self.assertEqual(context.baselines["entity|A|"].population_size, 12)
        self.assertEqual(context.baselines["entity|B|"].population_size, 12)
        self.assertFalse(context.baselines["entity|A|"].frequency_enabled)
        self.assertFalse(context.baselines["entity|B|"].frequency_enabled)

    def test_one_entity_enabled_does_not_enable_other(self):
        entries = [
            entry("A%02d" % i, entity="A", period=None)
            for i in range(25)
        ] + [
            entry("B%02d" % i, entity="B", period=None)
            for i in range(10)
        ]
        context = build_anomaly_context(entries)
        self.assertTrue(context.baselines["entity|A|"].frequency_enabled)
        self.assertFalse(context.baselines["entity|B|"].frequency_enabled)

    def test_period_only_and_global_keys(self):
        period_context = build_anomaly_context(
            [entry("P%02d" % i, entity=None, period="2026-01") for i in range(3)]
        )
        self.assertEqual(
            list(period_context.baselines.keys()),
            ["period||2026-01"],
        )
        global_context = build_anomaly_context(
            [entry("G%02d" % i, entity=None, period=None) for i in range(3)]
        )
        self.assertEqual(
            list(global_context.baselines.keys()),
            ["global||"],
        )


class SummarySemanticsTests(unittest.TestCase):
    def summary_for(self, left_count, right_count):
        entries = [
            entry("A%02d" % i, entity="A", period=None)
            for i in range(left_count)
        ] + [
            entry("B%02d" % i, entity="B", period=None)
            for i in range(right_count)
        ]
        return analyze_anomalies(entries)

    def test_all_baselines_disabled(self):
        result = self.summary_for(10, 10)
        summary = result.summary
        self.assertEqual(summary["frequency_enabled_baseline_count"], 0)
        self.assertEqual(summary["frequency_disabled_baseline_count"], 2)
        self.assertFalse(summary["frequency_enabled_for_any"])
        self.assertFalse(summary["frequency_enabled_for_all"])
        self.assertIn("frequency_disabled_all_baselines", result.warnings)

    def test_one_baseline_enabled(self):
        result = self.summary_for(25, 10)
        summary = result.summary
        self.assertEqual(summary["frequency_enabled_baseline_count"], 1)
        self.assertEqual(summary["frequency_disabled_baseline_count"], 1)
        self.assertTrue(summary["frequency_enabled_for_any"])
        self.assertFalse(summary["frequency_enabled_for_all"])
        self.assertIn("frequency_disabled_for_some_baselines", result.warnings)

    def test_all_baselines_enabled(self):
        result = self.summary_for(25, 30)
        summary = result.summary
        self.assertEqual(summary["frequency_enabled_baseline_count"], 2)
        self.assertEqual(summary["frequency_disabled_baseline_count"], 0)
        self.assertTrue(summary["frequency_enabled_for_any"])
        self.assertTrue(summary["frequency_enabled_for_all"])
        self.assertNotIn("frequency_disabled_for_some_baselines", result.warnings)
        self.assertNotIn("frequency_disabled_all_baselines", result.warnings)


class ScoreEntriesContractTests(unittest.TestCase):
    def setUp(self):
        self.population = [
            entry("P%03d" % i, entity="A", period="2026-01")
            for i in range(30)
        ]
        self.context = build_anomaly_context(self.population)

    def test_subset_returns_only_requested_scores(self):
        one = score_entries(
            [self.population[0]],
            context=self.context,
        )
        self.assertEqual(len(one), 1)
        self.assertEqual(one[0].voucher_id, "P000")
        self.assertEqual(one[0].evidence["population_size"], 30)

        five = score_entries(
            self.population[:5],
            context=self.context,
        )
        self.assertEqual(len(five), 5)
        self.assertTrue(all(score.evidence["population_size"] == 30 for score in five))

    def test_context_is_not_mutated(self):
        before_features = self.context.features
        before_keys = tuple(sorted(self.context.baselines.keys()))
        score_entries(self.population[:3], context=self.context)
        self.assertIs(self.context.features, before_features)
        self.assertEqual(tuple(sorted(self.context.baselines.keys())), before_keys)

    def test_missing_baseline_is_explicitly_disabled(self):
        outside = entry("OUT", entity="C", period="2026-01")
        scores = score_entries([outside], context=self.context)
        self.assertEqual(len(scores), 1)
        self.assertEqual(scores[0].evidence["baseline_key"], "entity_period|C|2026-01")
        self.assertEqual(scores[0].evidence["population_size"], 0)
        self.assertFalse(scores[0].evidence["frequency_enabled"])
        self.assertEqual(scores[0].components["rarity"], Decimal("0"))

    def test_contra_results_are_passed_to_feature_extraction(self):
        target = self.population[0]
        with mock.patch.object(
            anomaly_engine,
            "extract_all_features",
            wraps=anomaly_engine.extract_all_features,
        ) as extractor:
            mapping = {voucher_key_for_entry(target): object()}
            score_entries(
                [target],
                context=self.context,
                contra_results=mapping,
            )
            self.assertIs(extractor.call_args.kwargs["contra_results"], mapping)


class TargetedSignalTests(unittest.TestCase):
    def test_rare_pair_low_amount_is_not_high(self):
        normalized = normalize_file(FIXTURES / "journal_anomaly_rare_pair.xlsx")
        result = analyze_anomalies(normalized.entries)
        rare = [item for item in result.findings if item.voucher_id == "RP-RARE"]
        self.assertTrue(rare)
        self.assertTrue(all(item.severity in {"LOW", "MEDIUM"} for item in rare))
        self.assertTrue(all(item.risk_score < Decimal("75") for item in rare))

    def test_common_large_amount_is_not_high(self):
        normalized = normalize_file(FIXTURES / "journal_anomaly_materiality.xlsx")
        result = analyze_anomalies(normalized.entries)
        big = [item for item in result.findings if item.voucher_id == "MT-BIG"]
        self.assertTrue(big)
        self.assertTrue(all(item.severity != "HIGH" for item in big))
        self.assertTrue(all(item.risk_score < Decimal("75") for item in big))

    def test_rare_plus_material_is_higher(self):
        entries = [entry("V%03d" % i) for i in range(40)]
        entries.append(entry("RARE-LOW", credit_code="4001", credit_name="实收资本", amount="500"))
        entries.append(entry("RARE-BIG", credit_code="4001", credit_name="实收资本", amount="2000000"))
        result = analyze_anomalies(entries)
        scores = {score.voucher_id: score for score in result.scores}
        self.assertGreater(
            scores["RARE-BIG"].risk_score,
            scores["RARE-LOW"].risk_score,
        )
        self.assertGreater(
            scores["RARE-BIG"].components["materiality"],
            scores["RARE-LOW"].components["materiality"],
        )

    def test_cross_group_mismatch(self):
        entries = []
        for index in range(25):
            entries.append(
                entry(
                    "A%03d" % index,
                    debit_code="1601",
                    debit_name="固定资产",
                    amount="100",
                )
            )
        entries.append(
            JournalEntry.from_lines(
                [
                    JournalLine(voucher_id="ODD", account_code="1601", account_name="固定资产", debit=Decimal("100"), period="2026-01", entity="E", sheet_name="S", source_row=2),
                    JournalLine(voucher_id="ODD", account_code="6602", account_name="管理费用", debit=Decimal("50"), period="2026-01", entity="E", sheet_name="S", source_row=3),
                    JournalLine(voucher_id="ODD", account_code="2221", account_name="应交税费", debit=Decimal("10"), period="2026-01", entity="E", sheet_name="S", source_row=4),
                    JournalLine(voucher_id="ODD", account_code="1002", account_name="银行存款", credit=Decimal("160"), period="2026-01", entity="E", sheet_name="S", source_row=5),
                ]
            )
        )
        result = analyze_anomalies(entries)
        odd = [item for item in result.findings if item.voucher_id == "ODD"]
        self.assertTrue(odd)
        self.assertIn("JE-A003", {item.code for item in odd})
        self.assertGreater(
            next(score for score in result.scores if score.voucher_id == "ODD").components["cross_group"],
            Decimal("0"),
        )

    def test_small_group_disables_within_group(self):
        entries = [entry("E%03d" % i) for i in range(30)]
        entries.extend(
            [
                entry("A1", debit_code="1601", debit_name="固定资产"),
                entry("A2", debit_code="1601", debit_name="固定资产"),
            ]
        )
        result = analyze_anomalies(entries)
        for score in result.scores:
            if score.voucher_id in {"A1", "A2"}:
                self.assertEqual(score.components["within_group"], Decimal("0"))
                self.assertEqual(score.components["cross_group"], Decimal("0"))

    def test_baseline_isolation_by_entity_and_period(self):
        entries = [
            entry("J%03d" % i, period="2026-01", entity="E1")
            for i in range(20)
        ] + [
            entry("F%03d" % i, period="2026-02", entity="E2")
            for i in range(20)
        ]
        context = build_anomaly_context(entries)
        self.assertEqual(len(context.baselines), 2)
        self.assertEqual(
            sorted(context.baselines.keys()),
            ["entity_period|E1|2026-01", "entity_period|E2|2026-02"],
        )
        for feature in context.features:
            self.assertEqual(context.stats_for(feature).population_size, 20)

    def test_baseline_fallbacks(self):
        entries = [
            entry("P1", entity=None, period="2026-01"),
            entry("G1", entity="E", period=None),
        ]
        context = build_anomaly_context(entries)
        self.assertEqual(
            sorted(context.baselines.keys()),
            ["entity|E|", "period||2026-01"],
        )

    def test_all_unique_signatures_do_not_produce_all_high_risk(self):
        entries = [
            entry(
                "U%03d" % index,
                credit_code="1002%03d" % index,
                amount="100",
            )
            for index in range(100)
        ]
        result = analyze_anomalies(entries)
        self.assertEqual(
            [score for score in result.scores if score.risk_level == "HIGH"],
            [],
        )
        self.assertLess(len(result.findings), len(entries))

    def test_contra_result_is_optional_context(self):
        entries = [entry("V%03d" % i) for i in range(30)]
        result = analyze_anomalies(entries, contra_results={})
        self.assertEqual(len(result.scores), 30)
        self.assertEqual(result.findings, ())


if __name__ == "__main__":
    unittest.main()
