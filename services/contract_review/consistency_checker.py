import html
import re
import uuid
from decimal import Decimal, InvalidOperation
from pathlib import Path
import json


def make_issue(
    *,
    issue_type,
    severity,
    title,
    message,
    source_text="",
    suggested_text="",
    page=None,
    page_idx=None,
    bbox=None,
):
    return {
        "id": str(
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
            page,
        "pageIdx":
            page_idx,
        "bbox":
            bbox,
        "bboxMode":
            (
                "normalized"
                if bbox
                else None
            ),
        "locationConfidence":
            (
                1.0
                if bbox
                else 0.0
            ),
        "locationSource":
            (
                "mineru_middle_json"
                if bbox
                else None
            ),
        "status":
            "open",
    }


def normalize_space(
    value,
):
    return re.sub(
        r"\s+",
        " ",
        str(
            value or ""
        ),
    ).strip()


def normalize_name(
    value,
):
    value = normalize_space(
        value
    )

    value = re.sub(
        r"[，。；;、]+$",
        "",
        value,
    )

    return value.strip()


def normalize_identifier(
    value,
):
    return re.sub(
        r"[^A-Za-z0-9\-]",
        "",
        str(
            value or ""
        ),
    ).upper()


def extract_contract_numbers(
    text,
):
    matches = re.findall(
        r"合同编号\s*[:：]\s*"
        r"([A-Za-z0-9][A-Za-z0-9\-]{4,40})",
        text,
        flags=re.IGNORECASE,
    )

    result = []

    for value in matches:
        value = normalize_identifier(
            value
        )

        if (
            value
            and value not in result
        ):
            result.append(
                value
            )

    return result


def extract_party_names(
    text,
    label,
):
    pattern = (
        rf"(?:^|\n)"
        rf"\s*{re.escape(label)}"
        rf"\s*[:：]\s*"
        rf"([^\n\r]{{2,100}})"
    )

    values = re.findall(
        pattern,
        text,
        flags=re.MULTILINE,
    )

    result = []

    for value in values:

        # Stop common content following a party name.
        value = re.split(
            r"(?:统一社会信用代码|地址|联系人|电话)"
            r"\s*[:：]",
            value,
            maxsplit=1,
        )[0]

        value = normalize_name(
            value
        )

        if (
            len(value) >= 2
            and value not in result
        ):
            result.append(
                value
            )

    return result


def detect_duplicate_field_conflicts(
    markdown_text,
):
    issues = []

    contract_numbers = (
        extract_contract_numbers(
            markdown_text
        )
    )

    if len(
        contract_numbers
    ) > 1:

        issues.append(
            make_issue(
                issue_type=
                    "contract_number_conflict",

                severity=
                    "error",

                title=
                    "合同编号存在多个不同值",

                message=(
                    "正文中检测到多个不同的合同编号："
                    +
                    "、".join(
                        contract_numbers
                    )
                    +
                    "。请对照原合同确认正确编号。"
                ),

                source_text=
                    " / ".join(
                        contract_numbers
                    ),
            )
        )


    for label in (
        "甲方",
        "乙方",
    ):

        values = (
            extract_party_names(
                markdown_text,
                label,
            )
        )

        if len(
            values
        ) <= 1:
            continue

        issues.append(
            make_issue(
                issue_type=
                    "party_name_conflict",

                severity=
                    "error",

                title=
                    f"{label}名称存在多个不同值",

                message=(
                    f"正文中检测到多个不同的{label}名称："
                    +
                    "；".join(
                        values
                    )
                    +
                    "。请检查是否存在 OCR 误识别。"
                ),

                source_text=
                    " / ".join(
                        values
                    ),
            )
        )

    return {
        "contractNumbers":
            contract_numbers,

        "partyA":
            extract_party_names(
                markdown_text,
                "甲方",
            ),

        "partyB":
            extract_party_names(
                markdown_text,
                "乙方",
            ),

        "issues":
            issues,
    }


def parse_date_value(
    year,
    month,
    day,
):
    try:
        year = int(
            year
        )
        month = int(
            month
        )
        day = int(
            day
        )
    except (
        TypeError,
        ValueError,
    ):
        return None

    if not (
        1900 <= year <= 2200
        and 1 <= month <= 12
        and 1 <= day <= 31
    ):
        return None

    return (
        f"{year:04d}-"
        f"{month:02d}-"
        f"{day:02d}"
    )


def filename_date(
    original_name,
):
    stem = Path(
        original_name
    ).stem

    matches = re.findall(
        r"(?<!\d)"
        r"(20\d{2})"
        r"[-_/年]?"
        r"(\d{1,2})"
        r"[-_/月]?"
        r"(\d{1,2})"
        r"(?:日)?"
        r"(?!\d)",
        stem,
    )

    for match in matches:
        value = parse_date_value(
            *match
        )

        if value:
            return value

    return None


def labeled_contract_dates(
    text,
):
    pattern = re.compile(
        r"(?:签订日期|签署日期|合同日期)"
        r"\s*[:：]?\s*"
        r"(20\d{2})"
        r"\s*[年\-/.]\s*"
        r"(\d{1,2})"
        r"\s*[月\-/.]\s*"
        r"(\d{1,2})"
        r"\s*日?"
    )

    result = []

    for match in pattern.findall(
        text
    ):

        value = parse_date_value(
            *match
        )

        if (
            value
            and value not in result
        ):
            result.append(
                value
            )

    return result


def detect_date_conflict(
    markdown_text,
    original_name,
):
    expected = filename_date(
        original_name
    )

    actual = labeled_contract_dates(
        markdown_text
    )

    issues = []

    # Be conservative:
    # only flag when the document explicitly
    # labels a contract/signing date.
    if (
        expected
        and actual
        and expected not in actual
    ):

        issues.append(
            make_issue(
                issue_type=
                    "contract_date_conflict",

                severity=
                    "warning",

                title=
                    "文件名日期与正文合同日期不一致",

                message=(
                    f"文件名中的日期为 {expected}，"
                    f"正文明确标注的合同/签署日期为 "
                    f"{'、'.join(actual)}。"
                    "请对照原合同确认。"
                ),

                source_text=
                    " / ".join(
                        actual
                    ),

                suggested_text=
                    expected,
            )
        )

    return {
        "filenameDate":
            expected,

        "labeledDates":
            actual,

        "issues":
            issues,
    }


def strip_html(
    value,
):
    value = html.unescape(
        str(
            value or ""
        )
    )

    value = re.sub(
        r"<br\s*/?>",
        "\n",
        value,
        flags=re.IGNORECASE,
    )

    value = re.sub(
        r"<[^>]+>",
        " ",
        value,
    )

    value = re.sub(
        r"\s+",
        " ",
        value,
    )

    return value.strip()


def html_table_rows(
    table_html,
):
    rows = []

    for row_html in re.findall(
        r"<tr\b[^>]*>(.*?)</tr>",
        table_html,
        flags=(
            re.IGNORECASE
            |
            re.DOTALL
        ),
    ):

        cells = []

        for cell_html in re.findall(
            r"<t[dh]\b[^>]*>(.*?)</t[dh]>",
            row_html,
            flags=(
                re.IGNORECASE
                |
                re.DOTALL
            ),
        ):

            cells.append(
                strip_html(
                    cell_html
                )
            )

        if cells:
            rows.append(
                cells
            )

    return rows


def parse_decimal(
    value,
):
    value = normalize_space(
        value
    )

    value = value.replace(
        ",",
        ""
    )

    match = re.search(
        r"[-+]?\d+(?:\.\d+)?",
        value,
    )

    if not match:
        return None

    try:
        return Decimal(
            match.group(0)
        )
    except InvalidOperation:
        return None


def parse_quantity_cell(
    value,
):
    match = re.search(
        r"(\d+(?:\.\d+)?)\s*台",
        str(
            value
        ),
    )

    if not match:
        return None

    return parse_decimal(
        match.group(1)
    )


def parse_year_cell(
    value,
):
    match = re.search(
        r"(\d+(?:\.\d+)?)\s*年",
        str(
            value
        ),
    )

    if not match:
        return None

    return parse_decimal(
        match.group(1)
    )


def find_header_index(
    headers,
    keywords,
):
    for index, value in enumerate(
        headers
    ):

        normalized = (
            normalize_space(
                value
            )
        )

        if all(
            keyword in normalized
            for keyword in keywords
        ):
            return index

    return None


def extract_table_html(
    block,
):
    content = block.get(
        "content",
        []
    )

    if not isinstance(
        content,
        list,
    ):
        return ""

    for item in content:

        if not isinstance(
            item,
            dict,
        ):
            continue

        if (
            item.get(
                "type"
            )
            != "table_body"
        ):
            continue

        value = item.get(
            "content",
            ""
        )

        if value:
            return str(
                value
            )

    return ""


def detect_rental_table_math(
    middle_json_path,
):
    path = Path(
        middle_json_path
    )

    if not path.is_file():
        return {
            "checks": [],
            "issues": [],
        }

    data = json.loads(
        path.read_text(
            encoding="utf-8"
        )
    )

    checks = []
    issues = []

    for page in data.get(
        "pages",
        []
    ):

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

            if (
                block.get(
                    "type"
                )
                != "table"
            ):
                continue

            bbox = block.get(
                "bbox"
            )

            table_html = (
                extract_table_html(
                    block
                )
            )

            if not table_html:
                continue

            rows = html_table_rows(
                table_html
            )

            if len(
                rows
            ) < 2:
                continue

            headers = rows[0]

            quantity_index = (
                find_header_index(
                    headers,
                    [
                        "数量",
                    ],
                )
            )

            term_index = (
                find_header_index(
                    headers,
                    [
                        "租赁期限",
                    ],
                )
            )

            unit_price_index = (
                find_header_index(
                    headers,
                    [
                        "租赁费",
                        "年",
                        "台",
                    ],
                )
            )

            if (
                quantity_index is None
                or term_index is None
                or unit_price_index is None
            ):
                continue

            data_row = None

            for candidate in rows[1:]:

                if len(
                    candidate
                ) <= max(
                    quantity_index,
                    term_index,
                    unit_price_index,
                ):
                    continue

                quantity = (
                    parse_quantity_cell(
                        candidate[
                            quantity_index
                        ]
                    )
                )

                years = (
                    parse_year_cell(
                        candidate[
                            term_index
                        ]
                    )
                )

                unit_price = (
                    parse_decimal(
                        candidate[
                            unit_price_index
                        ]
                    )
                )

                if (
                    quantity is not None
                    and years is not None
                    and unit_price is not None
                ):
                    data_row = {
                        "quantity":
                            quantity,
                        "years":
                            years,
                        "unitPrice":
                            unit_price,
                    }
                    break

            if not data_row:
                continue

            total = None

            for row in rows[1:]:

                row_text = " ".join(
                    row
                )

                if (
                    "合同总金额"
                    not in row_text
                ):
                    continue

                numbers = re.findall(
                    r"\d[\d,]*(?:\.\d+)?",
                    row_text,
                )

                candidates = []

                for value in numbers:

                    number = (
                        parse_decimal(
                            value
                        )
                    )

                    if number is not None:
                        candidates.append(
                            number
                        )

                if candidates:
                    # Contract total is normally
                    # the largest numeric value
                    # in this row.
                    total = max(
                        candidates
                    )

                break

            if total is None:
                continue

            expected = (
                data_row[
                    "quantity"
                ]
                *
                data_row[
                    "years"
                ]
                *
                data_row[
                    "unitPrice"
                ]
            )

            difference = abs(
                expected
                -
                total
            )

            tolerance = max(
                Decimal("1"),
                abs(
                    total
                )
                *
                Decimal(
                    "0.001"
                ),
            )

            passed = (
                difference
                <= tolerance
            )

            check = {
                "page":
                    page_idx + 1,

                "quantity":
                    str(
                        data_row[
                            "quantity"
                        ]
                    ),

                "years":
                    str(
                        data_row[
                            "years"
                        ]
                    ),

                "unitPrice":
                    str(
                        data_row[
                            "unitPrice"
                        ]
                    ),

                "expectedTotal":
                    str(
                        expected
                    ),

                "documentTotal":
                    str(
                        total
                    ),

                "passed":
                    passed,
            }

            checks.append(
                check
            )

            if passed:
                continue

            issues.append(
                make_issue(
                    issue_type=
                        "rental_amount_math_conflict",

                    severity=
                        "error",

                    title=
                        "租赁金额计算关系不一致",

                    message=(
                        "表格中的数量 × 租赁期限 × "
                        "租赁费/年/台与合同总金额不一致。"
                        f"计算结果为 {expected}，"
                        f"合同总金额为 {total}。"
                        "请对照原合同人工确认。"
                    ),

                    source_text=
                        f"合同总金额 {total}",

                    suggested_text=
                        str(
                            expected
                        ),

                    page=
                        page_idx + 1,

                    page_idx=
                        page_idx,

                    bbox=
                        bbox,
                )
            )

    return {
        "checks":
            checks,

        "issues":
            issues,
    }


def analyze_contract_consistency(
    *,
    markdown_text,
    original_name,
    middle_json_path=None,
):
    duplicate_result = (
        detect_duplicate_field_conflicts(
            markdown_text
        )
    )

    date_result = (
        detect_date_conflict(
            markdown_text,
            original_name,
        )
    )

    table_result = {
        "checks": [],
        "issues": [],
    }

    if middle_json_path:

        table_result = (
            detect_rental_table_math(
                middle_json_path
            )
        )

    issues = []

    issues.extend(
        duplicate_result[
            "issues"
        ]
    )

    issues.extend(
        date_result[
            "issues"
        ]
    )

    issues.extend(
        table_result[
            "issues"
        ]
    )

    return {
        "fields": {
            "contractNumbers":
                duplicate_result[
                    "contractNumbers"
                ],

            "partyA":
                duplicate_result[
                    "partyA"
                ],

            "partyB":
                duplicate_result[
                    "partyB"
                ],

            "filenameDate":
                date_result[
                    "filenameDate"
                ],

            "labeledDates":
                date_result[
                    "labeledDates"
                ],
        },

        "tableChecks":
            table_result[
                "checks"
            ],

        "issues":
            issues,
    }
