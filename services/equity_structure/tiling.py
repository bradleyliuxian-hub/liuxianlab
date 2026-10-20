"""Overlapping tiling for very large screenshots."""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import List, Tuple

import numpy as np


@dataclass(frozen=True)
class Tile:
    label: str
    x: int
    y: int
    image: np.ndarray

    @property
    def box(self) -> Tuple[int, int, int, int]:
        height, width = self.image.shape[:2]
        return (self.x, self.y, self.x + width, self.y + height)


def tile_image(
    image: np.ndarray,
    tile_width: int = 1700,
    tile_height: int = 1200,
    overlap: float = 0.28,
    max_tiles: int = 72,
) -> List[Tile]:
    """Split an image into overlapping tiles, scaling tile size if needed.

    The final row/column is pinned to the image edge so no area is lost. The
    recursion only triggers when a very large image would exceed ``max_tiles``.
    """
    height, width = image.shape[:2]
    if width <= tile_width and height <= tile_height:
        return [Tile("R1C1", 0, 0, image.copy())]

    overlap = min(0.75, max(0.0, float(overlap)))
    step_x = max(1, int(tile_width * (1 - overlap)))
    step_y = max(1, int(tile_height * (1 - overlap)))

    xs = list(range(0, max(1, width - tile_width + 1), step_x))
    ys = list(range(0, max(1, height - tile_height + 1), step_y))
    if not xs or xs[-1] + tile_width < width:
        xs.append(max(0, width - tile_width))
    if not ys or ys[-1] + tile_height < height:
        ys.append(max(0, height - tile_height))

    boxes: List[Tuple[int, int, int, int]] = []
    seen = set()
    for y in ys:
        for x in xs:
            box = (x, y, min(width, x + tile_width), min(height, y + tile_height))
            if box in seen:
                continue
            seen.add(box)
            boxes.append(box)

    if len(boxes) > max_tiles:
        scale = math.sqrt(len(boxes) / max_tiles)
        return tile_image(
            image,
            tile_width=min(width, int(tile_width * scale * 1.05)),
            tile_height=min(height, int(tile_height * scale * 1.05)),
            overlap=overlap,
            max_tiles=max_tiles,
        )

    tiles: List[Tile] = []
    for index, (x1, y1, x2, y2) in enumerate(boxes):
        rows = sorted({box[1] for box in boxes})
        columns = sorted({box[0] for box in boxes})
        row = rows.index(y1) + 1
        column = columns.index(x1) + 1
        tiles.append(Tile(f"R{row}C{column}", x1, y1, image[y1:y2, x1:x2].copy()))
    return tiles


def dedupe_boxes(boxes: List[Tuple[int, int, int, int]]) -> List[Tuple[int, int, int, int]]:
    return list(dict.fromkeys(boxes))
