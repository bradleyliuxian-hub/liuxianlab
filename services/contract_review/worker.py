import hashlib
import inspect
import json
import shutil
import sys
import time
from contextlib import nullcontext
from datetime import datetime, timezone
from pathlib import Path

from . import database
from . import parse_cache
from .consistency_artifacts import build_consistency_artifacts
from .critical_integrity import (
    PROFILE_VERSION as CRITICAL_INTEGRITY_PROFILE_VERSION,
    build_critical_review_issues,
    compare_critical_observations,
    evaluate_critical_integrity,
)
from .mineru_service import parse_contract
from .parse_profile import (
    MODE_ACCURATE,
    MODE_AUTO,
    MODE_FAST,
    TIER_BASIC,
    TIER_STANDARD,
    normalize_mode,
)
from .quality_gate import (
    evaluate_parse_quality,
    fallback_reason,
)
from .review_artifacts import prepare_review_artifacts


PROJECT_ROOT = database.PROJECT_ROOT


# ---------------------------------------------------------------------------
# Progress
# ---------------------------------------------------------------------------

# Coarse stage -> progress, per tier band. Kept deliberately simple;
# we never fabricate a precise MinerU percentage.
#
# NOTE: claim_next_contract already sets DB progress = 10, so every
# ProgressReporter value below is >= 10 (see ProgressReporter floor).
_BASIC_STAGE_PROGRESS = {
    "layout": 30,
    "vlm": 38,
    "ocr_det": 44,
    "ocr_rec": 48,
    "ocr_seal": 52,
}

_STANDARD_STAGE_PROGRESS = {
    "layout": 68,
    "vlm": 74,
    "ocr_det": 78,
    "ocr_rec": 81,
    "ocr_seal": 84,
}

_STAGE_MESSAGES = {
    "layout": "正在分析页面布局",
    "vlm": "正在识别合同文字",
    "ocr_det": "正在识别合同文字",
    "ocr_rec": "正在识别合同文字",
    "ocr_seal": "正在识别印章与图片文字",
}


class ProgressReporter:
    """
    Monotonic progress writer.

    Guarantees:
    - progress never decreases
    - PostgreSQL is not hammered (writes only on a message/stage
      change, a large enough step, or after a minimum interval)
    """

    def __init__(
        self,
        contract_id,
        *,
        floor=0,
        min_interval=1.0,
        min_delta=2,
    ):
        self.contract_id = str(contract_id)
        self.min_interval = float(min_interval)
        self.min_delta = int(min_delta)

        # Starting floor. The worker passes 10 because
        # claim_next_contract has already written progress = 10.
        # This guarantees ProgressReporter never regresses the DB.
        self.progress = max(
            0,
            min(100, int(floor)),
        )
        self.message = None
        self.stage = None
        self.status = None

        self._last_write = 0.0

    def update(
        self,
        progress,
        message=None,
        *,
        stage=None,
        status=None,
        force=False,
    ):
        try:
            value = int(progress)
        except (TypeError, ValueError):
            return

        value = max(0, min(100, value))

        if self.progress is not None and value < self.progress:
            value = self.progress

        now = time.monotonic()

        message_changed = (
            message is not None
            and message != self.message
        )

        marker_changed = (
            (stage is not None and stage != self.stage)
            or (status is not None and status != self.status)
        )

        grew = (
            self.progress is None
            or (value - self.progress) >= self.min_delta
        )

        time_ok = (
            now - self._last_write
        ) >= self.min_interval

        if (
            not force
            and not message_changed
            and not marker_changed
            and not (grew and time_ok)
        ):
            return

        try:
            database.update_contract_progress(
                self.contract_id,
                progress=value,
                progress_message=message,
                stage=stage,
                status=status,
            )

        except Exception as error:
            print(
                "[contract-worker] progress update failed:",
                error,
                flush=True,
            )
            return

        self.progress = value

        if message is not None:
            self.message = message

        if stage is not None:
            self.stage = stage

        if status is not None:
            self.status = status

        self._last_write = now


# ---------------------------------------------------------------------------
# Parse helpers
# ---------------------------------------------------------------------------

def _sha256_file(path, chunk_size=1024 * 1024):
    """
    Streaming SHA256. Never loads the whole PDF into memory.
    """

    digest = hashlib.sha256()

    with open(path, "rb") as handle:
        for chunk in iter(
            lambda: handle.read(chunk_size),
            b"",
        ):
            digest.update(chunk)

    return digest.hexdigest()


def _count_middle_pages(middle_json_path):
    if not middle_json_path:
        return None

    try:
        import json

        data = json.loads(
            Path(middle_json_path).read_text(
                encoding="utf-8",
                errors="replace",
            )
        )

        pages = data.get("pages") if isinstance(data, dict) else None

        if isinstance(pages, list):
            return len(pages)

    except Exception:
        return None

    return None


def _result_from_restored(restored):
    """
    Build a parse-result dict from cached artifacts.
    """

    if not restored:
        return None

    raw = restored.get("raw_markdown")
    middle = restored.get("middle_json")
    structured = restored.get("structured_json")

    if raw is None or middle is None:
        return None

    raw_path = Path(raw)

    return {
        "source_path": None,
        "output_path": str(raw_path),
        "markdown_path": str(raw_path),
        "middle_json_path": str(Path(middle)),
        "structured_json_path": (
            str(Path(structured))
            if structured
            else None
        ),
        "output_size": raw_path.stat().st_size,
        "tier": None,
        "from_cache": True,
    }


def _run_parse(
    contract,
    tier,
    reporter,
    start_progress,
):
    stage_progress = (
        _BASIC_STAGE_PROGRESS
        if tier == TIER_BASIC
        else _STANDARD_STAGE_PROGRESS
    )

    def on_stage(stage_key):
        percent = stage_progress.get(stage_key)

        if percent is None:
            return

        reporter.update(
            percent,
            _STAGE_MESSAGES.get(stage_key),
            stage=stage_key,
        )

    reporter.update(
        start_progress,
        (
            "正在启动快速解析"
            if tier == TIER_BASIC
            else "正在启动高精度解析"
        ),
        force=True,
    )

    return parse_contract(
        contract,
        tier=tier,
        on_stage=on_stage,
    )


def _select_cached_parse(owner, source_sha256, mode):
    """
    Decide which cached tier (if any) to restore.

    Returns ("use", tier, manifest) or (None, None, None).

    The cached manifest's stored qualityPass is NOT used here.
    For a Basic cache hit the worker re-runs the CURRENT quality
    gate on the restored artifacts, so a stale stored value can
    never decide AUTO's behaviour.
    """

    if not parse_cache.is_valid_sha256(source_sha256):
        return (None, None, None)

    if mode == MODE_ACCURATE:
        manifest = parse_cache.lookup(
            owner,
            source_sha256,
            TIER_STANDARD,
        )

        if manifest:
            return ("use", TIER_STANDARD, manifest)

        return (None, None, None)

    if mode == MODE_FAST:
        manifest = parse_cache.lookup(
            owner,
            source_sha256,
            TIER_BASIC,
        )

        if manifest:
            return ("use", TIER_BASIC, manifest)

        return (None, None, None)

    # AUTO: prefer a standard cache, then a basic cache. Whether a
    # basic cache is actually usable is decided by re-evaluation.
    standard = parse_cache.lookup(
        owner,
        source_sha256,
        TIER_STANDARD,
    )

    if standard:
        return ("use", TIER_STANDARD, standard)

    basic = parse_cache.lookup(
        owner,
        source_sha256,
        TIER_BASIC,
    )

    if basic:
        return ("use", TIER_BASIC, basic)

    return (None, None, None)


def _store_cache(
    owner,
    source_sha256,
    tier,
    parsed_dir,
    quality_result,
):
    """
    Store MinerU artifacts only. Best-effort: never fatal.
    """

    if not parse_cache.is_valid_sha256(source_sha256):
        return None

    files = parse_cache.collect_cacheable_files(
        parsed_dir
    )

    if not files:
        return None

    try:
        return parse_cache.store(
            owner,
            source_sha256,
            tier,
            files=files,
            quality_pass=(
                (quality_result or {}).get("passed")
            ),
            metrics=(
                (quality_result or {}).get("metrics")
                or {}
            ),
        )

    except Exception as error:
        print(
            "[contract-worker] cache store failed:",
            error,
            flush=True,
        )

        return None


def _critical_fallback_reason(integrity):
    """
    Machine-readable AUTO fallback reason for a critical
    integrity failure. Contains reason codes only, never
    sensitive contract values.
    """

    codes = (
        (integrity.get("metrics") or {}).get("reasonCodes")
        or []
    )

    primary = (
        codes[0]
        if codes
        else "critical_integrity_failed"
    )

    return (
        "basic_critical_integrity_failed:"
        + primary
    )


def _write_integrity_artifact(
    *,
    parsed_dir,
    mode,
    final_tier,
    final_integrity,
    cross_tier_findings,
    basic_integrity,
    recovered_reason_codes=None,
):
    """
    Write the per-job private integrity artifact.

    Never cached and never served publicly. Contains the
    critical observations/findings for the FINAL selected
    artifact, plus a small Basic summary when AUTO ran both
    tiers. ``recoveredByStandard`` records a Basic critical
    failure that the Standard re-parse resolved (audit evidence
    only; it is not shown as a mandatory user issue).
    """

    parsed_dir = Path(parsed_dir)
    parsed_dir.mkdir(parents=True, exist_ok=True)

    recovered_reason_codes = list(
        recovered_reason_codes or []
    )

    document = {
        "version": 1,
        "profileVersion": CRITICAL_INTEGRITY_PROFILE_VERSION,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "mode": mode,
        "finalTier": final_tier,
        "recoveredByStandard": bool(
            recovered_reason_codes
        ),
        "recoveredReasonCodes": recovered_reason_codes,
        "observations": final_integrity.get("observations", {}),
        "findings": final_integrity.get("findings", []),
        "crossTierFindings": list(cross_tier_findings or []),
        "metrics": {
            **(final_integrity.get("metrics") or {}),
            "crossTierCount": len(cross_tier_findings or []),
        },
    }

    if basic_integrity is not None:

        document["basicSummary"] = {
            "requiresStandard": basic_integrity.get(
                "requiresStandard"
            ),
            "observations": basic_integrity.get(
                "observations",
                {},
            ),
            "metrics": basic_integrity.get(
                "metrics",
                {},
            ),
        }

    path = parsed_dir / "document.integrity.json"

    path.write_text(
        json.dumps(
            document,
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    return path


def _get_callable(*names):
    """
    Return the first available callable from database.py.

    This also tolerates older helper names left over
    from previous development stages.
    """

    for name in names:
        value = getattr(
            database,
            name,
            None,
        )

        if callable(value):
            return value


    # Fallback for a historical rename of the
    # contract claim helper.
    if any(
        "claim" in name
        for name in names
    ):

        candidates = []

        for name in dir(
            database
        ):

            value = getattr(
                database,
                name,
                None,
            )

            lowered = (
                name.lower()
            )

            if (
                callable(value)
                and "claim" in lowered
                and "contract" in lowered
            ):

                candidates.append(
                    (
                        name,
                        value,
                    )
                )


        if len(
            candidates
        ) == 1:

            return candidates[0][1]


    raise RuntimeError(
        "Database helper not found. Tried: "
        + ", ".join(
            names
        )
    )


def _claim_next_contract():

    claim = _get_callable(
        "claim_next_contract",
        "claim_next_queued_contract",
        "claim_queued_contract",
        "claim_contract",
    )

    return claim()


def _worker_lock_context():

    value = getattr(
        database,
        "contract_worker_lock",
        None,
    )


    if value is None:

        return nullcontext()


    if callable(
        value
    ):

        value = value()


    if (
        hasattr(
            value,
            "__enter__",
        )
        and
        hasattr(
            value,
            "__exit__",
        )
    ):

        return value


    return nullcontext()


def _is_contract_deleted(
    contract_id,
):

    checker = getattr(
        database,
        "is_contract_deleted",
        None,
    )


    if not callable(
        checker
    ):

        return False


    return bool(
        checker(
            contract_id
        )
    )


def _delete_contract_row(
    contract_id,
):

    deleter = getattr(
        database,
        "delete_contract_row",
        None,
    )


    if callable(
        deleter
    ):

        deleter(
            contract_id
        )


def _update_contract_state(
    contract_id,
    *,
    status=None,
    stage=None,
    progress=None,
    error_message=None,
):
    """
    Call the existing database updater.

    Supports either:
        error_message=

    or the older:
        error=
    """

    updater = _get_callable(
        "update_contract_state"
    )


    parameters = (
        inspect.signature(
            updater
        ).parameters
    )


    kwargs = {}


    if (
        status is not None
        and "status" in parameters
    ):

        kwargs[
            "status"
        ] = status


    if (
        stage is not None
        and "stage" in parameters
    ):

        kwargs[
            "stage"
        ] = stage


    if (
        progress is not None
        and "progress" in parameters
    ):

        kwargs[
            "progress"
        ] = progress


    if (
        "error_message"
        in parameters
    ):

        kwargs[
            "error_message"
        ] = error_message


    elif (
        "error"
        in parameters
    ):

        kwargs[
            "error"
        ] = error_message


    return updater(
        contract_id,
        **kwargs,
    )


def _contract_original_name(
    contract,
):

    return (
        contract.get(
            "original_name"
        )
        or
        contract.get(
            "originalName"
        )
        or
        "contract.pdf"
    )


def cleanup_deleted_contract(
    contract,
):
    """
    Physically remove a contract that was
    soft-deleted while parsing.
    """

    contract_id = str(
        contract[
            "id"
        ]
    )


    file_path = (
        contract.get(
            "file_path"
        )
    )


    storage_root = (
        PROJECT_ROOT
        / "storage"
        / "contracts"
    ).resolve()


    if file_path:

        source_path = (
            PROJECT_ROOT
            / file_path
        ).resolve()


        contract_dir = (
            source_path.parent
        )


    else:

        contract_dir = (
            storage_root
            / contract_id
        ).resolve()


    if (
        contract_dir
        ==
        storage_root
        or
        storage_root
        not in contract_dir.parents
    ):

        raise RuntimeError(
            "Refusing to delete path outside "
            "storage/contracts: "
            f"{contract_dir}"
        )


    shutil.rmtree(
        contract_dir,
        ignore_errors=True,
    )


    _delete_contract_row(
        contract_id
    )


    print(
        "[contract-worker] "
        "deleted contract cleaned:",
        contract_id,
        flush=True,
    )


def _print_contract(
    contract,
):

    file_path = (
        contract.get(
            "file_path"
        )
    )


    source_path = (
        (
            PROJECT_ROOT
            / file_path
        ).resolve()
        if file_path
        else None
    )


    print(
        "[contract-worker] claimed contract",
        flush=True,
    )


    print(
        "id:",
        contract.get(
            "id"
        ),
        flush=True,
    )


    print(
        "file:",
        _contract_original_name(
            contract
        ),
        flush=True,
    )


    print(
        "status:",
        contract.get(
            "status"
        ),
        flush=True,
    )


    print(
        "stage:",
        contract.get(
            "stage"
        ),
        flush=True,
    )


    print(
        "progress:",
        contract.get(
            "progress"
        ),
        flush=True,
    )


    print(
        "source:",
        source_path,
        flush=True,
    )


    print(
        "source exists:",
        bool(
            source_path
            and
            source_path.is_file()
        ),
        flush=True,
    )


def process_contract(
    contract,
):

    contract = dict(
        contract
    )


    contract_id = str(
        contract[
            "id"
        ]
    )

    reporter = ProgressReporter(
        contract_id,
        floor=10,
    )

    worker_start = time.monotonic()

    metrics = {}

    def elapsed_ms(start):
        return int(
            (time.monotonic() - start) * 1000
        )

    try:

        # ---------------------------------
        # Deleted before parsing starts
        # ---------------------------------

        if _is_contract_deleted(
            contract_id
        ):

            print(
                "[contract-worker] "
                "deleted before parsing",
                flush=True,
            )


            cleanup_deleted_contract(
                contract
            )


            return True


        # ---------------------------------
        # Parsing state
        # ---------------------------------

        _update_contract_state(
            contract_id,
            status=
                "processing",
            stage=
                "parsing",
            progress=
                10,
            error_message=
                None,
        )


        contract[
            "status"
        ] = "processing"


        contract[
            "stage"
        ] = "parsing"


        contract[
            "progress"
        ] = 10


        _print_contract(
            contract
        )


        mode = normalize_mode(
            contract.get(
                "parse_mode_requested"
            )
        )

        owner = (
            contract.get(
                "owner_username"
            )
            or ""
        )

        input_page_count = (
            contract.get(
                "page_count"
            )
        )

        # Persist the resolved mode immediately so the UI
        # can show it even if parsing later fails.
        try:
            database.update_parse_metadata(
                contract_id,
                parse_mode_requested=mode,
            )
        except Exception as error:
            print(
                "[contract-worker] metadata init failed:",
                error,
                flush=True,
            )

        source_path = (
            PROJECT_ROOT
            / contract["file_path"]
        ).resolve()

        parsed_dir = (
            source_path.parent
            / "parsed"
        )


        # ---------------------------------
        # 1. File fingerprint
        # ---------------------------------

        reporter.update(
            12,
            "正在检查文件",
            force=True,
        )

        hash_start = time.monotonic()

        source_sha256 = ""

        try:
            source_sha256 = _sha256_file(
                source_path
            )

        except Exception as error:
            print(
                "[contract-worker] hash failed:",
                error,
                flush=True,
            )

        metrics["hashMs"] = elapsed_ms(
            hash_start
        )


        # ---------------------------------
        # 2. Cache lookup
        # ---------------------------------

        reporter.update(
            15,
            "正在检查解析缓存",
            force=True,
        )

        lookup_start = time.monotonic()

        action, cached_tier, cached_manifest = (
            _select_cached_parse(
                owner,
                source_sha256,
                mode,
            )
        )

        metrics["cacheLookupMs"] = elapsed_ms(
            lookup_start
        )


        result = None
        actual_tier = None
        cache_hit = False
        fallback_used = False
        fallback_reason_value = None
        quality_result = None
        basic_integrity = None
        original_name = _contract_original_name(
            contract
        )


        # ---------------------------------
        # 3a. Restore cache (Basic is re-validated)
        # ---------------------------------

        if action == "use":

            reporter.update(
                20,
                "命中解析缓存",
                force=True,
            )

            restore_start = time.monotonic()

            restored = parse_cache.restore(
                owner,
                source_sha256,
                cached_tier,
                parsed_dir,
            )

            metrics["cacheRestoreMs"] = elapsed_ms(
                restore_start
            )

            cached_result = _result_from_restored(
                restored
            )

            if cached_result is not None:

                cache_hit = True
                actual_tier = cached_tier
                result = cached_result

                if cached_tier == TIER_BASIC:

                    # IMPORTANT: re-run the CURRENT quality gate on
                    # the restored artifacts. The manifest's stored
                    # qualityPass is only metrics/debug and must not
                    # decide AUTO behaviour (thresholds may have
                    # changed since the entry was written).
                    reporter.update(
                        60,
                        "正在检查快速解析质量",
                        force=True,
                    )

                    gate_start = time.monotonic()

                    quality_result = evaluate_parse_quality(
                        result["output_path"],
                        middle_json_path=result.get(
                            "middle_json_path"
                        ),
                        page_count=input_page_count,
                    )

                    metrics["qualityGateMs"] = elapsed_ms(
                        gate_start
                    )

                    metrics["cacheRevalidated"] = True

                    integrity_start = time.monotonic()

                    basic_integrity = (
                        evaluate_critical_integrity(
                            markdown_path=
                                result["output_path"],

                            middle_json_path=
                                result.get(
                                    "middle_json_path"
                                ),

                            original_name=
                                original_name,
                        )
                    )

                    metrics["criticalIntegrityMs"] = elapsed_ms(
                        integrity_start
                    )

                    metrics["basicCriticalRequiresStandard"] = bool(
                        basic_integrity["requiresStandard"]
                    )

                    needs_standard = (
                        not quality_result["passed"]
                        or basic_integrity["requiresStandard"]
                    )

                    if (
                        mode == MODE_AUTO
                        and needs_standard
                    ):

                        # Cached Basic no longer passes the current
                        # structural and/or critical gate -> Standard.
                        fallback_used = True

                        fallback_reason_value = (
                            fallback_reason(
                                quality_result["reasons"]
                            )
                            if not quality_result["passed"]
                            else _critical_fallback_reason(
                                basic_integrity
                            )
                        )

                        # The final result comes from a fresh parse.
                        cache_hit = False

                        reporter.update(
                            65,
                            "快速解析质量不足，正在自动切换高精度解析",
                            force=True,
                        )

                        standard_start = time.monotonic()

                        result = _run_parse(
                            contract,
                            TIER_STANDARD,
                            reporter,
                            65,
                        )

                        metrics["standardParseMs"] = elapsed_ms(
                            standard_start
                        )

                        actual_tier = TIER_STANDARD

                    else:

                        reporter.update(
                            70,
                            "恢复解析结果",
                            force=True,
                        )

                else:

                    quality_result = {
                        "passed": True,
                        "reasons": [],
                        "metrics": (
                            (cached_manifest or {}).get(
                                "metrics"
                            )
                            or {}
                        ),
                        "cached": True,
                    }

                    reporter.update(
                        70,
                        "恢复解析结果",
                        force=True,
                    )


        # ---------------------------------
        # 3c. No cache -> run the mode's tier
        # ---------------------------------

        if result is None:

            if mode == MODE_ACCURATE:

                standard_start = time.monotonic()

                result = _run_parse(
                    contract,
                    TIER_STANDARD,
                    reporter,
                    65,
                )

                metrics["standardParseMs"] = elapsed_ms(
                    standard_start
                )

                actual_tier = TIER_STANDARD

            else:

                basic_start = time.monotonic()

                result = _run_parse(
                    contract,
                    TIER_BASIC,
                    reporter,
                    20,
                )

                metrics["basicParseMs"] = elapsed_ms(
                    basic_start
                )

                actual_tier = TIER_BASIC

                if _is_contract_deleted(
                    contract_id
                ):

                    print(
                        "[contract-worker] "
                        "deleted after parsing",
                        flush=True,
                    )

                    cleanup_deleted_contract(
                        contract
                    )

                    return True

                # -- Quality Gate --
                reporter.update(
                    60,
                    "正在检查快速解析质量",
                    force=True,
                )

                gate_start = time.monotonic()

                quality_result = evaluate_parse_quality(
                    result["output_path"],
                    middle_json_path=result.get(
                        "middle_json_path"
                    ),
                    page_count=input_page_count,
                )

                metrics["qualityGateMs"] = elapsed_ms(
                    gate_start
                )

                metrics["basicQualityPass"] = bool(
                    quality_result["passed"]
                )

                integrity_start = time.monotonic()

                basic_integrity = (
                    evaluate_critical_integrity(
                        markdown_path=
                            result["output_path"],

                        middle_json_path=
                            result.get(
                                "middle_json_path"
                            ),

                        original_name=
                            original_name,
                    )
                )

                metrics["criticalIntegrityMs"] = elapsed_ms(
                    integrity_start
                )

                metrics["basicCriticalRequiresStandard"] = bool(
                    basic_integrity["requiresStandard"]
                )

                # Cache the basic result (pass or fail) so a
                # later AUTO job does not rerun basic.
                _store_cache(
                    owner,
                    source_sha256,
                    TIER_BASIC,
                    parsed_dir,
                    quality_result,
                )

                # -- AUTO fallback --
                needs_standard = (
                    not quality_result["passed"]
                    or basic_integrity["requiresStandard"]
                )

                if (
                    mode == MODE_AUTO
                    and needs_standard
                ):

                    fallback_used = True

                    fallback_reason_value = (
                        fallback_reason(
                            quality_result["reasons"]
                        )
                        if not quality_result["passed"]
                        else _critical_fallback_reason(
                            basic_integrity
                        )
                    )

                    reporter.update(
                        65,
                        "快速解析质量不足，正在自动切换高精度解析",
                        force=True,
                    )

                    standard_start = time.monotonic()

                    result = _run_parse(
                        contract,
                        TIER_STANDARD,
                        reporter,
                        65,
                    )

                    metrics["standardParseMs"] = elapsed_ms(
                        standard_start
                    )

                    actual_tier = TIER_STANDARD


        # ---------------------------------
        # 3c-2. Standard finished (real parse)
        # ---------------------------------
        #
        # Real Standard parses end at 84 (ocr_seal); emit 86 so the
        # sequence 84 -> 86 -> 88 is natural. Cache restores use 70
        # via their own path and never emit standard stage values,
        # so nothing relies on ProgressReporter clamping.
        if (
            not cache_hit
            and actual_tier == TIER_STANDARD
        ):

            reporter.update(
                86,
                "高精度解析完成",
                force=True,
            )


        # ---------------------------------
        # 3d. Cache the final tier (if freshly parsed)
        # ---------------------------------

        if (
            not cache_hit
            and actual_tier == TIER_STANDARD
        ):

            _store_cache(
                owner,
                source_sha256,
                TIER_STANDARD,
                parsed_dir,
                {"passed": True, "metrics": {}},
            )


        # ---------------------------------
        # Deleted while MinerU was running
        # ---------------------------------

        if _is_contract_deleted(
            contract_id
        ):

            print(
                "[contract-worker] "
                "deleted after parsing",
                flush=True,
            )


            cleanup_deleted_contract(
                contract
            )


            return True


        # ---------------------------------
        # 3e. Critical Integrity Gate (final selected artifact)
        # ---------------------------------
        #
        # Standard is NOT ground truth: whatever artifact was
        # finally selected (Basic for FAST/passing AUTO, Standard
        # for ACCURATE/fallback) is re-evaluated with the CURRENT
        # rules here. Nothing is reused from an earlier run.

        final_integrity_start = time.monotonic()

        final_integrity = evaluate_critical_integrity(
            markdown_path=
                result["output_path"],

            middle_json_path=
                result.get(
                    "middle_json_path"
                ),

            original_name=
                original_name,
        )

        cross_tier_findings = []

        if (
            basic_integrity is not None
            and actual_tier == TIER_STANDARD
        ):

            cross_tier_findings = (
                compare_critical_observations(
                    basic_integrity,
                    final_integrity,
                )
            )

        metrics["finalCriticalIntegrityMs"] = elapsed_ms(
            final_integrity_start
        )

        # A Basic critical failure that the Standard re-parse
        # resolved is a successful repair, not a user issue.
        recovered_reason_codes = []

        if (
            basic_integrity is not None
            and basic_integrity.get("requiresStandard")
            and not final_integrity["requiresStandard"]
        ):

            recovered_reason_codes = list(
                basic_integrity["metrics"]["reasonCodes"]
            )

        _write_integrity_artifact(
            parsed_dir=parsed_dir,
            mode=mode,
            final_tier=actual_tier,
            final_integrity=final_integrity,
            cross_tier_findings=cross_tier_findings,
            basic_integrity=basic_integrity,
            recovered_reason_codes=recovered_reason_codes,
        )

        metrics["criticalIntegrity"] = {
            "profileVersion":
                CRITICAL_INTEGRITY_PROFILE_VERSION,

            "finalTier":
                actual_tier,

            "findingCount":
                final_integrity["metrics"]["findingCount"],

            "criticalCount":
                final_integrity["metrics"]["criticalCount"],

            "reviewCount":
                final_integrity["metrics"]["reviewCount"],

            "crossTierCount":
                len(cross_tier_findings),

            "reasonCodes":
                list(
                    final_integrity["metrics"]["reasonCodes"]
                ),
        }

        critical_issues = (
            build_critical_review_issues(
                final_integrity,
                cross_tier_findings,
            )
        )


        # ---------------------------------
        # 4. Review artifacts (never cached)
        # ---------------------------------

        reporter.update(
            88,
            "正在生成校对文件",
            force=True,
        )

        artifact_start = time.monotonic()

        review_result = (
            prepare_review_artifacts(
                result[
                    "output_path"
                ],

                original_name=
                    original_name,

                middle_json_path=
                    result.get(
                        "middle_json_path"
                    ),

                critical_issues=
                    critical_issues,
            )
        )


        consistency_result = (
            build_consistency_artifacts(
                raw_markdown_path=
                    result[
                        "output_path"
                    ],

                original_name=
                    _contract_original_name(
                        contract
                    ),

                middle_json_path=
                    result.get(
                        "middle_json_path"
                    ),
            )
        )

        metrics["reviewArtifactMs"] = elapsed_ms(
            artifact_start
        )


        print(
            "[contract-worker] fields:",
            consistency_result[
                "fields_path"
            ],
            flush=True,
        )


        print(
            "[contract-worker] "
            "consistency issues:",
            consistency_result[
                "consistency_issue_count"
            ],
            flush=True,
        )


        # ---------------------------------
        # Deleted during artifact generation
        # ---------------------------------

        if _is_contract_deleted(
            contract_id
        ):

            print(
                "[contract-worker] "
                "deleted after artifact generation",
                flush=True,
            )


            cleanup_deleted_contract(
                contract
            )


            return True


        # ---------------------------------
        # 5. Persist parse metadata
        # ---------------------------------

        parsed_pages = _count_middle_pages(
            result.get(
                "middle_json_path"
            )
        )

        # MinerU's parsed page count is observation-only metadata.
        # contracts.page_count is permanently the SOURCE PDF page
        # count (set at upload by pdf-meta.js) and is NEVER
        # overwritten here, so a future retry / reprocess keeps a
        # reliable Quality Gate input.
        metrics["parsedPageCount"] = parsed_pages

        metrics["totalWorkerMs"] = elapsed_ms(
            worker_start
        )

        metrics["qualityGate"] = (
            quality_result
            if quality_result is not None
            else {
                "passed": None,
                "reasons": [],
                "metrics": {},
            }
        )

        try:

            database.update_parse_metadata(
                contract_id,

                parse_mode_requested=
                    mode,

                parse_tier_actual=
                    actual_tier,

                parse_cache_hit=
                    bool(cache_hit),

                parse_fallback_used=
                    bool(fallback_used),

                parse_fallback_reason=
                    fallback_reason_value,

                source_sha256=
                    (
                        source_sha256
                        or None
                    ),

                parse_metrics=
                    metrics,
            )

        except Exception as error:

            print(
                "[contract-worker] metadata update failed:",
                error,
                flush=True,
            )


        # ---------------------------------
        # Ready for human review
        # ---------------------------------

        _update_contract_state(
            contract_id,
            status=
                "processing",
            stage=
                "reviewing",
            progress=
                90,
            error_message=
                None,
        )

        reporter.update(
            90,
            "等待人工校对",
            stage="reviewing",
            status="processing",
            force=True,
        )


        output_path = Path(
            result[
                "output_path"
            ]
        )


        output_size = (
            result.get(
                "output_size"
            )
        )


        if (
            output_size is None
            and
            output_path.is_file()
        ):

            output_size = (
                output_path
                .stat()
                .st_size
            )


        print(
            "[contract-worker] MinerU completed",
            flush=True,
        )


        print(
            "document:",
            output_path,
            flush=True,
        )


        print(
            "document bytes:",
            output_size,
            flush=True,
        )


        print(
            "review artifacts:",
            review_result,
            flush=True,
        )


        print(
            "status: processing",
            flush=True,
        )


        print(
            "stage: reviewing",
            flush=True,
        )


        print(
            "progress: 90",
            flush=True,
        )


        # Best-effort lazy cache prune. Never blocks the main flow.
        try:
            parse_cache.prune_expired()
        except Exception:
            pass


        return True


    except Exception as error:

        # If the user deleted the contract while
        # another error happened, deletion wins.

        if _is_contract_deleted(
            contract_id
        ):

            try:

                cleanup_deleted_contract(
                    contract
                )


            except Exception as cleanup_error:

                print(
                    "[contract-worker] "
                    "cleanup after delete failed:",
                    cleanup_error,
                    flush=True,
                )


            return False


        print(
            "[contract-worker] FAILED",
            flush=True,
        )


        print(
            str(
                error
            ),
            flush=True,
        )


        try:

            _update_contract_state(
                contract_id,
                status=
                    "failed",
                stage=
                    "failed",
                progress=
                    10,
                error_message=
                    str(
                        error
                    ),
            )


        except Exception as update_error:

            print(
                "[contract-worker] "
                "failed to record error:",
                update_error,
                flush=True,
            )


        return False


def run_once():

    print(
        "[contract-worker] "
        "looking for queued contract...",
        flush=True,
    )


    with _worker_lock_context():

        contract = (
            _claim_next_contract()
        )


    if not contract:

        print(
            "[contract-worker] "
            "no queued contract",
            flush=True,
        )


        return True


    return process_contract(
        contract
    )


def main():

    try:

        success = (
            run_once()
        )


    except Exception as error:

        print(
            "[contract-worker] fatal error:",
            error,
            flush=True,
        )


        return 1


    return (
        0
        if success
        else 1
    )


if __name__ == "__main__":

    sys.exit(
        main()
    )
