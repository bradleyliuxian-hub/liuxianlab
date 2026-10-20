from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from openpyxl import Workbook

from services.purchase_reconciliation import worker


def make_job(directory: Path) -> Path:
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "DATABASE"
    headers = ["送货日期", "供应商", "采购订单", "采购订单项目", "物料编码", "订单单位", "数量", "单价", "每", "总金额", "移动类型"]
    sheet.append(headers)
    sheet.append(["2026-01-02", "V1", "PO1", "10", "M1", "KG", 100, 10, 1, 1000, "101"])
    sheet.append(["2026-01-03", "V1", "PO1", "10", "M1", "KG", -30, 10, 1, -300, "122"])
    workbook.save(directory / "source.xlsx")
    (directory / "meta.json").write_text(json.dumps({"sourceFile": "source.xlsx", "originalFilename": "sample.xlsx"}, ensure_ascii=False), encoding="utf-8")
    (directory / "request.json").write_text(json.dumps({
        "sheetName": "DATABASE",
        "headerRow": 1,
    }, ensure_ascii=False), encoding="utf-8")
    return directory


class WorkerIntegrationTest(unittest.TestCase):
    def test_worker_writes_summary_ndjson_and_exports(self):
        with tempfile.TemporaryDirectory() as directory:
            job_dir = make_job(Path(directory))
            worker.run(job_dir)
            status = json.loads((job_dir / "status.json").read_text(encoding="utf-8"))
            self.assertEqual(status["status"], "completed")
            self.assertEqual(status["xlsx"], "ready")
            summary = json.loads((job_dir / "result" / "summary.json").read_text(encoding="utf-8"))
            self.assertEqual(summary["metrics"]["match_segment_count"], 1)
            self.assertEqual(summary["counts"]["segments"], 1)
            self.assertEqual(summary["counts"]["remainingRows"], 1)
            self.assertTrue((job_dir / "result" / "reconciliation-result.xlsx").exists())
            self.assertTrue((job_dir / "result" / "reconciliation-result-csv.zip").exists())
            segment = json.loads((job_dir / "result" / "segments.ndjson").read_text(encoding="utf-8").strip())
            self.assertEqual(segment["matchId"], "MATCH-000001")
            self.assertEqual(segment["matchedQuantity"], "30")

    def test_worker_fails_with_missing_columns(self):
        with tempfile.TemporaryDirectory() as directory:
            job_dir = Path(directory)
            workbook = Workbook()
            sheet = workbook.active
            sheet.append(["供应商", "数量"])
            sheet.append(["V1", 10])
            workbook.save(job_dir / "source.xlsx")
            (job_dir / "meta.json").write_text(json.dumps({"sourceFile": "source.xlsx"}), encoding="utf-8")
            (job_dir / "request.json").write_text(json.dumps({"sheetName": "Sheet", "headerRow": 1}), encoding="utf-8")
            code = worker.main(["--job-dir", str(job_dir)])
            self.assertEqual(code, 2)
            status = json.loads((job_dir / "status.json").read_text(encoding="utf-8"))
            self.assertEqual(status["status"], "failed")
            self.assertIn("缺少必要字段", status["error"])


if __name__ == "__main__":
    unittest.main()
