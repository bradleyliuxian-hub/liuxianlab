"""Horizontal / vertical line extraction for topology reconstruction."""

from __future__ import annotations

from typing import List

import cv2

from .config import EquityConfig
from .geometry import Segment


def _merge_segments(segments: List[Segment], gap: int = 12) -> List[Segment]:
    """Merge collinear, nearby fragments so a dashed connector is one segment."""
    merged: List[Segment] = []
    for segment in sorted(segments, key=lambda s: (s.orientation, s.y1, s.x1)):
        target = None
        for existing in merged:
            if existing.orientation != segment.orientation:
                continue
            if segment.orientation == "h":
                same_axis = abs(existing.y1 - segment.y1) <= 4
                overlap = segment.x1 <= existing.x2 + gap and existing.x1 <= segment.x2 + gap
            else:
                same_axis = abs(existing.x1 - segment.x1) <= 4
                overlap = segment.y1 <= existing.y2 + gap and existing.y1 <= segment.y2 + gap
            if same_axis and overlap:
                target = existing
                break
        if target is None:
            merged.append(segment)
            continue
        index = merged.index(target)
        if segment.orientation == "h":
            merged[index] = Segment(
                min(target.x1, segment.x1), min(target.y1, segment.y1),
                max(target.x2, segment.x2), max(target.y2, segment.y2), "h",
            )
        else:
            merged[index] = Segment(
                min(target.x1, segment.x1), min(target.y1, segment.y1),
                max(target.x2, segment.x2), max(target.y2, segment.y2), "v",
            )
    return merged


def detect_segments(image: np.ndarray, config: EquityConfig = EquityConfig()) -> List[Segment]:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    binary = cv2.threshold(gray, 205, 255, cv2.THRESH_BINARY_INV)[1]
    horizontal_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (40, 1))
    vertical_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, 40))
    horizontal = cv2.morphologyEx(binary, cv2.MORPH_OPEN, horizontal_kernel)
    vertical = cv2.morphologyEx(binary, cv2.MORPH_OPEN, vertical_kernel)

    segments: List[Segment] = []
    for mask, orientation in ((horizontal, "h"), (vertical, "v")):
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        for contour in contours:
            x, y, width, height = cv2.boundingRect(contour)
            if orientation == "h":
                if width >= config.line_min_length and height <= config.line_max_thickness:
                    segments.append(Segment(x, y, x + width, y + height, "h"))
            else:
                if height >= config.line_min_length and width <= config.line_max_thickness:
                    segments.append(Segment(x, y, x + width, y + height, "v"))
    return _merge_segments(segments)
