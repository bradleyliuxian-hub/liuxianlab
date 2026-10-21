import tempfile
import unittest
from pathlib import Path

from PIL import Image

from services.flowchart_excel.image_validation import ImageValidationError, validate_and_prepare


class ImageValidationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def _image(self, name, fmt, size=(4, 3)):
        path = self.root / name
        Image.new("RGB", size, (68, 114, 196)).save(path, format=fmt)
        return path

    def test_valid_png_jpeg_webp_decode(self):
        for name, fmt in (("a.png", "PNG"), ("a.jpg", "JPEG"), ("a.webp", "WEBP")):
            source = self._image(name, fmt)
            meta = validate_and_prepare(source, self.root / ("out-" + name))
            self.assertEqual(meta["source_width"], 4)
            self.assertEqual(meta["source_height"], 3)
            self.assertTrue(Path(meta["prepared_path"]).is_file())
            self.assertEqual(len(meta["source_sha256"]), 64)

    def test_corrupt_image_is_rejected(self):
        path = self.root / "bad.png"
        path.write_bytes(b"\x89PNG\r\n\x1a\n" + b"0" * 20)
        with self.assertRaises(ImageValidationError) as ctx:
            validate_and_prepare(path, self.root / "out")
        self.assertEqual(ctx.exception.code, "IMAGE_DECODE_FAILED")

    def test_pixel_limit_is_rejected(self):
        source = self._image("large.png", "PNG", size=(20, 20))
        with self.assertRaises(ImageValidationError) as ctx:
            validate_and_prepare(source, self.root / "out", max_pixels=100)
        self.assertEqual(ctx.exception.code, "IMAGE_TOO_LARGE")

    def test_resize_keeps_original_metadata(self):
        source = self._image("wide.png", "PNG", size=(100, 50))
        meta = validate_and_prepare(source, self.root / "out", max_side=40)
        self.assertEqual(meta["source_width"], 100)
        self.assertEqual(meta["prepared_width"], 40)
        self.assertEqual(meta["prepared_height"], 20)
        self.assertEqual(meta["coordinate_scale"] if "coordinate_scale" in meta else 1, 1)
