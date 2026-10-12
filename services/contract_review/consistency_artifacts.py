import json
from datetime import datetime, timezone
from pathlib import Path

from .consistency_checker import (
    analyze_contract_consistency,
)

from .issue_locator import (
    locate_issues,
)


def _utc_now():
    return (
        datetime.now(
            timezone.utc
        ).isoformat()
    )


def _issue_key(
    issue,
):
    """
    Prevent duplicate consistency issues if this
    artifact-building step is run more than once.
    """

    return (
        str(
            issue.get(
                "type",
                ""
            )
        ),
        str(
            issue.get(
                "title",
                ""
            )
        ),
        str(
            issue.get(
                "sourceText",
                ""
            )
        ),
        str(
            issue.get(
                "page",
                ""
            )
        ),
    )


def _read_issues_document(
    issues_path,
):
    if not issues_path.is_file():

        return {
            "version": 4,
            "status":
                "reviewed",
            "issues": [],
        }


    try:

        data = json.loads(
            issues_path.read_text(
                encoding="utf-8"
            )
        )


        if not isinstance(
            data,
            dict,
        ):

            raise ValueError(
                "issues.json root must be an object"
            )


        if not isinstance(
            data.get(
                "issues"
            ),
            list,
        ):

            data[
                "issues"
            ] = []


        return data


    except Exception as error:

        raise RuntimeError(
            f"Cannot read issues.json: {error}"
        ) from error


def build_consistency_artifacts(
    *,
    raw_markdown_path,
    original_name,
    middle_json_path=None,
):
    """
    Generate:
        parsed/document.fields.json

    Append only actual consistency problems to:
        parsed/issues.json

    Existing issue resolution state is preserved.
    """

    raw_markdown_path = Path(
        raw_markdown_path
    )


    parsed_dir = (
        raw_markdown_path.parent
    )


    draft_path = (
        parsed_dir
        / "document.draft.md"
    )


    fields_path = (
        parsed_dir
        / "document.fields.json"
    )


    issues_path = (
        parsed_dir
        / "issues.json"
    )


    if not draft_path.is_file():

        raise RuntimeError(
            f"Draft Markdown does not exist: {draft_path}"
        )


    draft_text = (
        draft_path.read_text(
            encoding="utf-8"
        )
    )


    if not draft_text.strip():

        raise RuntimeError(
            "Draft Markdown is empty"
        )


    middle_path = None


    if middle_json_path:

        candidate = Path(
            middle_json_path
        )

        if candidate.is_file():

            middle_path = (
                candidate
            )


    result = (
        analyze_contract_consistency(
            markdown_text=
                draft_text,

            original_name=
                original_name,

            middle_json_path=
                middle_path,
        )
    )


    consistency_issues = list(
        result.get(
            "issues",
            []
        )
    )


    # Give text-based consistency issues a chance
    # to acquire page/bbox from MiddleJson.
    if (
        middle_path
        and consistency_issues
    ):

        consistency_issues = (
            locate_issues(
                consistency_issues,
                middle_path,
            )
        )


    generated_at = (
        _utc_now()
    )


    fields_document = {
        "version": 1,

        "generatedAt":
            generated_at,

        "source":
            "deterministic",

        "originalName":
            original_name,

        "fields":
            result.get(
                "fields",
                {}
            ),

        "tableChecks":
            result.get(
                "tableChecks",
                []
            ),

        "consistencyIssueCount":
            len(
                consistency_issues
            ),
    }


    fields_path.write_text(
        json.dumps(
            fields_document,
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )


    issues_document = (
        _read_issues_document(
            issues_path
        )
    )


    existing_issues = list(
        issues_document.get(
            "issues",
            []
        )
    )


    existing_keys = {
        _issue_key(
            issue
        )
        for issue
        in existing_issues
    }


    added = []


    for issue in consistency_issues:

        key = _issue_key(
            issue
        )


        if key in existing_keys:
            continue


        existing_issues.append(
            issue
        )

        existing_keys.add(
            key
        )

        added.append(
            issue
        )


    unresolved_count = sum(
        1
        for issue
        in existing_issues
        if issue.get(
            "status"
        )
        != "resolved"
    )


    issues_document[
        "version"
    ] = max(
        int(
            issues_document.get(
                "version",
                1,
            )
        ),
        4,
    )


    issues_document[
        "issues"
    ] = (
        existing_issues
    )


    issues_document[
        "status"
    ] = (
        "pending_review"
        if unresolved_count > 0
        else "reviewed"
    )


    issues_document[
        "updatedAt"
    ] = (
        generated_at
    )


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
        "fields_path":
            str(
                fields_path
            ),

        "issues_path":
            str(
                issues_path
            ),

        "field_data":
            fields_document,

        "consistency_issue_count":
            len(
                consistency_issues
            ),

        "added_issue_count":
            len(
                added
            ),

        "total_issue_count":
            len(
                existing_issues
            ),

        "unresolved_issue_count":
            unresolved_count,
    }
