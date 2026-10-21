"""Stage-1 vision worker: decode image, call model, write raw extraction JSON.

This worker deliberately does not adapt to the final contract and does not
build helper artifacts. Node owns adapter/validator/artifact orchestration.
"""

from __future__ import annotations

import argparse
import base64
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .image_validation import ImageValidationError, draw_overlay, validate_and_prepare
from .vision_client import (
    VisionError,
    call_vision,
    config_from_env,
    PROMPT_VERSION,
    build_prompt,
)

MAX_IMAGE_SIDE = 2200
MAX_PIXELS = 50_000_000


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(path)
    try:
        path.chmod(0o600)
    except OSError:
        pass


def read_meta(job_dir: Path) -> dict:
    file = job_dir / "meta.json"
    if not file.is_file():
        raise ImageValidationError("JOB_META_MISSING", "任务元数据不存在。")
    try:
        value = json.loads(file.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else {}
    except Exception as exc:
        raise ImageValidationError("JOB_META_INVALID", "任务元数据无法解析。") from exc


def source_path_for(job_dir: Path, meta: dict) -> Path:
    candidate = meta.get("sourceFile")
    if isinstance(candidate, str) and candidate and "/" not in candidate and "\\" not in candidate:
        path = job_dir / candidate
        if path.is_file():
            return path
    matches = sorted(job_dir.glob("source.*"))
    if len(matches) == 1 and matches[0].is_file():
        return matches[0]
    raise ImageValidationError("IMAGE_NOT_FOUND", "源图片不存在。")


def scale_box(box: Any, sx: float, sy: float) -> Any:
    if not isinstance(box, dict):
        return box
    try:
        x = float(box["x"])
        y = float(box["y"])
        w = float(box["w"] if "w" in box else box["width"])
        h = float(box["h"] if "h" in box else box["height"])
    except (KeyError, TypeError, ValueError):
        return box
    out = dict(box)
    out.update({
        "x": round(x * sx),
        "y": round(y * sy),
        "w": max(1, round(w * sx)),
        "h": max(1, round(h * sy)),
    })
    out.pop("width", None)
    out.pop("height", None)
    return out


def scale_raw(raw: dict, sx: float, sy: float) -> dict:
    raw = dict(raw)
    raw["lanes"] = [
        {**lane, "bbox_px": scale_box(lane.get("bbox_px"), sx, sy)}
        for lane in (raw.get("lanes") or []) if isinstance(lane, dict)
    ]
    raw["nodes"] = [
        {**node, "bbox_px": scale_box(node.get("bbox_px"), sx, sy)}
        for node in (raw.get("nodes") or []) if isinstance(node, dict)
    ]
    return raw


def fail(job_dir: Path, code: str, message: str, exit_code: int) -> int:
    write_json(job_dir / "vision" / "error.json", {
        "ok": False,
        "code": code,
        "message": message,
        "updated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    })
    return exit_code


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Flowchart stage-1 vision worker")
    parser.add_argument("--job-dir", required=True)
    parser.add_argument("--max-side", type=int, default=MAX_IMAGE_SIDE)
    args = parser.parse_args(argv)

    job_dir = Path(args.job_dir).expanduser().resolve()
    vision_dir = job_dir / "vision"
    vision_dir.mkdir(parents=True, exist_ok=True)

    try:
        meta = read_meta(job_dir)
        source = source_path_for(job_dir, meta)
        prepared = validate_and_prepare(
            source,
            vision_dir,
            max_pixels=MAX_PIXELS,
            max_side=max(320, int(args.max_side or MAX_IMAGE_SIDE)),
        )
    except ImageValidationError as exc:
        return fail(job_dir, exc.code, exc.message, 3)
    except Exception:
        return fail(job_dir, "IMAGE_DECODE_FAILED", "图片校验失败。", 3)

    config = config_from_env()
    if not config["configured"]:
        return fail(job_dir, "CONFIGURATION_REQUIRED", "视觉模型配置不完整。", 2)

    try:
        image_b64 = base64.b64encode(Path(prepared["prepared_path"]).read_bytes()).decode("ascii")
        raw, model_meta = call_vision(
            image_b64=image_b64,
            width=prepared["prepared_width"],
            height=prepared["prepared_height"],
            config=config,
            prompt_text=build_prompt(prepared["prepared_width"], prepared["prepared_height"]),
        )
    except VisionError as exc:
        return fail(job_dir, exc.code, exc.message, 4)
    except Exception:
        return fail(job_dir, "MODEL_REQUEST_FAILED", "视觉模型请求失败。", 4)

    sx = prepared["source_width"] / max(1, prepared["prepared_width"])
    sy = prepared["source_height"] / max(1, prepared["prepared_height"])
    raw = scale_raw(raw, sx, sy)

    document = raw.get("document") if isinstance(raw.get("document"), dict) else {}
    document.update({
        "source_type": "image",
        "source_image_name": meta.get("originalFilename") or source.name,
        "source_image_sha256": prepared["source_sha256"],
        "source_image_size_px": {
            "width": prepared["source_width"],
            "height": prepared["source_height"],
        },
        "extraction_status": "draft_requires_human_validation",
        "disclaimer": "视觉模型识别结果必须人工复核；不得直接作为审计事实。",
    })
    raw["document"] = document

    write_json(vision_dir / "raw-extraction.json", raw)
    metadata = {
        **model_meta,
        "prompt_version": PROMPT_VERSION,
        "source_sha256": prepared["source_sha256"],
        "source_width": prepared["source_width"],
        "source_height": prepared["source_height"],
        "prepared_width": prepared["prepared_width"],
        "prepared_height": prepared["prepared_height"],
        "coordinate_scale": {"sx": sx, "sy": sy},
        "template_profile_id": "trade_purchase_cn",
        "template_profile_version": "1.0.0",
    }
    overlay_warning = None
    try:
        draw_overlay(source, Path(prepared["prepared_path"]), vision_dir / "review_overlay.png", raw)
    except Exception:
        overlay_warning = "review_overlay.png 生成失败。"
    metadata["overlay_warning"] = overlay_warning
    write_json(vision_dir / "metadata.json", metadata)
    write_json(vision_dir / "status.json", {
        "status": "raw_extraction_ready",
        "ai_extraction_performed": True,
        "worker_mode": "real",
        "is_mock": False,
        "updated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    })
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
