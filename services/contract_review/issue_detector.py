import html
import json
import re
import uuid
from pathlib import Path


CHINESE_NUMBERS = {
    "零": 0,
    "一": 1,
    "二": 2,
    "两": 2,
    "三": 3,
    "四": 4,
    "五": 5,
    "六": 6,
    "七": 7,
    "八": 8,
    "九": 9,
    "十": 10,
}


ILLEGIBLE_MARKERS = (
    "[illegible]",
    "illegible",
    "[unclear]",
    "unreadable",
    "[unreadable]",
)


def make_issue(
    *,
    issue_type,
    severity,
    title,
    message,
    source_text="",
    suggested_text="",
):
    return {
        "id":
            str(
                uuid.uuid4()
            ),

        "type":
            issue_type,

        "severity":
            severity,

        "title":
            title,

        "message":
            message,

        "sourceText":
            source_text,

        "suggestedText":
            suggested_text,

        "page":
            None,

        "pageIdx":
            None,

        "bbox":
            None,

        "bboxMode":
            None,

        "locationConfidence":
            0.0,

        "status":
            "open",
    }


def _make_positioned_issue(
    *,
    issue_type,
    severity,
    title,
    message,
    source_text,
    page_idx,
    bbox,
):
    issue = make_issue(
        issue_type=
            issue_type,

        severity=
            severity,

        title=
            title,

        message=
            message,

        source_text=
            source_text,
    )


    issue["pageIdx"] = (
        page_idx
    )

    issue["page"] = (
        page_idx + 1
    )

    issue["bbox"] = [
        round(
            float(value),
            6,
        )
        for value in bbox
    ]

    issue["bboxMode"] = (
        "normalized"
    )

    # This means the location comes directly
    # from the MinerU block, not that OCR text
    # itself is 100% correct.
    issue["locationConfidence"] = (
        1.0
    )

    issue["locationSource"] = (
        "mineru_middle_json"
    )

    return issue


def normalize_identifier(
    value: str,
) -> str:
    return re.sub(
        r"[^A-Z0-9]",
        "",
        value.upper(),
    )


def levenshtein(
    a: str,
    b: str,
) -> int:
    if a == b:
        return 0

    if not a:
        return len(b)

    if not b:
        return len(a)

    previous = list(
        range(
            len(b) + 1
        )
    )

    for i, ca in enumerate(
        a,
        start=1,
    ):
        current = [i]

        for j, cb in enumerate(
            b,
            start=1,
        ):
            current.append(
                min(
                    current[j - 1] + 1,
                    previous[j] + 1,
                    previous[j - 1]
                    + (
                        0
                        if ca == cb
                        else 1
                    ),
                )
            )

        previous = current

    return previous[-1]


def filename_identifiers(
    original_name: str,
):
    stem = Path(
        original_name
    ).stem.upper()

    candidates = re.findall(
        r"[A-Z]{2,}[A-Z0-9-]{5,}",
        stem,
    )

    result = []

    for value in candidates:
        value = value.strip(
            "-"
        )

        if not any(
            char.isdigit()
            for char in value
        ):
            continue

        if value not in result:
            result.append(
                value
            )

    return result


def text_identifiers(
    text: str,
):
    candidates = re.findall(
        r"\b[A-Z]{2,}[A-Z0-9-]{5,}\b",
        text.upper(),
    )

    result = []

    for value in candidates:
        value = value.strip(
            "-"
        )

        if not any(
            char.isdigit()
            for char in value
        ):
            continue

        if value not in result:
            result.append(
                value
            )

    return result


def detect_identifier_mismatches(
    text: str,
    original_name: str,
):
    issues = []

    expected_values = (
        filename_identifiers(
            original_name
        )
    )

    actual_values = (
        text_identifiers(
            text
        )
    )

    for expected in expected_values:

        expected_norm = (
            normalize_identifier(
                expected
            )
        )

        if not expected_norm:
            continue

        if any(
            normalize_identifier(
                actual
            )
            == expected_norm
            for actual in actual_values
        ):
            continue

        best = None
        best_distance = None

        for actual in actual_values:

            actual_norm = (
                normalize_identifier(
                    actual
                )
            )

            if (
                abs(
                    len(actual_norm)
                    - len(expected_norm)
                )
                > 2
            ):
                continue

            distance = levenshtein(
                expected_norm,
                actual_norm,
            )

            if (
                best_distance is None
                or distance
                < best_distance
            ):
                best = actual
                best_distance = (
                    distance
                )

        if (
            best
            and
            best_distance
            is not None
            and
            best_distance <= 2
        ):
            issues.append(
                make_issue(
                    issue_type=
                        "identifier_mismatch",

                    severity=
                        "warning",

                    title=
                        "合同编号疑似识别差异",

                    message=(
                        f"文件名中的编号为"
                        f"“{expected}”，"
                        f"正文识别为"
                        f"“{best}”。"
                        f"请对照原合同核对。"
                    ),

                    source_text=
                        best,

                    suggested_text=
                        expected,
                )
            )

    return issues


def parse_quantity(
    value: str,
):
    value = value.strip()

    if value.isdigit():
        return int(
            value
        )

    return CHINESE_NUMBERS.get(
        value
    )


def filename_equipment_quantity(
    original_name: str,
):
    match = re.search(
        r"(\d+)\s*台",
        original_name,
    )

    if not match:
        return None

    return int(
        match.group(1)
    )


def detect_quantity_mismatches(
    text: str,
    original_name: str,
):
    expected = (
        filename_equipment_quantity(
            original_name
        )
    )

    if expected is None:
        return []

    matches = re.findall(
        r"(?<![\d一二三四五六七八九十两])"
        r"(\d+|[一二三四五六七八九十两])"
        r"\s*台",
        text,
    )

    conflicting = []

    for raw in matches:

        number = parse_quantity(
            raw
        )

        if (
            number is None
            or number == expected
        ):
            continue

        label = (
            f"{raw}台"
        )

        if label not in conflicting:
            conflicting.append(
                label
            )

    issues = []

    for value in conflicting:

        issues.append(
            make_issue(
                issue_type=
                    "quantity_mismatch",

                severity=
                    "warning",

                title=
                    "设备数量疑似不一致",

                message=(
                    f"文件名显示设备数量为"
                    f"{expected}台，"
                    f"正文中发现“{value}”。"
                    f"该差异可能是正常合同内容，"
                    f"也可能是 OCR 误识别，"
                    f"请人工核对原文。"
                ),

                source_text=
                    value,

                suggested_text=
                    f"{expected}台",
            )
        )

    return issues


def detect_suspicious_phrases(
    text: str,
):
    rules = [
        (
            "木合同",
            "本合同",
            "疑似 OCR 错字",
        ),
    ]

    issues = []

    for (
        source,
        suggestion,
        title,
    ) in rules:

        if source not in text:
            continue

        issues.append(
            make_issue(
                issue_type=
                    "suspicious_phrase",

                severity=
                    "warning",

                title=
                    title,

                message=(
                    f"正文中发现“{source}”。"
                    f"该文字可能是 OCR 误识别，"
                    f"请对照原合同确认。"
                ),

                source_text=
                    source,

                suggested_text=
                    suggestion,
            )
        )

    return issues


def detect_unusual_text(
    text: str,
):
    issues = []

    if "\ufffd" in text:

        issues.append(
            make_issue(
                issue_type=
                    "encoding_noise",

                severity=
                    "error",

                title=
                    "发现无法识别字符",

                message=(
                    "Markdown 中出现 Unicode "
                    "替换字符 �，"
                    "建议人工检查该位置。"
                ),

                source_text=
                    "\ufffd",
            )
        )

    return issues


def detect_issues(
    *,
    markdown_text: str,
    original_name: str,
):
    """
    Text-level deterministic checks.

    These issues do not yet know their PDF
    location. issue_locator.py adds page/bbox.
    """

    issues = []

    issues.extend(
        detect_identifier_mismatches(
            markdown_text,
            original_name,
        )
    )

    issues.extend(
        detect_quantity_mismatches(
            markdown_text,
            original_name,
        )
    )

    issues.extend(
        detect_suspicious_phrases(
            markdown_text
        )
    )

    issues.extend(
        detect_unusual_text(
            markdown_text
        )
    )

    return issues


# --------------------------------------------------
# MinerU MiddleJson structural review signals
# --------------------------------------------------

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


def _extract_middle_text(
    node,
):
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
            _extract_middle_text(
                item
            )
            for item in node
        ]

        return " ".join(
            value
            for value in parts
            if value
        )

    if isinstance(
        node,
        dict,
    ):
        for key in (
            "content",
            "text",
            "value",
        ):
            if key not in node:
                continue

            value = (
                _extract_middle_text(
                    node[key]
                )
            )

            if value:
                return value

    return ""


def _clean_middle_text(
    value,
):
    value = html.unescape(
        str(
            value or ""
        )
    )

    value = re.sub(
        r"<[^>]+>",
        " ",
        value,
    )

    value = value.replace(
        "\x00",
        ""
    )

    value = re.sub(
        r"\s+",
        " ",
        value,
    ).strip()

    return value


def _meaningful_character_count(
    value,
):
    return len(
        re.findall(
            r"[A-Za-z0-9\u4e00-\u9fff]",
            value,
        )
    )


def _is_edge_bbox(
    bbox,
):
    x1, y1, x2, y2 = bbox

    return (
        x1 >= 0.94
        or x2 <= 0.06
        or y1 >= 0.94
        or y2 <= 0.06
    )


def _is_illegible_text(
    value,
):
    lowered = value.casefold()

    return any(
        marker in lowered
        for marker
        in ILLEGIBLE_MARKERS
    )


def detect_middle_json_issues(
    middle_json_path,
):
    """
    Generate review issues directly from MinerU
    structural blocks.

    Important:
    - no fake OCR confidence
    - table/page_number are not automatically risky
    - direct MinerU bbox is preserved
    """

    path = Path(
        middle_json_path
    )

    if not path.is_file():
        return []

    data = json.loads(
        path.read_text(
            encoding="utf-8"
        )
    )

    issues = []

    pages = data.get(
        "pages",
        []
    )


    for page in pages:

        page_idx = int(
            page.get(
                "page_idx",
                0,
            )
        )

        for block in page.get(
            "blocks",
            []
        ):

            block_type = str(
                block.get(
                    "type",
                    ""
                )
            )

            bbox = _valid_bbox(
                block.get(
                    "bbox"
                )
            )

            if not bbox:
                continue

            raw_text = (
                _extract_middle_text(
                    block.get(
                        "content",
                        ""
                    )
                )
            )

            block_text = (
                _clean_middle_text(
                    raw_text
                )
            )


            # ----------------------------------
            # Explicit unreadable / illegible
            # ----------------------------------

            if (
                block_type
                ==
                "aside_text"
                and
                block_text
                and
                _is_illegible_text(
                    block_text
                )
            ):

                issues.append(
                    _make_positioned_issue(
                        issue_type=
                            "illegible_region",

                        severity=
                            "error",

                        title=
                            "存在无法可靠识别的区域",

                        message=(
                            "MinerU 将该区域识别为"
                            f"“{block_text}”。"
                            "该位置无法可靠自动判断，"
                            "请对照原合同人工确认。"
                        ),

                        source_text=
                            block_text,

                        page_idx=
                            page_idx,

                        bbox=
                            bbox,
                    )
                )

                continue


            # ----------------------------------
            # Abnormal page-edge text
            # ----------------------------------

            if (
                block_type
                ==
                "aside_text"
                and
                block_text
                and
                _meaningful_character_count(
                    block_text
                )
                >= 2
                and
                _is_edge_bbox(
                    bbox
                )
            ):

                issues.append(
                    _make_positioned_issue(
                        issue_type=
                            "edge_text_review",

                        severity=
                            "warning",

                        title=
                            "页面边缘存在异常识别文字",

                        message=(
                            "MinerU 在页面边缘检测到"
                            f"“{block_text}”。"
                            "该内容可能来自印章边缘、"
                            "扫描噪声或其他非正文区域，"
                            "建议人工核对。"
                        ),

                        source_text=
                            block_text,

                        page_idx=
                            page_idx,

                        bbox=
                            bbox,
                    )
                )

                continue


            # ----------------------------------
            # Image region containing OCR text
            # ----------------------------------

            if (
                block_type
                ==
                "image"
            ):

                meaningful_count = (
                    _meaningful_character_count(
                        block_text
                    )
                )


                # Empty edge images are generally
                # scan/seal fragments and add noise.
                if meaningful_count < 2:
                    continue


                if (
                    _is_edge_bbox(
                        bbox
                    )
                    and
                    meaningful_count < 8
                ):
                    continue


                preview_text = (
                    block_text[:240]
                )


                issues.append(
                    _make_positioned_issue(
                        issue_type=
                            "image_text_review",

                        severity=
                            "warning",

                        title=
                            "图像文字建议人工确认",

                        message=(
                            "MinerU 将该区域识别为"
                            "图像，并从图像中提取出文字。"
                            "该区域可能包含印章、签署内容"
                            "或其他非标准正文，"
                            "请对照原件人工确认。"
                        ),

                        source_text=
                            preview_text,

                        page_idx=
                            page_idx,

                        bbox=
                            bbox,
                    )
                )


    return issues
