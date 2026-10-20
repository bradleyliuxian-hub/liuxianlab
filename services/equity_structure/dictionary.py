"""Company dictionary correction with RapidFuzz (difflib fallback)."""

from __future__ import annotations

import threading
from pathlib import Path
from typing import List, Optional, Tuple

try:  # RapidFuzz is installed in the OCR environment.
    from rapidfuzz import fuzz, process
except Exception:  # pragma: no cover - exercised in the base test env
    fuzz = None
    process = None

from .config import DEFAULT_DICTIONARY
from .normalize import normalize_text

_lock = threading.Lock()
_cache: dict[str, tuple[float, List[str]]] = {}


def load_dictionary(path: Path | str = DEFAULT_DICTIONARY) -> List[str]:
    dictionary_path = Path(path).expanduser()
    try:
        mtime = dictionary_path.stat().st_mtime
    except OSError:
        return []
    key = str(dictionary_path)
    with _lock:
        cached = _cache.get(key)
        if cached and cached[0] == mtime:
            return cached[1]
    words: List[str] = []
    try:
        for line in dictionary_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            words.append(line)
    except OSError:
        return []
    with _lock:
        _cache[key] = (mtime, words)
    return words


def _similarity(left: str, right: str) -> float:
    if fuzz is not None:
        return float(fuzz.ratio(left, right))
    from difflib import SequenceMatcher
    return SequenceMatcher(None, left, right).ratio() * 100


def correct_name(
    name: str,
    dictionary: Optional[List[str]] = None,
    threshold: float = 91.0,
    min_length: int = 3,
    long_name_min_length: int = 20,
    long_name_discount: float = 3.0,
) -> Tuple[str, Optional[float], Optional[str]]:
    """Return ``(corrected, similarity, original_if_corrected)``."""
    text = normalize_text(name)
    words = dictionary if dictionary is not None else load_dictionary()
    if not words or len(text) < min_length:
        return name, None, None

    # OCR text is whitespace/punctuation-normalized; normalize dictionary
    # entries the same way while returning the original spelling for display.
    normalized_words = [normalize_text(word) for word in words]
    if process is not None:
        match = process.extractOne(text, normalized_words, scorer=fuzz.ratio)
        if not match:
            return name, None, None
        _candidate_norm, score, index = match
        candidate = words[int(index)]
        score = float(score)
    else:
        index = max(range(len(words)), key=lambda i: _similarity(text, normalized_words[i]))
        candidate = words[index]
        score = _similarity(text, normalized_words[index])

    # A correction must be close and not wildly different in length; this keeps
    # short personal names and unrelated institutions untouched. Longer legal
    # names tolerate a slightly lower ratio because one OCR error has less
    # relative weight and the candidate itself is highly specific.
    effective_threshold = threshold
    if len(text) >= long_name_min_length:
        effective_threshold = max(0.0, threshold - long_name_discount)
    length_guard = max(6, int(len(text) * 0.2))
    if score >= effective_threshold and abs(len(candidate) - len(text)) <= length_guard:
        if candidate != text:
            return candidate, score, text
        return text, score, None
    return name, score, None
