"""Full Pillow decode and preprocessing for the flowchart vision worker."""

from __future__ import annotations

import hashlib
import warnings
from pathlib import Path
from typing import Optional

from PIL import Image, ImageDraw, ImageFont, ImageOps


class ImageValidationError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def validate_and_prepare(
    source_path: Path,
    out_dir: Path,
    *,
    max_pixels: int = 50_000_000,
    max_side: int = 2200,
) -> dict:
    """Fully decode an image, enforce limits, and write a model-ready PNG.

    Pillow's decompression-bomb warning is promoted to an error so a file
    that is merely close to the limit cannot bypass the configured cap.
    """
    source_path = Path(source_path)
    out_dir = Path(out_dir)
    if not source_path.is_file():
        raise ImageValidationError("IMAGE_NOT_FOUND", "上传图片不存在。")

    previous_limit = Image.MAX_IMAGE_PIXELS
    Image.MAX_IMAGE_PIXELS = max_pixels
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            try:
                with Image.open(source_path) as opened:
                    opened.load()
                    if opened.format not in {"PNG", "JPEG", "WEBP"}:
                        raise ImageValidationError("INVALID_FILE_TYPE", "不支持该图片格式。")
                    image = ImageOps.exif_transpose(opened).convert("RGB")
            except ImageValidationError:
                raise
            except (Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
                raise ImageValidationError("IMAGE_TOO_LARGE", "图片像素数超过限制。") from exc
            except Exception as exc:  # Pillow raises several decoder-specific exceptions
                raise ImageValidationError("IMAGE_DECODE_FAILED", "图片无法完整解码。") from exc
    finally:
        Image.MAX_IMAGE_PIXELS = previous_limit

    original_width, original_height = image.size
    if original_width <= 0 or original_height <= 0:
        raise ImageValidationError("IMAGE_DECODE_FAILED", "图片尺寸无效。")
    if original_width * original_height > max_pixels:
        raise ImageValidationError("IMAGE_TOO_LARGE", "图片像素数超过限制。")

    prepared = image
    if max(original_width, original_height) > max_side:
        ratio = max_side / max(original_width, original_height)
        prepared = image.resize(
            (max(1, round(original_width * ratio)), max(1, round(original_height * ratio))),
            Image.Resampling.LANCZOS,
        )

    out_dir.mkdir(parents=True, exist_ok=True)
    prepared_path = out_dir / "input.png"
    prepared.save(prepared_path, format="PNG", optimize=True)
    try:
        prepared_path.chmod(0o600)
    except OSError:
        pass

    return {
        "source_width": original_width,
        "source_height": original_height,
        "prepared_width": prepared.size[0],
        "prepared_height": prepared.size[1],
        "source_sha256": sha256_file(source_path),
        "prepared_path": str(prepared_path),
        "format": "PNG",
    }


def _font(size: int) -> ImageFont.ImageFont:
    for candidate in (
        "/System/Library/Fonts/PingFang.ttc",
        "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "C:/Windows/Fonts/msyh.ttc",
    ):
        try:
            if Path(candidate).exists():
                return ImageFont.truetype(candidate, size)
        except OSError:
            pass
    return ImageFont.load_default()


def draw_overlay(source_path: Path, image_path: Path, output_path: Path, raw: dict) -> None:
    """Draw an inspection overlay from raw boxes. Never used as final Excel."""
    with Image.open(source_path) as opened:
        image = ImageOps.exif_transpose(opened).convert("RGB")
    draw = ImageDraw.Draw(image, "RGBA")
    font = _font(max(10, min(18, image.width // 100)))

    for lane in raw.get("lanes", []) or []:
        box = lane.get("bbox_px")
        if isinstance(box, dict):
            x, y, w, h = (box.get(k) for k in ("x", "y", "w", "h"))
            if all(isinstance(v, (int, float)) for v in (x, y, w, h)):
                draw.rectangle((x, y, x + w, y + h), outline=(30, 120, 220, 220), width=2)

    for node in raw.get("nodes", []) or []:
        box = node.get("bbox_px")
        if not isinstance(box, dict):
            continue
        x, y, w, h = (box.get(k) for k in ("x", "y", "w", "h"))
        if not all(isinstance(v, (int, float)) for v in (x, y, w, h)):
            continue
        confidence = str(node.get("confidence") or "medium").lower()
        color = {
            "high": (30, 150, 70, 230),
            "medium": (230, 150, 20, 230),
            "low": (220, 30, 30, 230),
        }.get(confidence, (120, 120, 120, 230))
        draw.rectangle((x, y, x + w, y + h), outline=color, width=2)
        label = str(node.get("id") or "")
        draw.rectangle((x, max(0, y - 18), x + max(80, len(label) * 8), max(15, y - 1)), fill=(255, 255, 255, 220))
        draw.text((x + 2, max(0, y - 17)), label, fill=color[:3] + (255,), font=font)

    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    image.save(output_path, format="PNG")
    try:
        output_path.chmod(0o600)
    except OSError:
        pass


def _main(argv=None) -> int:
    import argparse
    import json
    import tempfile

    parser = argparse.ArgumentParser(description="Validate one image without calling a model")
    parser.add_argument("--check", required=True)
    parser.add_argument("--max-pixels", type=int, default=50_000_000)
    args = parser.parse_args(argv)
    try:
        with tempfile.TemporaryDirectory(prefix="flowchart-image-check-") as temp:
            meta = validate_and_prepare(Path(args.check), Path(temp), max_pixels=args.max_pixels, max_side=2200)
        print(json.dumps({k: v for k, v in meta.items() if k != "prepared_path"}, ensure_ascii=False))
        return 0
    except ImageValidationError as exc:
        print(json.dumps({"ok": False, "code": exc.code, "message": exc.message}, ensure_ascii=False))
        return 1
    except Exception:
        print(json.dumps({"ok": False, "code": "IMAGE_DECODE_FAILED", "message": "图片无法完整解码。"}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    raise SystemExit(_main())
