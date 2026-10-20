from __future__ import annotations

import unittest

from services.equity_structure.png_export import (
    MAX_PNG_DIMENSION,
    PngExportError,
    safe_scale,
    svg_to_png,
    validate_svg,
)


class PngExportTest(unittest.TestCase):
    def test_simple_svg_dimensions(self):
        width, height = validate_svg('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="120"><rect width="400" height="120"/></svg>')
        self.assertEqual((width, height), (400, 120))

    def test_foreign_object_is_rejected(self):
        with self.assertRaises(PngExportError):
            validate_svg('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><foreignObject></foreignObject></svg>')

    def test_external_image_is_rejected(self):
        with self.assertRaises(PngExportError):
            validate_svg('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><image href="https://example.com/a.png"/></svg>')

    def test_large_canvas_reduces_scale(self):
        scale = safe_scale(30000, 1600, 2)
        self.assertLess(scale, 2)
        self.assertLessEqual(30000 * scale, MAX_PNG_DIMENSION + 0.01)

    def test_pixel_limit(self):
        scale = safe_scale(1000, 1000, 20)
        self.assertLessEqual(1000 * 1000 * scale * scale, 120_000_000 + 1)

    def test_cairosvg_produces_png(self):
        try:
            import cairosvg  # noqa: F401
        except Exception:
            self.skipTest("cairosvg not installed")
        svg = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="80"><rect width="200" height="80" fill="white"/><text x="20" y="45" font-size="18">Test 测试</text></svg>'
        png, scale = svg_to_png(svg, 2)
        self.assertTrue(png.startswith(b"\x89PNG"))
        self.assertGreater(len(png), 50)
        self.assertGreater(scale, 0)


if __name__ == "__main__":
    unittest.main()
