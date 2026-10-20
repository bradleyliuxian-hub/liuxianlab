from __future__ import annotations

import unittest

try:
    import cv2
    import numpy as np
except Exception:  # pragma: no cover - base env may not have OpenCV
    cv2 = None
    np = None


@unittest.skipUnless(cv2 is not None, "opencv not installed (run scripts/local/setup-equity-ocr.sh)")
class ServiceSmokeTest(unittest.TestCase):
    def test_synthetic_chart_end_to_end(self):
        from services.equity_structure.config import EquityConfig
        from services.equity_structure.ocr_engine import FakeOcrEngine
        from services.equity_structure.ocr_types import OcrItem
        from services.equity_structure.service import analyze_image

        image = np.full((900, 1200, 3), 255, dtype=np.uint8)

        def box(x1, y1, x2, y2, core=False):
            cv2.rectangle(image, (x1, y1), (x2, y2), (235, 245, 255), -1)
            cv2.rectangle(image, (x1, y1), (x2, y2), (67, 154, 212), 3)
            if core:
                cv2.line(image, (x1, y1), (x2, y1), (24, 125, 198), 4)

        box(100, 60, 360, 130)
        box(420, 360, 820, 450, core=True)
        box(420, 640, 760, 720)
        cv2.line(image, (230, 130), (230, 360), (120, 120, 120), 2)
        cv2.line(image, (620, 450), (620, 640), (120, 120, 120), 2)

        def item(text, x, y, score=0.95):
            return OcrItem(text=text, score=score, bbox=[x, y, x + 100, y + 24], center=[x + 50, y + 12])

        engine = FakeOcrEngine([
            item("股东甲", 160, 85),
            item("上海示例股份有限公司", 480, 390),
            item("示例子公司", 500, 665),
            item("51%", 235, 245),
            item("100%", 625, 545),
        ])
        ok, encoded = cv2.imencode(".png", image)
        self.assertTrue(ok)
        result = analyze_image(
            encoded.tobytes(),
            config=EquityConfig(tile_width=1700, tile_height=1200, max_tiles=4, ocr_scales=(1.0,), refine_node_ocr=False),
            engine=engine,
        )
        names = [node.name for node in result.nodes]
        self.assertIn("股东甲", names)
        self.assertIn("上海示例股份有限公司", names)
        self.assertEqual(result.core_company, "上海示例股份有限公司")
        self.assertGreaterEqual(len(result.edges), 2)
        self.assertTrue(all(edge.percentage for edge in result.edges))
        self.assertGreater(result.diagnostics.tile_count, 0)


if __name__ == "__main__":
    unittest.main()
