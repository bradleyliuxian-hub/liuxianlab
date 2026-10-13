import json
import tempfile
import unittest
from pathlib import Path

from services.contract_review import quality_gate


def _write_middle(pages):
    handle = tempfile.NamedTemporaryFile(
        "w",
        suffix=".json",
        delete=False,
        encoding="utf-8",
    )

    json.dump({"pages": pages}, handle)

    handle.close()

    return handle.name


def _page(text, blocks=1):
    return {
        "page_idx": 0,
        "blocks": [
            {"type": "text", "content": text}
            for _ in range(blocks)
        ],
    }


class QualityGateTests(unittest.TestCase):

    def test_missing_markdown(self):
        result = quality_gate.evaluate_parse_quality(
            "/nonexistent/nope.md"
        )

        self.assertFalse(result["passed"])
        self.assertIn(
            quality_gate.REASON_MISSING_MARKDOWN,
            result["reasons"],
        )

    def test_empty_markdown(self):
        with tempfile.NamedTemporaryFile(
            "w",
            suffix=".md",
            delete=False,
            encoding="utf-8",
        ) as handle:
            handle.write("   \n  \n")

        result = quality_gate.evaluate_parse_quality(
            handle.name
        )

        self.assertIn(
            quality_gate.REASON_EMPTY_MARKDOWN,
            result["reasons"],
        )

    def test_invalid_middle_json(self):
        with tempfile.NamedTemporaryFile(
            "w",
            suffix=".md",
            delete=False,
            encoding="utf-8",
        ) as handle:
            handle.write("合同正文 " * 500)

        with tempfile.NamedTemporaryFile(
            "w",
            suffix=".json",
            delete=False,
            encoding="utf-8",
        ) as middle:
            middle.write("{ not json")

        result = quality_gate.evaluate_parse_quality(
            handle.name,
            middle_json_path=middle.name,
        )

        self.assertIn(
            quality_gate.REASON_INVALID_MIDDLE_JSON,
            result["reasons"],
        )

    def test_low_text_volume(self):
        with tempfile.NamedTemporaryFile(
            "w",
            suffix=".md",
            delete=False,
            encoding="utf-8",
        ) as handle:
            handle.write("短")

        result = quality_gate.evaluate_parse_quality(
            handle.name
        )

        self.assertIn(
            quality_gate.REASON_LOW_TEXT_VOLUME,
            result["reasons"],
        )

    def test_few_illegible_markers_pass(self):
        text = ("合同正文 " * 400) + "[Illegible]"

        with tempfile.NamedTemporaryFile(
            "w",
            suffix=".md",
            delete=False,
            encoding="utf-8",
        ) as handle:
            handle.write(text)

        middle = _write_middle(
            [_page("合同正文 " * 200) for _ in range(4)]
        )

        result = quality_gate.evaluate_parse_quality(
            handle.name,
            middle_json_path=middle,
        )

        self.assertNotIn(
            quality_gate.REASON_EXCESSIVE_ILLEGIBLE,
            result["reasons"],
        )
        self.assertTrue(result["passed"])

    def test_many_illegible_markers_fail(self):
        text = " ".join(
            ["合同正文"] * 50
            + ["[Illegible]"] * 40
        )

        with tempfile.NamedTemporaryFile(
            "w",
            suffix=".md",
            delete=False,
            encoding="utf-8",
        ) as handle:
            handle.write(text)

        result = quality_gate.evaluate_parse_quality(
            handle.name
        )

        self.assertIn(
            quality_gate.REASON_EXCESSIVE_ILLEGIBLE,
            result["reasons"],
        )

    def test_encoding_noise(self):
        text = ("合同正文 " * 400) + ("\ufffd" * 40)

        with tempfile.NamedTemporaryFile(
            "w",
            suffix=".md",
            delete=False,
            encoding="utf-8",
        ) as handle:
            handle.write(text)

        result = quality_gate.evaluate_parse_quality(
            handle.name
        )

        self.assertIn(
            quality_gate.REASON_ENCODING_NOISE,
            result["reasons"],
        )

    def test_page_count_mismatch(self):
        text = "合同正文 " * 400

        with tempfile.NamedTemporaryFile(
            "w",
            suffix=".md",
            delete=False,
            encoding="utf-8",
        ) as handle:
            handle.write(text)

        middle = _write_middle(
            [_page("合同正文 " * 100)]
        )

        result = quality_gate.evaluate_parse_quality(
            handle.name,
            middle_json_path=middle,
            page_count=10,
        )

        self.assertIn(
            quality_gate.REASON_PAGE_COUNT_MISMATCH,
            result["reasons"],
        )

    def test_insufficient_page_coverage(self):
        text = "合同正文 " * 400

        with tempfile.NamedTemporaryFile(
            "w",
            suffix=".md",
            delete=False,
            encoding="utf-8",
        ) as handle:
            handle.write(text)

        pages = [
            _page("合同正文 " * 100),
            {"page_idx": 1, "blocks": []},
            {"page_idx": 2, "blocks": []},
            {"page_idx": 3, "blocks": []},
        ]

        middle = _write_middle(pages)

        result = quality_gate.evaluate_parse_quality(
            handle.name,
            middle_json_path=middle,
        )

        self.assertIn(
            quality_gate.REASON_INSUFFICIENT_COVERAGE,
            result["reasons"],
        )

    def test_page_count_equal_no_mismatch(self):
        text = "合同正文 " * 400

        with tempfile.NamedTemporaryFile(
            "w",
            suffix=".md",
            delete=False,
            encoding="utf-8",
        ) as handle:
            handle.write(text)

        middle = _write_middle(
            [_page("合同正文 " * 100)]
        )

        result = quality_gate.evaluate_parse_quality(
            handle.name,
            middle_json_path=middle,
            page_count=1,
        )

        self.assertNotIn(
            quality_gate.REASON_PAGE_COUNT_MISMATCH,
            result["reasons"],
        )

    def test_page_count_extra_pages_mismatch(self):
        # Strict equality: parsed > input is also a mismatch.
        text = "合同正文 " * 400

        with tempfile.NamedTemporaryFile(
            "w",
            suffix=".md",
            delete=False,
            encoding="utf-8",
        ) as handle:
            handle.write(text)

        middle = _write_middle(
            [_page("合同正文 " * 100) for _ in range(3)]
        )

        result = quality_gate.evaluate_parse_quality(
            handle.name,
            middle_json_path=middle,
            page_count=1,
        )

        self.assertIn(
            quality_gate.REASON_PAGE_COUNT_MISMATCH,
            result["reasons"],
        )

    def test_reasons_are_machine_readable(self):
        with tempfile.NamedTemporaryFile(
            "w",
            suffix=".md",
            delete=False,
            encoding="utf-8",
        ) as handle:
            handle.write("")

        result = quality_gate.evaluate_parse_quality(
            handle.name
        )

        for reason in result["reasons"]:
            self.assertRegex(reason, r"^[a-z_]+$")


if __name__ == "__main__":
    unittest.main()
