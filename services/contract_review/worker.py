import inspect
import shutil
import sys
from contextlib import nullcontext
from pathlib import Path

from . import database
from .consistency_artifacts import build_consistency_artifacts
from .mineru_service import parse_contract
from .review_artifacts import prepare_review_artifacts


PROJECT_ROOT = database.PROJECT_ROOT


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


        print(
            "[contract-worker] "
            "starting MinerU...",
            flush=True,
        )


        # ---------------------------------
        # MinerU
        # ---------------------------------

        result = parse_contract(
            contract
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
        # Review artifacts
        # ---------------------------------

        review_result = (
            prepare_review_artifacts(
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


        # ---------------------------------
        # Contract field / consistency data
        # ---------------------------------

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
