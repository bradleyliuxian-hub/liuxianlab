"""Server-side SVG -> PNG conversion via CairoSVG.

The browser sends the already-edited SVG; this module never re-runs layout.
"""

from __future__ import annotations

import argparse
import io
import re
import sys
from pathlib import Path
from typing import Tuple
from xml.etree import ElementTree as ET

MAX_SVG_BYTES = 8 * 1024 * 1024
MAX_PNG_DIMENSION = 20000
MAX_PNG_PIXELS = 120_000_000

FORBIDDEN_MARKERS = (
    "<foreignObject", "<script", "<image", "@import",
    "xlink:href=\"http", "href=\"http", "onload=", "onerror=",
)


class PngExportError(ValueError):
    pass


def _number(value: str | None) -> float | None:
    if value is None:
        return None
    match = re.match(r"^\s*(\d+(?:\.\d+)?)", value)
    return float(match.group(1)) if match else None


def validate_svg(svg: str) -> Tuple[float, float]:
    if not svg or not svg.strip():
        raise PngExportError("SVG 内容为空。")
    if len(svg.encode("utf-8")) > MAX_SVG_BYTES:
        raise PngExportError("SVG 内容超过 8MB 限制。")
    text = svg.lstrip()
    if not text.startswith("<svg"):
        raise PngExportError("请求内容不是 SVG。")
    for marker in FORBIDDEN_MARKERS:
        if marker in text:
            raise PngExportError(f"SVG 包含不允许的外部/交互资源：{marker}")
    if "xmlns=\"http://www.w3.org/2000/svg\"" not in text[:2000]:
        raise PngExportError("SVG 缺少 svg namespace。")

    try:
        root = ET.fromstring(text)
    except ET.ParseError as error:
        raise PngExportError(f"SVG 解析失败：{error}") from error

    width = _number(root.attrib.get("width"))
    height = _number(root.attrib.get("height"))
    if not width or not height:
        view_box = root.attrib.get("viewBox", "").replace(",", " ").split()
        if len(view_box) == 4:
            try:
                width = float(view_box[2])
                height = float(view_box[3])
            except ValueError:
                pass
    if not width or not height or width <= 0 or height <= 0:
        raise PngExportError("SVG width/height/viewBox 无效。")
    return width, height


def safe_scale(width: float, height: float, requested: float = 2.0) -> float:
    requested = max(0.1, min(4.0, float(requested or 2.0)))
    return min(
        requested,
        MAX_PNG_DIMENSION / width,
        MAX_PNG_DIMENSION / height,
        (MAX_PNG_PIXELS / max(1.0, width * height)) ** 0.5,
    )


def _normalize_fonts(svg: str) -> str:
    # Use a cross-platform fallback list. Pango/Cairo picks the first installed
    # family; macOS has PingFang, Ubuntu uses Noto/WenQuanYi.
    font = "PingFang SC, Noto Sans CJK SC, Noto Sans SC, Microsoft YaHei, Arial Unicode MS, WenQuanYi Zen Hei, sans-serif"
    return re.sub(r'font-family="[^"]*"', f'font-family="{font}"', svg)


def svg_to_png(svg: str, requested_scale: float = 2.0) -> Tuple[bytes, float]:
    svg = _normalize_fonts(svg)
    width, height = validate_svg(svg)
    scale = safe_scale(width, height, requested_scale)
    if not (scale > 0):
        raise PngExportError("无法计算安全的 PNG 尺寸。")
    try:
        import cairosvg  # type: ignore
    except Exception as error:  # pragma: no cover - environment specific
        raise PngExportError(
            "服务器未安装 CairoSVG 或 Cairo 系统库。请运行 "
            "scripts/local/setup-equity-ocr.sh 并安装 libcairo2/libpango。"
        ) from error
    try:
        output = cairosvg.svg2png(
            bytestring=svg.encode("utf-8"),
            output_width=max(1, int(round(width * scale))),
            output_height=max(1, int(round(height * scale))),
        )
    except Exception as error:  # pragma: no cover - renderer specific
        raise PngExportError(f"PNG 渲染失败：{error}") from error
    if not output:
        raise PngExportError("PNG 渲染返回空内容。")
    return output, scale


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Convert the exported equity SVG to PNG")
    parser.add_argument("--svg", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--scale", type=float, default=2.0)
    args = parser.parse_args(argv)
    try:
        svg = Path(args.svg).read_text(encoding="utf-8")
        png, _scale = svg_to_png(svg, args.scale)
        Path(args.output).write_bytes(png)
        return 0
    except PngExportError as error:
        print(str(error), file=sys.stderr)
        return 2
    except Exception as error:  # pragma: no cover
        print(f"PNG 导出失败：{error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
