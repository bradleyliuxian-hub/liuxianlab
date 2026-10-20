"""Rounded-node detection and OCR text assignment."""

from __future__ import annotations

from difflib import SequenceMatcher
from typing import Dict, List, Optional, Tuple

import cv2
import numpy as np

from .config import EquityConfig
from .dictionary import correct_name
from .normalize import clean_name, contains_cancel_word, entity_type_for, is_percentage, is_ui_noise, normalize_text
from .image_preprocess import resize_keep
from .ocr_engine import OcrEngine, OcrItem


def _iou(a: List[float], b: List[float]) -> float:
    x1, y1 = max(a[0], b[0]), max(a[1], b[1])
    x2, y2 = min(a[2], b[2]), min(a[3], b[3])
    intersection = max(0.0, x2 - x1) * max(0.0, y2 - y1)
    area_a = max(1.0, (a[2] - a[0]) * (a[3] - a[1]))
    area_b = max(1.0, (b[2] - b[0]) * (b[3] - b[1]))
    return intersection / (area_a + area_b - intersection)


def _nms(boxes: List[List[float]], threshold: float = 0.4) -> List[List[float]]:
    if not boxes:
        return []
    ordered = sorted(boxes, key=lambda box: (box[2] - box[0]) * (box[3] - box[1]), reverse=True)
    kept: List[List[float]] = []
    while ordered:
        current = ordered.pop(0)
        kept.append(current)
        ordered = [box for box in ordered if _iou(current, box) < threshold]
    return kept


def detect_boxes(image: np.ndarray, config: EquityConfig = EquityConfig()) -> List[List[int]]:
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    masks = [
        # Warm beige / orange templates (reference screenshots).
        cv2.inRange(hsv, np.array([5, 55, 90], np.uint8), np.array([35, 255, 255], np.uint8)),
        cv2.inRange(hsv, np.array([8, 20, 120], np.uint8), np.array([40, 140, 255], np.uint8)),
        # 天眼查/企查查 style: white fill with a blue rounded border.
        cv2.inRange(hsv, np.array([90, 50, 70], np.uint8), np.array([140, 255, 255], np.uint8)),
        cv2.inRange(hsv, np.array([95, 20, 150], np.uint8), np.array([135, 120, 255], np.uint8)),
    ]
    mask = masks[0]
    for extra in masks[1:]:
        mask = cv2.bitwise_or(mask, extra)
    mask = cv2.morphologyEx(
        mask,
        cv2.MORPH_CLOSE,
        cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5)),
        iterations=1,
    )
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    height, width = image.shape[:2]
    boxes: List[List[float]] = []
    for contour in contours:
        x, y, w, h = cv2.boundingRect(contour)
        if w < config.node_min_width or h < config.node_min_height:
            continue
        if w > width * config.node_max_width_ratio or h > height * config.node_max_height_ratio:
            continue
        ratio = w / max(1, h)
        # Rounded rectangles are wider than tall; some templates draw an
        # individual shareholder as a near-square orange circle.
        if ratio < 1.15:
            if ratio < 0.72 or w < 55 or h < 55 or w * h < 3000:
                continue
        elif ratio > 13:
            continue
        if w * h < 2400:
            continue
        boxes.append([float(x), float(y), float(x + w), float(y + h)])
    boxes = _nms(boxes)
    boxes.sort(key=lambda box: (box[1], box[0]))
    return [[int(value) for value in box] for box in boxes]


def _point_in_box(point: List[float], box: List[float], pad: int = 5) -> bool:
    return (
        box[0] - pad <= point[0] <= box[2] + pad
        and box[1] - pad <= point[1] <= box[3] + pad
    )


def _overlap_ratio(a: List[float], b: List[float]) -> float:
    x1, y1 = max(a[0], b[0]), max(a[1], b[1])
    x2, y2 = min(a[2], b[2]), min(a[3], b[3])
    intersection = max(0.0, x2 - x1) * max(0.0, y2 - y1)
    return intersection / max(1.0, min((a[2] - a[0]) * (a[3] - a[1]), (b[2] - b[0]) * (b[3] - b[1])))


def _dedupe_inside(items: List[OcrItem]) -> List[OcrItem]:
    """Collapse duplicate OCR fragments produced by overlapping tiles."""
    ordered = sorted(
        items,
        key=lambda item: (-len(normalize_text(item.text).strip("√✓✔+")), -item.votes, -item.score),
    )
    kept: List[OcrItem] = []
    for item in ordered:
        norm = normalize_text(item.text).strip("√✓✔+")
        if len(norm) < 2:
            continue
        duplicate = False
        for existing in kept:
            existing_norm = normalize_text(existing.text).strip("√✓✔+")
            if norm in existing_norm or existing_norm in norm:
                duplicate = True
                break
            if _overlap_ratio(item.bbox, existing.bbox) >= 0.32:
                if SequenceMatcher(None, norm, existing_norm).ratio() >= 0.52:
                    duplicate = True
                    break
        if not duplicate:
            kept.append(item)
    return kept


def _name_from_items(items: List[OcrItem]) -> str:
    return clean_name(_row_merge_text(_dedupe_inside(items)))


def _has_repeated_prefix(name: str) -> bool:
    if len(name) < 10:
        return False
    left = name[:5]
    right = name[5:10]
    if len(right) < 4:
        return False
    return SequenceMatcher(None, left, right).ratio() >= 0.65


def _row_merge_text(items: List[OcrItem]) -> str:
    if not items:
        return ""
    ordered = sorted(items, key=lambda item: (item.center[1], item.center[0]))
    heights = [max(1.0, item.bbox[3] - item.bbox[1]) for item in ordered]
    tolerance = max(13.0, float(np.median(heights)) * 0.85)
    rows: List[Dict[str, object]] = []
    for item in ordered:
        placed = False
        for row in rows:
            if abs(item.center[1] - row["y"]) <= tolerance:
                row["items"].append(item)  # type: ignore[union-attr]
                row["y"] = float(np.mean([entry.center[1] for entry in row["items"]]))  # type: ignore[index]
                placed = True
                break
        if not placed:
            rows.append({"y": item.center[1], "items": [item]})
    return "".join(
        "".join(entry.text.strip() for entry in sorted(row["items"], key=lambda entry: entry.center[0]) if entry.text.strip())
        for row in rows
    )


def assign_text_to_boxes(
    items: List[OcrItem],
    boxes: List[List[int]],
    config: EquityConfig = EquityConfig(),
    dictionary: Optional[List[str]] = None,
    core_id: str = "",
    engine: Optional[OcrEngine] = None,
    image: Optional[np.ndarray] = None,
) -> Tuple[List[Dict[str, object]], List[Dict[str, object]]]:
    nodes: List[Dict[str, object]] = []
    corrections: List[Dict[str, object]] = []

    for box in boxes:
        global_inside = [item for item in items if _point_in_box(item.center, box, pad=4)]
        if not global_inside:
            continue
        text_items = _dedupe_inside(global_inside)
        global_name = _name_from_items(text_items)

        # A second OCR pass on the node crop removes tile-boundary duplicates
        # and reads wrapped company names much more reliably. Keep the global
        # text when the crop is shorter (it may have clipped a rare character).
        if config.refine_node_ocr and engine is not None and image is not None:
            x1, y1, x2, y2 = (int(value) for value in box)
            crop_image = image[max(0, y1):min(image.shape[0], y2), max(0, x1):min(image.shape[1], x2)]
            if crop_image.size:
                refined = engine.recognize(resize_keep(crop_image, config.refine_node_scale))
                refined_items = []
                for item in refined:
                    refined_items.append(OcrItem(
                        text=item.text,
                        score=item.score,
                        bbox=[
                            item.bbox[0] / config.refine_node_scale + x1,
                            item.bbox[1] / config.refine_node_scale + y1,
                            item.bbox[2] / config.refine_node_scale + x1,
                            item.bbox[3] / config.refine_node_scale + y1,
                        ],
                        center=[
                            item.center[0] / config.refine_node_scale + x1,
                            item.center[1] / config.refine_node_scale + y1,
                        ],
                        polygon=[[point[0] / config.refine_node_scale + x1, point[1] / config.refine_node_scale + y1] for point in item.polygon],
                        votes=item.votes,
                    ))
                refined_items = _dedupe_inside(refined_items)
                refined_name = _name_from_items(refined_items)
                if refined_name and (
                    len(refined_name) >= len(global_name)
                    or (_has_repeated_prefix(global_name) and len(refined_name) >= int(len(global_name) * 0.7))
                ):
                    text_items = refined_items

        cleaned: List[OcrItem] = []
        status_text = ""
        for item in text_items:
            text = item.text.strip()
            if not text:
                continue
            if contains_cancel_word(text) and not clean_name(text):
                status_text += text
                continue
            if is_percentage(text) or is_ui_noise(text):
                continue
            cleaned.append(item)
            if contains_cancel_word(text):
                status_text += text

        # Status labels sometimes sit just outside the node; inspect a narrow
        # band around the box without letting unrelated labels cancel a node.
        expanded = [box[0] - 12, box[1] - 12, box[2] + 12, box[3] + 12]
        for item in items:
            if _point_in_box(item.center, expanded, pad=0) and contains_cancel_word(item.text):
                status_text += item.text

        name = clean_name(_row_merge_text(_dedupe_inside(cleaned)))
        if len(name) < 2:
            continue

        corrected, similarity, original = correct_name(
            name,
            dictionary=dictionary,
            threshold=config.dictionary_threshold,
            min_length=config.min_dictionary_length,
        )
        if original:
            corrections.append({
                "original": original,
                "corrected": corrected,
                "similarity": round(float(similarity or 0), 2),
            })
            name = corrected

        if contains_cancel_word(status_text) or contains_cancel_word(name):
            status = "excluded_cancelled"
        else:
            status = "active"

        score_items = global_inside or text_items
        base_score = float(np.mean([item.score for item in score_items])) if score_items else 0.0
        vote_score = float(np.mean([min(4, item.votes) / 4 for item in score_items])) if score_items else 0.0
        confidence = min(0.99, 0.68 * base_score + 0.32 * vote_score)
        nodes.append({
            "name": name,
            "bbox": box,
            "ocr_confidence": round(confidence, 4),
            "status": status,
            "entity_type": entity_type_for(name, "", core_id),
        })

    # Stable IDs follow the visual reading order.
    for index, node in enumerate(nodes, start=1):
        node["id"] = f"n{index}"
    return nodes, corrections
