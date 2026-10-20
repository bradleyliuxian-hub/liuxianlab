"""Geometry primitives shared by topology, layout and exporters."""

from __future__ import annotations

from dataclasses import dataclass
from typing import List, Tuple


@dataclass(frozen=True)
class Segment:
    x1: int
    y1: int
    x2: int
    y2: int
    orientation: str

    @property
    def rect(self) -> List[int]:
        return [self.x1, self.y1, self.x2, self.y2]

    @property
    def center(self) -> Tuple[float, float]:
        return ((self.x1 + self.x2) / 2, (self.y1 + self.y2) / 2)

    @property
    def length(self) -> int:
        return (self.x2 - self.x1) if self.orientation == "h" else (self.y2 - self.y1)

    def to_dict(self) -> dict:
        return {
            "x1": self.x1,
            "y1": self.y1,
            "x2": self.x2,
            "y2": self.y2,
            "orientation": self.orientation,
        }
