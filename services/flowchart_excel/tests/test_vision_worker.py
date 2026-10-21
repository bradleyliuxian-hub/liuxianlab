import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image

from services.flowchart_excel import vision_worker


class VisionWorkerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.job = Path(self.tmp.name) / "job"
        self.job.mkdir()
        Image.new("RGB", (4, 3), (68, 114, 196)).save(self.job / "source.png")
        (self.job / "meta.json").write_text(json.dumps({
            "id": "job",
            "sourceFile": "source.png",
            "originalFilename": "synthetic.png"
        }), encoding="utf-8")

    def tearDown(self):
        self.tmp.cleanup()

    def test_missing_config_stops_before_model_call(self):
        def must_not_call(**_kwargs):
            raise AssertionError("model must not be called")
        with patch.object(vision_worker, "config_from_env", return_value={
            "configured": False, "missing": ["FLOWCHART_MODEL"], "model": "", "base_url": ""
        }), patch.object(vision_worker, "call_vision", must_not_call):
            code = vision_worker.main(["--job-dir", str(self.job)])
        self.assertEqual(code, 2)
        error = json.loads((self.job / "vision" / "error.json").read_text(encoding="utf-8"))
        self.assertEqual(error["code"], "CONFIGURATION_REQUIRED")
        self.assertFalse((self.job / "vision" / "raw-extraction.json").exists())

    def test_mocked_model_output_creates_raw_json_and_overlay(self):
        raw = {
            "document": {"title": "synthetic"},
            "lanes": [{"id": "lane1", "label": "Mock", "order": 1, "bbox_px": {"x": 0, "y": 0, "w": 2, "h": 2}}],
            "nodes": [{"id": "n1", "label": "Mock", "shape": "process", "lane": "lane1",
                       "bbox_px": {"x": 1, "y": 1, "w": 1, "h": 1}, "confidence": "high"}],
            "edges": [],
            "unresolved_items": []
        }
        with patch.object(vision_worker, "config_from_env", return_value={
            "configured": True, "missing": [], "model": "mock", "base_url": "http://local"
        }), patch.object(vision_worker, "call_vision", return_value=(raw, {
            "model": "mock", "provider": "local", "prompt_version": "1.0.0", "duration_seconds": 0.01
        })):
            code = vision_worker.main(["--job-dir", str(self.job)])
        self.assertEqual(code, 0)
        saved = json.loads((self.job / "vision" / "raw-extraction.json").read_text(encoding="utf-8"))
        self.assertEqual(saved["document"]["source_image_size_px"], {"width": 4, "height": 3})
        self.assertTrue((self.job / "vision" / "review_overlay.png").is_file())
        status = json.loads((self.job / "vision" / "status.json").read_text(encoding="utf-8"))
        self.assertEqual(status["ai_extraction_performed"], True)
        self.assertEqual(status["is_mock"], False)


if __name__ == "__main__":
    unittest.main()
