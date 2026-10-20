"""OCR engines and multi-scale / multi-tile merge logic.

PaddleOCR is imported lazily so the rest of the module (geometry, topology,
exporters, tests) can run in the base Python environment.
"""

from __future__ import annotations

from collections import Counter
from difflib import SequenceMatcher
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

import numpy as np

from .image_preprocess import resize_keep
from .normalize import is_percentage, normalize_percentage, normalize_text
from .ocr_types import OcrItem


class OcrEngine:
    def recognize(self, image: np.ndarray) -> List[OcrItem]:
        raise NotImplementedError


class PaddleOcrEngine(OcrEngine):
    """PaddleOCR adapter supporting both the 2.x and 3.x APIs."""

    def __init__(self, lang: str = "ch", use_angle_cls: bool = True):
        try:
            from paddleocr import PaddleOCR  # type: ignore
        except Exception as error:  # pragma: no cover - depends on local env
            raise RuntimeError(
                "OCR 环境未安装 PaddleOCR。请先在项目根目录运行 "
                "scripts/local/setup-equity-ocr.sh。"
            ) from error

        self._api = "v2"
        try:
            self._engine = PaddleOCR(
                use_angle_cls=use_angle_cls,
                lang=lang,
                show_log=False,
            )
        except TypeError:
            self._api = "v3"
            self._engine = PaddleOCR(
                lang=lang,
                use_doc_orientation_classify=False,
                use_doc_unwarping=False,
                use_textline_orientation=use_angle_cls,
            )
        except Exception as error:  # pragma: no cover - model / paddle issue
            raise RuntimeError(f"PaddleOCR 初始化失败：{error}") from error

    def recognize(self, image: np.ndarray) -> List[OcrItem]:
        try:
            if self._api == "v2":
                result = self._engine.ocr(image, cls=True)
                return parse_paddle_v2(result)
            result = self._engine.predict(image)
            return parse_paddle_v3(result)
        except Exception as error:  # pragma: no cover - runtime OCR failure
            raise RuntimeError(f"OCR 识别失败：{error}") from error


def _bbox_from_points(points: Sequence[Sequence[float]]) -> List[float]:
    array = np.asarray(points, dtype=float)
    return [float(array[:, 0].min()), float(array[:, 1].min()),
            float(array[:, 0].max()), float(array[:, 1].max())]


def parse_paddle_v2(result: Any) -> List[OcrItem]:
    if not result:
        return []
    lines = result[0] if isinstance(result, list) and len(result) == 1 and isinstance(result[0], list) else result
    items: List[OcrItem] = []
    for row in lines or []:
        if not row or len(row) < 2:
            continue
        box, text_score = row[0], row[1]
        if not isinstance(text_score, (list, tuple)) or len(text_score) < 2:
            continue
        text = str(text_score[0]).strip()
        if not text:
            continue
        score = float(text_score[1])
        polygon = [[float(point[0]), float(point[1])] for point in box]
        bbox = _bbox_from_points(polygon)
        items.append(OcrItem(
            text=text,
            score=score,
            bbox=bbox,
            center=[(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2],
            polygon=polygon,
        ))
    return items


def _result_mapping(result: Any) -> Optional[Dict[str, Any]]:
    data = result
    if isinstance(data, dict) and isinstance(data.get("res"), dict):
        data = data["res"]
    if isinstance(data, dict):
        return data
    json_attr = getattr(data, "json", None)
    if callable(json_attr):
        try:
            data = json_attr()
        except Exception:
            return None
    elif json_attr is not None:
        data = json_attr
    if isinstance(data, dict) and isinstance(data.get("res"), dict):
        data = data["res"]
    return data if isinstance(data, dict) else None


def parse_paddle_v3(result: Any) -> List[OcrItem]:
    if result is None:
        return []
    if not isinstance(result, (list, tuple)):
        result = [result]
    items: List[OcrItem] = []
    for entry in result:
        data = _result_mapping(entry)
        if not data:
            continue
        texts = data.get("rec_texts") or data.get("texts") or []
        scores = data.get("rec_scores") or data.get("scores") or []
        boxes = data.get("rec_polys")
        if boxes is None:
            boxes = data.get("dt_polys")
        if boxes is None:
            boxes = data.get("rec_boxes") or []
        for index, text in enumerate(texts):
            text = str(text or "").strip()
            if not text:
                continue
            score = float(scores[index]) if index < len(scores) else 0.0
            box = boxes[index] if index < len(boxes) else None
            if box is None:
                continue
            box_array = np.asarray(box, dtype=float)
            if box_array.ndim == 1 and box_array.size == 4:
                bbox = [float(v) for v in box_array.tolist()]
                polygon = [
                    [bbox[0], bbox[1]], [bbox[2], bbox[1]],
                    [bbox[2], bbox[3]], [bbox[0], bbox[3]],
                ]
            else:
                polygon = [[float(point[0]), float(point[1])] for point in box_array]
                bbox = _bbox_from_points(polygon)
            items.append(OcrItem(
                text=text,
                score=score,
                bbox=bbox,
                center=[(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2],
                polygon=polygon,
            ))
    return items


class FakeOcrEngine(OcrEngine):
    """Deterministic engine for unit tests and offline demos."""

    def __init__(self, items: Iterable[OcrItem]):
        self._items = list(items)

    def recognize(self, image: np.ndarray) -> List[OcrItem]:
        return [OcrItem(
            text=item.text,
            score=item.score,
            bbox=list(item.bbox),
            center=list(item.center),
            polygon=[list(point) for point in item.polygon],
            votes=item.votes,
        ) for item in self._items]


def _move(item: OcrItem, dx: float, dy: float) -> OcrItem:
    return OcrItem(
        text=item.text,
        score=item.score,
        bbox=[item.bbox[0] + dx, item.bbox[1] + dy, item.bbox[2] + dx, item.bbox[3] + dy],
        center=[item.center[0] + dx, item.center[1] + dy],
        polygon=[[point[0] + dx, point[1] + dy] for point in item.polygon],
        votes=item.votes,
    )


def _scale_back(item: OcrItem, scale: float) -> OcrItem:
    if abs(scale - 1.0) < 1e-6:
        return item
    return OcrItem(
        text=item.text,
        score=item.score,
        bbox=[value / scale for value in item.bbox],
        center=[value / scale for value in item.center],
        polygon=[[point[0] / scale, point[1] / scale] for point in item.polygon],
        votes=item.votes,
    )


def _similar(left: str, right: str) -> float:
    return SequenceMatcher(None, normalize_text(left), normalize_text(right)).ratio()


def multiscale_recognize(
    engine: OcrEngine,
    tile_image: np.ndarray,
    offset_x: int,
    offset_y: int,
    scales: Sequence[float] = (1.0, 1.3, 1.65, 2.0),
    tile_label: str = "",
) -> List[OcrItem]:
    groups: List[Dict[str, Any]] = []
    for scale in scales:
        scaled = resize_keep(tile_image, scale)
        for item in engine.recognize(scaled):
            item = _scale_back(item, scale)
            normalized = item.normalized
            if not normalized:
                continue
            placed = False
            for group in groups:
                gx, gy = group["center"]
                if abs(item.center[0] - gx) <= 18 and abs(item.center[1] - gy) <= 16:
                    if _similar(normalized, group["norm"]) >= 0.72 or (
                        is_percentage(normalized) and is_percentage(group["norm"])
                    ):
                        group["variants"].append(item)
                        group["center"] = [
                            float(np.mean([v.center[0] for v in group["variants"]])),
                            float(np.mean([v.center[1] for v in group["variants"]])),
                        ]
                        placed = True
                        break
            if not placed:
                groups.append({"center": list(item.center), "norm": normalized, "variants": [item]})

    merged: List[OcrItem] = []
    for group in groups:
        variants: List[OcrItem] = group["variants"]
        counts = Counter(normalize_text(v.text) for v in variants)
        best = max(variants, key=lambda v: (counts[normalize_text(v.text)], v.score, len(normalize_text(v.text))))
        text = best.text
        if any(is_percentage(v.text) for v in variants):
            candidates = [normalize_percentage(v.text) for v in variants if normalize_percentage(v.text)]
            if candidates:
                text = Counter(candidates).most_common(1)[0][0]
        merged.append(OcrItem(
            text=text,
            score=float(np.mean([v.score for v in variants])),
            bbox=[
                float(np.mean([v.bbox[0] for v in variants])),
                float(np.mean([v.bbox[1] for v in variants])),
                float(np.mean([v.bbox[2] for v in variants])),
                float(np.mean([v.bbox[3] for v in variants])),
            ],
            center=[
                float(np.mean([v.center[0] for v in variants])),
                float(np.mean([v.center[1] for v in variants])),
            ],
            polygon=best.polygon,
            votes=len(variants),
        ))
    return [_move(item, offset_x, offset_y) for item in merged if item.text.strip()]


def dedupe_items(items: Iterable[OcrItem], distance: int = 24, similarity: float = 0.86) -> List[OcrItem]:
    ordered = sorted(items, key=lambda item: (-item.votes, -item.score, item.center[1], item.center[0]))
    kept: List[OcrItem] = []
    for item in ordered:
        duplicate = False
        for existing in kept:
            if abs(item.center[0] - existing.center[0]) <= distance and abs(item.center[1] - existing.center[1]) <= distance:
                if _similar(item.text, existing.text) >= similarity:
                    duplicate = True
                    if (item.votes, item.score) > (existing.votes, existing.score):
                        existing.text = item.text
                        existing.score = item.score
                        existing.bbox = item.bbox
                        existing.center = item.center
                        existing.polygon = item.polygon
                        existing.votes = item.votes
                    break
        if not duplicate:
            kept.append(item)
    return sorted(kept, key=lambda item: (item.center[1], item.center[0]))
