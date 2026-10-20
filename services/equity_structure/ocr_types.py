"""OCR data type shared by geometry/merge code (no cv2 dependency)."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List

from .normalize import normalize_text


@dataclass
class OcrItem:
    text: str
    score: float
    bbox: List[float]
    center: List[float]
    polygon: List[List[float]] = field(default_factory=list)
    votes: int = 1

    @property
    def normalized(self) -> str:
        return normalize_text(self.text)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "text": self.text,
            "score": round(float(self.score), 4),
            "bbox": [round(float(value), 1) for value in self.bbox],
            "center": [round(float(value), 1) for value in self.center],
            "votes": int(self.votes),
        }
