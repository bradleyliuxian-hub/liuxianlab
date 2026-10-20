"""Percentage extraction with a second crop-specific OCR pass."""

from __future__ import annotations

from collections import defaultdict
from typing import Callable, Dict, List, Optional, Sequence, Tuple

import numpy as np

from .config import EquityConfig
from .image_preprocess import crop, percentage_variants, resize_keep
from .normalize import normalize_percentage
from .ocr_engine import OcrEngine, OcrItem


def _center(box: Sequence[float]) -> Tuple[float, float]:
    return ((float(box[0]) + float(box[2])) / 2, (float(box[1]) + float(box[3])) / 2)


def percentage_from_crop(
    engine: OcrEngine,
    crop_image: np.ndarray,
    scales: Sequence[float] = (1.5, 2.0, 2.5),
) -> str:
    if crop_image is None or crop_image.size == 0:
        return ""
    votes: Dict[str, List[float]] = defaultdict(list)
    for _label, variant in percentage_variants(crop_image):
        for scale in scales:
            for item in engine.recognize(resize_keep(variant, scale)):
                percentage = normalize_percentage(item.text)
                if percentage:
                    votes[percentage].append(item.score)
    if not votes:
        return ""
    ranked = sorted(
        votes.items(),
        key=lambda pair: (len(pair[1]), float(np.mean(pair[1]))),
        reverse=True,
    )
    return ranked[0][0]


def _global_near(
    items: Sequence[OcrItem],
    box: Sequence[float],
    side: str,
    vertical_range: int = 150,
    horizontal_range: int = 145,
) -> str:
    """Find a percentage immediately below/above a node, aligned to its center."""
    cx, _cy = _center(box)
    if side == "bottom":
        y1, y2 = float(box[3]) - 10, float(box[3]) + vertical_range
    else:
        y1, y2 = float(box[1]) - vertical_range, float(box[1]) + 10
    candidates: List[Tuple[float, str]] = []
    for item in items:
        percentage = normalize_percentage(item.text)
        if not percentage:
            continue
        x, y = item.center
        if abs(x - cx) <= horizontal_range and y1 <= y <= y2:
            distance = abs(x - cx) + 0.35 * min(abs(y - y1), abs(y - y2))
            candidates.append((distance, percentage))
    if not candidates:
        return ""
    return min(candidates, key=lambda pair: pair[0])[1]


def _local_crop(
    engine: OcrEngine,
    image: np.ndarray,
    box: Sequence[float],
    side: str,
    config: EquityConfig,
) -> str:
    cx, _cy = _center(box)
    width = 150
    if side == "bottom":
        y1, y2 = int(float(box[3]) - 20), int(float(box[3]) + 170)
    else:
        y1, y2 = int(float(box[1]) - 170), int(float(box[1]) + 20)
    crop_image = crop(image, (int(cx - width), y1, int(cx + width), y2))
    return percentage_from_crop(engine, crop_image, config.percentage_scales)


def make_percentage_reader(
    engine: OcrEngine,
    image: np.ndarray,
    global_items: Sequence[OcrItem],
    config: EquityConfig = EquityConfig(),
    use_secondary: bool = True,
) -> Callable[[Sequence[float], Sequence[float]], Tuple[str, str]]:
    def read(source_box: Sequence[float], target_box: Sequence[float]) -> Tuple[str, str]:
        # Percentages in these charts sit next to the upper or lower vertical
        # connector, not at the midpoint of a potentially very wide edge.
        for side, box, source in (
            ("top", target_box, "global_ocr"),
            ("bottom", source_box, "global_ocr"),
        ):
            percentage = _global_near(global_items, box, side)
            if percentage:
                return percentage, source

        if use_secondary:
            for side, box in (("top", target_box), ("bottom", source_box)):
                percentage = _local_crop(engine, image, box, side, config)
                if percentage:
                    return percentage, "secondary_crop_ocr"

        # Last resort: the old wide midpoint search, kept for unusual layouts.
        sx, sy = _center(source_box)
        tx, ty = _center(target_box)
        x1, x2 = min(sx, tx) - 135, max(sx, tx) + 135
        y1 = min(source_box[3], target_box[1]) - 55
        y2 = max(source_box[3], target_box[1]) + 55
        mid_x = (sx + tx) / 2
        mid_y = (y1 + y2) / 2
        candidates: List[Tuple[float, str]] = []
        for item in global_items:
            percentage = normalize_percentage(item.text)
            if not percentage:
                continue
            x, y = item.center
            if x1 <= x <= x2 and y1 <= y <= y2:
                distance = abs(x - mid_x) + 0.45 * abs(y - mid_y) - 25 * min(4, item.votes)
                candidates.append((distance, percentage))
        if candidates:
            return min(candidates, key=lambda pair: pair[0])[1], "global_ocr"
        return "", "missing"

    return read
