"""Streaming OOXML reader for SAP exports.

SAP sometimes writes a used range down to row 1,048,576 even though only a few
thousand rows contain data. ``openpyxl`` and ``pandas`` both honour that range,
so this module reads the worksheet XML directly and stops after a run of empty
rows. Only populated rows are materialised.
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta
from decimal import Decimal
from pathlib import Path, PurePosixPath
from typing import Any, Dict, Iterable, Iterator, List, Optional, Sequence, Tuple
from zipfile import BadZipFile, ZipFile
from xml.etree import ElementTree as ET

from .column_mapper import _canonical_headers
from .schema import COLUMN_ALIASES, DATE_FIELDS, _normalize

NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
NS_PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships"

DEFAULT_BLANK_STOP = 20


class WorkbookReadError(ValueError):
    """Raised when the workbook cannot be parsed into a tabular layout."""


def _col_index(cell_ref: str) -> int:
    index = 0
    saw_letter = False
    for char in str(cell_ref or ""):
        if "A" <= char <= "Z":
            saw_letter = True
            index = index * 26 + (ord(char) - 64)
        elif "a" <= char <= "z":
            saw_letter = True
            index = index * 26 + (ord(char) - 96)
        else:
            break
    return index - 1 if saw_letter else -1


def _read_shared_strings(archive: ZipFile) -> List[str]:
    if "xl/sharedStrings.xml" not in archive.namelist():
        return []
    values: List[str] = []
    with archive.open("xl/sharedStrings.xml") as handle:
        for _event, element in ET.iterparse(handle, events=("end",)):
            if element.tag != f"{{{NS_MAIN}}}si":
                continue
            values.append("".join(t.text or "" for t in element.iter(f"{{{NS_MAIN}}}t")))
            element.clear()
    return values


def _workbook_meta(archive: ZipFile) -> Tuple[List[Dict[str, Any]], Dict[str, str], str]:
    try:
        workbook = ET.fromstring(archive.read("xl/workbook.xml"))
    except KeyError as error:
        raise WorkbookReadError("工作簿缺少 xl/workbook.xml，可能不是有效的 .xlsx 文件。") from error
    properties = workbook.find(f"{{{NS_MAIN}}}workbookPr")
    date1904 = properties is not None and properties.attrib.get("date1904") in {"1", "true", "TRUE"}
    system = "1904" if date1904 else "1900"

    sheets: List[Dict[str, Any]] = []
    sheet_node = workbook.find(f"{{{NS_MAIN}}}sheets")
    if sheet_node is not None:
        for position, sheet in enumerate(sheet_node):
            relationship_id = sheet.attrib.get(f"{{{NS_REL}}}id", "")
            sheets.append({
                "name": sheet.attrib.get("name") or f"Sheet{position + 1}",
                "index": position,
                "sheet_id": sheet.attrib.get("sheetId"),
                "state": sheet.attrib.get("state") or "visible",
                "relationship_id": relationship_id,
            })

    try:
        relationships_root = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
    except KeyError as error:
        raise WorkbookReadError("工作簿缺少关系定义文件。") from error

    relationships: Dict[str, str] = {}
    for relationship in relationships_root:
        if relationship.tag == f"{{{NS_PKG_REL}}}Relationship":
            relationships[relationship.attrib.get("Id", "")] = relationship.attrib.get("Target", "")
    return sheets, relationships, system


def _sheet_path(target: str) -> str:
    path = PurePosixPath(target if target.startswith("/") else f"xl/{target}")
    parts: List[str] = []
    for part in path.parts:
        if part in ("/", ".", ""):
            continue
        if part == "..":
            if parts:
                parts.pop()
            continue
        parts.append(part)
    return "/".join(parts)


def _serial_to_iso(serial: Decimal | float | int, system: str) -> Optional[str]:
    try:
        value = float(serial)
    except (TypeError, ValueError):
        return None
    if value <= 0 or value > 2958465:
        return None
    base = datetime(1904, 1, 1) if system == "1904" else datetime(1899, 12, 30)
    converted = base + timedelta(days=value)
    if converted.time() == time(0, 0):
        return converted.date().isoformat()
    return converted.isoformat(sep=" ")


def _cell_value(cell: ET.Element, shared: Sequence[str]) -> Any:
    cell_type = cell.attrib.get("t")
    if cell_type == "inlineStr":
        text = "".join(t.text or "" for t in cell.iter(f"{{{NS_MAIN}}}t"))
        return text if text != "" else None
    value_node = cell.find(f"{{{NS_MAIN}}}v")
    if value_node is None or value_node.text is None:
        return None
    text = value_node.text
    if cell_type == "s":
        try:
            return shared[int(text)]
        except (ValueError, IndexError):
            return text
    if cell_type in {"str", "e"}:
        return text
    if cell_type == "b":
        return text == "1"
    try:
        return Decimal(text)
    except Exception:
        return text


def _date_header_indexes(headers: Sequence[str]) -> set[int]:
    indexes: set[int] = set()
    date_aliases = {
        _normalize(alias)
        for field in DATE_FIELDS
        for alias in COLUMN_ALIASES.get(field, ())
    }
    for index, header in enumerate(headers):
        normalized = _normalize(header)
        if normalized in date_aliases or "日期" in header or "date" in normalized:
            indexes.add(index)
    return indexes


def _iter_rows(
    path: str | Path,
    sheet_name: Optional[str],
    header_row: Optional[int],
    blank_stop: int,
) -> Iterator[Tuple[str, List[str], int, Dict[str, Any]]]:
    """Yield ``(sheet_name, headers, source_row, row)`` for populated data rows."""
    try:
        archive = ZipFile(path)
    except (BadZipFile, FileNotFoundError) as error:
        raise WorkbookReadError("无法打开文件，请确认是有效的 .xlsx 文件。") from error

    with archive:
        sheets, relationships, system = _workbook_meta(archive)
        if not sheets:
            raise WorkbookReadError("工作簿中没有工作表。")
        selected = None
        if sheet_name:
            selected = next((sheet for sheet in sheets if sheet["name"] == sheet_name), None)
            if selected is None:
                raise WorkbookReadError(f"找不到工作表：{sheet_name}")
        else:
            selected = sheets[0]
        target = relationships.get(selected["relationship_id"], "")
        if not target:
            raise WorkbookReadError("无法定位工作表 XML。")
        sheet_path = _sheet_path(target)
        if sheet_path not in archive.namelist():
            raise WorkbookReadError("工作表 XML 不存在，工作簿可能已损坏。")
        shared = _read_shared_strings(archive)

        headers: List[str] = []
        header_seen = False
        date_indexes: set[int] = set()
        blank_count = 0
        data_seen = False
        expected_row = 1

        with archive.open(sheet_path) as handle:
            for _event, element in ET.iterparse(handle, events=("end",)):
                if element.tag != f"{{{NS_MAIN}}}row":
                    continue
                source_row = int(element.attrib.get("r") or expected_row)
                expected_row = source_row + 1
                cells = element.findall(f"{{{NS_MAIN}}}c")
                values: List[Any] = []
                if cells:
                    max_index = max(_col_index(cell.attrib.get("r", "")) for cell in cells)
                    if max_index < 0:
                        max_index = len(cells) - 1
                    values = [None] * (max_index + 1)
                    for position, cell in enumerate(cells):
                        index = _col_index(cell.attrib.get("r", ""))
                        if index < 0:
                            index = position
                        if index >= len(values):
                            values.extend([None] * (index + 1 - len(values)))
                        values[index] = _cell_value(cell, shared)

                empty = not values or all(_is_blank(value) for value in values)
                if empty:
                    if data_seen:
                        blank_count += 1
                        if blank_count >= blank_stop:
                            element.clear()
                            break
                    element.clear()
                    continue
                blank_count = 0

                if header_row is not None and source_row < header_row:
                    element.clear()
                    continue

                if not header_seen:
                    headers = _canonical_headers(values)
                    header_seen = True
                    date_indexes = _date_header_indexes(headers)
                    element.clear()
                    continue

                if source_row <= (header_row or 1):
                    element.clear()
                    continue

                data_seen = True
                if len(values) < len(headers):
                    values.extend([None] * (len(headers) - len(values)))
                values = values[: len(headers)]

                row: Dict[str, Any] = {}
                for index, header in enumerate(headers):
                    value = values[index]
                    if index in date_indexes and isinstance(value, Decimal):
                        converted = _serial_to_iso(value, system)
                        if converted is not None:
                            value = converted
                    elif isinstance(value, datetime):
                        value = value.isoformat(sep=" ")
                    elif isinstance(value, date):
                        value = value.isoformat()
                    row[header] = value
                row["_source_row"] = source_row
                yield selected["name"], headers, source_row, row
                element.clear()

        if not header_seen:
            raise WorkbookReadError("未找到表头行。")


def _is_blank(value: Any) -> bool:
    if value is None:
        return True
    return isinstance(value, str) and value.strip() == ""


def list_sheets(path: str | Path) -> List[Dict[str, Any]]:
    try:
        with ZipFile(path) as archive:
            sheets, _relationships, _system = _workbook_meta(archive)
    except (BadZipFile, FileNotFoundError) as error:
        raise WorkbookReadError("无法打开文件，请确认是有效的 .xlsx 文件。") from error
    return [
        {"name": sheet["name"], "index": sheet["index"], "state": sheet["state"]}
        for sheet in sheets
    ]


def _looks_numeric(text: str) -> bool:
    cleaned = str(text or "").strip().replace(",", "").replace(" ", "")
    if not cleaned:
        return False
    try:
        Decimal(cleaned)
        return True
    except Exception:
        return False


def _detect_header_row(path: str | Path, sheet_name: Optional[str], scan_limit: int = 40) -> Tuple[int, List[str]]:
    """Pick the most plausible header row among the first populated rows.

    SAP exports often prepend title/parameter rows. The header is the row with
    the most textual cells; data rows contain predominantly numeric values.
    """
    with ZipFile(path) as archive:
        sheets, relationships, _system = _workbook_meta(archive)
        if not sheets:
            raise WorkbookReadError("工作簿中没有工作表。")
        selected = next((sheet for sheet in sheets if sheet["name"] == sheet_name), None) if sheet_name else sheets[0]
        if selected is None:
            raise WorkbookReadError(f"找不到工作表：{sheet_name}")
        target = relationships.get(selected["relationship_id"], "")
        sheet_path = _sheet_path(target)
        shared = _read_shared_strings(archive)
        expected_row = 1
        scanned = 0
        best_row = 0
        best_values: List[Any] = []
        best_score = (-1, -1)
        with archive.open(sheet_path) as handle:
            for _event, element in ET.iterparse(handle, events=("end",)):
                if element.tag != f"{{{NS_MAIN}}}row":
                    continue
                source_row = int(element.attrib.get("r") or expected_row)
                expected_row = source_row + 1
                values: List[Any] = []
                for position, cell in enumerate(element.findall(f"{{{NS_MAIN}}}c")):
                    index = _col_index(cell.attrib.get("r", ""))
                    if index < 0:
                        index = position
                    if index >= len(values):
                        values.extend([None] * (index + 1 - len(values)))
                    values[index] = _cell_value(cell, shared)
                element.clear()
                non_empty = [value for value in values if not _is_blank(value)]
                if not non_empty:
                    continue
                text_cells = [
                    value for value in non_empty
                    if isinstance(value, str) and not _looks_numeric(value)
                ]
                score = (len(text_cells), len(non_empty))
                if score > best_score:
                    best_score = score
                    best_row = source_row
                    best_values = values
                scanned += 1
                if scanned >= scan_limit:
                    break
    if best_row == 0 or best_score[0] < 2:
        raise WorkbookReadError("未找到表头行。")
    return best_row, _canonical_headers(best_values)


def inspect_workbook(
    path: str | Path,
    sheet_name: Optional[str] = None,
    header_row: Optional[int] = None,
    blank_stop: int = DEFAULT_BLANK_STOP,
) -> Dict[str, Any]:
    """Return sheet/header metadata and the populated data-row count."""
    sheets = list_sheets(path)
    if sheet_name and not any(sheet["name"] == sheet_name for sheet in sheets):
        raise WorkbookReadError(f"找不到工作表：{sheet_name}")

    if header_row is None:
        header_row, detected_headers = _detect_header_row(path, sheet_name)
    else:
        detected_headers = []

    headers: List[str] = []
    selected_sheet = sheet_name or (sheets[0]["name"] if sheets else "")
    data_rows = 0
    samples: List[Dict[str, Any]] = []

    for name, row_headers, _source_row, row in _iter_rows(path, sheet_name, header_row, blank_stop):
        selected_sheet = name
        headers = row_headers
        data_rows += 1
        if len(samples) < 3:
            samples.append({
                header: _json_scalar(row.get(header))
                for header in row_headers
            })

    if not headers:
        headers = detected_headers
    if not headers:
        raise WorkbookReadError("工作表中没有可读取的数据。")

    return {
        "sheets": sheets,
        "selected_sheet": selected_sheet,
        "header_row": header_row or 1,
        "headers": headers,
        "data_row_count": data_rows,
        "sample_rows": samples,
    }


def read_rows(
    path: str | Path,
    sheet_name: Optional[str] = None,
    header_row: int = 1,
    blank_stop: int = DEFAULT_BLANK_STOP,
) -> Tuple[List[str], List[Dict[str, Any]], str]:
    """Read all populated rows after the given header row."""
    headers: List[str] = []
    rows: List[Dict[str, Any]] = []
    selected_sheet = sheet_name or ""
    for name, row_headers, _source_row, row in _iter_rows(path, sheet_name, header_row, blank_stop):
        headers = row_headers
        selected_sheet = name
        rows.append(row)
    if not headers:
        raise WorkbookReadError("工作表中没有可读取的数据。")
    return headers, rows, selected_sheet


def _json_scalar(value: Any) -> Any:
    if isinstance(value, Decimal):
        return format(value, "f")
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return value
