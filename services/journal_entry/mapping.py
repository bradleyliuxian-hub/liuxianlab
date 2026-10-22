"""Raw Excel header -> canonical field and amount-layout mapping.

The mapping layer is intentionally conservative: it accepts explicit mappings,
uses a small finite alias set, and refuses to guess when a column is ambiguous.
It never reads accounting values or groups vouchers.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Dict, Mapping, Optional, Sequence, Tuple

from .errors import ColumnMappingError, JournalEntryError
from .input_layouts import (
    AMOUNT_LAYOUTS,
    DEFAULT_AMOUNT_LAYOUT,
    LAYOUT_DEBIT_CREDIT,
    LAYOUT_DIRECTION_AMOUNT,
    LAYOUT_SIGNED_AMOUNT,
    AmountLayoutSpec,
    normalize_positive_side,
)

CANONICAL_FIELDS = (
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

MAPPING_META_FIELDS = ("amount_layout", "positive_side")

# Finite aliases only. Do not turn this into an open-ended fuzzy dictionary.
FIELD_ALIASES: Dict[str, Tuple[str, ...]] = {
    "voucher_id": (
        "凭证号",
        "凭证编号",
        "凭证号码",
        "凭证字号",
        "凭证号数",
        "凭证",
        "voucher no",
        "voucher id",
        "voucher number",
        "document no",
        "document number",
        "doc no",
        "journal no",
        "journal number",
        "entry no",
        "entry number",
    ),
    "date": (
        "日期",
        "记账日期",
        "凭证日期",
        "业务日期",
        "date",
        "entry date",
        "posting date",
        "voucher date",
        "gl date",
    ),
    "period": (
        "期间",
        "会计期间",
        "所属期间",
        "月份",
        "period",
        "fiscal period",
        "accounting period",
        "month",
    ),
    "entity": (
        "公司",
        "公司名称",
        "主体",
        "核算主体",
        "entity",
        "company",
        "organization",
        "legal entity",
    ),
    "account_code": (
        "科目编码",
        "科目代码",
        "会计科目编码",
        "会计科目代码",
        "科目号",
        "account code",
        "account no",
        "account number",
        "gl code",
        "subject code",
    ),
    "account_name": (
        "科目名称",
        "会计科目",
        "科目",
        "account name",
        "account",
        "subject",
        "gl account",
        "account description",
    ),
    "detail_account": (
        "明细科目",
        "明细",
        "子科目",
        "detail account",
        "sub account",
        "subaccount",
        "detail",
    ),
    "customer_code": (
        "客户编码", "客户代码", "客户编号", "客户号",
        "customer code", "customer no", "customer number", "customer id",
    ),
    "customer_name": (
        "客户名称", "客户", "customer name", "customer",
    ),
    "supplier_code": (
        "供应商编码", "供应商代码", "供应商编号", "供应商号",
        "supplier code", "supplier no", "supplier number",
        "vendor code", "vendor no", "vendor id",
    ),
    "supplier_name": (
        "供应商名称", "供应商", "supplier name", "supplier", "vendor name", "vendor",
    ),
    "counterparty_code": (
        "往来单位编码", "客商编码", "核算项目编码", "辅助核算编码",
        "counterparty code", "counterparty no", "auxiliary code",
    ),
    "counterparty_name": (
        "往来单位", "客商", "辅助核算", "核算项目", "往来单位名称",
        "counterparty name", "counterparty", "auxiliary", "auxiliary name",
    ),
    "direction": (
        "方向",
        "借贷方向",
        "借贷标志",
        "借贷",
        "dc",
        "d/c",
        "direction",
        "debitcredit",
        "dr/cr",
    ),
    "amount": (
        "金额",
        "本币金额",
        "金额本币",
        "发生额",
        "本币发生额",
        "amount",
        "local amount",
        "amount(local)",
    ),
    "debit": (
        "借方",
        "借方金额",
        "借方发生额",
        "借方本币",
        "借方本位币",
        "debit",
        "debit amount",
        "debit balance",
        "dr",
    ),
    "credit": (
        "贷方",
        "贷方金额",
        "贷方发生额",
        "贷方本币",
        "贷方本位币",
        "credit",
        "credit amount",
        "credit balance",
        "cr",
    ),
    "signed_amount": (
        "借正代付",
        "借正贷负",
        "正借负贷",
        "借贷金额",
        "signed amount",
        "signed_amount",
        "signed",
    ),
    "currency": (
        "币种",
        "货币",
        "货币种类",
        "currency",
        "ccy",
    ),
    "original_amount": (
        "原币金额",
        "原币",
        "外币金额",
        "original amount",
        "foreign amount",
        "transaction amount",
    ),
    "description": (
        "摘要",
        "说明",
        "业务摘要",
        "凭证摘要",
        "description",
        "memo",
        "narration",
        "summary",
        "text",
    ),
    "preparer": (
        "制单人",
        "制单",
        "录入人",
        "编制人",
        "prepared by",
        "preparer",
        "creator",
        "created by",
    ),
    "line_id": (
        "行号",
        "行标识",
        "分录行号",
        "line id",
        "line no",
        "line number",
    ),
}


def normalize_header(value: Any) -> str:
    """Normalize a header for exact alias matching.

    Spaces, underscores, hyphens, dots, slashes, colons, and common brackets
    are removed. CJK characters are preserved. This is deliberately not fuzzy.
    """

    text = "" if value is None else str(value).strip().lower()
    text = text.replace("（", "(").replace("）", ")")
    text = re.sub(r"[\s_\-./\\()\[\]{}:：]+", "", text)
    return text


@dataclass(frozen=True)
class FieldMapping:
    field: str
    source_column: str
    confidence: float = 1.0
    method: str = "alias"
    column_index: Optional[int] = None  # 1-based; resolves duplicate headers

    def to_dict(self) -> Dict[str, Any]:
        return {
            "source_column": self.source_column,
            "column_index": self.column_index,
            "confidence": self.confidence,
            "method": self.method,
        }


@dataclass(frozen=True)
class ColumnMapping:
    fields: Mapping[str, FieldMapping]
    header_row: Optional[int] = None
    sheet_name: Optional[str] = None
    amount_layout: AmountLayoutSpec = DEFAULT_AMOUNT_LAYOUT
    ambiguous: Mapping[str, Tuple[str, ...]] = field(default_factory=dict)
    ambiguous_candidates: Mapping[
        str, Tuple[Mapping[str, Any], ...]
    ] = field(default_factory=dict)
    warnings: Tuple[str, ...] = ()

    def get(self, name: str) -> Optional[FieldMapping]:
        return self.fields.get(name)

    def source_column(self, name: str) -> Optional[str]:
        mapping = self.get(name)
        return mapping.source_column if mapping else None

    def source_index(self, name: str, headers: Sequence[Any]) -> Optional[int]:
        mapping = self.get(name)
        if mapping is None:
            return None
        if mapping.column_index is not None:
            index = mapping.column_index - 1
            if index < 0 or index >= len(headers):
                raise ColumnMappingError(
                    "映射列号超出表头范围。",
                    details={
                        "field": name,
                        "column_index": mapping.column_index,
                        "max_column": len(headers),
                    },
                )
            if normalize_header(headers[index]) != normalize_header(
                mapping.source_column
            ):
                raise ColumnMappingError(
                    "映射列号与表头不一致。",
                    details={
                        "field": name,
                        "column_index": mapping.column_index,
                        "header": str(headers[index]),
                        "source_column": mapping.source_column,
                    },
                )
            return index

        normalized = [normalize_header(header) for header in headers]
        target = normalize_header(mapping.source_column)
        matches = [
            index for index, header in enumerate(normalized) if header == target
        ]
        if len(matches) == 1:
            return matches[0]
        if not matches:
            raise ColumnMappingError(
                "映射列在表头中不存在。",
                details={
                    "field": name,
                    "source_column": mapping.source_column,
                },
            )
        raise ColumnMappingError(
            "映射列在表头中不唯一。",
            details={
                "field": name,
                "source_column": mapping.source_column,
                "matches": [headers[index] for index in matches],
                "candidates": [
                    {"column_index": index + 1, "header": str(headers[index])}
                    for index in matches
                ],
            },
        )

    def to_dict(self) -> Dict[str, Any]:
        return {
            "header_row": self.header_row,
            "sheet_name": self.sheet_name,
            "amount_layout": self.amount_layout.to_dict(),
            "fields": {
                name: mapping.to_dict()
                for name, mapping in self.fields.items()
            },
            "ambiguous": {
                name: list(columns)
                for name, columns in self.ambiguous.items()
            },
            "ambiguous_candidates": {
                name: [dict(candidate) for candidate in candidates]
                for name, candidates in self.ambiguous_candidates.items()
            },
            "warnings": list(self.warnings),
        }


def _build_header_index(headers: Sequence[Any]) -> Dict[str, Tuple[int, ...]]:
    index: Dict[str, list] = {}
    for position, header in enumerate(headers):
        key = normalize_header(header)
        if not key:
            continue
        index.setdefault(key, []).append(position)
    return {key: tuple(positions) for key, positions in index.items()}


def _candidate(column_index: int, header: Any) -> Dict[str, Any]:
    return {
        "column_index": column_index,
        "header": str(header),
    }


def _resolve_explicit_column(
    field_name: str,
    requested: Any,
    headers: Sequence[Any],
    header_index: Mapping[str, Tuple[int, ...]],
) -> Tuple[str, int]:
    if isinstance(requested, bool) or requested is None:
        raise ColumnMappingError(
            "显式映射值无效。",
            details={"field": field_name, "value": requested},
        )
    if isinstance(requested, int):
        if requested < 1 or requested > len(headers):
            raise ColumnMappingError(
                "显式映射列号超出范围。",
                details={
                    "field": field_name,
                    "column_index": requested,
                    "max_column": len(headers),
                },
            )
        column = headers[requested - 1]
        if normalize_header(column) == "":
            raise ColumnMappingError(
                "显式映射指向空表头。",
                details={"field": field_name, "column_index": requested},
            )
        return str(column), requested - 1

    requested_text = str(requested).strip()
    normalized = normalize_header(requested_text)
    positions = header_index.get(normalized, ())
    if len(positions) == 1:
        return str(headers[positions[0]]), positions[0]
    if len(positions) > 1:
        raise ColumnMappingError(
            "显式映射列不唯一，请使用 1-based 列号。",
            details={
                "field": field_name,
                "source_column": requested_text,
                "matches": [headers[index] for index in positions],
                "candidates": [
                    _candidate(index + 1, headers[index])
                    for index in positions
                ],
            },
        )

    exact = [
        index for index, header in enumerate(headers)
        if str(header).strip() == requested_text
    ]
    if len(exact) == 1:
        return str(headers[exact[0]]), exact[0]
    raise ColumnMappingError(
        "显式映射列不存在。",
        details={"field": field_name, "source_column": requested_text},
    )


def _alias_positions(
    field_name: str,
    header_index: Mapping[str, Tuple[int, ...]],
) -> Tuple[int, ...]:
    alias_keys = {
        normalize_header(alias)
        for alias in FIELD_ALIASES.get(field_name, ())
    }
    positions = []
    for alias_key in alias_keys:
        for position in header_index.get(alias_key, ()):
            if position not in positions:
                positions.append(position)
    return tuple(sorted(positions))


def _layout_spec(
    explicit_layout: Optional[str],
    requested_positive_side: Optional[str],
    mappings: Mapping[str, FieldMapping],
    ambiguous: Optional[Mapping[str, Tuple[str, ...]]] = None,
    ambiguous_candidates: Optional[
        Mapping[str, Tuple[Mapping[str, Any], ...]]
    ] = None,
) -> AmountLayoutSpec:
    layout = explicit_layout
    if layout is None:
        if "debit" in mappings and "credit" in mappings:
            layout = LAYOUT_DEBIT_CREDIT
        elif "direction" in mappings and "amount" in mappings:
            layout = LAYOUT_DIRECTION_AMOUNT
        elif "signed_amount" in mappings and requested_positive_side:
            layout = LAYOUT_SIGNED_AMOUNT
        elif "debit" in mappings or "credit" in mappings:
            # Partial debit/credit columns: keep the layout for precise
            # missing-field diagnostics.
            layout = LAYOUT_DEBIT_CREDIT
        elif "direction" in mappings or "amount" in mappings:
            # Partial direction/amount columns: keep the layout for precise
            # missing-field diagnostics.
            layout = LAYOUT_DIRECTION_AMOUNT
        else:
            layout = ""

    if layout == LAYOUT_DEBIT_CREDIT:
        debit = mappings.get("debit")
        credit = mappings.get("credit")
        return AmountLayoutSpec(
            layout=LAYOUT_DEBIT_CREDIT,
            debit_column=debit.source_column if debit else None,
            credit_column=credit.source_column if credit else None,
        )
    if layout == LAYOUT_DIRECTION_AMOUNT:
        direction = mappings.get("direction")
        amount = mappings.get("amount")
        return AmountLayoutSpec(
            layout=LAYOUT_DIRECTION_AMOUNT,
            direction_column=direction.source_column if direction else None,
            amount_column=amount.source_column if amount else None,
        )
    if layout == LAYOUT_SIGNED_AMOUNT:
        signed = mappings.get("signed_amount")
        return AmountLayoutSpec(
            layout=LAYOUT_SIGNED_AMOUNT,
            signed_amount_column=signed.source_column if signed else None,
            positive_side=requested_positive_side,
        )
    if layout not in ("", None):
        raise ColumnMappingError(
            "未知的 amount_layout。",
            details={"amount_layout": layout, "allowed": list(AMOUNT_LAYOUTS)},
        )
    if "signed_amount" in mappings and not requested_positive_side:
        raise ColumnMappingError(
            "signed_amount 需要显式 positive_side 约定。",
            details={
                "reason": "missing_positive_side",
                "signed_amount_column": mappings["signed_amount"].source_column,
                "allowed": ["debit", "credit"],
            },
        )
    raise ColumnMappingError(
        "无法识别金额列布局。",
        details={
            "reason": "no_supported_amount_layout",
            "supported": list(AMOUNT_LAYOUTS),
            "ambiguous": {
                name: list(columns)
                for name, columns in (ambiguous or {}).items()
            },
            "ambiguous_candidates": {
                name: [dict(candidate) for candidate in candidates]
                for name, candidates in (ambiguous_candidates or {}).items()
            },
        },
    )


def suggest_mapping(
    headers: Sequence[Any],
    *,
    explicit: Optional[Mapping[str, Any]] = None,
    header_row: Optional[int] = None,
    sheet_name: Optional[str] = None,
) -> ColumnMapping:
    """Build a conservative mapping and explicit amount-layout contract.

    Explicit entries win. Remaining fields are matched by exact normalized alias.
    Duplicate headers are never silently overwritten; use a 1-based column index
    to select one.
    """

    if not headers:
        raise ColumnMappingError("表头为空。")

    header_index = _build_header_index(headers)
    mappings: Dict[str, FieldMapping] = {}
    ambiguous: Dict[str, Tuple[str, ...]] = {}
    ambiguous_candidates: Dict[str, Tuple[Mapping[str, Any], ...]] = {}
    warnings = []
    used_indices: Dict[int, str] = {}

    explicit = dict(explicit or {})
    allowed = set(CANONICAL_FIELDS) | set(MAPPING_META_FIELDS)
    unknown_fields = sorted(set(explicit) - allowed)
    if unknown_fields:
        raise ColumnMappingError(
            "显式映射包含未知字段。",
            details={"unknown_fields": unknown_fields},
        )

    explicit_layout = explicit.pop("amount_layout", None)
    if explicit_layout is not None and explicit_layout not in AMOUNT_LAYOUTS:
        raise ColumnMappingError(
            "显式 amount_layout 无效。",
            details={
                "amount_layout": explicit_layout,
                "allowed": list(AMOUNT_LAYOUTS),
            },
        )

    try:
        requested_positive_side = normalize_positive_side(
            explicit.pop("positive_side", None)
        )
    except JournalEntryError as exc:
        raise ColumnMappingError(
            "显式 positive_side 无效。",
            details={"allowed": ["debit", "credit"], "value": exc.details.get("value")},
        ) from exc

    for field_name in CANONICAL_FIELDS:
        if field_name not in explicit:
            continue
        column, index = _resolve_explicit_column(
            field_name,
            explicit[field_name],
            headers,
            header_index,
        )
        if index in used_indices:
            raise ColumnMappingError(
                "多个字段映射到同一列。",
                details={
                    "column_index": index + 1,
                    "column": column,
                    "fields": [used_indices[index], field_name],
                },
            )
        mappings[field_name] = FieldMapping(
            field=field_name,
            source_column=column,
            confidence=1.0,
            method="explicit",
            column_index=index + 1,
        )
        used_indices[index] = field_name

    for field_name in CANONICAL_FIELDS:
        if field_name in mappings:
            continue
        positions = _alias_positions(field_name, header_index)
        if not positions:
            continue
        if len(positions) > 1:
            ambiguous[field_name] = tuple(
                str(headers[position]) for position in positions
            )
            ambiguous_candidates[field_name] = tuple(
                _candidate(position + 1, headers[position])
                for position in positions
            )
            warnings.append(
                "%s 存在多个候选列，未自动选择。" % field_name
            )
            continue

        index = positions[0]
        if index in used_indices:
            warnings.append(
                "%s 的候选列已被 %s 使用。"
                % (field_name, used_indices[index])
            )
            continue
        mappings[field_name] = FieldMapping(
            field=field_name,
            source_column=str(headers[index]),
            confidence=1.0,
            method="alias",
            column_index=index + 1,
        )
        used_indices[index] = field_name

    amount_layout = _layout_spec(
        explicit_layout,
        requested_positive_side,
        mappings,
        ambiguous,
        ambiguous_candidates,
    )

    missing = []
    if "voucher_id" not in mappings:
        missing.append("voucher_id")
    if "account_code" not in mappings and "account_name" not in mappings:
        missing.append("account_code_or_account_name")
    if amount_layout.layout == LAYOUT_DEBIT_CREDIT:
        for name in ("debit", "credit"):
            if name not in mappings:
                missing.append(name)
    elif amount_layout.layout == LAYOUT_DIRECTION_AMOUNT:
        for name in ("direction", "amount"):
            if name not in mappings:
                missing.append(name)
    elif amount_layout.layout == LAYOUT_SIGNED_AMOUNT:
        if "signed_amount" not in mappings:
            missing.append("signed_amount")
        if not amount_layout.positive_side:
            missing.append("positive_side")

    if missing:
        raise ColumnMappingError(
            "缺少必要的列映射。",
            details={
                "missing_fields": missing,
                "amount_layout": amount_layout.layout,
                "ambiguous": {
                    name: list(columns)
                    for name, columns in ambiguous.items()
                },
                "ambiguous_candidates": {
                    name: [dict(candidate) for candidate in candidates]
                    for name, candidates in ambiguous_candidates.items()
                },
                "headers": [str(header) for header in headers],
            },
        )

    return ColumnMapping(
        fields=mappings,
        header_row=header_row,
        sheet_name=sheet_name,
        amount_layout=amount_layout,
        ambiguous=ambiguous,
        ambiguous_candidates=ambiguous_candidates,
        warnings=tuple(warnings),
    )
