import random
import unittest
from pathlib import Path

from services.journal_entry.normalize import normalize_file
from services.journal_entry.anomaly import analyze_anomalies

FIXTURES = Path(__file__).resolve().parent / "fixtures"


class DeterminismTests(unittest.TestCase):
    def test_shuffle_100_times_is_exactly_equal(self):
        normalized = normalize_file(FIXTURES / "journal_anomaly_basic.xlsx")
        entries = list(normalized.entries)
        baseline = analyze_anomalies(entries).to_dict()
        rng = random.Random(20261019)
        for _ in range(100):
            shuffled = list(entries)
            rng.shuffle(shuffled)
            self.assertEqual(analyze_anomalies(shuffled).to_dict(), baseline)

    def test_finding_ids_are_stable(self):
        normalized = normalize_file(FIXTURES / "journal_anomaly_basic.xlsx")
        first = analyze_anomalies(normalized.entries)
        second = analyze_anomalies(list(reversed(normalized.entries)))
        self.assertEqual(
            [finding.id for finding in first.findings],
            [finding.id for finding in second.findings],
        )
        self.assertTrue(all("uuid" not in finding.id.lower() for finding in first.findings))


if __name__ == "__main__":
    unittest.main()
