"""Deterministic FIFO reconciliation engine.

Design notes
------------
* Direction comes from the signed quantity, never from the SAP movement type.
  Movement type is carried through for audit only.
* A match may only happen inside one business key (supplier + purchase order +
  item + material + unit + price + price unit by default). This prevents
  "amount happens to be equal" matches across unrelated documents.
* Inside a key, both sides are sorted once by delivery date and source row,
  then consumed with a two-pointer sweep. That is O(n log n) overall instead of
  scanning every negative row against every positive row.
* One positive row may consume several negative rows (and vice versa), and a
  partial match leaves a proportional remaining amount on the original row.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

from .schema import (
    DEFAULT_MATCH_FIELDS,
    DEFAULT_SORT_FIELDS,
    ReconciliationConfig,
)


def to_decimal(value: Any) -> Decimal:
    if value is None or value == "":
        return Decimal("0")
    if isinstance(value, Decimal):
        return value
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError) as error:
        raise ValueError(f"无法转换为数字：{value!r}") from error


def _key_value(value: Any) -> Any:
    if value is None:
        return ""
    if isinstance(value, Decimal):
        normalized = value.normalize()
        return format(normalized, "f")
    if isinstance(value, float):
        return format(Decimal(str(value)).normalize(), "f")
    return str(value).strip()


def business_key(record: Dict[str, Any], match_fields: Sequence[str]) -> Tuple[Any, ...]:
    return tuple(_key_value(record.get(field)) for field in match_fields)


def _sort_value(value: Any):
    if value is None or value == "":
        return (1, "")
    if isinstance(value, Decimal):
        return (0, format(value, "f").rjust(40, "0"))
    return (0, str(value))


def _row_sort_key(record: Dict[str, Any], sort_fields: Sequence[str]):
    values = []
    for field in sort_fields:
        if field == "_source_row":
            values.append((0, int(record.get("source_row") or 0)))
        else:
            values.append(_sort_value(record.get(field)))
    return tuple(values)


def amount_for_quantity(record: Dict[str, Any], quantity: Decimal, amount_field: str = "amount", quantity_field: str = "quantity") -> Decimal:
    original_quantity = to_decimal(record.get(quantity_field))
    original_amount = to_decimal(record.get(amount_field))
    if original_quantity == 0:
        return Decimal("0")
    return original_amount * quantity / original_quantity


@dataclass
class ReconciliationResult:
    segments: List[Dict[str, Any]]
    matched_records: List[Dict[str, Any]]
    remaining_rows: List[Dict[str, Any]]
    metrics: Dict[str, Any]
    movement_summary: List[Dict[str, Any]]
    config: Dict[str, Any]
    headers: List[str]
    warnings: List[str]

    def summary(self) -> Dict[str, Any]:
        return {
            "metrics": self.metrics,
            "movement_summary": self.movement_summary,
            "config": self.config,
            "headers": self.headers,
            "warnings": self.warnings,
            "match_count": len(self.segments),
            "matched_record_count": len(self.matched_records),
            "remaining_row_count": len(self.remaining_rows),
            "unmatched_negative_count": sum(
                1 for row in self.remaining_rows
                if to_decimal(row.get("remaining_quantity")) < 0
            ),
        }


def reconcile(
    records: Iterable[Dict[str, Any]],
    config: Optional[ReconciliationConfig] = None,
    headers: Optional[Sequence[str]] = None,
    warnings: Optional[Sequence[str]] = None,
) -> ReconciliationResult:
    cfg = config or ReconciliationConfig()
    quantity_field = cfg.quantity_field
    amount_field = cfg.amount_field
    movement_field = cfg.movement_type_field

    rows = list(records)
    if not rows:
        raise ValueError("没有可对抵的数据行。")
    for field in cfg.match_fields:
        if field not in ("_source_row",) and not any(field in row for row in rows[:1]):
            raise ValueError(f"匹配字段不存在：{field}")
    for field in cfg.sort_fields:
        if field != "_source_row" and rows and field not in rows[0]:
            raise ValueError(f"排序字段不存在：{field}")

    groups: Dict[Tuple[Any, ...], Dict[str, List[int]]] = defaultdict(
        lambda: {"positive": [], "negative": []}
    )
    matched_quantities = [Decimal("0") for _ in rows]
    match_ids: List[List[str]] = [[] for _ in rows]
    positive_count = 0
    negative_count = 0
    zero_count = 0

    for index, record in enumerate(rows):
        quantity = to_decimal(record.get(quantity_field))
        if quantity > 0:
            positive_count += 1
            groups[business_key(record, cfg.match_fields)]["positive"].append(index)
        elif quantity < 0:
            negative_count += 1
            groups[business_key(record, cfg.match_fields)]["negative"].append(index)
        else:
            zero_count += 1

    segments: List[Dict[str, Any]] = []
    # Iteration order follows the first occurrence of each key in the uploaded
    # file, so repeated runs over the same file produce identical MATCH IDs.
    for key, sides in groups.items():
        positive_indexes = sorted(
            sides["positive"], key=lambda i: _row_sort_key(rows[i], cfg.sort_fields)
        )
        negative_indexes = sorted(
            sides["negative"], key=lambda i: _row_sort_key(rows[i], cfg.sort_fields)
        )
        if not positive_indexes or not negative_indexes:
            continue

        positive_pointer = 0
        negative_pointer = 0
        positive_remaining = to_decimal(rows[positive_indexes[0]].get(quantity_field))
        negative_remaining = -to_decimal(rows[negative_indexes[0]].get(quantity_field))

        while positive_pointer < len(positive_indexes) and negative_pointer < len(negative_indexes):
            quantity = min(positive_remaining, negative_remaining)
            if quantity <= 0:
                break
            positive_index = positive_indexes[positive_pointer]
            negative_index = negative_indexes[negative_pointer]
            positive_row = rows[positive_index]
            negative_row = rows[negative_index]

            matched_quantities[positive_index] += quantity
            matched_quantities[negative_index] += quantity

            match_id = f"MATCH-{len(segments) + 1:06d}"
            match_ids[positive_index].append(match_id)
            match_ids[negative_index].append(match_id)
            matched_amount = amount_for_quantity(positive_row, quantity, amount_field, quantity_field)
            negative_amount_abs = -amount_for_quantity(negative_row, -quantity, amount_field, quantity_field)
            segments.append({
                "match_id": match_id,
                "business_key": " | ".join(str(part) for part in key),
                "positive_source_row": int(positive_row.get("source_row") or 0),
                "negative_source_row": int(negative_row.get("source_row") or 0),
                "positive_quantity": to_decimal(positive_row.get(quantity_field)),
                "negative_quantity": to_decimal(negative_row.get(quantity_field)),
                "matched_quantity": quantity,
                "matched_amount": matched_amount,
                "negative_amount_abs": negative_amount_abs,
                "positive_movement_type": str(positive_row.get(movement_field) or ""),
                "negative_movement_type": str(negative_row.get(movement_field) or ""),
                "positive_date": positive_row.get(cfg.date_field),
                "negative_date": negative_row.get(cfg.date_field),
                "positive_unit_price": to_decimal(positive_row.get("unit_price")),
                "negative_unit_price": to_decimal(negative_row.get("unit_price")),
            })

            positive_remaining -= quantity
            negative_remaining -= quantity
            if positive_remaining == 0:
                positive_pointer += 1
                if positive_pointer < len(positive_indexes):
                    positive_remaining = to_decimal(
                        rows[positive_indexes[positive_pointer]].get(quantity_field)
                    )
            if negative_remaining == 0:
                negative_pointer += 1
                if negative_pointer < len(negative_indexes):
                    negative_remaining = -to_decimal(
                        rows[negative_indexes[negative_pointer]].get(quantity_field)
                    )

    original_positive_amount = Decimal("0")
    original_negative_amount_abs = Decimal("0")
    remaining_negative_amount_abs = Decimal("0")
    remaining_negative_quantity_abs = Decimal("0")
    net_amount = Decimal("0")

    remaining_rows: List[Dict[str, Any]] = []
    matched_records: List[Dict[str, Any]] = []
    movement = defaultdict(lambda: {
        "record_count": 0,
        "original_quantity": Decimal("0"),
        "original_amount": Decimal("0"),
        "matched_quantity": Decimal("0"),
        "remaining_quantity": Decimal("0"),
        "remaining_amount": Decimal("0"),
    })

    for index, record in enumerate(rows):
        quantity = to_decimal(record.get(quantity_field))
        amount = to_decimal(record.get(amount_field))
        if quantity > 0:
            original_positive_amount += amount
        elif quantity < 0:
            original_negative_amount_abs += -amount

        matched = matched_quantities[index]
        if quantity > 0:
            remaining_quantity = quantity - matched
        elif quantity < 0:
            remaining_quantity = quantity + matched
        else:
            remaining_quantity = quantity
        remaining_amount = (
            amount_for_quantity(record, remaining_quantity, amount_field, quantity_field)
            if quantity != 0 else amount
        )

        movement_type = str(record.get(movement_field) or "未标注")
        bucket = movement[movement_type]
        bucket["record_count"] += 1
        bucket["original_quantity"] += quantity
        bucket["original_amount"] += amount
        bucket["matched_quantity"] += matched
        bucket["remaining_quantity"] += remaining_quantity
        bucket["remaining_amount"] += remaining_amount

        direction = "正向" if quantity > 0 else "负向" if quantity < 0 else "零数量"
        audit = {
            "source_row": int(record.get("source_row") or 0),
            "direction": direction,
            "original_quantity": quantity,
            "matched_quantity": matched,
            "remaining_quantity": remaining_quantity,
            "original_amount": amount,
            "remaining_amount": remaining_amount,
            "match_ids": list(match_ids[index]),
            "business_key": " | ".join(str(part) for part in business_key(record, cfg.match_fields)),
        }
        if matched:
            signed_matched_amount = (
                amount_for_quantity(record, matched, amount_field, quantity_field)
                if quantity != 0 else Decimal("0")
            )
            if quantity < 0:
                signed_matched_amount = -signed_matched_amount
            matched_records.append({
                **audit,
                "matched_amount": signed_matched_amount,
                "raw": record.get("raw", {}),
            })
        if remaining_quantity != 0:
            remaining_rows.append({**audit, "raw": record.get("raw", {})})
            net_amount += remaining_amount
            if remaining_quantity < 0:
                remaining_negative_amount_abs += -remaining_amount
                remaining_negative_quantity_abs += -remaining_quantity

    matched_amount = sum((segment["matched_amount"] for segment in segments), Decimal("0"))
    precision = Decimal(1).scaleb(-cfg.currency_precision)

    def money(value: Any) -> Decimal:
        return to_decimal(value).quantize(precision, rounding=ROUND_HALF_UP)

    original_positive = money(original_positive_amount)
    original_negative = money(original_negative_amount_abs)
    matched_total = money(matched_amount)
    unmatched_negative = money(remaining_negative_amount_abs)
    final_net = money(net_amount)
    conservation = money((original_positive - original_negative) - final_net)
    tolerance = to_decimal(cfg.amount_tolerance)

    metrics = {
        "original_record_count": len(rows),
        "match_segment_count": len(segments),
        "matched_record_count": len(matched_records),
        "remaining_record_count": len(remaining_rows),
        "original_positive_amount": original_positive,
        "original_negative_amount_abs": original_negative,
        "matched_amount": matched_total,
        "unmatched_negative_amount_abs": unmatched_negative,
        "unmatched_negative_quantity_abs": remaining_negative_quantity_abs,
        "final_net_amount": final_net,
        "conservation_difference": conservation,
        "positive_record_count": positive_count,
        "negative_record_count": negative_count,
        "zero_quantity_record_count": zero_count,
        "fully_matched_record_count": sum(
            1 for row in matched_records if row["remaining_quantity"] == 0
        ),
        "business_key_count": sum(
            1 for sides in groups.values() if sides["positive"] or sides["negative"]
        ),
        "conservation_ok": abs(conservation) <= tolerance,
    }

    movement_summary = [
        {"movement_type": movement_type, **values}
        for movement_type, values in sorted(movement.items())
    ]
    return ReconciliationResult(
        segments=segments,
        matched_records=matched_records,
        remaining_rows=remaining_rows,
        metrics=metrics,
        movement_summary=movement_summary,
        config=cfg.as_dict(),
        headers=list(headers or []),
        warnings=list(warnings or []),
    )
