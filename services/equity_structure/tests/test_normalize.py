from __future__ import annotations

import unittest

from services.equity_structure.normalize import (
    clean_name,
    contains_cancel_word,
    normalize_percentage,
    normalize_text,
)


class NormalizeTest(unittest.TestCase):
    def test_text_normalization(self):
        self.assertEqual(normalize_text(" 上海　示例 公司 "), "上海示例公司")
        self.assertEqual(normalize_text("ＡＢＣ　有限公司"), "ABC有限公司")

    def test_percentage_forms(self):
        self.assertEqual(normalize_percentage("54%"), "54%")
        self.assertEqual(normalize_percentage("0.46％"), "0.46%")
        self.assertEqual(normalize_percentage("30.4498%"), "30.4498%")
        self.assertEqual(normalize_percentage("2.9412 %"), "2.9412%")
        self.assertEqual(normalize_percentage("120%"), "")
        self.assertEqual(normalize_percentage("54"), "")
        self.assertEqual(normalize_percentage("54", allow_missing_sign=True), "54%")

    def test_clean_name_removes_noise_and_status(self):
        self.assertEqual(clean_name("上海示例科技有限公司 54%"), "上海示例科技有限公司")
        self.assertEqual(clean_name("展开上海示例有限公司"), "上海示例有限公司")
        self.assertEqual(clean_name("上海示例有限公司（已注销）"), "上海示例有限公司")

    def test_display_keeps_latin_word_spaces(self):
        from services.equity_structure.normalize import normalize_display
        self.assertEqual(normalize_display("CITIGROUP   GLOBAL  MARKETS LIMITED"), "CITIGROUP GLOBAL MARKETS LIMITED")
        self.assertEqual(normalize_display("BARCLAYS BANK PLC"), "BARCLAYS BANK PLC")
        self.assertEqual(normalize_display("上海  元祖 有限公司"), "上海元祖有限公司")

    def test_wrap_text_keeps_english_word_boundaries(self):
        from services.equity_structure.layout import wrap_text
        lines = wrap_text("CITIGROUP GLOBAL MARKETS LIMITED", 16)
        self.assertEqual(lines[0], "CITIGROUP GLOBAL")
        self.assertIn("MARKETS", " ".join(lines))

    def test_cancel_detection(self):
        self.assertTrue(contains_cancel_word("已注销"))
        self.assertTrue(contains_cancel_word("吊销"))
        self.assertFalse(contains_cancel_word("存续"))

    def test_clean_name_keeps_english_spaces(self):
        self.assertEqual(clean_name("CITIGROUP GLOBAL MARKETS LIMITED"), "CITIGROUP GLOBAL MARKETS LIMITED")
        self.assertEqual(clean_name("UBS AG"), "UBS AG")


if __name__ == "__main__":
    unittest.main()
