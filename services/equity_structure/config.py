"""Runtime configuration for equity-structure OCR."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Tuple

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DICTIONARY = PROJECT_ROOT / "config" / "equity_structure" / "company_dictionary.txt"


def _int(name: str, default: int, minimum: int = 1) -> int:
    try:
        return max(minimum, int(os.getenv(name, str(default))))
    except (TypeError, ValueError):
        return default


def _float(name: str, default: float, minimum: float = 0.0) -> float:
    try:
        return max(minimum, float(os.getenv(name, str(default))))
    except (TypeError, ValueError):
        return default


def _scales() -> Tuple[float, ...]:
    raw = os.getenv("EQUITY_OCR_SCALES", "1.0,1.3,1.65,2.0")
    values = []
    for part in raw.split(","):
        try:
            value = float(part.strip())
        except ValueError:
            continue
        if 0.5 <= value <= 3.0:
            values.append(value)
    return tuple(values) or (1.0, 1.3, 1.65, 2.0)


@dataclass(frozen=True)
class EquityConfig:
    tile_width: int = 1700
    tile_height: int = 1200
    tile_overlap: float = 0.28
    max_tiles: int = 72
    max_pixels: int = 220_000_000
    ocr_lang: str = "ch"
    ocr_scales: Tuple[float, ...] = (1.0, 1.3, 1.65, 2.0)
    dictionary_path: Path = field(default=DEFAULT_DICTIONARY)
    dictionary_threshold: float = 91.0
    min_dictionary_length: int = 3
    node_min_width: int = 72
    node_min_height: int = 28
    node_max_width_ratio: float = 0.96
    node_max_height_ratio: float = 0.55
    line_min_length: int = 35
    line_max_thickness: int = 16
    topology_pad: int = 14
    low_confidence_threshold: float = 0.80
    refine_node_ocr: bool = True
    refine_node_scale: float = 2.0
    percentage_scales: Tuple[float, ...] = (1.5, 2.0, 2.5)

    @classmethod
    def from_env(cls) -> "EquityConfig":
        dictionary = Path(os.getenv("EQUITY_DICTIONARY_PATH", str(DEFAULT_DICTIONARY))).expanduser()
        return cls(
            tile_width=_int("TILE_WIDTH", 1700, 200),
            tile_height=_int("TILE_HEIGHT", 1200, 200),
            tile_overlap=_float("TILE_OVERLAP", 0.28, 0.0),
            max_tiles=_int("MAX_TILES", 72, 1),
            max_pixels=_int("EQUITY_MAX_PIXELS", 220_000_000, 1_000_000),
            ocr_lang=os.getenv("EQUITY_OCR_LANG", "ch"),
            ocr_scales=_scales(),
            dictionary_path=dictionary,
            dictionary_threshold=_float("EQUITY_DICTIONARY_THRESHOLD", 91.0, 0.0),
            low_confidence_threshold=_float("EQUITY_LOW_CONFIDENCE", 0.80, 0.0),
        )
