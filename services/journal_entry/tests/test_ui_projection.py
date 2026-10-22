import json
import os
import zlib
import tempfile
import unittest
from pathlib import Path

from services.journal_entry.ui_projection import (
    DETAILS_FILENAME,
    DETAILS_INDEX_FILENAME,
    FINDINGS_FILENAME,
    SUMMARY_FILENAME,
    VOUCHERS_FILENAME,
    build_ui_projection,
    build_ui_projection_from_result,
)


def payload_fixture():
    voucher = {
        "voucher_key": "|date|2025-01-01|V/001",
        "voucher_id": "V/001",
        "date": "2025-01-01",
        "period": "2025-01",
        "entity": "主体",
        "total_debit": "100.00",
        "total_credit": "100.00",
        "imbalance": "0.00",
        "exactly_balanced": True,
        "is_within_tolerance": True,
        "validation_flags": [],
        "line_count": 2,
        "lines": [
            {
                "sheet_name": "序时账", "source_row": 2, "line_id": "001",
                "account_code": "1002", "account_name": "银行存款",
                "debit": "100.00", "credit": "0.00", "description": "测试",
                "internal_line_key": "3:序时账:2", "customer_name": "不进入投影",
            },
            {
                "sheet_name": "序时账", "source_row": 3, "line_id": "001",
                "account_code": "1122", "account_name": "应收账款",
                "debit": "0.00", "credit": "100.00", "description": "测试",
                "internal_line_key": "3:序时账:3",
            },
        ],
        "business_classification": {
            "business_code": "JE-B001", "business_label": "职工薪酬",
            "confidence": "0.9", "confidence_level": "HIGH", "score": "90.00",
            "is_hard_rule": True, "reason": "规则命中",
            "professional_interpretation": "解释",
            "candidates": [
                {"code": "JE-B001", "label": "职工薪酬", "score": "90.00", "evidence": {"secret": "drop"}}
            ],
            "evidence": {"large": "drop"},
        },
        "contra": {
            "method": "direct", "confidence": "1.00", "ambiguous": False,
            "complexity_limited": False, "solution_limit_reached": False,
            "solution_count": 1, "node_count": 2, "warnings": [],
            "allocations": [{
                "source_internal_key": "3:序时账:2", "source_line_id": "001",
                "target_internal_key": "3:序时账:3", "target_line_id": "001",
                "amount": "100.00", "method": "direct",
                "source_node_id": "drop", "target_node_id": "drop",
            }],
            "unallocated_debit": [], "unallocated_credit": [],
        },
        "anomaly": {
            "risk_score": "20.00", "risk_level": "LOW", "business_group": "other",
            "components": {"materiality": "8.00"}, "finding_codes": ["JE-A004"],
        },
    }
    finding = {
        "voucher_key": voucher["voucher_key"], "voucher_id": voucher["voucher_id"],
        "date": voucher["date"], "code": "JE-A004", "severity": "LOW",
        "risk_score": "20.00", "business_group": "other", "reason": "测试原因",
        "evidence": {"large": "detail only"},
    }
    return {
        "schema_version": 1, "job_id": "job-1", "status": "completed",
        "generated_at": "2026-01-01T00:00:00+00:00",
        "input_metadata": {"source_filename": "test.xlsx", "sheet_name": "序时账"},
        "cleaning_summary": {"voucher_count": 1, "line_count": 2},
        "voucher_summary": {"voucher_count": 1},
        "business_classification_summary": {"voucher_count": 1},
        "contra_summary": {"analyzed_voucher_count": 1},
        "anomaly_summary": {"finding_count": 1, "finding_voucher_count": 1},
        "warnings": ["warning"],
        "validation_issues": [{"large": "not in summary"}],
        "row_warnings": [{"large": "not in summary"}],
        "vouchers": [voucher],
        "findings": [finding],
    }


class UiProjectionTests(unittest.TestCase):
    def test_projection_matches_canonical_and_keeps_details_lazy(self):
        payload = payload_fixture()
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "ui"
            stats = build_ui_projection(payload, out)
            summary = json.loads((out / SUMMARY_FILENAME).read_text(encoding="utf-8"))
            rows = [
                json.loads(line)
                for line in (out / VOUCHERS_FILENAME).read_text(encoding="utf-8").splitlines()
                if line
            ]
            findings = json.loads((out / FINDINGS_FILENAME).read_text(encoding="utf-8"))
            index = json.loads((out / DETAILS_INDEX_FILENAME).read_text(encoding="utf-8"))

            self.assertEqual(summary["job_id"], payload["job_id"])
            self.assertEqual(summary["cleaning_summary"], payload["cleaning_summary"])
            self.assertEqual(summary["anomaly_summary"], payload["anomaly_summary"])
            self.assertNotIn("vouchers", summary)
            self.assertNotIn("validation_issues", summary)
            self.assertEqual(rows[0]["bc"], "JE-B001")
            self.assertEqual(rows[0]["fc"], 1)
            self.assertEqual(rows[0]["ct"]["ca"], 1)
            self.assertEqual(findings[0]["code"], "JE-A004")
            self.assertEqual(stats["voucher_rows"], 1)

            key = payload["vouchers"][0]["voucher_key"]
            offset, length = index[key]
            raw = zlib.decompress((out / DETAILS_FILENAME).read_bytes()[offset:offset + length])
            detail = json.loads(raw.decode("utf-8"))
            self.assertEqual(detail["voucher"]["lines"][0]["internal_line_key"], "3:序时账:2")
            self.assertEqual(detail["voucher"]["lines"][0]["line_id"], "001")
            self.assertNotIn("customer_name", detail["voucher"]["lines"][0])
            self.assertNotIn("evidence", detail["voucher"]["business_classification"])
            self.assertEqual(detail["voucher"]["contra"]["allocations"][0]["source_internal_key"], "3:序时账:2")
            self.assertEqual(detail["findings"][0]["evidence"], {"large": "detail only"})
            self.assertEqual(oct(out.stat().st_mode & 0o777), "0o700")
            self.assertEqual(oct((out / SUMMARY_FILENAME).stat().st_mode & 0o777), "0o600")

    def test_build_from_result_file_and_rerun_is_atomic(self):
        payload = payload_fixture()
        with tempfile.TemporaryDirectory() as tmp:
            result = Path(tmp) / "result.json"
            result.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
            out = Path(tmp) / "ui"
            first = build_ui_projection_from_result(result, out)
            second = build_ui_projection_from_result(result, out)
            self.assertEqual(first["voucher_rows"], second["voucher_rows"])
            self.assertTrue((out / SUMMARY_FILENAME).exists())
            self.assertFalse(any(p.name.startswith(".ui.tmp-") for p in Path(tmp).iterdir()))


if __name__ == "__main__":
    unittest.main()
