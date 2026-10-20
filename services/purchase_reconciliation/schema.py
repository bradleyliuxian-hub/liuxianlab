"""Canonical field schema and column aliases for SAP reconciliation input."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Sequence, Tuple

# Canonical fields used by the engine. Keep these stable: they are the contract
# between the Excel reader, the FIFO engine, the exporters and the HTTP layer.
FIELD_LABELS: Dict[str, str] = {
    "delivery_date": "送货日期",
    "supplier": "供应商",
    "purchase_order": "采购订单",
    "purchase_order_item": "采购订单项目",
    "material_code": "物料编码",
    "material_description": "物料描述",
    "order_unit": "订单单位",
    "quantity": "数量",
    "unit_price": "单价",
    "per": "每",
    "amount": "总金额",
    "movement_type": "移动类型",
}

# Default business key: a match may only happen inside one identical key.
DEFAULT_MATCH_FIELDS: Tuple[str, ...] = (
    "supplier",
    "purchase_order",
    "purchase_order_item",
    "material_code",
    "order_unit",
    "unit_price",
    "per",
)

DEFAULT_SORT_FIELDS: Tuple[str, ...] = ("delivery_date", "_source_row")

# Fields that must exist before a reconciliation may start. movement_type is
# required for the audit output; material_description is optional.
REQUIRED_FIELDS: Tuple[str, ...] = (
    "delivery_date",
    "supplier",
    "purchase_order",
    "purchase_order_item",
    "material_code",
    "order_unit",
    "quantity",
    "unit_price",
    "per",
    "amount",
    "movement_type",
)

NUMERIC_FIELDS = {"quantity", "unit_price", "per", "amount"}
DATE_FIELDS = {"delivery_date"}

_ALIAS_GROUPS: Dict[str, Sequence[str]] = {
    "delivery_date": (
        "送货日期", "交货日期", "收货日期", "Delivery Date", "DeliveryDate",
        "Goods Receipt Date", "GR Date",
    ),
    "supplier": (
        "供应商", "供应商名称", "供应商编码", "Vendor", "Vendor Name",
        "Supplier", "Supplier Name", "供应商/客户",
    ),
    "purchase_order": (
        "采购订单", "采购订单号", "采购凭证", "采购凭证号", "订单号",
        "Purchase Order", "Purchasing Document", "PO", "PO Number",
    ),
    "purchase_order_item": (
        "采购订单项目", "采购订单行项目", "采购订单行号", "行项目", "项目",
        "Purchase Order Item", "PO Item", "Item",
    ),
    "material_code": (
        "物料编码", "物料号", "物料编号", "物料", "Material", "Material Code",
        "Material Number", "SKU",
    ),
    "material_description": (
        "物料描述", "物料名称", "品名", "Material Description", "Description",
    ),
    "order_unit": (
        "订单单位", "单位", "计量单位", "Order Unit", "Unit", "UoM", "UOM",
    ),
    "quantity": ("数量", "Quantity", "Qty", "QTY"),
    "unit_price": ("单价", "Unit Price", "Price", "Net Price"),
    "per": ("每", "Per", "Price Unit"),
    "amount": ("总金额", "金额", "Amount", "Total Amount", "Net Amount"),
    "movement_type": (
        "移动类型", "移动类型代码", "Movement Type", "MovementType", "MvT",
        "Transaction Type",
    ),
}


def _normalize(value: str) -> str:
    return (
        str(value or "")
        .strip()
        .lower()
        .replace("（", "(")
        .replace("）", ")")
        .replace("：", ":")
        .replace(" ", "")
        .replace("_", "")
        .replace("-", "")
    )


COLUMN_ALIASES: Dict[str, Tuple[str, ...]] = {
    key: tuple(alias for alias in aliases)
    for key, aliases in _ALIAS_GROUPS.items()
}


@dataclass(frozen=True)
class ReconciliationConfig:
    """Runtime configuration of the reconciliation engine.

    The engine only depends on this object plus a list of normalized records,
    so it can be reused by HTTP jobs, CLI and tests.
    """

    match_fields: Tuple[str, ...] = DEFAULT_MATCH_FIELDS
    sort_fields: Tuple[str, ...] = DEFAULT_SORT_FIELDS
    date_field: str = "delivery_date"
    quantity_field: str = "quantity"
    amount_field: str = "amount"
    movement_type_field: str = "movement_type"
    fifo: bool = True
    currency_precision: int = 2
    amount_tolerance: str = "0.00"

    def __post_init__(self) -> None:
        if not self.fifo:
            raise ValueError("当前版本仅支持 FIFO；LIFO 尚未启用。")
        if not self.match_fields:
            raise ValueError("匹配字段不能为空。")
        unknown = [f for f in self.match_fields if f not in FIELD_LABELS]
        if unknown:
            raise ValueError("未知的匹配字段：" + "、".join(unknown))
        if self.date_field not in FIELD_LABELS:
            raise ValueError("未知的日期字段。")
        if self.quantity_field not in FIELD_LABELS:
            raise ValueError("未知的数量字段。")
        if self.amount_field not in FIELD_LABELS:
            raise ValueError("未知的金额字段。")

    def as_dict(self) -> Dict[str, object]:
        return {
            "match_fields": list(self.match_fields),
            "sort_fields": list(self.sort_fields),
            "date_field": self.date_field,
            "quantity_field": self.quantity_field,
            "amount_field": self.amount_field,
            "movement_type_field": self.movement_type_field,
            "fifo": self.fifo,
            "currency_precision": self.currency_precision,
            "amount_tolerance": self.amount_tolerance,
        }


def field_label(key: str) -> str:
    return FIELD_LABELS.get(key, key)


def public_field_schema() -> List[Dict[str, object]]:
    return [
        {
            "key": key,
            "label": label,
            "required": key in REQUIRED_FIELDS,
            "numeric": key in NUMERIC_FIELDS,
            "date": key in DATE_FIELDS,
            "aliases": list(COLUMN_ALIASES.get(key, ())),
        }
        for key, label in FIELD_LABELS.items()
    ]
