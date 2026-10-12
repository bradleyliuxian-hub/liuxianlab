import json
import re
from pathlib import Path


def _extract_text(
    node,
):
    """
    Recursively extract textual content from a
    MinerU MiddleJson node.
    """

    if isinstance(
        node,
        str,
    ):
        return node


    if isinstance(
        node,
        list,
    ):
        parts = [
            _extract_text(
                item
            )
            for item in node
        ]

        return " ".join(
            part
            for part in parts
            if part
        )


    if isinstance(
        node,
        dict,
    ):
        parts = []

        for key in (
            "text",
            "value",
            "content",
        ):

            if key not in node:
                continue

            value = _extract_text(
                node[key]
            )

            if value:
                parts.append(
                    value
                )

        return " ".join(
            parts
        )


    return ""


def _normalize_text(
    value,
):
    """
    Normalize only for matching.
    Do not modify the actual OCR result.
    """

    value = str(
        value or ""
    ).casefold()


    value = re.sub(
        r"[\s\W_]+",
        "",
        value,
        flags=re.UNICODE,
    )


    return value


def _valid_bbox(
    value,
):
    if (
        not isinstance(
            value,
            list,
        )
        or len(value) != 4
    ):
        return None


    try:

        bbox = [
            float(
                item
            )
            for item in value
        ]

    except (
        TypeError,
        ValueError,
    ):

        return None


    x1, y1, x2, y2 = bbox


    if (
        x2 <= x1
        or y2 <= y1
    ):
        return None


    return bbox


def _bbox_area(
    bbox,
):
    return (
        max(
            0.0,
            bbox[2] - bbox[0],
        )
        *
        max(
            0.0,
            bbox[3] - bbox[1],
        )
    )


def _iter_positioned_nodes(
    node,
    page_idx,
):
    """
    Yield every MiddleJson dictionary node that has:
    - textual content
    - bbox

    Child nodes are included so we can prefer a
    smaller/more precise bbox when possible.
    """

    if isinstance(
        node,
        dict,
    ):

        bbox = _valid_bbox(
            node.get(
                "bbox"
            )
        )


        text = _extract_text(
            node
        ).strip()


        if (
            bbox
            and text
        ):

            yield {
                "page_idx":
                    page_idx,

                "bbox":
                    bbox,

                "text":
                    text,

                "type":
                    node.get(
                        "type"
                    ),
            }


        for (
            key,
            value,
        ) in node.items():

            if key == "bbox":
                continue

            yield from _iter_positioned_nodes(
                value,
                page_idx,
            )


    elif isinstance(
        node,
        list,
    ):

        for item in node:

            yield from _iter_positioned_nodes(
                item,
                page_idx,
            )


def _load_candidates(
    middle_json_path,
):
    path = Path(
        middle_json_path
    )


    data = json.loads(
        path.read_text(
            encoding="utf-8"
        )
    )


    pages = data.get(
        "pages",
        []
    )


    candidates = []


    for page in pages:

        page_idx = int(
            page.get(
                "page_idx",
                0,
            )
        )


        blocks = page.get(
            "blocks",
            []
        )


        candidates.extend(
            _iter_positioned_nodes(
                blocks,
                page_idx,
            )
        )


    return candidates


def _match_score(
    source_text,
    candidate_text,
):
    source = str(
        source_text or ""
    ).strip()


    candidate = str(
        candidate_text or ""
    ).strip()


    if (
        not source
        or not candidate
    ):
        return 0.0


    # Best case:
    # exact OCR text appears inside this block.
    if source in candidate:
        return 1.0


    source_folded = (
        source.casefold()
    )


    candidate_folded = (
        candidate.casefold()
    )


    if (
        source_folded
        in candidate_folded
    ):
        return 0.99


    normalized_source = (
        _normalize_text(
            source
        )
    )


    normalized_candidate = (
        _normalize_text(
            candidate
        )
    )


    if (
        normalized_source
        and
        normalized_source
        in normalized_candidate
    ):
        return 0.95


    return 0.0


def locate_issue(
    issue,
    candidates,
):
    # Preserve direct MinerU location.
    #
    # Structural issues such as image / aside_text
    # already come with authoritative page+bbox.
    existing_bbox = _valid_bbox(
        issue.get(
            "bbox"
        )
    )

    existing_page_idx = (
        issue.get(
            "pageIdx"
        )
    )

    existing_page = (
        issue.get(
            "page"
        )
    )

    if (
        existing_bbox is not None
        and
        (
            existing_page_idx
            is not None
            or
            existing_page
            is not None
        )
    ):

        result = dict(
            issue
        )

        if existing_page_idx is None:

            existing_page_idx = (
                int(
                    existing_page
                )
                - 1
            )


        if existing_page is None:

            existing_page = (
                int(
                    existing_page_idx
                )
                + 1
            )


        result["pageIdx"] = (
            int(
                existing_page_idx
            )
        )

        result["page"] = (
            int(
                existing_page
            )
        )

        result["bbox"] = (
            existing_bbox
        )

        result.setdefault(
            "bboxMode",
            "normalized",
        )

        result.setdefault(
            "locationConfidence",
            1.0,
        )

        return result

    source_text = str(
        issue.get(
            "sourceText"
        )
        or ""
    ).strip()


    if not source_text:

        return dict(
            issue
        )


    best = None


    for candidate in candidates:

        score = _match_score(
            source_text,
            candidate["text"],
        )


        if score <= 0:
            continue


        area = _bbox_area(
            candidate["bbox"]
        )


        rank = (
            score,
            -area,
        )


        if (
            best is None
            or rank > best["rank"]
        ):

            best = {
                "rank":
                    rank,

                "score":
                    score,

                "candidate":
                    candidate,
            }


    result = dict(
        issue
    )


    if best is None:

        result["page"] = None
        result["pageIdx"] = None
        result["bbox"] = None
        result["bboxMode"] = None
        result["locationConfidence"] = 0.0

        return result


    candidate = best[
        "candidate"
    ]


    page_idx = int(
        candidate[
            "page_idx"
        ]
    )


    bbox = [
        round(
            float(value),
            6,
        )
        for value
        in candidate[
            "bbox"
        ]
    ]


    result["pageIdx"] = (
        page_idx
    )


    # UI page number is 1-based.
    result["page"] = (
        page_idx + 1
    )


    result["bbox"] = (
        bbox
    )


    result["bboxMode"] = (
        "normalized"
    )


    result[
        "locationConfidence"
    ] = round(
        float(
            best["score"]
        ),
        3,
    )


    result["matchedText"] = (
        candidate["text"][:500]
    )


    result["matchedBlockType"] = (
        candidate.get(
            "type"
        )
    )


    return result


def locate_issues(
    issues,
    middle_json_path,
):
    """
    Enrich issues with page and bbox.

    Does not modify OCR text and does not make
    any legal/content decisions.
    """

    path = Path(
        middle_json_path
    )


    if not path.is_file():

        return [
            dict(
                issue
            )
            for issue
            in issues
        ]


    candidates = (
        _load_candidates(
            path
        )
    )


    return [
        locate_issue(
            issue,
            candidates,
        )
        for issue
        in issues
    ]
