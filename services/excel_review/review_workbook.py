"""Build the review workbook (V1.2 simplified tool).

V1.2 output layout (fixed structure, always three sheets):

    1. 新版批注   (Microsoft 365 threaded comments + replies)
    2. 旧版批注   (legacy Excel notes/comments)
    3. _Mapping   (hidden - traceability / audit identity)

The product no longer imports user replies or writes back to the source
workbook. The two visible sheets are a free-form human workspace (no
worksheet protection); each row carries a hidden ``_ITEM_ID`` and an
``Excel Address`` for F5 / Ctrl+G lookup.
"""

import hashlib
import json

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Font, PatternFill, Protection
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.table import Table, TableStyleInfo

from .parser import (
    COMMENT_TYPE_LEGACY,
    COMMENT_TYPE_THREADED,
    COMMENT_TYPE_THREADED_REPLY,
    MAPPING_VERSION,
)
from .status import ReviewError

DASHBOARD_SHEET = "Dashboard"
THREADED_SHEET = "新版批注"
LEGACY_SHEET = "旧版批注"
VISIBLE_SHEETS = [THREADED_SHEET, LEGACY_SHEET]
MAPPING_SHEET = "_Mapping"
ITEM_ID_COLUMN = "_ITEM_ID"

TABLE_THREADED = "tblThreadedReview"
TABLE_LEGACY = "tblLegacyReview"

# User-facing columns. Excel Address follows the problem text; Source
# Reference stays the last VISIBLE column. The hidden _ITEM_ID column
# comes after it.
VISIBLE_HEADERS = [
    "类型",
    "原文件",
    "Sheet",
    "Cell",
    "原始值",
    "批注内容",
    "Excel Address",
    "作者",
    "回复",
    "状态",
    "Source Reference",
]
_WRAP_COLUMNS = (6, 9)  # 批注内容 / 回复

TYPE_LABELS = {
    COMMENT_TYPE_LEGACY: "旧版批注",
    COMMENT_TYPE_THREADED: "新版批注",
    COMMENT_TYPE_THREADED_REPLY: "新版回复",
}

VISIBLE_WIDTHS = {
    "A": 14,
    "B": 26,
    "C": 16,
    "D": 8,
    "E": 22,
    "F": 54,
    "G": 30,
    "H": 14,
    "I": 42,
    "J": 10,
    "K": 42,
    "L": 34,
}

# Mapping V3: full machine identity for both legacy and threaded items.
MAPPING_HEADERS = [
    "mapping_version",
    "job_id",
    "item_id",
    "review_id",
    "source_sha256",
    "source_filename",
    "comment_type",
    "sheet_name",
    "cell_address",
    "excel_address",
    "original_value",
    "original_text",
    "original_text_hash",
    "author",
    "comment_datetime",
    "thread_id",
    "parent_thread_id",
    "person_id",
    "legacy_comment_hash",
    "source_reference",
    "visible_sheet_name",
    "visible_row_number",
    "resolved",
    "status",
    "mapping_token",
]

# Identity fields covered by the tamper-detection token.
_TOKEN_FIELDS = [
    "mapping_version",
    "job_id",
    "item_id",
    "review_id",
    "source_sha256",
    "source_filename",
    "comment_type",
    "sheet_name",
    "cell_address",
    "original_text_hash",
    "legacy_comment_hash",
    "thread_id",
    "parent_thread_id",
    "person_id",
]


def compute_mapping_token(rows):
    payload = [
        {key: ("" if row.get(key) is None else row.get(key)) for key in _TOKEN_FIELDS}
        for row in rows
    ]
    canonical = json.dumps(
        payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _base_mapping_row(item, job_id, source_sha256, source_filename,
                      mapping_version):
    return {
        "mapping_version": mapping_version,
        "job_id": str(job_id),
        "item_id": item["itemId"],
        "review_id": item["reviewId"],
        "source_sha256": source_sha256,
        "source_filename": source_filename,
        "comment_type": item["commentType"],
        "sheet_name": item["sheetName"],
        "cell_address": item["cellAddress"],
        "excel_address": item["excelAddress"],
        "original_value": item["cellValue"],
        "original_text": item["commentText"],
        "original_text_hash": item["originalTextHash"],
        "author": item["author"],
        "comment_datetime": item["commentDatetime"],
        "thread_id": item["threadId"],
        "parent_thread_id": item["parentThreadId"],
        "person_id": item["personId"],
        "legacy_comment_hash": item["legacyCommentHash"],
        "source_reference": item["sourceReference"],
        "visible_sheet_name": "",
        "visible_row_number": "",
        "resolved": bool(item.get("resolved", False)),
        "status": item.get("status", "pending"),
        "mapping_token": "",
    }


def set_literal_cell(worksheet, row, column, value):
    """Write ``value`` as literal text when it is a string.

    External content (filenames, sheet names, comments, authors, cell text,
    mapping identity values ...) must never be interpreted by Excel as a
    formula. OpenPyXL marks any string starting with ``=`` as ``data_type
    "f"``; forcing ``data_type "s"`` keeps the original text intact while
    storing it as a literal string. Trusted Dashboard formulas are written
    with the plain ``worksheet[...] = "=..."`` path instead, so they stay
    formulas.
    """
    cell = worksheet.cell(row=row, column=column)
    cell.value = value
    if isinstance(value, str):
        cell.data_type = "s"
    return cell


def _write_visible_sheet(worksheet, items, header_fill, reply_text=None):
    """Write one visible sheet; return {item_id: row_number}.

    ``reply_text`` maps a threaded root's thread id to the merged text of
    its replies (source Microsoft 365 thread replies), written into the
    row's 回复 column so a thread is presented as a single row.
    """
    reply_text = reply_text or {}
    id_column = len(VISIBLE_HEADERS) + 1  # hidden _ITEM_ID column
    for column, name in enumerate(VISIBLE_HEADERS, start=1):
        cell = worksheet.cell(row=1, column=column, value=name)
        cell.font = Font(bold=True)
        cell.fill = header_fill
        cell.protection = Protection(locked=False)
    id_header = worksheet.cell(row=1, column=id_column, value=ITEM_ID_COLUMN)
    id_header.protection = Protection(locked=False)
    worksheet.column_dimensions[get_column_letter(id_column)].hidden = True
    worksheet.freeze_panes = "A2"

    row_numbers = {}
    for offset, item in enumerate(items):
        row = offset + 2
        values = [
            TYPE_LABELS.get(item["commentType"], item["commentType"]),
            item["sourceFilename"],
            item["sheetName"],
            item["cellAddress"],
            item["cellValue"],
            item["commentText"],
            item["excelAddress"],
            item["author"],
            reply_text.get(item.get("threadId", ""), ""),
            item.get("status", "pending"),
            item["sourceReference"],
        ]
        for column, value in enumerate(values, start=1):
            target = set_literal_cell(worksheet, row, column, value)
            target.protection = Protection(locked=False)
            if column in _WRAP_COLUMNS:
                target.alignment = Alignment(wrap_text=True, vertical="top")
        id_cell = set_literal_cell(worksheet, row, id_column, item["itemId"])
        id_cell.protection = Protection(locked=False)
        row_numbers[item["itemId"]] = row

    for column, width in VISIBLE_WIDTHS.items():
        worksheet.column_dimensions[column].width = width
    return row_numbers


def _add_table(worksheet, name, data_rows):
    """Turn a visible sheet into a real Excel Table (header + data rows)."""
    if data_rows <= 0:
        # An Excel Table needs at least one data row; skip empty tables and
        # let the Dashboard formulas guard with IFERROR.
        return False
    last_row = data_rows + 1
    ref = "A1:%s%d" % (get_column_letter(len(VISIBLE_HEADERS)), last_row)
    table = Table(displayName=name, ref=ref)
    table.tableStyleInfo = TableStyleInfo(
        name="TableStyleMedium2", showRowStripes=True, showColumnStripes=False
    )
    worksheet.add_table(table)
    return True


def _build_dashboard(worksheet, statistics, source_filename):
    from datetime import datetime

    bold = Font(bold=True)
    threaded_label = TYPE_LABELS[COMMENT_TYPE_THREADED]

    threaded_root = 'IFERROR(COUNTIF(%s[类型],"%s"),0)' % (
        TABLE_THREADED,
        threaded_label,
    )
    legacy_count = "IFERROR(COUNTA(%s[类型]),0)" % TABLE_LEGACY
    answered_threaded = 'IFERROR(COUNTIFS(%s[类型],"%s",%s[回复],"<>"),0)' % (
        TABLE_THREADED,
        threaded_label,
        TABLE_THREADED,
    )
    answered_legacy = "IFERROR(COUNTIF(%s[回复],\"<>\"),0)" % TABLE_LEGACY

    worksheet["A1"] = "Excel Review Dashboard"
    worksheet["A1"].font = Font(bold=True, size=14)
    worksheet["A2"] = "Source File"
    worksheet["A2"].font = bold
    set_literal_cell(worksheet, 2, 2, source_filename or "source.xlsx")
    worksheet["A3"] = "Generated At"
    worksheet["A3"].font = bold
    worksheet["B3"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    worksheet["A5"] = "问题总数"
    worksheet["A5"].font = bold
    worksheet["B5"] = "=%s+%s" % (threaded_root, legacy_count)
    worksheet["A6"] = "已回答"
    worksheet["A6"].font = bold
    worksheet["B6"] = "=%s+%s" % (answered_threaded, answered_legacy)
    worksheet["A7"] = "未回答"
    worksheet["A7"].font = bold
    worksheet["B7"] = "=B5-B6"
    worksheet["A8"] = "回答率"
    worksheet["A8"].font = bold
    worksheet["B8"] = "=IF(B5=0,0,B6/B5)"
    worksheet["B8"].number_format = "0.0%"

    worksheet["A10"] = "问题类型"
    worksheet["A10"].font = bold
    worksheet["A11"] = "Microsoft 365 新版批注"
    worksheet["B11"] = "=%s" % threaded_root
    worksheet["A12"] = "传统批注 / Note"
    worksheet["B12"] = "=%s" % legacy_count

    worksheet["A14"] = "问题提出人数"
    worksheet["A14"].font = bold
    # Formula (not a hard-coded number): count the author-name cells below.
    worksheet["B14"] = "=COUNTA(A18:A1000)"

    worksheet["A16"] = "按问题提出人"
    worksheet["A16"].font = bold
    for col, name in enumerate(["作者", "问题总数", "已回答", "未回答", "回答率"], start=1):
        cell = worksheet.cell(row=17, column=col, value=name)
        cell.font = bold

    for index, entry in enumerate(statistics.get("authors", []), start=18):
        set_literal_cell(worksheet, index, 1, entry["author"])
        worksheet.cell(
            row=index,
            column=2,
            value=(
                '=IFERROR(COUNTIFS(%s[作者],$A%d,%s[类型],"%s"),0)'
                "+IFERROR(COUNTIF(%s[作者],$A%d),0)"
                % (TABLE_THREADED, index, TABLE_THREADED, threaded_label,
                   TABLE_LEGACY, index)
            ),
        )
        worksheet.cell(
            row=index,
            column=3,
            value=(
                '=IFERROR(COUNTIFS(%s[作者],$A%d,%s[类型],"%s",%s[回复],"<>"),0)'
                '+IFERROR(COUNTIFS(%s[作者],$A%d,%s[回复],"<>"),0)'
                % (TABLE_THREADED, index, TABLE_THREADED, threaded_label,
                   TABLE_THREADED, TABLE_LEGACY, index, TABLE_LEGACY)
            ),
        )
        worksheet.cell(row=index, column=4, value="=B%d-C%d" % (index, index))
        rate = worksheet.cell(
            row=index, column=5, value="=IF(B%d=0,0,C%d/B%d)" % (index, index, index)
        )
        rate.number_format = "0.0%"

    worksheet.column_dimensions["A"].width = 30
    worksheet.column_dimensions["B"].width = 18
    worksheet.column_dimensions["C"].width = 12
    worksheet.column_dimensions["D"].width = 12
    worksheet.column_dimensions["E"].width = 12
    worksheet.freeze_panes = "A5"


def build_review_workbook(path, items, job_id, source_sha256, source_filename,
                          statistics):
    """Build review.xlsx; return the mapping rows (with token set).

    A Microsoft 365 thread is presented as ONE row (its root question);
    the thread's replies are merged into that row's 回复 column instead of
    each reply becoming its own row.
    """
    threaded_roots = [
        item for item in items if item["commentType"] == COMMENT_TYPE_THREADED
    ]
    legacy_items = [
        item for item in items if item["commentType"] == COMMENT_TYPE_LEGACY
    ]

    # Merge each thread's replies (rootThreadId -> newline-joined text).
    merged = {}
    for item in items:
        if item["commentType"] != COMMENT_TYPE_THREADED_REPLY:
            continue
        key = (
            item.get("rootThreadId")
            or item.get("parentThreadId")
            or item.get("threadId")
        )
        merged.setdefault(key, []).append(item.get("commentText", ""))
    reply_text = {key: "\n".join(texts) for key, texts in merged.items()}

    workbook = Workbook()
    header_fill = PatternFill("solid", fgColor="E4F3CB")

    dashboard = workbook.active
    dashboard.title = DASHBOARD_SHEET
    _build_dashboard(dashboard, statistics, source_filename)

    threaded_sheet = workbook.create_sheet(THREADED_SHEET)
    threaded_rows = _write_visible_sheet(
        threaded_sheet, threaded_roots, header_fill, reply_text
    )
    _add_table(threaded_sheet, TABLE_THREADED, len(threaded_roots))

    legacy_sheet = workbook.create_sheet(LEGACY_SHEET)
    legacy_rows = _write_visible_sheet(legacy_sheet, legacy_items, header_fill)
    _add_table(legacy_sheet, TABLE_LEGACY, len(legacy_items))

    # Mapping rows: one per visible row (thread replies are merged, so they
    # have no separate mapping row).
    rows = []
    for item in items:
        if item["commentType"] == COMMENT_TYPE_THREADED_REPLY:
            continue
        row = _base_mapping_row(
            item, job_id, source_sha256, source_filename, MAPPING_VERSION
        )
        if item["itemId"] in threaded_rows:
            row["visible_sheet_name"] = THREADED_SHEET
            row["visible_row_number"] = threaded_rows[item["itemId"]]
        elif item["itemId"] in legacy_rows:
            row["visible_sheet_name"] = LEGACY_SHEET
            row["visible_row_number"] = legacy_rows[item["itemId"]]
        rows.append(row)

    token = compute_mapping_token(rows)
    for row in rows:
        row["mapping_token"] = token

    mapping = workbook.create_sheet(MAPPING_SHEET)
    for column, name in enumerate(MAPPING_HEADERS, start=1):
        cell = mapping.cell(row=1, column=column, value=name)
        cell.protection = Protection(locked=False)
    for row_index, row in enumerate(rows, start=2):
        for column, name in enumerate(MAPPING_HEADERS, start=1):
            cell = set_literal_cell(mapping, row_index, column, row[name])
            cell.protection = Protection(locked=False)
    mapping.sheet_state = "hidden"

    try:
        workbook.calculation.fullCalcOnLoad = True
        workbook.calculation.forceFullCalc = True
        workbook.calculation.calcMode = "auto"
    except Exception:  # noqa: BLE001 - optional recalc hint
        pass

    workbook.save(path)
    return rows


def verify_openable(path) -> None:
    try:
        workbook = load_workbook(
            path, read_only=True, data_only=False, keep_links=True
        )
    except Exception as exc:  # noqa: BLE001
        raise ReviewError("生成的文件无法被重新打开，已中止。") from exc
    try:
        _ = workbook.sheetnames
    finally:
        workbook.close()
