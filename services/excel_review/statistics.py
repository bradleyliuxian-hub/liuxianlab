"""Unified question statistics for the Excel Review Assistant.

Single source of truth shared by the review workbook Dashboard and the
web/API summary. A "question" is:

- a legacy Excel note/comment, or
- a Microsoft 365 threaded comment **root**.

A threaded *reply* is not a question. Author = comment author (the person
who raised the question); blank authors are normalised to ``未知作者``.
"""

UNKNOWN_AUTHOR = "未知作者"

QUESTION_TYPES = ("legacy", "threaded")
THREADED_TYPE = "threaded"
LEGACY_TYPE = "legacy"
THREADED_REPLY_TYPE = "threaded_reply"


def normalize_author(value):
    """Normalise an author name for display and grouping.

    None / empty / whitespace-only -> 未知作者. Case and Unicode are
    preserved (Alice and alice are NOT merged).
    """
    text = "" if value is None else str(value).strip()
    if not text or text == "None":
        return UNKNOWN_AUTHOR
    return text


def is_question(item):
    return item.get("commentType") in QUESTION_TYPES


def build_statistics(items):
    """Return the unified statistics object for a list of extracted items."""
    questions = [item for item in items if is_question(item)]
    threaded_questions = [
        item for item in questions if item.get("commentType") == THREADED_TYPE
    ]
    legacy_questions = [
        item for item in questions if item.get("commentType") == LEGACY_TYPE
    ]
    threaded_replies = [
        item for item in items if item.get("commentType") == THREADED_REPLY_TYPE
    ]

    counts = {}
    for item in questions:
        author = normalize_author(item.get("author"))
        counts[author] = counts.get(author, 0) + 1

    ordered = sorted(counts.items(), key=lambda pair: (-pair[1], pair[0]))

    return {
        "questions_total": len(questions),
        "threaded_questions": len(threaded_questions),
        "legacy_questions": len(legacy_questions),
        "threaded_replies": len(threaded_replies),
        "authors_total": len(ordered),
        "authors": [
            {"author": author, "questions": count} for author, count in ordered
        ],
    }
