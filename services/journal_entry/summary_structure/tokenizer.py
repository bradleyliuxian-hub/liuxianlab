"""Safe summary tokenization and normalization."""

from __future__ import annotations

from typing import Iterable, List, Sequence

AUTO_DELIMITERS = ("_", "|", "：", ":", "\t", "/", ";", "；")
PLACEHOLDERS = {"", "-", "--"}
MAX_SAMPLES_PER_ACCOUNT = 5000


def normalize_parts(parts: Sequence[str]) -> List[str]:
    cleaned = [str(value or "").strip() for value in parts]
    while cleaned and cleaned[-1] in PLACEHOLDERS:
        cleaned.pop()
    return cleaned


def tokenize_plain(summary: str, delimiter: str) -> List[str]:
    text = str(summary or "").strip()
    if not text:
        return []
    if delimiter not in text:
        return [text]
    return normalize_parts(text.split(delimiter))


def tokenize_and_normalize(summaries: Iterable[str], delimiter: str) -> List[List[str]]:
    rows = []
    for summary in summaries:
        parts = tokenize_plain(summary, delimiter)
        if parts:
            rows.append(parts)
    return rows
