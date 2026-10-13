"""
Deterministic parse-quality gate (Contract Digitization v1.1).

This is NOT an AI confidence score and it does NOT fabricate
OCR confidence. It only detects "Basic clearly failed / is
badly incomplete" so AUTO can fall back to Standard.

Ordinary OCR issues (one wrong digit, a seal needing a human
look, a single [Illegible]) must NOT trigger a fallback. Those
belong to the human review workflow.

Thresholds are centralized and may be overridden by env vars.
"""

import json
import os
import re
from pathlib import Path

from .issue_detector import ILLEGIBLE_MARKERS


# ---------------------------------------------------------------------------
# Centralized thresholds (no magic numbers in the check logic below)
# ---------------------------------------------------------------------------

DEFAULT_MIN_TOTAL_CHARS = 300
DEFAULT_CHARS_PER_PAGE = 120

DEFAULT_ILLEGIBLE_ABS = 20
DEFAULT_ILLEGIBLE_RATIO = 0.02

DEFAULT_REPLACEMENT_ABS = 20
DEFAULT_REPLACEMENT_RATIO = 0.01

DEFAULT_PAGE_COVERAGE_MIN = 0.50
DEFAULT_MIN_MEANINGFUL_PER_PAGE = 20


# Machine-readable reason codes.
REASON_MISSING_MARKDOWN = "missing_markdown"
REASON_EMPTY_MARKDOWN = "empty_markdown"
REASON_MISSING_MIDDLE_JSON = "missing_middle_json"
REASON_INVALID_MIDDLE_JSON = "invalid_middle_json"
REASON_PAGE_COUNT_MISMATCH = "page_count_mismatch"
REASON_LOW_TEXT_VOLUME = "extremely_low_text_volume"
REASON_EXCESSIVE_ILLEGIBLE = "excessive_illegible_markers"
REASON_ENCODING_NOISE = "encoding_noise"
REASON_INSUFFICIENT_COVERAGE = "insufficient_page_coverage"


_MEANINGFUL_RE = re.compile(
    r"[A-Za-z0-9\u4e00-\u9fff]"
)


def _env_int(name, default):
    try:
        return int(os.getenv(name, default))
    except (TypeError, ValueError):
        return default


def _env_float(name, default):
    try:
        return float(os.getenv(name, default))
    except (TypeError, ValueError):
        return default


def thresholds():
    return {
        "min_total_chars": _env_int(
            "CONTRACT_QG_MIN_TOTAL_CHARS",
            DEFAULT_MIN_TOTAL_CHARS,
        ),
        "chars_per_page": _env_int(
            "CONTRACT_QG_CHARS_PER_PAGE",
            DEFAULT_CHARS_PER_PAGE,
        ),
        "illegible_abs": _env_int(
            "CONTRACT_QG_ILLEGIBLE_ABS",
            DEFAULT_ILLEGIBLE_ABS,
        ),
        "illegible_ratio": _env_float(
            "CONTRACT_QG_ILLEGIBLE_RATIO",
            DEFAULT_ILLEGIBLE_RATIO,
        ),
        "replacement_abs": _env_int(
            "CONTRACT_QG_REPLACEMENT_ABS",
            DEFAULT_REPLACEMENT_ABS,
        ),
        "replacement_ratio": _env_float(
            "CONTRACT_QG_REPLACEMENT_RATIO",
            DEFAULT_REPLACEMENT_RATIO,
        ),
        "page_coverage_min": _env_float(
            "CONTRACT_QG_PAGE_COVERAGE_MIN",
            DEFAULT_PAGE_COVERAGE_MIN,
        ),
        "min_meaningful_per_page": _env_int(
            "CONTRACT_QG_MIN_MEANINGFUL_PER_PAGE",
            DEFAULT_MIN_MEANINGFUL_PER_PAGE,
        ),
    }


def _meaningful_chars(value):
    return len(
        _MEANINGFUL_RE.findall(
            value or ""
        )
    )


def _count_illegible(text):
    lowered = text.casefold()

    total = 0

    for marker in ILLEGIBLE_MARKERS:
        total += lowered.count(marker)

    return total


def _page_text(node):
    """
    Best-effort text extraction for MinerU middle-json
    content nodes. Mirrors issue_detector's tolerant walk.
    """

    if isinstance(node, str):
        return node

    if isinstance(node, list):
        return " ".join(
            _page_text(item)
            for item in node
        )

    if isinstance(node, dict):
        for key in ("content", "text", "value"):
            if key in node:
                value = _page_text(node[key])

                if value:
                    return value

    return ""


def _parse_middle_pages(middle_json_path):
    """
    Return (pages, error_reason).

    pages is a list of pages from MinerU middle_json.json.
    """

    if not middle_json_path:
        return None, REASON_MISSING_MIDDLE_JSON

    path = Path(middle_json_path)

    if not path.is_file():
        return None, REASON_MISSING_MIDDLE_JSON

    try:
        data = json.loads(
            path.read_text(
                encoding="utf-8",
                errors="replace",
            )
        )
    except (ValueError, OSError):
        return None, REASON_INVALID_MIDDLE_JSON

    if not isinstance(data, dict):
        return None, REASON_INVALID_MIDDLE_JSON

    pages = data.get("pages")

    if not isinstance(pages, list):
        return [], None

    return pages, None


def evaluate_parse_quality(
    markdown_path,
    *,
    middle_json_path=None,
    page_count=None,
):
    """
    Deterministic Basic-result validation.

    Returns:
        {
          "passed": bool,
          "reasons": [machine-readable reason, ...],
          "metrics": {...}
        }
    """

    config = thresholds()

    reasons = []

    metrics = {
        "thresholds": config,
    }

    text = ""

    markdown_ok = False

    path = (
        Path(markdown_path)
        if markdown_path
        else None
    )

    if path is None or not path.is_file():
        reasons.append(REASON_MISSING_MARKDOWN)
    else:
        try:
            text = path.read_text(
                encoding="utf-8",
                errors="replace",
            )
            markdown_ok = True
        except OSError:
            reasons.append(REASON_MISSING_MARKDOWN)

    if markdown_ok and not text.strip():
        reasons.append(REASON_EMPTY_MARKDOWN)

    meaningful_chars = _meaningful_chars(text)
    total_chars = len(text)
    word_count = len(text.split()) or 1
    illegible_count = _count_illegible(text)
    replacement_count = text.count("\ufffd")

    metrics["markdownChars"] = meaningful_chars
    metrics["totalChars"] = total_chars
    metrics["wordCount"] = word_count
    metrics["illegibleCount"] = illegible_count
    metrics["illegibleRatio"] = round(
        illegible_count / word_count,
        6,
    )
    metrics["replacementCharCount"] = replacement_count
    metrics["replacementCharRatio"] = round(
        replacement_count / max(1, total_chars),
        6,
    )

    # -- input page count (only trusted when provided) --
    input_pages = None

    try:
        if page_count is not None:
            input_pages = int(page_count)

            if input_pages <= 0:
                input_pages = None
    except (TypeError, ValueError):
        input_pages = None

    # -- middle json / page coverage --
    pages, middle_error = _parse_middle_pages(
        middle_json_path
    )

    parsed_pages = None
    page_coverage = None

    if middle_error == REASON_INVALID_MIDDLE_JSON:
        reasons.append(REASON_INVALID_MIDDLE_JSON)

    elif middle_error == REASON_MISSING_MIDDLE_JSON:
        reasons.append(REASON_MISSING_MIDDLE_JSON)

    elif pages is not None:
        parsed_pages = len(pages)

        min_per_page = config["min_meaningful_per_page"]

        meaningful_pages = 0

        for page in pages:
            if not isinstance(page, dict):
                continue

            page_chars = 0

            for block in page.get("blocks", []) or []:
                if isinstance(block, dict):
                    page_chars += _meaningful_chars(
                        _page_text(
                            block.get("content")
                        )
                    )

            if page_chars >= min_per_page:
                meaningful_pages += 1

        if parsed_pages > 0:
            page_coverage = meaningful_pages / parsed_pages

    metrics["pageCountInput"] = input_pages
    metrics["pageCountParsed"] = parsed_pages
    metrics["pageCoverage"] = (
        round(page_coverage, 6)
        if page_coverage is not None
        else None
    )

    # -- page count mismatch (only when BOTH counts are reliable) --
    #
    # Strict equality. We intentionally do NOT allow a tolerance:
    # a difference means pages were dropped or mis-grouped.
    #
    # There is no "blank page" exception in v1.1. If a real blank
    # page fixture ever proves MinerU legitimately omits a page,
    # it must be added together with a committed fixture and a
    # documented reason -- not loosened up front.
    if (
        input_pages is not None
        and parsed_pages is not None
        and parsed_pages != input_pages
    ):
        reasons.append(REASON_PAGE_COUNT_MISMATCH)

    # -- extremely low text volume --
    reference_pages = (
        input_pages
        or parsed_pages
        or 1
    )

    min_total_chars = max(
        config["min_total_chars"],
        reference_pages
        * config["chars_per_page"],
    )

    metrics["minTotalChars"] = min_total_chars

    if meaningful_chars < min_total_chars:
        reasons.append(REASON_LOW_TEXT_VOLUME)

    # -- excessive illegible markers (absolute AND relative) --
    if (
        illegible_count >= config["illegible_abs"]
        and metrics["illegibleRatio"]
        >= config["illegible_ratio"]
    ):
        reasons.append(REASON_EXCESSIVE_ILLEGIBLE)

    # -- encoding noise --
    if (
        replacement_count >= config["replacement_abs"]
        and metrics["replacementCharRatio"]
        >= config["replacement_ratio"]
    ):
        reasons.append(REASON_ENCODING_NOISE)

    # -- insufficient page coverage --
    if (
        page_coverage is not None
        and page_coverage
        < config["page_coverage_min"]
    ):
        reasons.append(REASON_INSUFFICIENT_COVERAGE)

    # Keep the reason list deterministic and de-duplicated.
    seen = set()
    ordered_reasons = []

    for reason in reasons:
        if reason not in seen:
            seen.add(reason)
            ordered_reasons.append(reason)

    return {
        "passed": len(ordered_reasons) == 0,
        "reasons": ordered_reasons,
        "metrics": metrics,
    }


def fallback_reason(reasons):
    """
    Build the machine-readable fallback reason string.
    """

    if not reasons:
        return "basic_quality_gate_failed"

    return (
        "basic_quality_gate_failed:"
        + ",".join(reasons)
    )
