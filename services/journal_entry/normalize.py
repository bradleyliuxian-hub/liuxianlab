"""Amount/date normalization, source-layout adaptation, and voucher grouping.

This module is the only place that groups source rows into vouchers. It also
converts direction+signed source layouts into canonical debit/credit before a
JournalLine is created. Contra and anomaly never see the source layout.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any, Dict, Iterable, Optional, Sequence, Set, Tuple

from openpyxl.utils.datetime import from_excel

from .errors import JournalEntryError, NormalizationError, WorkbookValidationError
from .input_layouts import (
    LAYOUT_DEBIT_CREDIT,
    LAYOUT_DIRECTION_AMOUNT,
    LAYOUT_SIGNED_AMOUNT,
    SIDE_CREDIT,
    SIDE_DEBIT,
    is_excel_error_value,
    normalize_direction,
)
from .mapping import ColumnMapping, suggest_mapping
from .reader import WorkbookReader, detect_header_row
from .schema import (
    JournalEntry,
    JournalLine,
    ZERO,
    clean_text,
    make_voucher_key,
    quantize_amount,
)

_EMPTY_AMOUNT_MARKERS = {"", "-", "--", "—", "–", "n/a", "na", "null", "none"}
_NUMBER_CLEAN_RE = re.compile(r"[\s,，]")
_CURRENCY_RE = re.compile(r"(?i)(rmb|cny|usd|eur|hkd|jpy|gbp)")
_DATE_PATTERNS = (
    "%Y-%m-%d",
    "%Y/%m/%d",
    "%Y.%m.%d",
    "%Y%m%d",
    "%Y年%m月%d日",
    "%d/%m/%Y",
    "%m/%d/%Y",
)
_DATE_WITH_TIME_PATTERNS = (
    "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%d %H:%M",
    "%Y/%m/%d %H:%M:%S",
    "%Y/%m/%d %H:%M",
)


@dataclass(frozen=True)
class ParsedAmount:
    value: Decimal
    state: str  # empty | zero | positive | negative
    raw: Any = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "value": format(self.value, ".2f"),
            "state": self.state,
            "raw": self.raw,
        }


def parse_amount(value: Any, *, field_name: str = "amount") -> ParsedAmount:
    """Parse an Excel amount into Decimal.

    Supported:
    - int / Decimal / float (float converted via str, never kept as float)
    - "100", "100.00", "1,000.00", "(1,000.00)", "-100"
    - currency symbols and common currency codes
    - blank / "-" / "—" -> zero with state "empty"

    Invalid input raises NormalizationError; it is never coerced to zero.
    """

    if value is None:
        return ParsedAmount(ZERO, "empty", value)
    if isinstance(value, bool):
        raise NormalizationError(
            "布尔值不能作为金额。",
            details={
                "field": field_name,
                "reason": "invalid_amount",
                "value": value,
            },
        )
    if isinstance(value, (int, Decimal)):
        amount = Decimal(value)
    elif isinstance(value, float):
        if value != value or value in (float("inf"), float("-inf")):
            raise NormalizationError(
                "金额必须是有限数字。",
                details={
                    "field": field_name,
                    "reason": "invalid_amount",
                    "value": value,
                },
            )
        amount = Decimal(str(value))
    else:
        text = str(value).strip()
        if text.lower() in _EMPTY_AMOUNT_MARKERS:
            return ParsedAmount(ZERO, "empty", value)

        negative = False
        if text.startswith("(") and text.endswith(")"):
            negative = True
            text = text[1:-1].strip()
        if text.endswith("-") and len(text) > 1:
            negative = True
            text = text[:-1].strip()

        text = _CURRENCY_RE.sub("", text)
        text = text.replace("￥", "").replace("¥", "").replace("$", "")
        text = text.replace("€", "").replace("£", "")
        text = _NUMBER_CLEAN_RE.sub("", text)
        text = text.replace("−", "-").replace("－", "-")

        try:
            amount = Decimal(text)
        except (InvalidOperation, ValueError) as exc:
            raise NormalizationError(
                "金额无法解析。",
                details={
                    "field": field_name,
                    "reason": "invalid_amount",
                    "value": value,
                },
            ) from exc
        if negative:
            amount = -amount

    if not amount.is_finite():
        raise NormalizationError(
            "金额必须是有限数字。",
            details={
                "field": field_name,
                "reason": "invalid_amount",
                "value": value,
            },
        )

    amount = quantize_amount(amount, field_name)
    if amount == ZERO:
        state = "zero"
    elif amount < ZERO:
        state = "negative"
    else:
        state = "positive"
    return ParsedAmount(amount, state, value)


def parse_date(value: Any, *, field_name: str = "date") -> Optional[date]:
    """Parse common Excel/date strings. Blank returns None; invalid raises."""

    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        text = value.strip()
        if not text or text.lower() in _EMPTY_AMOUNT_MARKERS:
            return None
        for pattern in _DATE_WITH_TIME_PATTERNS:
            try:
                return datetime.strptime(text, pattern).date()
            except ValueError:
                pass
        if re.fullmatch(r"\d{8}", text):
            try:
                return datetime.strptime(text, "%Y%m%d").date()
            except ValueError:
                pass
        for pattern in _DATE_PATTERNS:
            try:
                return datetime.strptime(text, pattern).date()
            except ValueError:
                pass
        raise NormalizationError(
            "日期无法解析。",
            details={
                "field": field_name,
                "reason": "invalid_date",
                "value": value,
            },
        )

    if isinstance(value, (int, float)) and not isinstance(value, bool):
        numeric = float(value)
        if numeric != numeric or numeric in (float("inf"), float("-inf")):
            raise NormalizationError(
                "日期必须是有限数字。",
                details={
                    "field": field_name,
                    "reason": "invalid_date",
                    "value": value,
                },
            )
        if 19000101 <= int(numeric) <= 29991231 and float(int(numeric)) == numeric:
            try:
                return datetime.strptime(str(int(numeric)), "%Y%m%d").date()
            except ValueError:
                pass
        try:
            result = from_excel(numeric)
            if isinstance(result, datetime):
                return result.date()
            if isinstance(result, date):
                return result
        except Exception as exc:  # noqa: BLE001 - normalise openpyxl error
            raise NormalizationError(
                "日期无法解析。",
                details={
                    "field": field_name,
                    "reason": "invalid_date",
                    "value": value,
                },
            ) from exc
        raise NormalizationError(
            "日期无法解析。",
            details={
                "field": field_name,
                "reason": "invalid_date",
                "value": value,
            },
        )

    raise NormalizationError(
        "日期无法解析。",
        details={
            "field": field_name,
            "reason": "invalid_date",
            "value": value,
            "type": type(value).__name__,
        },
    )


@dataclass(frozen=True)
class NormalizationIssue:
    sheet_name: str
    source_row: int
    field: str
    code: str
    message: str
    raw_value: Any = None
    column_index: Optional[int] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "sheet_name": self.sheet_name,
            "source_row": self.source_row,
            "field": self.field,
            "code": self.code,
            "message": self.message,
            "raw_value": None if self.raw_value is None else str(self.raw_value),
            "column_index": self.column_index,
        }


@dataclass(frozen=True)
class NormalizationWarning:
    sheet_name: str
    source_row: int
    field: str
    code: str
    message: str
    raw_value: Any = None
    column_index: Optional[int] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "sheet_name": self.sheet_name,
            "source_row": self.source_row,
            "field": self.field,
            "code": self.code,
            "message": self.message,
            "raw_value": None if self.raw_value is None else str(self.raw_value),
            "column_index": self.column_index,
        }


@dataclass(frozen=True)
class NormalizationResult:
    sheet_name: str
    header_row: int
    mapping: ColumnMapping
    lines: Tuple[JournalLine, ...]
    entries: Tuple[JournalEntry, ...]
    raw_row_count: int = 0
    issues: Tuple[NormalizationIssue, ...] = ()
    row_warnings: Tuple[NormalizationWarning, ...] = ()
    warnings: Tuple[str, ...] = ()

    def to_dict(self) -> Dict[str, Any]:
        return {
            "sheet_name": self.sheet_name,
            "header_row": self.header_row,
            "mapping": self.mapping.to_dict(),
            "raw_row_count": self.raw_row_count,
            "line_count": len(self.lines),
            "entry_count": len(self.entries),
            "issues": [issue.to_dict() for issue in self.issues],
            "row_warnings": [warning.to_dict() for warning in self.row_warnings],
            "warnings": list(self.warnings),
            "entries": [entry.to_dict() for entry in self.entries],
        }


def _row_value(row: Sequence[Any], index: Optional[int]) -> Any:
    if index is None or index >= len(row):
        return None
    return row[index]


def _is_blank_row(values: Iterable[Any]) -> bool:
    return all(clean_text(value) is None for value in values)


def _cell_is_formula(
    source_row: int,
    index: int,
    formula_cells: Optional[Set[Tuple[int, int]]],
) -> bool:
    return bool(formula_cells and (source_row, index) in formula_cells)


def _critical_cell_value(
    row: Sequence[Any],
    index: Optional[int],
    *,
    field: str,
    source_row: int,
    formula_cells: Optional[Set[Tuple[int, int]]],
) -> Any:
    if index is None:
        raise NormalizationError(
            "关键字段缺少列映射。",
            details={"field": field, "source_row": source_row},
        )
    value = _row_value(row, index)
    if is_excel_error_value(value):
        raise NormalizationError(
            "关键字段是 Excel 错误值。",
            details={
                "field": field,
                "reason": "excel_error_value",
                "value": value,
                "source_row": source_row,
                "column_index": index + 1,
            },
        )
    if value is None and _cell_is_formula(source_row, index, formula_cells):
        raise NormalizationError(
            "公式单元格缺少缓存值。",
            details={
                "field": field,
                "reason": "missing_cached_formula_value",
                "source_row": source_row,
                "column_index": index + 1,
            },
        )
    return value


def _optional_text_value(
    row: Sequence[Any],
    index: Optional[int],
    *,
    field: str,
    sheet_name: str,
    source_row: int,
    formula_cells: Optional[Set[Tuple[int, int]]],
    row_warnings: list,
) -> Optional[str]:
    if index is None:
        return None
    value = _row_value(row, index)
    if is_excel_error_value(value):
        row_warnings.append(
            NormalizationWarning(
                sheet_name=sheet_name,
                source_row=source_row,
                field=field,
                code="EXCEL_ERROR_VALUE_IGNORED",
                message="可选字段是 Excel 错误值，已置空。",
                raw_value=value,
                column_index=index + 1,
            )
        )
        return None
    if value is None and _cell_is_formula(source_row, index, formula_cells):
        row_warnings.append(
            NormalizationWarning(
                sheet_name=sheet_name,
                source_row=source_row,
                field=field,
                code="MISSING_CACHED_FORMULA_VALUE",
                message="可选公式单元格缺少缓存值，已置空。",
                raw_value=None,
                column_index=index + 1,
            )
        )
        return None
    return clean_text(value)


def _optional_amount_value(
    row: Sequence[Any],
    index: Optional[int],
    *,
    field: str,
    sheet_name: str,
    source_row: int,
    formula_cells: Optional[Set[Tuple[int, int]]],
    row_warnings: list,
) -> Optional[Decimal]:
    if index is None:
        return None
    value = _row_value(row, index)
    if is_excel_error_value(value):
        row_warnings.append(
            NormalizationWarning(
                sheet_name=sheet_name,
                source_row=source_row,
                field=field,
                code="EXCEL_ERROR_VALUE_IGNORED",
                message="可选金额字段是 Excel 错误值，已置空。",
                raw_value=value,
                column_index=index + 1,
            )
        )
        return None
    if value is None and _cell_is_formula(source_row, index, formula_cells):
        row_warnings.append(
            NormalizationWarning(
                sheet_name=sheet_name,
                source_row=source_row,
                field=field,
                code="MISSING_CACHED_FORMULA_VALUE",
                message="可选金额公式缺少缓存值，已置空。",
                raw_value=None,
                column_index=index + 1,
            )
        )
        return None
    if clean_text(value) is None:
        return None
    try:
        return parse_amount(value, field_name=field).value
    except NormalizationError as exc:
        row_warnings.append(
            NormalizationWarning(
                sheet_name=sheet_name,
                source_row=source_row,
                field=field,
                code="OPTIONAL_AMOUNT_INVALID",
                message=exc.message,
                raw_value=value,
                column_index=index + 1,
            )
        )
        return None


def _extract_debit_credit(
    row: Sequence[Any],
    index_cache: Dict[str, Optional[int]],
    *,
    source_row: int,
    formula_cells: Optional[Set[Tuple[int, int]]],
) -> Tuple[Decimal, Decimal]:
    debit_value = _critical_cell_value(
        row,
        index_cache["debit"],
        field="debit",
        source_row=source_row,
        formula_cells=formula_cells,
    )
    credit_value = _critical_cell_value(
        row,
        index_cache["credit"],
        field="credit",
        source_row=source_row,
        formula_cells=formula_cells,
    )
    debit = parse_amount(debit_value, field_name="debit").value
    credit = parse_amount(credit_value, field_name="credit").value
    return debit, credit


def _extract_direction_amount(
    row: Sequence[Any],
    index_cache: Dict[str, Optional[int]],
    *,
    source_row: int,
    formula_cells: Optional[Set[Tuple[int, int]]],
) -> Tuple[Decimal, Decimal]:
    direction_value = _critical_cell_value(
        row,
        index_cache["direction"],
        field="direction",
        source_row=source_row,
        formula_cells=formula_cells,
    )
    amount_value = _critical_cell_value(
        row,
        index_cache["amount"],
        field="amount",
        source_row=source_row,
        formula_cells=formula_cells,
    )
    amount = parse_amount(amount_value, field_name="amount").value
    direction = normalize_direction(direction_value)
    if direction is None:
        if amount == ZERO:
            return ZERO, ZERO
        raise NormalizationError(
            "金额非零时方向不能为空。",
            details={
                "field": "direction",
                "reason": "missing_direction",
                "source_row": source_row,
            },
        )
    if direction == SIDE_DEBIT:
        return amount, ZERO
    return ZERO, amount


def _extract_signed_amount(
    row: Sequence[Any],
    index_cache: Dict[str, Optional[int]],
    *,
    positive_side: Optional[str],
    source_row: int,
    formula_cells: Optional[Set[Tuple[int, int]]],
) -> Tuple[Decimal, Decimal]:
    signed_value = _critical_cell_value(
        row,
        index_cache["signed_amount"],
        field="signed_amount",
        source_row=source_row,
        formula_cells=formula_cells,
    )
    amount = parse_amount(signed_value, field_name="signed_amount").value
    if positive_side not in (SIDE_DEBIT, SIDE_CREDIT):
        raise NormalizationError(
            "signed_amount 缺少 positive_side 约定。",
            details={
                "field": "positive_side",
                "reason": "missing_positive_side",
                "source_row": source_row,
            },
        )
    if amount >= ZERO:
        side = positive_side
        value = amount
    else:
        side = SIDE_CREDIT if positive_side == SIDE_DEBIT else SIDE_DEBIT
        value = abs(amount)
    if side == SIDE_DEBIT:
        return value, ZERO
    return ZERO, value


def _line_from_row(
    row: Sequence[Any],
    *,
    index_cache: Dict[str, Optional[int]],
    mapping: ColumnMapping,
    sheet_name: str,
    source_row: int,
    formula_cells: Optional[Set[Tuple[int, int]]],
    row_warnings: list,
) -> JournalLine:
    voucher_value = _critical_cell_value(
        row,
        index_cache["voucher_id"],
        field="voucher_id",
        source_row=source_row,
        formula_cells=formula_cells,
    )
    voucher_id = clean_text(voucher_value)
    if not voucher_id:
        raise NormalizationError(
            "凭证号为空。",
            details={
                "field": "voucher_id",
                "reason": "missing_voucher_id",
                "source_row": source_row,
            },
        )

    account_code = None
    if index_cache["account_code"] is not None:
        account_code = clean_text(
            _critical_cell_value(
                row,
                index_cache["account_code"],
                field="account_code",
                source_row=source_row,
                formula_cells=formula_cells,
            )
        )
    account_name = None
    if index_cache["account_name"] is not None:
        account_name = clean_text(
            _critical_cell_value(
                row,
                index_cache["account_name"],
                field="account_name",
                source_row=source_row,
                formula_cells=formula_cells,
            )
        )
    if not account_code and not account_name:
        raise NormalizationError(
            "科目为空。",
            details={
                "field": "account",
                "reason": "missing_account",
                "source_row": source_row,
            },
        )

    layout = mapping.amount_layout.layout
    if layout == LAYOUT_DEBIT_CREDIT:
        debit, credit = _extract_debit_credit(
            row,
            index_cache,
            source_row=source_row,
            formula_cells=formula_cells,
        )
    elif layout == LAYOUT_DIRECTION_AMOUNT:
        debit, credit = _extract_direction_amount(
            row,
            index_cache,
            source_row=source_row,
            formula_cells=formula_cells,
        )
    elif layout == LAYOUT_SIGNED_AMOUNT:
        debit, credit = _extract_signed_amount(
            row,
            index_cache,
            positive_side=mapping.amount_layout.positive_side,
            source_row=source_row,
            formula_cells=formula_cells,
        )
    else:
        raise NormalizationError(
            "不支持的金额列布局。",
            details={"field": "amount_layout", "value": layout},
        )

    date_value = None
    if index_cache["date"] is not None:
        date_value = _critical_cell_value(
            row,
            index_cache["date"],
            field="date",
            source_row=source_row,
            formula_cells=formula_cells,
        )
    line_date = parse_date(date_value, field_name="date")

    original_amount = _optional_amount_value(
        row,
        index_cache["original_amount"],
        field="original_amount",
        sheet_name=sheet_name,
        source_row=source_row,
        formula_cells=formula_cells,
        row_warnings=row_warnings,
    )

    explicit_line_id = _optional_text_value(
        row,
        index_cache["line_id"],
        field="line_id",
        sheet_name=sheet_name,
        source_row=source_row,
        formula_cells=formula_cells,
        row_warnings=row_warnings,
    )

    return JournalLine(
        voucher_id=voucher_id,
        account_code=account_code,
        account_name=account_name,
        detail_account=_optional_text_value(
            row,
            index_cache["detail_account"],
            field="detail_account",
            sheet_name=sheet_name,
            source_row=source_row,
            formula_cells=formula_cells,
            row_warnings=row_warnings,
        ),
        customer_code=_optional_text_value(
            row, index_cache["customer_code"], field="customer_code",
            sheet_name=sheet_name, source_row=source_row,
            formula_cells=formula_cells, row_warnings=row_warnings,
        ),
        customer_name=_optional_text_value(
            row, index_cache["customer_name"], field="customer_name",
            sheet_name=sheet_name, source_row=source_row,
            formula_cells=formula_cells, row_warnings=row_warnings,
        ),
        supplier_code=_optional_text_value(
            row, index_cache["supplier_code"], field="supplier_code",
            sheet_name=sheet_name, source_row=source_row,
            formula_cells=formula_cells, row_warnings=row_warnings,
        ),
        supplier_name=_optional_text_value(
            row, index_cache["supplier_name"], field="supplier_name",
            sheet_name=sheet_name, source_row=source_row,
            formula_cells=formula_cells, row_warnings=row_warnings,
        ),
        counterparty_code=_optional_text_value(
            row, index_cache["counterparty_code"], field="counterparty_code",
            sheet_name=sheet_name, source_row=source_row,
            formula_cells=formula_cells, row_warnings=row_warnings,
        ),
        counterparty_name=_optional_text_value(
            row, index_cache["counterparty_name"], field="counterparty_name",
            sheet_name=sheet_name, source_row=source_row,
            formula_cells=formula_cells, row_warnings=row_warnings,
        ),
        debit=debit,
        credit=credit,
        date=line_date,
        period=_optional_text_value(
            row,
            index_cache["period"],
            field="period",
            sheet_name=sheet_name,
            source_row=source_row,
            formula_cells=formula_cells,
            row_warnings=row_warnings,
        ),
        entity=_optional_text_value(
            row,
            index_cache["entity"],
            field="entity",
            sheet_name=sheet_name,
            source_row=source_row,
            formula_cells=formula_cells,
            row_warnings=row_warnings,
        ),
        currency=_optional_text_value(
            row,
            index_cache["currency"],
            field="currency",
            sheet_name=sheet_name,
            source_row=source_row,
            formula_cells=formula_cells,
            row_warnings=row_warnings,
        ),
        original_amount=original_amount,
        description=_optional_text_value(
            row,
            index_cache["description"],
            field="description",
            sheet_name=sheet_name,
            source_row=source_row,
            formula_cells=formula_cells,
            row_warnings=row_warnings,
        ),
        preparer=_optional_text_value(
            row,
            index_cache["preparer"],
            field="preparer",
            sheet_name=sheet_name,
            source_row=source_row,
            formula_cells=formula_cells,
            row_warnings=row_warnings,
        ),
        sheet_name=sheet_name,
        source_row=source_row,
        line_id=explicit_line_id or "",
    )


_FIELD_INDEX_NAMES = (
    "entity",
    "period",
    "date",
    "voucher_id",
    "line_id",
    "account_code",
    "account_name",
    "detail_account",
    "customer_code",
    "customer_name",
    "supplier_code",
    "supplier_name",
    "counterparty_code",
    "counterparty_name",
    "direction",
    "amount",
    "debit",
    "credit",
    "signed_amount",
    "currency",
    "original_amount",
    "description",
    "preparer",
)


def normalize_table(
    *,
    sheet_name: str,
    header_row: int,
    headers: Sequence[Any],
    rows: Sequence[Sequence[Any]],
    mapping: ColumnMapping,
    start_row: Optional[int] = None,
    formula_cells: Optional[Set[Tuple[int, int]]] = None,
) -> NormalizationResult:
    """Normalize a table and reconstruct vouchers in one pass.

    Invalid rows become structured NormalizationIssue entries and are skipped;
    they are never silently coerced.
    """

    if header_row < 1:
        raise NormalizationError(
            "header_row 必须 >= 1。",
            details={"header_row": header_row},
        )
    if not headers:
        raise NormalizationError("表头为空。")

    data_start_row = start_row if start_row is not None else header_row + 1
    index_cache = {
        name: mapping.source_index(name, headers)
        for name in _FIELD_INDEX_NAMES
    }
    mapped_indexes = [
        index_cache[name]
        for name in (
            "entity",
            "period",
            "date",
            "voucher_id",
            "account_code",
            "account_name",
            "detail_account",
            "customer_code",
            "customer_name",
            "supplier_code",
            "supplier_name",
            "counterparty_code",
            "counterparty_name",
            "direction",
            "amount",
            "debit",
            "credit",
            "signed_amount",
            "description",
            "preparer",
        )
    ]

    lines = []
    issues = []
    row_warnings = []
    for offset, row in enumerate(rows):
        source_row = data_start_row + offset
        mapped_values = [_row_value(row, index) for index in mapped_indexes]
        if _is_blank_row(mapped_values):
            continue
        try:
            lines.append(
                _line_from_row(
                    row,
                    index_cache=index_cache,
                    mapping=mapping,
                    sheet_name=sheet_name,
                    source_row=source_row,
                    formula_cells=formula_cells,
                    row_warnings=row_warnings,
                )
            )
        except NormalizationError as exc:
            issues.append(
                NormalizationIssue(
                    sheet_name=sheet_name,
                    source_row=source_row,
                    field=str(exc.details.get("field", "row")),
                    code=str(exc.details.get("reason", exc.code)),
                    message=exc.message,
                    raw_value=exc.details.get("value"),
                    column_index=exc.details.get("column_index"),
                )
            )
        except JournalEntryError as exc:
            issues.append(
                NormalizationIssue(
                    sheet_name=sheet_name,
                    source_row=source_row,
                    field=str(exc.details.get("field", "row")),
                    code=str(exc.details.get("reason", exc.code)),
                    message=exc.message,
                    raw_value=exc.details.get("value"),
                    column_index=exc.details.get("column_index"),
                )
            )

    grouped: Dict[Tuple[str, str, str, str], list] = {}
    for line in lines:
        grouped.setdefault(make_voucher_key(line), []).append(line)

    entries = []
    for key in sorted(grouped):
        entries.append(JournalEntry.from_lines(tuple(grouped[key])))

    warnings = list(mapping.warnings)
    if not lines:
        warnings.append("没有可规范化的会计行。")

    return NormalizationResult(
        sheet_name=sheet_name,
        header_row=header_row,
        mapping=mapping,
        lines=tuple(lines),
        entries=tuple(entries),
        raw_row_count=len(rows),
        issues=tuple(issues),
        row_warnings=tuple(row_warnings),
        warnings=tuple(warnings),
    )


def normalize_file(
    path: Any,
    *,
    sheet_name: Optional[str] = None,
    header_row: Optional[int] = None,
    mapping: Optional[Any] = None,
) -> NormalizationResult:
    """Open, inspect, map, and normalize one .xlsx sheet.

    ``mapping`` may be a ColumnMapping or an explicit field->column dict.
    If omitted, conservative alias mapping is used.
    """

    reader = WorkbookReader(path)
    sheets = reader.list_sheets()
    if not sheets:
        raise WorkbookValidationError("工作簿没有工作表。")

    if sheet_name is None:
        sheet_name = sheets[0].name

    sample = reader.read_sheet(sheet_name, max_rows=30)
    if header_row is None:
        detected = detect_header_row(sample.rows)
        if detected is None:
            raise NormalizationError(
                "无法识别表头行，请显式指定 header_row。",
                details={"sheet_name": sheet_name},
            )
        header_row = detected

    headers, data_rows, _last_row = reader.read_table(sheet_name, header_row)
    formula_cells = reader.formula_cells(sheet_name)

    if isinstance(mapping, ColumnMapping):
        resolved_mapping = mapping
    else:
        resolved_mapping = suggest_mapping(
            headers,
            explicit=mapping,
            header_row=header_row,
            sheet_name=sheet_name,
        )

    return normalize_table(
        sheet_name=sheet_name,
        header_row=header_row,
        headers=headers,
        rows=data_rows,
        mapping=resolved_mapping,
        start_row=header_row + 1,
        formula_cells=formula_cells,
    )
