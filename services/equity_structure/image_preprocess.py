"""Image decoding and lightweight preprocessing."""

from __future__ import annotations

from typing import List, Tuple

import cv2
import numpy as np


class ImageDecodeError(ValueError):
    pass


def decode_image(raw: bytes) -> np.ndarray:
    if not raw:
        raise ImageDecodeError("图片内容为空。")
    array = np.frombuffer(raw, dtype=np.uint8)
    image = cv2.imdecode(array, cv2.IMREAD_COLOR)
    if image is None:
        raise ImageDecodeError("无法解析图片，请上传 PNG / JPG / WebP。")
    return image


def resize_keep(image: np.ndarray, scale: float) -> np.ndarray:
    if abs(scale - 1.0) < 1e-6:
        return image
    height, width = image.shape[:2]
    return cv2.resize(
        image,
        (max(1, int(width * scale)), max(1, int(height * scale))),
        interpolation=cv2.INTER_CUBIC,
    )


def crop(image: np.ndarray, box: Tuple[int, int, int, int], pad: int = 0) -> np.ndarray:
    height, width = image.shape[:2]
    x1, y1, x2, y2 = box
    x1 = max(0, int(x1) - pad)
    y1 = max(0, int(y1) - pad)
    x2 = min(width, int(x2) + pad)
    y2 = min(height, int(y2) + pad)
    if x2 <= x1 or y2 <= y1:
        return np.zeros((1, 1, 3), dtype=image.dtype)
    return image[y1:y2, x1:x2].copy()


def percentage_variants(crop_image: np.ndarray) -> List[Tuple[str, np.ndarray]]:
    """Four views used by the secondary percentage OCR pass."""
    if crop_image is None or crop_image.size == 0:
        return []
    gray = cv2.cvtColor(crop_image, cv2.COLOR_BGR2GRAY)
    equalized = cv2.equalizeHist(gray)
    otsu = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)[1]
    adaptive = cv2.adaptiveThreshold(
        gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 11
    )
    return [
        ("original", crop_image),
        ("equalized", cv2.cvtColor(equalized, cv2.COLOR_GRAY2BGR)),
        ("otsu", cv2.cvtColor(otsu, cv2.COLOR_GRAY2BGR)),
        ("adaptive", cv2.cvtColor(adaptive, cv2.COLOR_GRAY2BGR)),
    ]


def hsv_mask(image: np.ndarray, lower: tuple, upper: tuple) -> np.ndarray:
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    return cv2.inRange(hsv, np.array(lower, np.uint8), np.array(upper, np.uint8))
