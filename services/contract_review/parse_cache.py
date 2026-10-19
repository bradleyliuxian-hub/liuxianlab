"""
Owner-scoped MinerU artifact cache (Contract Digitization v1.1).

Only MinerU's raw parse artifacts are cached. Human review
state (document.draft.md, issues.json, document.fields.json,
final/document.md) is NEVER cached or reused across jobs.

Cache layout (all gitignored, never served over HTTP):

    storage/contracts-cache/
      <owner_hash>/
        <source_sha256>/
          <parser_signature>/
            basic/
              manifest.json
              document.raw.md
              document.middle.json
              document.structured.json
            standard/
              ...

Because the parser signature already includes the tier, basic
and standard entries are isolated automatically. Changing the
profile version (or MinerU/backend/VLM/seal version) changes
the signature and therefore invalidates old entries.
"""

import hashlib
import json
import os
import re
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path

from .database import PROJECT_ROOT
from .parse_profile import (
    VALID_TIERS,
    model_for_tier,
    parse_backend,
    parser_signature,
)


CACHE_ROOT = (
    PROJECT_ROOT
    / "storage"
    / "contracts-cache"
).resolve()


MANIFEST_VERSION = 1

DEFAULT_TTL_DAYS = 30


# Logical cache key -> stable filename inside parsed/.
CACHEABLE_FILES = (
    ("raw_markdown", "document.raw.md"),
    ("middle_json", "document.middle.json"),
    ("structured_json", "document.structured.json"),
)


_SHA256_RE = re.compile(r"^[0-9a-f]{64}$")


def is_valid_sha256(value):
    return bool(
        _SHA256_RE.match(
            str(value or "")
        )
    )


def owner_hash(owner_username):
    """
    Never use the raw username as a directory name.
    """

    return hashlib.sha256(
        str(owner_username or "").encode("utf-8")
    ).hexdigest()


def ttl_days():
    try:
        return int(
            os.getenv(
                "CONTRACT_PARSE_CACHE_DAYS",
                DEFAULT_TTL_DAYS,
            )
        )
    except (TypeError, ValueError):
        return DEFAULT_TTL_DAYS


def _validate_tier(tier):
    tier = str(tier or "").strip().lower()

    if tier not in VALID_TIERS:
        raise ValueError(
            f"Unknown MinerU tier: {tier!r}"
        )

    return tier


def entry_dir(owner_username, source_sha256, tier, *, backend=None):
    tier = _validate_tier(tier)

    signature = parser_signature(tier, backend=backend)

    cache_root = CACHE_ROOT.resolve()

    path = (
        cache_root
        / owner_hash(owner_username)
        / str(source_sha256)
        / signature
        / tier
    ).resolve()

    # Defensive: never escape the cache root.
    if (
        path != cache_root
        and cache_root not in path.parents
    ):
        raise RuntimeError(
            "Cache path escaped cache root"
        )

    return path


def collect_cacheable_files(parsed_dir):
    """
    Return {logical_key: Path} for the MinerU artifacts that
    exist in a parsed/ directory.
    """

    parsed_dir = Path(parsed_dir)

    collected = {}

    for key, filename in CACHEABLE_FILES:
        candidate = parsed_dir / filename

        if candidate.is_file():
            collected[key] = candidate

    return collected


def _quarantine(path):
    """
    Remove a corrupt/unusable cache entry.

    Cache must never be a single point of failure, so a bad
    entry is simply deleted and treated as a miss.
    """

    try:
        shutil.rmtree(path, ignore_errors=True)
    except Exception:
        pass


def lookup(owner_username, source_sha256, tier, *, backend=None):
    """
    Return a validated manifest, or None (cache miss).

    Never raises for a bad entry: it is quarantined and
    treated as a miss.
    """

    if not is_valid_sha256(source_sha256):
        return None

    directory = entry_dir(
        owner_username,
        source_sha256,
        tier,
        backend=backend,
    )

    manifest_path = directory / "manifest.json"

    if not manifest_path.is_file():
        return None

    try:
        manifest = json.loads(
            manifest_path.read_text(
                encoding="utf-8"
            )
        )
    except (ValueError, OSError):
        _quarantine(directory)
        return None

    if not isinstance(manifest, dict):
        _quarantine(directory)
        return None

    if manifest.get("version") != MANIFEST_VERSION:
        return None

    if manifest.get("sourceSha256") != source_sha256:
        return None

    if str(manifest.get("tier")) != str(tier).lower():
        return None

    if (
        manifest.get("parserSignature")
        != parser_signature(tier, backend=backend)
    ):
        return None

    files = manifest.get("files")

    if not isinstance(files, dict) or not files:
        _quarantine(directory)
        return None

    for _, filename in files.items():
        if not (
            directory / str(filename)
        ).is_file():
            _quarantine(directory)
            return None

    return manifest


def store(
    owner_username,
    source_sha256,
    tier,
    *,
    files,
    quality_pass=None,
    metrics=None,
    backend=None,
):
    """
    Atomically write a cache entry.

    Writes a temporary directory, fills every artifact, writes
    the manifest last, then atomically renames it into place.
    A crashed job can therefore never leave a half-written
    entry that a later job mistakes for a hit.
    """

    if not is_valid_sha256(source_sha256):
        raise ValueError(
            "source_sha256 must be a 64-char hex digest"
        )

    tier = _validate_tier(tier)
    resolved_backend = parse_backend(backend)

    directory = entry_dir(
        owner_username,
        source_sha256,
        tier,
        backend=resolved_backend,
    )

    directory.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    temp_dir = directory.parent / (
        f".tmp-{directory.name}-"
        f"{os.getpid()}-"
        f"{uuid.uuid4().hex}"
    )

    try:
        temp_dir.mkdir(
            parents=False,
            exist_ok=False,
        )

        stored_files = {}

        for key, source in (files or {}).items():
            source = Path(source)

            if not source.is_file():
                continue

            destination = temp_dir / source.name

            shutil.copy2(
                source,
                destination,
            )

            stored_files[key] = source.name

        if not stored_files:
            raise RuntimeError(
                "No cacheable artifacts to store"
            )

        manifest = {
            "version": MANIFEST_VERSION,
            "sourceSha256": source_sha256,
            "tier": tier,
            "parserSignature": parser_signature(
                tier,
                backend=resolved_backend,
            ),
            "backend": resolved_backend,
            "modelVersion": model_for_tier(
                tier,
                backend=resolved_backend,
            ),
            "qualityPass": quality_pass,
            "createdAt": datetime.now(
                timezone.utc
            ).isoformat(),
            "files": stored_files,
            "metrics": metrics or {},
        }

        (temp_dir / "manifest.json").write_text(
            json.dumps(
                manifest,
                ensure_ascii=False,
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )

        # Atomic publish.
        if directory.exists():
            shutil.rmtree(
                directory,
                ignore_errors=True,
            )

        os.replace(
            str(temp_dir),
            str(directory),
        )

        return manifest

    except Exception:
        shutil.rmtree(
            temp_dir,
            ignore_errors=True,
        )
        raise


def restore(
    owner_username,
    source_sha256,
    tier,
    destination_dir,
    *,
    backend=None,
):
    """
    Materialize cached MinerU artifacts into a new job's
    parsed/ directory. Returns {key: path} or None on miss.

    The destination still needs prepare_review_artifacts() and
    build_consistency_artifacts() so each job gets its own
    draft / issues / fields.
    """

    manifest = lookup(
        owner_username,
        source_sha256,
        tier,
        backend=backend,
    )

    if not manifest:
        return None

    directory = entry_dir(
        owner_username,
        source_sha256,
        tier,
        backend=backend,
    )

    destination_dir = Path(destination_dir)

    destination_dir.mkdir(
        parents=True,
        exist_ok=True,
    )

    restored = {}

    for key, filename in manifest["files"].items():
        source = directory / str(filename)

        if not source.is_file():
            _quarantine(directory)
            return None

        destination = destination_dir / str(filename)

        shutil.copy2(
            source,
            destination,
        )

        restored[key] = destination

    return {
        "manifest": manifest,
        "files": restored,
        "raw_markdown": restored.get("raw_markdown"),
        "middle_json": restored.get("middle_json"),
        "structured_json": restored.get("structured_json"),
    }


def prune_expired(now=None, ttl=None):
    """
    Best-effort lazy prune of expired cache entries.

    Never raises; returns the number of removed entries.
    Callers on the upload path must never be blocked by this.
    """

    if now is None:
        now = datetime.now(timezone.utc)

    if ttl is None:
        ttl = ttl_days()

    if not CACHE_ROOT.is_dir():
        return 0

    removed = 0

    try:
        for manifest_path in CACHE_ROOT.rglob(
            "manifest.json"
        ):
            try:
                manifest = json.loads(
                    manifest_path.read_text(
                        encoding="utf-8"
                    )
                )

                created_raw = str(
                    manifest.get("createdAt")
                    or ""
                )

                created = datetime.fromisoformat(
                    created_raw.replace(
                        "Z",
                        "+00:00",
                    )
                )

            except Exception:
                continue

            age_days = (
                now - created
            ).total_seconds() / 86400

            if age_days <= ttl:
                continue

            _quarantine(manifest_path.parent)
            removed += 1

    except Exception:
        return removed

    return removed
