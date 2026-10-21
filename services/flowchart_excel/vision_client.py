"""OpenAI-compatible multimodal client for the flowchart extraction stage."""

from __future__ import annotations

import json
import os
import re
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Callable, Optional

PROJECT_ROOT = Path(__file__).resolve().parents[2]
SCHEMA_PATH = PROJECT_ROOT / "docs" / "agent" / "flowchart-excel" / "flowchart.schema.json"
PROMPT_PATH = Path(__file__).with_name("extraction_prompt.txt")
PROMPT_VERSION = "1.0.0"
DEFAULT_TIMEOUT_SECONDS = 240
DEFAULT_MAX_RESPONSE_BYTES = 5 * 1024 * 1024


class VisionError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def load_enums() -> dict:
    try:
        schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
        defs = schema.get("$defs", {})
        return {
            "shapes": defs["node"]["properties"]["shape"]["enum"],
            "confidences": defs["node"]["properties"]["confidence"]["enum"],
            "route_hints": defs["edge"]["properties"]["route_hint"]["enum"],
            "kinds": defs["edge"]["properties"]["kind"]["enum"],
            "control_kinds": defs["control"]["properties"]["kind"]["enum"],
        }
    except Exception as exc:
        raise VisionError("SCHEMA_UNAVAILABLE", "无法读取共享 Schema 枚举。") from exc


def build_prompt(width: int, height: int) -> str:
    enums = load_enums()
    template = PROMPT_PATH.read_text(encoding="utf-8")
    replacements = {
        "{width}": str(width),
        "{height}": str(height),
        "{shapes}": ", ".join(enums["shapes"]),
        "{confidences}": ", ".join(enums["confidences"]),
        "{route_hints}": ", ".join(enums["route_hints"]),
        "{kinds}": ", ".join(enums["kinds"]),
        "{control_kinds}": ", ".join(enums["control_kinds"]),
    }
    for token, value in replacements.items():
        template = template.replace(token, value)
    return template


def config_from_env(env: Optional[dict] = None) -> dict:
    env = os.environ if env is None else env
    base_url = str(env.get("FLOWCHART_BASE_URL") or "").strip()
    model = str(env.get("FLOWCHART_MODEL") or "").strip()
    api_key = str(env.get("FLOWCHART_API_KEY") or "").strip()
    provider = str(env.get("FLOWCHART_PROVIDER") or "openai-compatible").strip()
    timeout = _int_env(env.get("FLOWCHART_TIMEOUT_SECONDS"), DEFAULT_TIMEOUT_SECONDS)
    max_tokens = _int_env(env.get("FLOWCHART_MAX_OUTPUT_TOKENS"), 0)
    missing = []
    if not base_url:
        missing.append("FLOWCHART_BASE_URL")
    if not model:
        missing.append("FLOWCHART_MODEL")
    if "api.openai.com" in base_url.lower() and not api_key:
        missing.append("FLOWCHART_API_KEY")
    return {
        "base_url": base_url,
        "model": model,
        "api_key": api_key,
        "provider": provider,
        "timeout_seconds": timeout,
        "max_output_tokens": max_tokens,
        "missing": missing,
        "configured": not missing,
    }


def _int_env(value, default: int) -> int:
    try:
        parsed = int(str(value))
        return parsed if parsed > 0 else default
    except (TypeError, ValueError):
        return default


def _post_json(url: str, payload: dict, headers: dict, timeout: int, opener: Callable) -> tuple[int, bytes]:
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    try:
        with opener(request, timeout=timeout) as response:
            status = int(getattr(response, "status", 200))
            body = response.read(DEFAULT_MAX_RESPONSE_BYTES + 1)
    except urllib.error.HTTPError as exc:
        raise VisionError("MODEL_HTTP_ERROR", f"视觉模型返回 HTTP {exc.code}。") from exc
    except urllib.error.URLError as exc:
        reason = str(getattr(exc, "reason", "")).lower()
        if "timed out" in reason or "timeout" in reason:
            raise VisionError("MODEL_TIMEOUT", "视觉模型请求超时。") from exc
        raise VisionError("MODEL_CONNECTION_FAILED", "无法连接视觉模型端点。") from exc
    except Exception as exc:
        raise VisionError("MODEL_REQUEST_FAILED", "视觉模型请求失败。") from exc
    if len(body) > DEFAULT_MAX_RESPONSE_BYTES:
        raise VisionError("MODEL_RESPONSE_TOO_LARGE", "视觉模型响应过大。")
    return status, body


def call_vision(
    *,
    image_b64: str,
    width: int,
    height: int,
    config: dict,
    opener: Callable = urllib.request.urlopen,
    prompt_text: Optional[str] = None,
) -> tuple[dict, dict]:
    if not config.get("configured"):
        raise VisionError("CONFIGURATION_REQUIRED", "视觉模型配置不完整。")
    base_url = str(config.get("base_url") or "").rstrip("/")
    model = str(config.get("model") or "").strip()
    if not base_url or not model:
        raise VisionError("CONFIGURATION_REQUIRED", "视觉模型配置不完整。")
    if "api.openai.com" in base_url.lower() and not config.get("api_key"):
        raise VisionError("CONFIGURATION_REQUIRED", "OpenAI 端点需要 API Key。")

    url = base_url + "/chat/completions"
    headers = {"Content-Type": "application/json"}
    if config.get("api_key"):
        headers["Authorization"] = "Bearer " + str(config["api_key"])
    prompt = prompt_text if prompt_text is not None else build_prompt(width, height)
    payload = {
        "model": model,
        "temperature": 0.1,
        "messages": [{
            "role": "user",
            "content": [
                {"type": "text", "text": prompt},
                {"type": "image_url", "image_url": {"url": "data:image/png;base64," + image_b64}},
            ],
        }],
        "response_format": {"type": "json_object"},
    }
    if config.get("max_output_tokens"):
        payload["max_tokens"] = config["max_output_tokens"]

    started = time.monotonic()
    status, body = _post_json(url, payload, headers, int(config.get("timeout_seconds") or DEFAULT_TIMEOUT_SECONDS), opener)
    if status in (400, 404, 422):
        # Some local compatible endpoints do not support response_format.
        payload.pop("response_format", None)
        status, body = _post_json(url, payload, headers, int(config.get("timeout_seconds") or DEFAULT_TIMEOUT_SECONDS), opener)
    if status >= 400:
        raise VisionError("MODEL_HTTP_ERROR", f"视觉模型返回 HTTP {status}。")

    try:
        response = json.loads(body.decode("utf-8"))
        content = response["choices"][0]["message"]["content"]
        if isinstance(content, list):
            content = "".join(part.get("text", "") for part in content if isinstance(part, dict))
        content = str(content).strip()
    except Exception as exc:
        raise VisionError("MODEL_EMPTY_RESPONSE", "视觉模型响应缺少有效 JSON 内容。") from exc
    if not content:
        raise VisionError("MODEL_EMPTY_RESPONSE", "视觉模型返回空内容。")
    if content.startswith("```") or content.endswith("```"):
        raise VisionError("MODEL_INVALID_JSON", "视觉模型返回了 Markdown 围栏，不是纯 JSON。")
    try:
        raw = json.loads(content)
    except json.JSONDecodeError as exc:
        raise VisionError("MODEL_INVALID_JSON", "视觉模型返回的不是合法 JSON。") from exc
    if not isinstance(raw, dict):
        raise VisionError("MODEL_INVALID_JSON", "视觉模型 JSON 顶层必须是对象。")
    metadata = {
        "model": model,
        "provider": str(config.get("provider") or "openai-compatible"),
        "prompt_version": PROMPT_VERSION,
        "duration_seconds": round(time.monotonic() - started, 3),
        "input_width": width,
        "input_height": height,
    }
    return raw, metadata
