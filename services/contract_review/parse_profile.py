"""
Contract parse profile (Contract Digitization v1.1).

Single source of truth for:

- user-facing parse modes (auto / fast / accurate)
- MinerU tier mapping (basic / standard)
- the parser signature used by the artifact cache

Changing CONTRACT_PARSE_PROFILE_VERSION, the MinerU version,
the small backend, the VLM engine, or the seal patch version
changes the parser signature, which invalidates old cache
entries. This is intentional.
"""

import hashlib
import os


# Bump this whenever the deterministic parsing pipeline
# changes in a way that should invalidate the cache.
CONTRACT_PARSE_PROFILE_VERSION = "v1.1.0"


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


def parser_signature_descriptor(tier):
    """
    Human-readable, stable description of everything
    that can affect MinerU output for one tier.
    """

    tier = str(tier or "").strip().lower()

    if tier not in VALID_TIERS:
        raise ValueError(
            "Unknown MinerU tier: "
            f"{tier!r}"
        )

    parts = [
        f"mineru={mineru_version()}",
        f"tier={tier}",
        f"source={model_source()}",
        f"backend={small_backend()}",
        f"vlm={vlm_engine()}",
        f"profile={CONTRACT_PARSE_PROFILE_VERSION}",
        f"seal={SEAL_PATCH_VERSION}",
    ]

    return ";".join(parts)


def parser_signature(tier):
    """
    Stable hex signature for a tier's parser configuration.
    """

    descriptor = parser_signature_descriptor(tier)

    return hashlib.sha256(
        descriptor.encode("utf-8")
    ).hexdigest()
