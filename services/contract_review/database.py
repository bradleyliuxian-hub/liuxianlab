import os
from contextlib import contextmanager
from pathlib import Path

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from dotenv import load_dotenv


PROJECT_ROOT = Path(__file__).resolve().parents[2]

load_dotenv(
    PROJECT_ROOT / ".env"
)


WORKER_LOCK_KEY = 527894221


def get_database_url():
    database_url = os.getenv(
        "DATABASE_URL"
    )

    if not database_url:
        raise RuntimeError(
            "DATABASE_URL is not configured"
        )

    return database_url


def connect():
    return psycopg.connect(
        get_database_url()
    )


@contextmanager
def contract_worker_lock():
    """
    Allow only one MinerU contract worker
    to run at the same time.
    """

    conn = connect()
    conn.autocommit = True

    locked = False

    try:

        with conn.cursor() as cur:

            cur.execute(
                """
                SELECT pg_try_advisory_lock(%s)
                """,
                (
                    WORKER_LOCK_KEY,
                ),
            )

            row = cur.fetchone()

            locked = bool(
                row[0]
            )

        yield locked

    finally:

        if locked:

            try:

                with conn.cursor() as cur:

                    cur.execute(
                        """
                        SELECT pg_advisory_unlock(%s)
                        """,
                        (
                            WORKER_LOCK_KEY,
                        ),
                    )

            except Exception:
                pass

        conn.close()


def ping_database():

    with connect() as conn:

        with conn.cursor() as cur:

            cur.execute(
                """
                SELECT
                    current_database(),
                    current_user,
                    NOW()
                """
            )

            row = cur.fetchone()

    return {
        "database": row[0],
        "user": row[1],
        "server_time": row[2],
    }


def count_contracts():

    with connect() as conn:

        with conn.cursor() as cur:

            cur.execute(
                """
                SELECT COUNT(*)
                FROM contracts
                """
            )

            row = cur.fetchone()

    return int(
        row[0]
    )


def claim_contract(
    contract_id
):
    """
    Atomically claim one specific queued contract.
    """

    with connect() as conn:

        with conn.cursor(
            row_factory=dict_row
        ) as cur:

            cur.execute(
                """
                UPDATE contracts

                SET
                    status = 'processing',
                    stage = 'parsing',
                    progress = 10,
                    error_message = NULL,
                    updated_at = NOW()

                WHERE
                    id = %s
                    AND status = 'queued'
                    AND stage = 'queued'
                    AND deleted_at IS NULL

                RETURNING
                    id,
                    owner_username,
                    original_name,
                    stored_name,
                    file_path,
                    size_bytes,
                    mime_type,
                    status,
                    stage,
                    progress,
                    page_count,
                    parse_mode_requested,
                    parse_tier_actual,
                    source_sha256,
                    progress_message,
                    created_at,
                    updated_at
                """,
                (
                    contract_id,
                ),
            )

            row = cur.fetchone()

    if row is None:
        return None

    return dict(
        row
    )


def claim_next_contract():
    """
    Atomically claim the oldest queued contract.
    """

    sql = """
        WITH next_job AS (

            SELECT id

            FROM contracts

            WHERE
                status = 'queued'
                AND stage = 'queued'
                AND deleted_at IS NULL

            ORDER BY created_at ASC

            FOR UPDATE SKIP LOCKED

            LIMIT 1
        )

        UPDATE contracts AS c

        SET
            status = 'processing',
            stage = 'parsing',
            progress = 10,
            error_message = NULL,
            updated_at = NOW()

        FROM next_job

        WHERE
            c.id = next_job.id

        RETURNING
            c.id,
            c.owner_username,
            c.original_name,
            c.stored_name,
            c.file_path,
            c.size_bytes,
            c.mime_type,
            c.status,
            c.stage,
            c.progress,
            c.page_count,
            c.parse_mode_requested,
            c.parse_tier_actual,
            c.source_sha256,
            c.progress_message,
            c.created_at,
            c.updated_at
    """

    with connect() as conn:

        with conn.cursor(
            row_factory=dict_row
        ) as cur:

            cur.execute(
                sql
            )

            row = cur.fetchone()

    if row is None:
        return None

    return dict(
        row
    )


def get_contract(
    contract_id
):

    with connect() as conn:

        with conn.cursor(
            row_factory=dict_row
        ) as cur:

            cur.execute(
                """
                SELECT
                    id,
                    owner_username,
                    original_name,
                    stored_name,
                    file_path,
                    size_bytes,
                    mime_type,
                    status,
                    stage,
                    progress,
                    error_message,
                    page_count,
                    parse_mode_requested,
                    parse_tier_actual,
                    parse_cache_hit,
                    parse_fallback_used,
                    parse_fallback_reason,
                    source_sha256,
                    progress_message,
                    parse_metrics,
                    created_at,
                    updated_at

                FROM contracts

                WHERE id = %s

                LIMIT 1
                """,
                (
                    contract_id,
                ),
            )

            row = cur.fetchone()

    if row is None:
        return None

    return dict(
        row
    )



def is_contract_deleted(
    contract_id
):

    with connect() as conn:

        with conn.cursor() as cur:

            cur.execute(
                """
                SELECT deleted_at
                FROM contracts
                WHERE id = %s
                LIMIT 1
                """,
                (
                    contract_id,
                ),
            )

            row = cur.fetchone()


    if row is None:
        return True


    return (
        row[0]
        is not None
    )


def delete_contract_row(
    contract_id
):

    with connect() as conn:

        with conn.cursor() as cur:

            cur.execute(
                """
                DELETE FROM contracts
                WHERE id = %s
                """,
                (
                    contract_id,
                ),
            )



def update_contract_state(
    contract_id,
    *,
    status,
    stage,
    progress,
    error_message=None,
):

    with connect() as conn:

        with conn.cursor(
            row_factory=dict_row
        ) as cur:

            cur.execute(
                """
                UPDATE contracts

                SET
                    status = %s,
                    stage = %s,
                    progress = %s,
                    error_message = %s,
                    updated_at = NOW()

                WHERE id = %s

                RETURNING
                    id,
                    owner_username,
                    original_name,
                    stored_name,
                    file_path,
                    status,
                    stage,
                    progress,
                    error_message,
                    created_at,
                    updated_at
                """,
                (
                    status,
                    stage,
                    progress,
                    error_message,
                    contract_id,
                ),
            )

            row = cur.fetchone()

    if row is None:
        raise RuntimeError(
            f"Contract not found: {contract_id}"
        )

    return dict(
        row
    )


def update_contract_progress(
    contract_id,
    *,
    progress,
    progress_message=None,
    stage=None,
    status=None,
):
    """
    Lightweight progress update used by the worker's
    ProgressReporter.

    Only progress (plus an optional non-technical message and
    stage/status) is written; parse metadata is left untouched.
    """

    with connect() as conn:

        with conn.cursor(
            row_factory=dict_row
        ) as cur:

            cur.execute(
                """
                UPDATE contracts

                SET
                    progress = %s,
                    progress_message =
                        COALESCE(%s, progress_message),
                    stage = COALESCE(%s, stage),
                    status = COALESCE(%s, status),
                    updated_at = NOW()

                WHERE id = %s

                RETURNING
                    progress,
                    progress_message,
                    stage,
                    status
                """,
                (
                    progress,
                    progress_message,
                    stage,
                    status,
                    contract_id,
                ),
            )

            row = cur.fetchone()

    if row is None:
        raise RuntimeError(
            f"Contract not found: {contract_id}"
        )

    return dict(
        row
    )


def update_parse_metadata(
    contract_id,
    *,
    parse_mode_requested=None,
    parse_tier_actual=None,
    parse_cache_hit=None,
    parse_fallback_used=None,
    parse_fallback_reason=None,
    source_sha256=None,
    page_count=None,
    parse_metrics=None,
):
    """
    Persist v1.1 parse metadata. Every argument is optional and
    applied with COALESCE, so callers can update a subset.
    """

    metrics_param = (
        Jsonb(parse_metrics)
        if parse_metrics is not None
        else None
    )

    with connect() as conn:

        with conn.cursor(
            row_factory=dict_row
        ) as cur:

            cur.execute(
                """
                UPDATE contracts

                SET
                    parse_mode_requested =
                        COALESCE(
                            %s,
                            parse_mode_requested
                        ),

                    parse_tier_actual =
                        COALESCE(
                            %s,
                            parse_tier_actual
                        ),

                    parse_cache_hit =
                        COALESCE(
                            %s,
                            parse_cache_hit
                        ),

                    parse_fallback_used =
                        COALESCE(
                            %s,
                            parse_fallback_used
                        ),

                    parse_fallback_reason =
                        COALESCE(
                            %s,
                            parse_fallback_reason
                        ),

                    source_sha256 =
                        COALESCE(
                            %s,
                            source_sha256
                        ),

                    page_count =
                        COALESCE(
                            %s,
                            page_count
                        ),

                    parse_metrics =
                        COALESCE(
                            %s,
                            parse_metrics
                        ),

                    updated_at = NOW()

                WHERE id = %s

                RETURNING id
                """,
                (
                    parse_mode_requested,
                    parse_tier_actual,
                    parse_cache_hit,
                    parse_fallback_used,
                    parse_fallback_reason,
                    source_sha256,
                    page_count,
                    metrics_param,
                    contract_id,
                ),
            )

            row = cur.fetchone()

    if row is None:
        raise RuntimeError(
            f"Contract not found: {contract_id}"
        )

    return True
