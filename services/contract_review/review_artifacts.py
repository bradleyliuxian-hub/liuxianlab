import json
import re
from datetime import datetime, timezone
from pathlib import Path


from .issue_detector import (
    detect_issues,
    detect_middle_json_issues,
)

from .issue_locator import (
    locate_issues,
)

def clean_markdown(
    text: str,
) -> str:
    """
    Prepare MinerU Markdown for human review.

    Important:
    - Do NOT silently correct OCR text.
    - Do NOT change contract meaning.
    - Only remove presentation noise.
    """

    result = text


    # Remove MinerU seal detail blocks.
    result = re.sub(
        r"<details[^>]*>\s*"
        r"<summary>\s*seal\s*</summary>"
        r".*?</details>",
        "",
        result,
        flags=(
            re.IGNORECASE
            | re.DOTALL
        ),
    )


    # Remove Markdown images whose contents are
    # embedded directly as base64 data.
    result = re.sub(
        r"!\[[^\]]*\]"
        r"\("
        r"data:image/[^)]*"
        r"\)",
        "",
        result,
        flags=re.DOTALL,
    )


    # Remove HTML image tags containing base64.
    result = re.sub(
        r"<img\b[^>]*"
        r"src=[\"']"
        r"data:image/[^\"']+"
        r"[\"'][^>]*>",
        "",
        result,
        flags=(
            re.IGNORECASE
            | re.DOTALL
        ),
    )


    # MinerU sometimes emits percentages as:
    #
    #     $13\%$
    #
    # Convert presentation markup only.
    result = re.sub(
        r"\$"
        r"(\d+(?:\.\d+)?)"
        r"\\%"
        r"\$",
        r"\1%",
        result,
    )


    # Remove trailing whitespace.
    result = "\n".join(
        line.rstrip()
        for line in result.splitlines()
    )


    # Keep a maximum of two blank lines.
    result = re.sub(
        r"\n{3,}",
        "\n\n",
        result,
    )


    return (
        result.strip()
        + "\n"
    )


def prepare_review_artifacts(
    raw_markdown_path,
    *,
    original_name="contract.pdf",
    middle_json_path=None,
):
    raw_path = Path(
        raw_markdown_path
    ).resolve()


    if not raw_path.is_file():
        raise RuntimeError(
            "Raw Markdown does not exist: "
            f"{raw_path}"
        )


    raw_text = raw_path.read_text(
        encoding="utf-8",
        errors="replace",
    )


    if not raw_text.strip():
        raise RuntimeError(
            "Raw Markdown is empty"
        )


    parsed_dir = (
        raw_path.parent
    )


    draft_path = (
        parsed_dir
        / "document.draft.md"
    )


    issues_path = (
        parsed_dir
        / "issues.json"
    )


    draft_text = clean_markdown(
        raw_text
    )


    if not draft_text.strip():
        raise RuntimeError(
            "Draft Markdown became empty"
        )


    draft_path.write_text(
        draft_text,
        encoding="utf-8",
    )


    detected_issues = (
        detect_issues(
            markdown_text=
                draft_text,

            original_name=
                original_name,
        )
    )


    if middle_json_path:

        structural_issues = (
            detect_middle_json_issues(
                middle_json_path
            )
        )


        detected_issues.extend(
            structural_issues
        )


        detected_issues = (
            locate_issues(
                detected_issues,
                middle_json_path,
            )
        )


    issues_document = {
        "version": 1,

        "status":
            (
                "pending_review"
                if detected_issues
                else "reviewed"
            ),

        "generatedAt":
            datetime.now(
                timezone.utc
            ).isoformat(),

        "issues":
            detected_issues,
    }


    issues_path.write_text(
        json.dumps(
            issues_document,
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )


    return {
        "raw_path":
            str(raw_path),

        "draft_path":
            str(draft_path),

        "issues_path":
            str(issues_path),

        "raw_bytes":
            raw_path.stat().st_size,

        "draft_bytes":
            draft_path.stat().st_size,

        "issue_count":
            len(
                detected_issues
            ),
    }
