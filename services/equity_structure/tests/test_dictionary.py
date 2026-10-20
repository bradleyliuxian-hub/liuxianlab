from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from services.equity_structure.dictionary import correct_name, load_dictionary


class DictionaryTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "dict.txt"
        self.path.write_text(
            "# comment\n上海元祖梦果子股份有限公司\n合富（中国）医疗科技股份有限公司\n",
            encoding="utf-8",
        )
        self.words = load_dictionary(self.path)

    def tearDown(self):
        self.temp.cleanup()

    def test_load_skips_comments_and_blank_lines(self):
        self.assertEqual(len(self.words), 2)

    def test_high_similarity_is_corrected(self):
        corrected, score, original = correct_name(
            "上海元祖梦果子份有限公司", self.words, threshold=80, min_length=3
        )
        self.assertEqual(corrected, "上海元祖梦果子股份有限公司")
        self.assertGreaterEqual(score, 80)
        self.assertEqual(original, "上海元祖梦果子份有限公司")

    def test_low_similarity_is_not_corrected(self):
        corrected, _score, original = correct_name(
            "完全不同的名字", self.words, threshold=91, min_length=3
        )
        self.assertEqual(corrected, "完全不同的名字")
        self.assertIsNone(original)

    def test_spaced_english_name_matches_normalized_ocr(self):
        corrected, score, original = correct_name(
            "CITIGROUPGLOBALMARKETSLIMITED",
            ["CITIGROUP GLOBAL MARKETS LIMITED"],
            threshold=90,
            min_length=3,
        )
        self.assertEqual(corrected, "CITIGROUP GLOBAL MARKETS LIMITED")
        self.assertGreaterEqual(score, 90)
        self.assertEqual(original, "CITIGROUPGLOBALMARKETSLIMITED")

    def test_long_name_tolerates_one_ocr_error(self):
        corrected, score, original = correct_name(
            "上海明法投资管理有限公司一明汰宏观2号私募证券投资基金",
            ["上海明汯投资管理有限公司-明汯宏观2号私募证券投资基金"],
            threshold=91,
            min_length=3,
        )
        self.assertTrue(corrected.startswith("上海明汯"))
        self.assertEqual(original, "上海明法投资管理有限公司一明汰宏观2号私募证券投资基金")

    def test_short_person_name_is_untouched(self):
        corrected, _score, original = correct_name("张三", self.words, threshold=10, min_length=3)
        self.assertEqual(corrected, "张三")
        self.assertIsNone(original)


if __name__ == "__main__":
    unittest.main()
