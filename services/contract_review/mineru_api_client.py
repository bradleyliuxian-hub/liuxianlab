"""
MinerU cloud API client and artifact adapter for contract review.

This module only replaces the *execution backend* for MinerU parsing.
It does not decide tiers, run quality gates, or modify review
semantics. The worker still owns AUTO/FAST/ACCURATE behaviour.

Design rules:

- Standard library only (no new Python dependencies).
- The API token is never logged, never put in a URL, and never
  included in an exception message.
- Signed upload URLs are never logged or returned to the browser.
- API/network errors are raised as MineruApiError. They are NOT
  converted into a quality-gate failure, so AUTO cannot mistake an
  outage for "Basic was low quality".
- The cloud ZIP is extracted with path traversal / symlink / size
  guards before anything is written into the job directory.
"""

import http.client
import json
import os
import re
import shutil
import socket
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import zipfile
from dataclasses import dataclass, field, replace
from datetime import datetime, timezone
from pathlib import Path

from .database import PROJECT_ROOT
from .parse_profile import (
    BACKEND_CLOUD,
    TIER_STANDARD,
    VALID_TIERS,
    cloud_api_base_url,
    cloud_api_enable_formula,
    cloud_api_enable_table,
    cloud_api_is_ocr,
    cloud_api_language,
    cloud_model_for_tier,
)


DEFAULT_API_TIMEOUT_SECONDS = 60.0
DEFAULT_POLL_INTERVAL_SECONDS = 3.0
DEFAULT_POLL_TIMEOUT_SECONDS = 900.0
DEFAULT_MAX_RETRIES = 2
DEFAULT_MAX_FILE_BYTES = 200 * 1024 * 1024
DEFAULT_MAX_ZIP_BYTES = 512 * 1024 * 1024
DEFAULT_MAX_EXTRACT_BYTES = 1024 * 1024 * 1024
DEFAULT_MAX_EXTRACT_FILES = 20000

MAX_JSON_RESPONSE_BYTES = 4 * 1024 * 1024

# MinerU cloud API limits.
MAX_CLOUD_PAGES = 200

_USER_AGENT = "liuxianlab-contract-review/1.0"

# API result states documented by MinerU v4.
_STATE_QUEUED = ("waiting-file", "pending", "uploading")
_STATE_CONVERTING = "converting"
_STATE_DONE = "done"
_STATE_FAILED = "failed"

# API codes that are worth a bounded retry (service busy / temporary).
_RETRYABLE_API_CODES = {
    -10001,
    -60001,
    -60007,
    -60009,
}

# Token-related API codes (message is normalized, token is never echoed).
_TOKEN_API_CODES = {"A0202", "A0211"}


def _env_int(name, default, minimum=0):
    try:
        value = int(os.getenv(name, default))
    except (TypeError, ValueError):
        return default

    return max(minimum, value)


def _env_float(name, default, minimum=0.0):
    try:
        value = float(os.getenv(name, default))
    except (TypeError, ValueError):
        return default

    return max(minimum, value)


def _env_bool(name, default):
    value = os.getenv(name)

    if value is None:
        return bool(default)

    return str(value).strip().lower() in (
        "1",
        "true",
        "yes",
        "on",
    )


class MineruApiError(RuntimeError):
    """
    A diagnosable cloud-parse failure.

    ``stage`` is one of: config, submit, upload, poll, parse,
    download, extract, adapt, internal.

    ``retryable`` only describes the transport/API operation that
    failed; the caller must not blindly resubmit a parse task.
    """

    def __init__(
        self,
        message,
        *,
        stage,
        code=None,
        retryable=False,
        detail=None,
    ):
        self.stage = str(stage or "internal")
        self.code = code
        self.retryable = bool(retryable)
        self.detail = _safe_detail(detail) if detail else None

        text = str(message or "MinerU 云端解析失败")

        if self.detail and self.detail not in text:
            text = f"{text}：{self.detail}"

        super().__init__(text)


def _safe_detail(value, secret=None):
    """
    Redact URLs, bearer credentials, and an exact secret value
    from API-provided text.

    This is defensive: callers must still avoid putting secrets in
    messages. It guarantees a signed URL or token copied into an
    error body cannot reach the logs.
    """

    text = str(value or "")

    if secret:
        text = text.replace(str(secret), "[redacted]")

    text = re.sub(r"https?://\S+", "[url]", text)
    text = re.sub(
        r"(?i)bearer\s+\S+",
        "Bearer [redacted]",
        text,
    )
    text = re.sub(r"\s+", " ", text).strip()

    return text[:400]


class _NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    """
    API calls must not forward the Authorization header to a
    redirect target. MinerU's JSON API does not need redirects.
    """

    def redirect_request(
        self,
        req,
        fp,
        code,
        msg,
        headers,
        newurl,
    ):
        raise urllib.error.HTTPError(
            req.full_url,
            code,
            "redirect not allowed",
            headers,
            fp,
        )


@dataclass(frozen=True)
class MineruApiConfig:

    base_url: str
    token: str = field(repr=False)
    model_basic: str
    model_standard: str
    language: str
    enable_table: bool
    enable_formula: bool
    is_ocr: bool
    timeout_seconds: float
    poll_interval_seconds: float
    poll_timeout_seconds: float
    max_retries: int
    max_file_bytes: int
    max_zip_bytes: int
    max_extract_bytes: int
    max_extract_files: int

    def model_for(self, tier):
        if str(tier) == "basic":
            return self.model_basic

        return self.model_standard

    @classmethod
    def from_env(cls, token=None):
        base_url = cloud_api_base_url()

        effective_token = str(token or "").strip()

        if not effective_token:
            effective_token = str(
                os.getenv("MINERU_API_TOKEN", "")
            ).strip()

        allow_insecure = _env_bool(
            "MINERU_API_ALLOW_INSECURE",
            False,
        )

        if (
            not base_url.startswith("https://")
            and not allow_insecure
        ):
            raise MineruApiError(
                "MINERU_API_BASE_URL 必须使用 HTTPS",
                stage="config",
            )

        return cls(
            base_url=base_url,
            token=effective_token,
            model_basic=cloud_model_for_tier("basic"),
            model_standard=cloud_model_for_tier("standard"),
            language=cloud_api_language(),
            enable_table=cloud_api_enable_table(),
            enable_formula=cloud_api_enable_formula(),
            is_ocr=cloud_api_is_ocr(),
            timeout_seconds=_env_float(
                "MINERU_API_TIMEOUT_SECONDS",
                DEFAULT_API_TIMEOUT_SECONDS,
                minimum=1.0,
            ),
            poll_interval_seconds=_env_float(
                "MINERU_API_POLL_INTERVAL_SECONDS",
                DEFAULT_POLL_INTERVAL_SECONDS,
                minimum=1.0,
            ),
            poll_timeout_seconds=_env_float(
                "MINERU_API_POLL_TIMEOUT_SECONDS",
                DEFAULT_POLL_TIMEOUT_SECONDS,
                minimum=1.0,
            ),
            max_retries=_env_int(
                "MINERU_API_MAX_RETRIES",
                DEFAULT_MAX_RETRIES,
                minimum=0,
            ),
            max_file_bytes=_env_int(
                "MINERU_API_MAX_FILE_BYTES",
                DEFAULT_MAX_FILE_BYTES,
                minimum=1,
            ),
            max_zip_bytes=_env_int(
                "MINERU_API_MAX_ZIP_BYTES",
                DEFAULT_MAX_ZIP_BYTES,
                minimum=1,
            ),
            max_extract_bytes=_env_int(
                "MINERU_API_MAX_EXTRACT_BYTES",
                DEFAULT_MAX_EXTRACT_BYTES,
                minimum=1,
            ),
            max_extract_files=_env_int(
                "MINERU_API_MAX_EXTRACT_FILES",
                DEFAULT_MAX_EXTRACT_FILES,
                minimum=1,
            ),
        )


class HttpTransport:
    """
    Minimal JSON + signed-upload transport.

    Only JSON API calls carry the Authorization header. The PUT to
    the signed URL deliberately carries no Authorization and no
    Content-Type header (MinerU documents that neither is needed).
    """

    def __init__(self, config, *, sleep=None):
        self.config = config
        self._sleep = sleep or time.sleep
        self._api_opener = urllib.request.build_opener(
            _NoRedirectHandler()
        )

    # -- helpers -------------------------------------------------

    def _url(self, path):
        path = str(path or "")

        if not path.startswith("/"):
            path = "/" + path

        return self.config.base_url + path

    def _headers(self, json_body=False):
        headers = {
            "Accept": "application/json",
            "User-Agent": _USER_AGENT,
        }

        if self.config.token:
            headers["Authorization"] = (
                "Bearer " + self.config.token
            )

        if json_body:
            headers["Content-Type"] = "application/json"

        return headers

    def _retry_delay(self, attempt, retry_after=None):
        if retry_after:
            try:
                seconds = float(retry_after)
                return max(0.0, min(seconds, 30.0))
            except (TypeError, ValueError):
                pass

        return min(2.0 ** attempt, 10.0)

    def _read_json(self, response, stage="poll"):
        raw = response.read(MAX_JSON_RESPONSE_BYTES + 1)

        if len(raw) > MAX_JSON_RESPONSE_BYTES:
            raise MineruApiError(
                "MinerU 云端 API 响应过大",
                stage=stage,
            )

        try:
            return json.loads(
                raw.decode("utf-8", errors="strict")
            )
        except (ValueError, UnicodeDecodeError):
            raise MineruApiError(
                "MinerU 云端 API 返回了非 JSON 响应",
                stage=stage,
            )

    def _http_error(self, status, body, stage):
        code = None
        message = ""
        trace_id = None

        if body:
            try:
                payload = json.loads(
                    body.decode("utf-8", errors="replace")
                )

                if isinstance(payload, dict):
                    code = payload.get("code")
                    message = str(
                        payload.get("msg")
                        or payload.get("message")
                        or ""
                    )
                    trace_id = payload.get("trace_id")

            except (ValueError, UnicodeDecodeError):
                pass

        token_error = (
            status in (401, 403)
            or code in _TOKEN_API_CODES
        )

        if token_error:
            raise MineruApiError(
                "MinerU 云端 API Token 无效或已过期"
                f"（HTTP {status}）",
                stage=stage,
                code=code,
                retryable=False,
            )

        retryable = (
            status == 429
            or 500 <= status < 600
            or code in _RETRYABLE_API_CODES
        )

        detail_parts = []

        if code is not None:
            detail_parts.append(f"code={code}")

        if message:
            detail_parts.append(
                _safe_detail(message, self.config.token)
            )

        if trace_id:
            detail_parts.append(
                "trace_id=" + _safe_detail(trace_id)
            )

        raise MineruApiError(
            f"MinerU 云端 API 请求失败（HTTP {status}）",
            stage=stage,
            code=code,
            retryable=retryable,
            detail="; ".join(detail_parts) or None,
        )

    def _network_error(self, error, stage):
        detail = _safe_detail(
            getattr(error, "reason", None) or error,
            self.config.token,
        )

        raise MineruApiError(
            "MinerU 云端 API 网络请求失败",
            stage=stage,
            retryable=True,
            detail=detail,
        )

    # -- JSON ----------------------------------------------------

    def request_json(
        self,
        method,
        path,
        *,
        payload=None,
        retry=True,
    ):
        url = self._url(path)
        stage = (
            "submit"
            if str(method).upper() == "POST"
            else "poll"
        )

        body = None

        if payload is not None:
            body = json.dumps(
                payload,
                ensure_ascii=False,
            ).encode("utf-8")

        attempts = self.config.max_retries + 1

        for attempt in range(attempts):

            request = urllib.request.Request(
                url,
                data=body,
                headers=self._headers(json_body=True),
                method=str(method).upper(),
            )

            try:
                with self._api_opener.open(
                    request,
                    timeout=self.config.timeout_seconds,
                ) as response:

                    payload = self._read_json(response, stage)

                code = (
                    payload.get("code")
                    if isinstance(payload, dict)
                    else None
                )

                if (
                    retry
                    and attempt + 1 < attempts
                    and code in _RETRYABLE_API_CODES
                ):
                    self._sleep(self._retry_delay(attempt))
                    continue

                return payload

            except urllib.error.HTTPError as error:
                try:
                    error_body = error.read(8192)
                except Exception:
                    error_body = b""

                if (
                    retry
                    and attempt + 1 < attempts
                    and (
                        error.code == 429
                        or 500 <= error.code < 600
                    )
                ):
                    self._sleep(
                        self._retry_delay(
                            attempt,
                            error.headers.get("Retry-After")
                            if error.headers
                            else None,
                        )
                    )
                    continue

                self._http_error(error.code, error_body, stage)

            except (
                urllib.error.URLError,
                TimeoutError,
                socket.timeout,
                ConnectionError,
            ) as error:

                if retry and attempt + 1 < attempts:
                    self._sleep(self._retry_delay(attempt))
                    continue

                self._network_error(error, stage)

            except OSError as error:
                if retry and attempt + 1 < attempts:
                    self._sleep(self._retry_delay(attempt))
                    continue

                self._network_error(error, stage)

        raise MineruApiError(
            "MinerU 云端 API 请求失败",
            stage=stage,
        )

    # -- signed upload -------------------------------------------

    def upload_file(self, signed_url, source_path, *, retry=True):
        parts = urllib.parse.urlsplit(str(signed_url or ""))

        if parts.scheme != "https" or not parts.hostname:
            raise MineruApiError(
                "MinerU 云端返回了非 HTTPS 的上传地址",
                stage="upload",
            )

        source_path = Path(source_path)

        try:
            size = source_path.stat().st_size
        except OSError as error:
            raise MineruApiError(
                "无法读取合同 PDF",
                stage="upload",
                detail=_safe_detail(error),
            ) from error

        if size <= 0:
            raise MineruApiError(
                "合同 PDF 为空",
                stage="upload",
            )

        attempts = self.config.max_retries + 1

        for attempt in range(attempts):

            connection = None

            try:
                connection = http.client.HTTPSConnection(
                    parts.hostname,
                    parts.port,
                    timeout=self.config.timeout_seconds,
                )

                path = parts.path or "/"

                if parts.query:
                    path = path + "?" + parts.query

                connection.putrequest(
                    "PUT",
                    path,
                    skip_accept_encoding=True,
                )

                # Deliberately no Authorization / Content-Type.
                connection.putheader(
                    "Content-Length",
                    str(size),
                )
                connection.putheader("User-Agent", _USER_AGENT)
                connection.endheaders()

                with source_path.open("rb") as handle:
                    while True:
                        chunk = handle.read(1024 * 1024)

                        if not chunk:
                            break

                        connection.send(chunk)

                response = connection.getresponse()

                try:
                    response.read(8192)
                except Exception:
                    pass

                if response.status in (200, 201, 204):
                    return

                status = response.status

                if (
                    retry
                    and attempt + 1 < attempts
                    and (status == 429 or 500 <= status < 600)
                ):
                    self._sleep(self._retry_delay(attempt))
                    continue

                if status in (401, 403):
                    raise MineruApiError(
                        "MinerU 签名上传被拒绝"
                        f"（HTTP {status}）",
                        stage="upload",
                    )

                raise MineruApiError(
                    "MinerU 签名上传失败"
                    f"（HTTP {status}）",
                    stage="upload",
                    retryable=(status == 429 or status >= 500),
                )

            except (
                urllib.error.URLError,
                TimeoutError,
                socket.timeout,
                ConnectionError,
                http.client.HTTPException,
                OSError,
            ) as error:

                if retry and attempt + 1 < attempts:
                    self._sleep(self._retry_delay(attempt))
                    continue

                self._network_error(error, "upload")

            finally:
                if connection is not None:
                    try:
                        connection.close()
                    except Exception:
                        pass

        raise MineruApiError(
            "MinerU 签名上传失败",
            stage="upload",
        )

    # -- result ZIP ----------------------------------------------

    def download_file(
        self,
        signed_url,
        destination,
        *,
        max_bytes,
        retry=True,
    ):
        parts = urllib.parse.urlsplit(str(signed_url or ""))

        if parts.scheme != "https":
            raise MineruApiError(
                "MinerU 云端返回了非 HTTPS 的下载地址",
                stage="download",
            )

        destination = Path(destination)
        destination.parent.mkdir(
            parents=True,
            exist_ok=True,
        )

        temp_path = destination.with_name(
            destination.name
            + ".part-"
            + uuid.uuid4().hex
        )

        attempts = self.config.max_retries + 1

        for attempt in range(attempts):

            try:
                request = urllib.request.Request(
                    signed_url,
                    headers={"User-Agent": _USER_AGENT},
                )

                with urllib.request.urlopen(
                    request,
                    timeout=self.config.timeout_seconds,
                ) as response:

                    final_url = response.geturl()

                    if not str(final_url).startswith("https://"):
                        raise MineruApiError(
                            "MinerU 结果下载被重定向到非 HTTPS 地址",
                            stage="download",
                        )

                    declared = response.headers.get(
                        "Content-Length"
                    )

                    if declared:
                        try:
                            if int(declared) > max_bytes:
                                raise MineruApiError(
                                    "MinerU 结果 ZIP 超过大小限制",
                                    stage="download",
                                )
                        except ValueError:
                            pass

                    total = 0

                    with temp_path.open("wb") as handle:
                        while True:
                            chunk = response.read(1024 * 1024)

                            if not chunk:
                                break

                            total += len(chunk)

                            if total > max_bytes:
                                raise MineruApiError(
                                    "MinerU 结果 ZIP 超过大小限制",
                                    stage="download",
                                )

                            handle.write(chunk)

                if not temp_path.is_file() or temp_path.stat().st_size <= 0:
                    raise MineruApiError(
                        "MinerU 结果 ZIP 为空",
                        stage="download",
                    )

                os.replace(temp_path, destination)
                return

            except MineruApiError:
                try:
                    temp_path.unlink()
                except OSError:
                    pass
                raise

            except urllib.error.HTTPError as error:
                try:
                    error_body = error.read(4096)
                except Exception:
                    error_body = b""

                if (
                    retry
                    and attempt + 1 < attempts
                    and (
                        error.code == 429
                        or 500 <= error.code < 600
                    )
                ):
                    self._sleep(
                        self._retry_delay(
                            attempt,
                            error.headers.get("Retry-After")
                            if error.headers
                            else None,
                        )
                    )
                    continue

                self._http_error(
                    error.code,
                    error_body,
                    "download",
                )

            except (
                urllib.error.URLError,
                TimeoutError,
                socket.timeout,
                ConnectionError,
                OSError,
            ) as error:

                try:
                    temp_path.unlink()
                except OSError:
                    pass

                if retry and attempt + 1 < attempts:
                    self._sleep(self._retry_delay(attempt))
                    continue

                self._network_error(error, "download")

        raise MineruApiError(
            "MinerU 结果 ZIP 下载失败",
            stage="download",
        )


# ---------------------------------------------------------------------------
# Output adaptation
# ---------------------------------------------------------------------------

_TEXT_KEYS = ("text", "value", "content")
_CHILD_KEYS = ("lines", "spans", "blocks")


def _node_text(node, depth=0):
    """
    Best-effort text extraction for both current MiddleJson
    (content/text) and older layouts (lines/spans).
    """

    if depth > 20:
        return ""

    if isinstance(node, str):
        return node

    if isinstance(node, list):
        return " ".join(
            part
            for part in (
                _node_text(item, depth + 1)
                for item in node
            )
            if part
        )

    if isinstance(node, dict):

        parts = []

        for key in _TEXT_KEYS:
            if key not in node:
                continue

            value = _node_text(node[key], depth + 1)

            if value:
                parts.append(value)

        if not parts:
            for key in _CHILD_KEYS:
                if key not in node:
                    continue

                value = _node_text(node[key], depth + 1)

                if value:
                    parts.append(value)

        return " ".join(parts)

    return ""


def _normalize_bbox(value):
    if isinstance(value, dict):
        try:
            value = [
                value["x0"],
                value["y0"],
                value["x1"],
                value["y1"],
            ]
        except KeyError:
            return None

    if not isinstance(value, list) or len(value) != 4:
        return None

    try:
        return [
            float(item)
            for item in value
        ]
    except (TypeError, ValueError):
        return None


def _normalize_block(block):
    if isinstance(block, str):
        text = block.strip()

        if not text:
            return None

        return {
            "type": "text",
            "content": text,
        }

    if not isinstance(block, dict):
        return None

    normalized = dict(block)

    text = _node_text(block).strip()

    if text:
        content = normalized.get("content")

        if not isinstance(content, str) or not content.strip():
            # Flatten spans/lines to a string for the quality gate.
            normalized["content"] = text

            # Keep the original child nodes so issue_locator can
            # still prefer a smaller, more precise bbox when it
            # exists. The parent text is not duplicated because the
            # locator reads only text/value/content on this node.
            if isinstance(content, (list, dict)):
                normalized["contentNodes"] = content

    bbox = _normalize_bbox(normalized.get("bbox"))

    if bbox is not None:
        normalized["bbox"] = bbox

    if not normalized.get("type"):
        for key in ("block_type", "category", "label"):
            value = normalized.get(key)

            if isinstance(value, str) and value.strip():
                normalized["type"] = value.strip()
                break

    return normalized


def _normalize_page(page, index):
    if not isinstance(page, dict):
        page = {}

    normalized = dict(page)

    page_idx = page.get(
        "page_idx",
        page.get("page_id", index),
    )

    try:
        page_idx = int(page_idx)
    except (TypeError, ValueError):
        page_idx = index

    blocks = page.get("blocks")

    if isinstance(blocks, dict):
        blocks = [blocks]

    if not isinstance(blocks, list):
        blocks = None

        for key in (
            "preproc_blocks",
            "para_blocks",
            "layout_blocks",
            "lines",
        ):
            candidate = page.get(key)

            if isinstance(candidate, list):
                blocks = candidate
                break

    if not isinstance(blocks, list):
        blocks = []

    normalized_blocks = []

    for block in blocks:
        item = _normalize_block(block)

        if item is not None:
            normalized_blocks.append(item)

    normalized["page_idx"] = page_idx
    normalized["blocks"] = normalized_blocks

    return normalized


def _as_page_list(data):
    if isinstance(data, list):
        return data, None

    if not isinstance(data, dict):
        return None, None

    pages = data.get("pages")

    if isinstance(pages, list):
        return pages, None

    if isinstance(pages, dict):
        ordered = []

        for key in sorted(
            pages,
            key=lambda item: str(item),
        ):
            value = pages[key]

            if isinstance(value, dict):
                ordered.append(value)

        return ordered, None

    legacy = data.get("pdf_info")

    if isinstance(legacy, list):
        return legacy, "pdf_info"

    return None, None


def adapt_middle_json(data):
    """
    Convert a cloud layout/middle JSON payload into the shape the
    existing quality gate, locator, and review artifacts expect:

        {
          "pages": [
            {"page_idx": 0, "blocks": [{"type": ..., "bbox": ..., "content": ...}]}
          ],
          ...other metadata preserved...
        }

    The adapter validates the result. It never fabricates an empty
    middle JSON to make a quality gate pass.
    """

    pages, adapted_from = _as_page_list(data)

    if pages is None:
        raise MineruApiError(
            "MinerU 云端 layout/middle JSON 缺少 pages 列表",
            stage="adapt",
        )

    normalized_pages = [
        _normalize_page(page, index)
        for index, page in enumerate(pages)
    ]

    if not normalized_pages:
        raise MineruApiError(
            "MinerU 云端 layout/middle JSON 没有页面",
            stage="adapt",
        )

    if isinstance(data, dict):
        result = dict(data)

        if adapted_from == "pdf_info":
            result.pop("pdf_info", None)

        result["pages"] = normalized_pages

    else:
        result = {"pages": normalized_pages}

    if adapted_from:
        result["adaptedFrom"] = adapted_from

    return result


def _middle_text_chars(middle):
    total = 0

    for page in middle.get("pages", []) or []:
        if not isinstance(page, dict):
            continue

        for block in page.get("blocks", []) or []:
            total += len(_node_text(block).strip())

            if total > 0:
                return total

    return total


def content_list_to_middle(data):
    """
    Build a conservative middle JSON from *_content_list.json when
    layout.json is absent.

    This preserves page_idx/bbox/text but not the original block
    hierarchy. It is a fallback, and callers must log that fact.
    """

    if isinstance(data, dict):
        for key in ("content_list", "items"):
            if isinstance(data.get(key), list):
                data = data[key]
                break

    if not isinstance(data, list):
        raise MineruApiError(
            "MinerU 云端 content_list 不是列表",
            stage="adapt",
        )

    items = []
    nested = bool(data) and all(
        isinstance(group, list)
        for group in data
    )

    if nested:
        for page_index, group in enumerate(data):
            for item in group:
                if isinstance(item, dict):
                    item = dict(item)
                    item.setdefault("page_idx", page_index)
                    items.append(item)
    else:
        items = [
            item
            for item in data
            if isinstance(item, dict)
        ]

    grouped = {}

    for item in items:

        # A content-list block without text is not a usable
        # fallback middle block. Skip it instead of fabricating an
        # empty text block that could confuse the quality gate.
        if not _node_text(item).strip():
            continue

        block = _normalize_block(item)

        if block is None:
            continue

        try:
            page_idx = int(
                item.get(
                    "page_idx",
                    item.get(
                        "page_id",
                        item.get("page_index", 0),
                    ),
                )
            )
        except (TypeError, ValueError):
            page_idx = 0

        grouped.setdefault(page_idx, []).append(block)

    if not grouped:
        raise MineruApiError(
            "MinerU 云端 content_list 没有可用文本块",
            stage="adapt",
        )

    pages = [
        {
            "page_idx": page_idx,
            "blocks": grouped[page_idx],
        }
        for page_idx in sorted(grouped)
    ]

    return {
        "pages": pages,
        "adaptedFrom": "content_list",
    }


def safe_extract_zip(
    zip_path,
    destination,
    *,
    max_bytes,
    max_files,
):
    """
    Extract a result ZIP after rejecting traversal, symlinks, and
    oversized archives.
    """

    zip_path = Path(zip_path)
    destination = Path(destination).resolve()

    destination.mkdir(parents=True, exist_ok=True)

    try:
        with zipfile.ZipFile(zip_path, "r") as archive:

            members = archive.infolist()

            if len(members) > max_files:
                raise MineruApiError(
                    "MinerU 结果 ZIP 文件数量超过限制",
                    stage="extract",
                )

            total = 0

            for member in members:

                name = member.filename.replace("\\", "/")

                if (
                    name.startswith("/")
                    or re.match(r"^[A-Za-z]:/", name)
                    or ".." in Path(name).parts
                ):
                    raise MineruApiError(
                        "MinerU 结果 ZIP 包含不安全路径",
                        stage="extract",
                    )

                mode = (member.external_attr >> 16) & 0o170000

                if mode == 0o120000:
                    raise MineruApiError(
                        "MinerU 结果 ZIP 包含符号链接",
                        stage="extract",
                    )

                total += max(0, int(member.file_size))

                if total > max_bytes:
                    raise MineruApiError(
                        "MinerU 结果 ZIP 解压后超过大小限制",
                        stage="extract",
                    )

                target = (destination / name).resolve()

                if (
                    target != destination
                    and destination not in target.parents
                ):
                    raise MineruApiError(
                        "MinerU 结果 ZIP 路径越界",
                        stage="extract",
                    )

            archive.extractall(destination)

    except zipfile.BadZipFile as error:
        raise MineruApiError(
            "MinerU 结果不是有效的 ZIP",
            stage="extract",
        ) from error

    except MineruApiError:
        raise

    except (OSError, RuntimeError, ValueError) as error:
        raise MineruApiError(
            "MinerU 结果 ZIP 解压失败",
            stage="extract",
            detail=_safe_detail(error),
        ) from error


def _find_export_file(root, predicate):
    matches = [
        path
        for path in root.rglob("*")
        if path.is_file() and predicate(path.name.lower())
    ]

    if not matches:
        return None

    matches.sort(
        key=lambda path: (
            len(path.relative_to(root).parts),
            str(path),
        )
    )

    return matches[0]


def _find_artifacts(export_dir):

    markdown = _find_export_file(
        export_dir,
        lambda name: name == "full.md",
    )

    if markdown is None:
        markdown = _find_export_file(
            export_dir,
            lambda name: name.endswith(".md"),
        )

    layout = _find_export_file(
        export_dir,
        lambda name: name in ("layout.json", "middle.json")
        or name.endswith("_middle.json"),
    )

    content_list = _find_export_file(
        export_dir,
        lambda name: name == "content_list.json"
        or name.endswith("_content_list.json"),
    )

    model = _find_export_file(
        export_dir,
        lambda name: name.endswith("_model.json")
        and not name.endswith("_content_list.json"),
    )

    return {
        "markdown": markdown,
        "layout": layout,
        "content_list": content_list,
        "model": model,
    }


def _read_json_file(path):
    try:
        return json.loads(
            Path(path).read_text(
                encoding="utf-8-sig",
                errors="strict",
            )
        )
    except (ValueError, UnicodeDecodeError) as error:
        raise MineruApiError(
            "MinerU 云端 JSON 产物无法解析",
            stage="adapt",
            detail=_safe_detail(error),
        ) from error


def _atomic_write_text(path, text):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)

    temp = path.with_name(
        path.name + ".tmp-" + uuid.uuid4().hex
    )

    try:
        temp.write_text(text, encoding="utf-8")
        os.replace(temp, path)
    finally:
        if temp.exists():
            try:
                temp.unlink()
            except OSError:
                pass


def _atomic_write_json(path, value):
    _atomic_write_text(
        path,
        json.dumps(
            value,
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
    )


def _resolve_source_path(contract):
    file_path = contract.get("file_path")

    if not file_path:
        raise MineruApiError(
            "合同缺少 file_path",
            stage="config",
        )

    root = Path(PROJECT_ROOT).resolve()
    storage_root = (root / "storage" / "contracts").resolve()
    source_path = (root / file_path).resolve()

    if (
        source_path != storage_root
        and storage_root not in source_path.parents
    ):
        raise MineruApiError(
            "合同源文件路径越界（不在 storage/contracts 内）",
            stage="config",
        )

    if not source_path.is_file():
        raise MineruApiError(
            "合同源文件不存在",
            stage="config",
        )

    return source_path


def _data_id_for_contract(contract):
    raw = str(contract.get("id") or "").strip()
    safe = re.sub(r"[^A-Za-z0-9_.-]", "", raw)[:128]

    if not safe:
        raise MineruApiError(
            "合同 ID 无法作为 MinerU data_id",
            stage="config",
        )

    return safe


def _select_batch_result(payload, data_id, file_name):
    if not isinstance(payload, dict):
        raise MineruApiError(
            "MinerU 云端查询响应格式无效",
            stage="poll",
        )

    data = payload.get("data")

    if not isinstance(data, dict):
        raise MineruApiError(
            "MinerU 云端查询响应缺少 data",
            stage="poll",
        )

    results = data.get("extract_result")

    if isinstance(results, dict):
        results = [results]

    if not isinstance(results, list) or not results:
        raise MineruApiError(
            "MinerU 云端查询响应缺少 extract_result",
            stage="poll",
        )

    for item in results:
        if not isinstance(item, dict):
            continue

        if str(item.get("data_id") or "") == data_id:
            return item

    for item in results:
        if not isinstance(item, dict):
            continue

        # Only use the filename when the API omitted data_id. If an
        # item carries a different data_id, matching by a shared
        # filename would pick the wrong contract.
        if (
            not item.get("data_id")
            and str(item.get("file_name") or "") == file_name
        ):
            return item

    if len(results) == 1 and isinstance(results[0], dict):
        return results[0]

    raise MineruApiError(
        "MinerU 云端返回多个结果且无法匹配当前合同 data_id，"
        "拒绝随机选择",
        stage="poll",
    )


def _require_api_ok(payload, *, stage, secret=None):
    if not isinstance(payload, dict):
        raise MineruApiError(
            "MinerU 云端 API 响应格式无效",
            stage=stage,
        )

    code = payload.get("code")

    if code in (0, "0"):
        return

    message = _safe_detail(
        payload.get("msg")
        or payload.get("message")
        or "",
        secret,
    )

    if code in _TOKEN_API_CODES:
        raise MineruApiError(
            "MinerU 云端 API Token 无效或已过期",
            stage=stage,
            code=code,
        )

    raise MineruApiError(
        f"MinerU 云端 API 返回错误（code={code}）",
        stage=stage,
        code=code,
        retryable=code in _RETRYABLE_API_CODES,
        detail=message or None,
    )


def _emit_stage(on_stage, stage):
    if on_stage is None:
        return

    try:
        on_stage(stage)
    except Exception:
        pass


def _write_log(log_path, events):
    """
    Write a sanitized diagnostic log. Never includes the token,
    signed URLs, or contract text.
    """

    try:
        lines = []

        for event in events:
            fields = event.get("fields") or {}
            suffix = " ".join(
                f"{key}={_safe_detail(value)}"
                for key, value in fields.items()
                if value is not None
            )
            lines.append(
                f"{event.get('at')} "
                f"{event.get('event')}"
                + (f" {suffix}" if suffix else "")
            )

        Path(log_path).write_text(
            "\n".join(lines) + "\n",
            encoding="utf-8",
        )

    except Exception:
        pass


def parse_contract_cloud(
    contract,
    *,
    tier=TIER_STANDARD,
    on_stage=None,
    source_path=None,
    parsed_dir=None,
    config=None,
    transport=None,
    sleep=None,
    token=None,
):
    """
    Parse one contract with the MinerU cloud API.

    Returns the same artifact-path contract as the local parser.
    API errors raise MineruApiError and are never reported as a
    quality-gate failure.
    """

    tier = str(tier or "").strip().lower()

    if tier not in VALID_TIERS:
        raise ValueError(
            f"Unknown MinerU tier: {tier!r}"
        )

    if config is None:
        try:
            config = MineruApiConfig.from_env(
                token=token
            )
        except ValueError as error:
            raise MineruApiError(
                "MinerU 云端解析配置无效",
                stage="config",
                detail=_safe_detail(error),
            ) from error

    elif token is not None and str(token).strip():
        config = replace(
            config,
            token=str(token).strip(),
        )

    sleep = sleep or time.sleep

    if not config.token:
        raise MineruApiError(
            "MinerU 云端解析未配置 MINERU_API_TOKEN",
            stage="config",
        )

    if source_path is None:
        source_path = _resolve_source_path(contract)
    else:
        source_path = Path(source_path).resolve()

    if not source_path.is_file():
        raise MineruApiError(
            "合同源文件不存在",
            stage="config",
        )

    try:
        source_size = source_path.stat().st_size
    except OSError as error:
        raise MineruApiError(
            "无法读取合同 PDF",
            stage="config",
            detail=_safe_detail(error),
        ) from error

    if source_size <= 0:
        raise MineruApiError(
            "合同 PDF 为空",
            stage="config",
        )

    if source_size > config.max_file_bytes:
        raise MineruApiError(
            "合同 PDF 超过 MinerU 云端 API 大小限制",
            stage="config",
        )

    try:
        page_count = int(contract.get("page_count"))
    except (TypeError, ValueError):
        page_count = None

    if page_count is not None and page_count > MAX_CLOUD_PAGES:
        raise MineruApiError(
            "合同页数超过 MinerU 云端 API 限制"
            f"（{MAX_CLOUD_PAGES} 页）",
            stage="config",
        )

    parsed_dir = (
        Path(parsed_dir)
        if parsed_dir is not None
        else source_path.parent / "parsed"
    )

    parsed_dir.mkdir(parents=True, exist_ok=True)

    markdown_path = parsed_dir / "document.raw.md"
    middle_json_path = parsed_dir / "document.middle.json"
    structured_json_path = parsed_dir / "document.structured.json"
    zip_path = parsed_dir / "mineru-cloud-output.zip"
    extract_dir = parsed_dir / "mineru-cloud-export"
    log_path = parsed_dir / "mineru.log"

    for path in (
        markdown_path,
        middle_json_path,
        structured_json_path,
        zip_path,
    ):
        if path.exists():
            path.unlink()

    if extract_dir.exists():
        shutil.rmtree(extract_dir, ignore_errors=True)

    extract_dir.mkdir(parents=True, exist_ok=True)

    events = []

    def log_event(event, **fields):
        events.append(
            {
                "at": datetime.now(
                    timezone.utc
                ).isoformat(),
                "event": event,
                "fields": fields,
            }
        )

    model_version = config.model_for(tier)
    data_id = _data_id_for_contract(contract)

    # A short ASCII name avoids filename encoding issues. The
    # business key is data_id, not the cloud-visible filename.
    cloud_file_name = "contract-" + data_id + ".pdf"

    transport = transport or HttpTransport(
        config,
        sleep=sleep,
    )

    log_event(
        "start",
        backend="cloud",
        tier=tier,
        model=model_version,
    )

    # Leave an early marker so a hard kill cannot leave an old log
    # looking like the current attempt.
    _write_log(log_path, events)

    try:

        _emit_stage(on_stage, "upload")

        payload = {
            "files": [
                {
                    "name": cloud_file_name,
                    "data_id": data_id,
                    "is_ocr": config.is_ocr,
                }
            ],
            "model_version": model_version,
            "language": config.language,
            "enable_table": config.enable_table,
            "enable_formula": config.enable_formula,
        }

        submission = transport.request_json(
            "POST",
            "/file-urls/batch",
            payload=payload,
            retry=False,
        )

        _require_api_ok(
            submission,
            stage="submit",
            secret=config.token,
        )

        data = submission.get("data")

        if not isinstance(data, dict):
            raise MineruApiError(
                "MinerU 云端上传申请响应缺少 data",
                stage="submit",
            )

        batch_id = data.get("batch_id")
        file_urls = data.get("file_urls")

        if not batch_id or not isinstance(file_urls, list):
            raise MineruApiError(
                "MinerU 云端上传申请响应缺少 batch_id/file_urls",
                stage="submit",
            )

        if len(file_urls) != 1:
            raise MineruApiError(
                "MinerU 云端返回的上传链接数量与文件数量不一致",
                stage="submit",
            )

        log_event(
            "submitted",
            batch_id=_safe_detail(batch_id),
        )

        _emit_stage(on_stage, "queued")

        transport.upload_file(
            file_urls[0],
            source_path,
        )

        log_event(
            "uploaded",
            bytes=source_size,
        )

        poll_path = (
            "/extract-results/batch/"
            + urllib.parse.quote(str(batch_id), safe="")
        )

        deadline = time.monotonic() + config.poll_timeout_seconds
        last_state = None
        item = None

        while True:

            result_payload = transport.request_json(
                "GET",
                poll_path,
                retry=True,
            )

            _require_api_ok(
                result_payload,
                stage="poll",
                secret=config.token,
            )

            item = _select_batch_result(
                result_payload,
                data_id,
                cloud_file_name,
            )

            state = str(
                item.get("state") or ""
            ).strip().lower()

            if state != last_state:
                progress = item.get("extract_progress") or {}

                log_event(
                    "state",
                    state=state or "unknown",
                    extracted_pages=progress.get(
                        "extracted_pages"
                    ),
                    total_pages=progress.get("total_pages"),
                )

                last_state = state

            if state == _STATE_DONE:
                break

            if state == _STATE_FAILED:
                raise MineruApiError(
                    "MinerU 云端解析失败",
                    stage="parse",
                    detail=_safe_detail(
                        item.get("err_msg")
                        or "云端返回 failed",
                        config.token,
                    ),
                )

            if state in _STATE_QUEUED:
                _emit_stage(on_stage, "queued")
            elif state == _STATE_CONVERTING:
                _emit_stage(on_stage, "converting")
            else:
                # running plus any undocumented non-terminal state.
                _emit_stage(on_stage, "parsing")

            if time.monotonic() >= deadline:
                raise MineruApiError(
                    "MinerU 云端解析超时"
                    f"（{int(config.poll_timeout_seconds)} 秒）；"
                    "任务可能仍在云端处理，不会自动重复提交",
                    stage="poll",
                )

            sleep(config.poll_interval_seconds)

        zip_url = item.get("full_zip_url") if item else None

        if not zip_url:
            raise MineruApiError(
                "MinerU 云端解析完成但缺少 full_zip_url",
                stage="poll",
            )

        _emit_stage(on_stage, "download")

        transport.download_file(
            zip_url,
            zip_path,
            max_bytes=config.max_zip_bytes,
            retry=True,
        )

        log_event(
            "downloaded",
            bytes=zip_path.stat().st_size,
        )

        _emit_stage(on_stage, "adapt")

        safe_extract_zip(
            zip_path,
            extract_dir,
            max_bytes=config.max_extract_bytes,
            max_files=config.max_extract_files,
        )

        artifacts = _find_artifacts(extract_dir)

        if artifacts["markdown"] is None:
            raise MineruApiError(
                "MinerU 云端结果缺少 full.md",
                stage="adapt",
            )

        try:
            markdown_text = artifacts[
                "markdown"
            ].read_text(
                encoding="utf-8-sig",
                errors="strict",
            )
        except (UnicodeDecodeError, OSError) as error:
            raise MineruApiError(
                "MinerU 云端 full.md 不是有效的 UTF-8 文本",
                stage="adapt",
                detail=_safe_detail(error),
            ) from error

        if not markdown_text.strip():
            raise MineruApiError(
                "MinerU 云端 full.md 为空",
                stage="adapt",
            )

        middle_source = "layout_json"
        middle_data = None

        if artifacts["layout"] is not None:
            try:
                middle_data = adapt_middle_json(
                    _read_json_file(artifacts["layout"])
                )
            except MineruApiError as layout_error:
                if artifacts["content_list"] is None:
                    raise

                log_event(
                    "layout_fallback",
                    reason=_safe_detail(
                        layout_error,
                        config.token,
                    ),
                )
                middle_data = None

        if (
            middle_data is not None
            and _middle_text_chars(middle_data) == 0
        ):
            # A syntactically valid layout with no text (for example
            # an old layout_dets-style payload) is not usable. Do not
            # let it reach the quality gate as if it were a parse.
            if artifacts["content_list"] is None:
                raise MineruApiError(
                    "MinerU 云端 layout.json 没有可识别文本",
                    stage="adapt",
                )

            log_event(
                "layout_fallback",
                reason="layout_without_text",
            )
            middle_data = None

        if middle_data is None:

            if artifacts["content_list"] is None:
                raise MineruApiError(
                    "MinerU 云端结果缺少 layout.json "
                    "且没有可回退的 content_list",
                    stage="adapt",
                )

            middle_data = content_list_to_middle(
                _read_json_file(artifacts["content_list"])
            )
            middle_source = "content_list_fallback"

        _atomic_write_text(
            markdown_path,
            markdown_text,
        )

        _atomic_write_json(
            middle_json_path,
            middle_data,
        )

        structured_written = None

        if artifacts["content_list"] is not None:
            _atomic_write_json(
                structured_json_path,
                _read_json_file(artifacts["content_list"]),
            )
            structured_written = structured_json_path
        elif artifacts["model"] is not None:
            _atomic_write_json(
                structured_json_path,
                _read_json_file(artifacts["model"]),
            )
            structured_written = structured_json_path

        output_size = markdown_path.stat().st_size
        middle_json_size = middle_json_path.stat().st_size

        if output_size <= 0:
            raise MineruApiError(
                "MinerU 云端 document.raw.md 为空",
                stage="adapt",
            )

        if middle_json_size <= 0:
            raise MineruApiError(
                "MinerU 云端 document.middle.json 为空",
                stage="adapt",
            )

        log_event(
            "adapted",
            pages=len(middle_data.get("pages") or []),
            middle_source=middle_source,
            markdown_bytes=output_size,
        )

        return {
            "source_path": str(source_path),
            "output_path": str(markdown_path),
            "markdown_path": str(markdown_path),
            "middle_json_path": str(middle_json_path),
            "structured_json_path": (
                str(structured_written)
                if structured_written is not None
                else None
            ),
            "zip_path": str(zip_path),
            "export_dir": str(extract_dir),
            "log_path": str(log_path),
            "output_size": output_size,
            "middle_json_size": middle_json_size,
            "tier": tier,
            "backend": BACKEND_CLOUD,
            "model_version": model_version,
            "middle_json_source": middle_source,
        }

    except MineruApiError as error:
        log_event(
            "error",
            stage=error.stage,
            code=error.code,
            message=_safe_detail(error, config.token),
        )
        raise

    except Exception as error:
        detail = _safe_detail(error, config.token)

        log_event(
            "error",
            stage="internal",
            message=detail,
        )

        raise MineruApiError(
            "MinerU 云端解析内部错误",
            stage="internal",
            detail=detail,
        ) from error

    finally:
        _write_log(log_path, events)
