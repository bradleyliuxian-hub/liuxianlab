import os
import shutil
import subprocess
import zipfile
from pathlib import Path

from .database import PROJECT_ROOT


MINERU_BIN = (
    PROJECT_ROOT
    / ".mineru"
    / "bin"
    / "mineru-kit"
)


CONTRACT_STORAGE_ROOT = (
    PROJECT_ROOT
    / "storage"
    / "contracts"
).resolve()



# LIUXIANLAB_MINERU_PRODUCTION_ENV_V1
#
# Production contract parsing must stay on the
# CPU-friendly ONNX + llama.cpp path.
#
# Do not rely on PM2 / Node / interactive shell
# environment propagation for these critical values.
os.environ["MINERU_MODEL_SOURCE"] = "local"
os.environ["MINERU_MODEL_SMALL_BACKEND"] = "onnx"
os.environ["MINERU_MODEL_VLM_ENGINE"] = "llama-cpp"

def _find_export_file(
    root: Path,
    filename: str,
):
    """
    Find one MinerU export file inside the
    extracted ZIP.

    MinerU normally writes files such as:

        markdown.md
        middle_json.json
        structured_content.json

    Keep this recursive so minor ZIP layout
    changes do not break our application.
    """

    matches = list(
        root.rglob(
            filename
        )
    )

    if not matches:
        return None

    return matches[0]


def _copy_export(
    source: Path,
    destination: Path,
):
    destination.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    shutil.copy2(
        source,
        destination,
    )


def parse_contract(contract):
    """
    Parse one contract with MinerU.

    One MinerU pass produces a ZIP export containing:
    - markdown.md
    - middle_json.json
    - structured_content.json
    - images/

    Stable application filenames are then created under:
        parsed/document.raw.md
        parsed/document.middle.json
        parsed/document.structured.json
    """

    if not MINERU_BIN.is_file():
        raise RuntimeError(
            f"MinerU executable not found: {MINERU_BIN}"
        )


    source_path = (
        PROJECT_ROOT
        / contract["file_path"]
    ).resolve()


    if not source_path.is_file():
        raise RuntimeError(
            f"Source file does not exist: {source_path}"
        )


    if (
        source_path != CONTRACT_STORAGE_ROOT
        and CONTRACT_STORAGE_ROOT
        not in source_path.parents
    ):
        raise RuntimeError(
            "Contract source path is outside storage/contracts"
        )


    job_dir = (
        source_path.parent
    )


    parsed_dir = (
        job_dir
        / "parsed"
    )


    parsed_dir.mkdir(
        parents=True,
        exist_ok=True,
    )


    # Stable application output paths.
    markdown_path = (
        parsed_dir
        / "document.raw.md"
    )


    middle_json_path = (
        parsed_dir
        / "document.middle.json"
    )


    structured_json_path = (
        parsed_dir
        / "document.structured.json"
    )


    # Raw MinerU export package.
    zip_path = (
        parsed_dir
        / "mineru-output.zip"
    )


    extracted_dir = (
        parsed_dir
        / "mineru-export"
    )


    log_path = (
        parsed_dir
        / "mineru.log"
    )


    # Clean artifacts from a previous parse attempt.
    for path in (
        markdown_path,
        middle_json_path,
        structured_json_path,
        zip_path,
    ):

        if path.exists():
            path.unlink()


    if extracted_dir.exists():

        shutil.rmtree(
            extracted_dir
        )


    extracted_dir.mkdir(
        parents=True,
        exist_ok=True,
    )


    env = os.environ.copy()


    # Models were already downloaded from ModelScope.
    # Parsing itself must use local models only.
    env[
        "MINERU_MODEL_SOURCE"
    ] = "local"


    command = [
        str(MINERU_BIN),

        "parse",

        str(source_path),

        "-o",
        str(zip_path),

        "--format",
        "zip",

        "--tier",
        "standard",
    ]


    print(
        "[mineru] source:",
        source_path,
        flush=True,
    )


    print(
        "[mineru] zip:",
        zip_path,
        flush=True,
    )


    print(
        "[mineru] log:",
        log_path,
        flush=True,
    )


    with log_path.open(
        "w",
        encoding="utf-8",
    ) as log_file:

        result = subprocess.run(
            command,
            cwd=str(
                PROJECT_ROOT
            ),
            env=env,
            stdout=log_file,
            stderr=subprocess.STDOUT,
            text=True,
            check=False,
        )


    if result.returncode != 0:

        error_tail = ""

        try:

            error_tail = (
                log_path.read_text(
                    encoding="utf-8",
                    errors="replace",
                )[-3000:]
            )

        except Exception:
            pass


        raise RuntimeError(
            "MinerU failed with exit code "
            f"{result.returncode}\n"
            f"{error_tail}"
        )


    if not zip_path.is_file():

        raise RuntimeError(
            "MinerU finished but mineru-output.zip "
            "was not created"
        )


    if zip_path.stat().st_size <= 0:

        raise RuntimeError(
            "MinerU created an empty ZIP export"
        )


    try:

        with zipfile.ZipFile(
            zip_path,
            "r",
        ) as archive:

            archive.extractall(
                extracted_dir
            )


    except zipfile.BadZipFile as error:

        raise RuntimeError(
            "MinerU produced an invalid ZIP export"
        ) from error


    mineru_markdown = (
        _find_export_file(
            extracted_dir,
            "markdown.md",
        )
    )


    mineru_middle_json = (
        _find_export_file(
            extracted_dir,
            "middle_json.json",
        )
    )


    mineru_structured_json = (
        _find_export_file(
            extracted_dir,
            "structured_content.json",
        )
    )


    if mineru_markdown is None:

        raise RuntimeError(
            "MinerU ZIP does not contain markdown.md"
        )


    if mineru_middle_json is None:

        raise RuntimeError(
            "MinerU ZIP does not contain middle_json.json"
        )


    _copy_export(
        mineru_markdown,
        markdown_path,
    )


    _copy_export(
        mineru_middle_json,
        middle_json_path,
    )


    if (
        mineru_structured_json
        is not None
    ):

        _copy_export(
            mineru_structured_json,
            structured_json_path,
        )


    if not markdown_path.is_file():

        raise RuntimeError(
            "document.raw.md was not created"
        )


    if not middle_json_path.is_file():

        raise RuntimeError(
            "document.middle.json was not created"
        )


    markdown_size = (
        markdown_path
        .stat()
        .st_size
    )


    middle_json_size = (
        middle_json_path
        .stat()
        .st_size
    )


    if markdown_size <= 0:

        raise RuntimeError(
            "MinerU created an empty document.raw.md"
        )


    if middle_json_size <= 0:

        raise RuntimeError(
            "MinerU created an empty document.middle.json"
        )


    print(
        "[mineru] markdown:",
        markdown_path,
        flush=True,
    )


    print(
        "[mineru] middle json:",
        middle_json_path,
        flush=True,
    )


    return {
        "source_path":
            str(
                source_path
            ),

        # Keep this key for the existing Worker /
        # review_artifacts integration.
        "output_path":
            str(
                markdown_path
            ),

        "markdown_path":
            str(
                markdown_path
            ),

        "middle_json_path":
            str(
                middle_json_path
            ),

        "structured_json_path":
            (
                str(
                    structured_json_path
                )
                if structured_json_path.is_file()
                else None
            ),

        "zip_path":
            str(
                zip_path
            ),

        "export_dir":
            str(
                extracted_dir
            ),

        "log_path":
            str(
                log_path
            ),

        "output_size":
            markdown_size,

        "middle_json_size":
            middle_json_size,
    }
