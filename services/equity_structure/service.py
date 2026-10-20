"""High-level equity-structure recognition service."""

from __future__ import annotations

import time
from typing import Callable, Optional

import numpy as np

from .config import EquityConfig
from .dictionary import load_dictionary
from .image_preprocess import decode_image
from .line_detector import detect_segments
from .node_detector import assign_text_to_boxes, detect_boxes
from .ocr_engine import OcrEngine, PaddleOcrEngine, dedupe_items, multiscale_recognize
from .percentage_reader import make_percentage_reader
from .schemas import Diagnostics, StructureResult
from .structure_builder import build_structure
from .tiling import tile_image

ProgressCallback = Callable[[int, str], None]


def _noop(_percent: int, _message: str) -> None:
    return None


def analyze_image(
    raw: bytes,
    progress: Optional[ProgressCallback] = None,
    config: Optional[EquityConfig] = None,
    engine: Optional[OcrEngine] = None,
) -> StructureResult:
    callback = progress or _noop
    cfg = config or EquityConfig.from_env()
    started = time.time()

    callback(3, "正在解析图片…")
    image = decode_image(raw)
    height, width = image.shape[:2]
    if width * height > cfg.max_pixels:
        raise ValueError(
            f"图片像素过大（{width}×{height}），请控制在约 {cfg.max_pixels // 100_000_000} 亿像素以内。"
        )

    callback(6, "正在准备 OCR 引擎…")
    ocr_engine = engine or PaddleOcrEngine(lang=cfg.ocr_lang)
    dictionary = load_dictionary(cfg.dictionary_path)

    tiles = tile_image(
        image,
        tile_width=cfg.tile_width,
        tile_height=cfg.tile_height,
        overlap=cfg.tile_overlap,
        max_tiles=cfg.max_tiles,
    )
    callback(10, f"已切分 {len(tiles)} 个切片，开始多尺度 OCR…")

    all_items = []
    for index, tile in enumerate(tiles, start=1):
        items = multiscale_recognize(
            ocr_engine,
            tile.image,
            offset_x=tile.x,
            offset_y=tile.y,
            scales=cfg.ocr_scales,
            tile_label=tile.label,
        )
        all_items.extend(items)
        percent = 10 + int(55 * index / max(1, len(tiles)))
        callback(percent, f"OCR 切片 {index}/{len(tiles)}（{tile.label}）")

    callback(68, "正在合并多尺度/重叠切片文字…")
    all_items = dedupe_items(all_items)

    callback(72, "正在检测节点框与连线…")
    boxes = detect_boxes(image, cfg)
    segments = detect_segments(image, cfg)
    raw_nodes, corrections = assign_text_to_boxes(
        all_items, boxes, cfg, dictionary=dictionary,
        engine=ocr_engine, image=image,
    )

    callback(82, "正在重建股权拓扑与持股比例…")
    percentage_for = make_percentage_reader(ocr_engine, image, all_items, cfg)
    result = build_structure(
        all_items,
        raw_nodes,
        corrections,
        segments,
        width,
        height,
        percentage_for,
        config=cfg,
        diagnostics=Diagnostics(
            image_width=width,
            image_height=height,
            raw_size_bytes=len(raw),
            tile_count=len(tiles),
            dictionary_size=len(dictionary),
            engine="PaddleOCR + OpenCV + dictionary + line topology",
        ),
    )
    result.diagnostics.duration_seconds = round(time.time() - started, 2)
    callback(100, "识别完成。")
    return result
