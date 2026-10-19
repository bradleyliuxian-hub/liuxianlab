"""
Contract parse profile (Contract Digitization v1.1).

Single source of truth for:

- user-facing parse modes (auto / fast / accurate)
- MinerU tier mapping (basic / standard)
- parse backend selection (local / cloud) and the cloud model mapping
- the parser signature used by the artifact cache

Changing CONTRACT_PARSE_PROFILE_VERSION, the backend, the MinerU
version, the small backend, the VLM engine, the seal patch version,
or the cloud model/OCR settings changes the parser signature, which
invalidates old cache entries. This is intentional.
"""

import hashlib
import os


# Bump this whenever the deterministic parsing pipeline
# changes in a way that should invalidate the cache.
CONTRACT_PARSE_PROFILE_VERSION = "v1.2.0"


MODE_AUTO = "auto"
MODE_FAST = "fast"
MODE_ACCURATE = "accurate"

VALID_MODES = (
    MODE_AUTO,
    MODE_FAST,
    MODE_ACCURATE,
)

DEFAULT_MODE = MODE_AUTO


TIER_BASIC = "basic"
TIER_STANDARD = "standard"

VALID_TIERS = (
    TIER_BASIC,
    TIER_STANDARD,
)


# MinerU release the production environment is pinned to.
DEFAULT_MINERU_VERSION = "4.0.11"

# LIUXIANLAB_SAFE_SEAL_CROP_V3 lives in
# scripts/patch_mineru_seal.py.
SEAL_PATCH_VERSION = "v3"


# ---------------------------------------------------------------------------
# Parse backend (local MinerU CLI vs MinerU cloud API)
# ---------------------------------------------------------------------------

BACKEND_LOCAL = "local"
BACKEND_CLOUD = "cloud"

VALID_BACKENDS = (
    BACKEND_LOCAL,
    BACKEND_CLOUD,
)

DEFAULT_PARSE_BACKEND = BACKEND_LOCAL

# Product policy, NOT an equivalence claim:
#   basic    -> pipeline
#   standard -> vlm
# Cloud model semantics differ from the local tier names.
DEFAULT_API_MODEL_BASIC = "pipeline"
DEFAULT_API_MODEL_STANDARD = "vlm"

VALID_API_MODELS = (
    "pipeline",
    "vlm",
)

DEFAULT_API_LANGUAGE = "ch"
DEFAULT_API_ENABLE_TABLE = True
DEFAULT_API_ENABLE_FORMULA = True

# Contracts are often scans. Defaulting OCR on avoids an empty
# Basic transcript for scanned PDFs; digital PDFs can opt out.
DEFAULT_API_IS_OCR = True

DEFAULT_API_BASE_URL = "https://mineru.net/api/v4"


def parse_backend(requested=None):
    """
    Resolve the parse backend for one job.

    A per-contract ``parse_backend_requested`` value always wins.
    Missing/blank values fall back to CONTRACT_MINERU_BACKEND
    (default: local) for old records and old clients.

    Unknown values raise instead of silently changing the
    execution backend.
    """

    candidate = (
        str(requested).strip().lower()
        if requested is not None
        else ""
    )

    if candidate:
        if candidate not in VALID_BACKENDS:
            raise ValueError(
                "Unknown parse backend: "
                f"{candidate!r} (expected local or cloud)"
            )

        return candidate

    value = str(
        os.getenv(
            "CONTRACT_MINERU_BACKEND",
            DEFAULT_PARSE_BACKEND,
        )
    ).strip().lower()

    if value not in VALID_BACKENDS:
        raise ValueError(
            "Unknown CONTRACT_MINERU_BACKEND: "
            f"{value!r} (expected local or cloud)"
        )

    return value


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


def cloud_api_base_url():
    return str(
        os.getenv(
            "MINERU_API_BASE_URL",
            DEFAULT_API_BASE_URL,
        )
    ).strip().rstrip("/")


def cloud_api_language():
    return str(
        os.getenv(
            "MINERU_API_LANGUAGE",
            DEFAULT_API_LANGUAGE,
        )
    ).strip() or DEFAULT_API_LANGUAGE


def cloud_api_enable_table():
    return _env_bool(
        "MINERU_API_ENABLE_TABLE",
        DEFAULT_API_ENABLE_TABLE,
    )


def cloud_api_enable_formula():
    return _env_bool(
        "MINERU_API_ENABLE_FORMULA",
        DEFAULT_API_ENABLE_FORMULA,
    )


def cloud_api_is_ocr():
    return _env_bool(
        "MINERU_API_IS_OCR",
        DEFAULT_API_IS_OCR,
    )


def cloud_model_for_tier(tier):
    """
    Map a local tier (basic/standard) to a cloud model version.

    This is a product policy. The cloud model is not claimed to
    be semantically identical to the local tier.
    """

    tier = str(tier or "").strip().lower()

    if tier not in VALID_TIERS:
        raise ValueError(
            "Unknown MinerU tier: "
            f"{tier!r}"
        )

    env_name = (
        "MINERU_API_MODEL_BASIC"
        if tier == TIER_BASIC
        else "MINERU_API_MODEL_STANDARD"
    )

    default = (
        DEFAULT_API_MODEL_BASIC
        if tier == TIER_BASIC
        else DEFAULT_API_MODEL_STANDARD
    )

    value = str(
        os.getenv(env_name, default)
    ).strip()

    normalized = value.lower()

    if normalized not in VALID_API_MODELS:
        raise ValueError(
            f"Unknown {env_name}: {value!r} "
            "(expected pipeline or vlm)"
        )

    return normalized


def model_for_tier(tier, backend=None):
    """
    The concrete parser model for the selected backend.
    """

    if parse_backend(backend) == BACKEND_CLOUD:
        return cloud_model_for_tier(tier)

    return str(tier or "").strip().lower()


def normalize_mode(value):
    """
    Return a valid parse mode.

    Missing or unknown values fall back to AUTO so that
    old clients (which never sent parseMode) keep working.
    """

    if value is None:
        return DEFAULT_MODE

    candidate = str(value).strip().lower()

    if candidate in VALID_MODES:
        return candidate

    return DEFAULT_MODE


def is_valid_mode(value):
    """
    Strict validation used by the upload API.

    Unlike normalize_mode(), this returns False for
    unknown values so the API can answer HTTP 400.
    """

    if value is None:
        return True

    return (
        str(value).strip().lower()
        in VALID_MODES
    )


def mineru_version():
    return os.getenv(
        "CONTRACT_MINERU_VERSION",
        DEFAULT_MINERU_VERSION,
    )


def model_source():
    return os.getenv(
        "MINERU_MODEL_SOURCE",
        "local",
    )


def small_backend():
    return os.getenv(
        "MINERU_MODEL_SMALL_BACKEND",
        "onnx",
    )


def vlm_engine():
    return os.getenv(
        "MINERU_MODEL_VLM_ENGINE",
        "llama-cpp",
    )


def tier_for_mode(mode):
    """
    Deterministic mode -> tier mapping.

    AUTO has no fixed tier (it tries basic first and may
    fall back to standard), so it returns None.
    """

    mode = normalize_mode(mode)

    if mode == MODE_FAST:
        return TIER_BASIC

    if mode == MODE_ACCURATE:
        return TIER_STANDARD

    return None


def initial_tier_for_mode(mode):
    """
    The first tier a mode attempts.
    """

    mode = normalize_mode(mode)

    if mode == MODE_ACCURATE:
        return TIER_STANDARD

    # AUTO and FAST both start on basic.
    return TIER_BASIC


def parser_signature_descriptor(tier, backend=None):
    """
    Human-readable, stable description of everything
    that can affect MinerU output for one tier/backend.
    """

    tier = str(tier or "").strip().lower()

    if tier not in VALID_TIERS:
        raise ValueError(
            "Unknown MinerU tier: "
            f"{tier!r}"
        )

    backend = parse_backend(backend)

    if backend == BACKEND_CLOUD:

        parts = [
            "mineru=cloud",
            f"tier={tier}",
            f"backend={backend}",
            f"api_base={cloud_api_base_url()}",
            f"api_model={cloud_model_for_tier(tier)}",
            f"api_lang={cloud_api_language()}",
            "api_ocr="
            + ("1" if cloud_api_is_ocr() else "0"),
            "api_table="
            + ("1" if cloud_api_enable_table() else "0"),
            "api_formula="
            + ("1" if cloud_api_enable_formula() else "0"),
            f"profile={CONTRACT_PARSE_PROFILE_VERSION}",
        ]

    else:

        parts = [
            f"mineru={mineru_version()}",
            f"tier={tier}",
            f"backend={backend}",
            f"source={model_source()}",
            f"small_backend={small_backend()}",
            f"vlm={vlm_engine()}",
            f"profile={CONTRACT_PARSE_PROFILE_VERSION}",
            f"seal={SEAL_PATCH_VERSION}",
        ]

    return ";".join(parts)


def parser_signature(tier, backend=None):
    """
    Stable hex signature for a tier/backend parser configuration.
    """

    descriptor = parser_signature_descriptor(
        tier,
        backend=backend,
    )

    return hashlib.sha256(
        descriptor.encode("utf-8")
    ).hexdigest()
