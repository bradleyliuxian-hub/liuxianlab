#!/bin/bash

set -u

PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

cd "$PROJECT_ROOT" || exit 1

if [ ! -f ".env" ]; then
  echo "ERROR: .env not found"
  exit 1
fi

DATABASE_URL="$(
  grep '^DATABASE_URL=' .env \
  | cut -d= -f2-
)"

if [ -z "$DATABASE_URL" ]; then
  echo "ERROR: DATABASE_URL not found"
  exit 1
fi

CONTRACT_ID="$(
  psql "$DATABASE_URL" -tAc "
    SELECT id
    FROM contracts
    WHERE deleted_at IS NULL
    ORDER BY created_at DESC
    LIMIT 1;
  "
)"

if [ -z "$CONTRACT_ID" ]; then
  echo "ERROR: no contract found"
  exit 1
fi

export CONTRACT_ID

echo
echo "============================================================"
echo "LATEST CONTRACT"
echo "============================================================"
echo

psql "$DATABASE_URL" -x -c "
SELECT
    id,
    owner_username,
    original_name,
    status,
    stage,
    progress,
    size_bytes,
    created_at,
    updated_at
FROM contracts
WHERE id = '$CONTRACT_ID';
"

ROOT="storage/contracts/$CONTRACT_ID"

echo
echo "============================================================"
echo "FILES"
echo "============================================================"
echo

check_file() {
  FILE="$1"

  if [ -f "$FILE" ]; then
    BYTES="$(wc -c < "$FILE" | tr -d ' ')"

    echo "OK      $BYTES bytes"
    echo "        $FILE"
  else
    echo "MISSING $FILE"
  fi
}

check_file "$ROOT/source.pdf"
check_file "$ROOT/parsed/document.raw.md"
check_file "$ROOT/parsed/document.draft.md"
check_file "$ROOT/parsed/document.middle.json"
check_file "$ROOT/parsed/document.structured.json"
check_file "$ROOT/parsed/document.fields.json"
check_file "$ROOT/parsed/issues.json"
check_file "$ROOT/final/document.md"

echo
echo "============================================================"
echo "ISSUES"
echo "============================================================"
echo

python3 - <<'PY'
import json
import os
from collections import Counter
from pathlib import Path

root = (
    Path("storage/contracts")
    / os.environ["CONTRACT_ID"]
)

path = (
    root
    / "parsed"
    / "issues.json"
)

if not path.is_file():
    print("issues.json: MISSING")
    raise SystemExit(0)

data = json.loads(
    path.read_text(
        encoding="utf-8"
    )
)

issues = data.get(
    "issues",
    []
)

open_issues = [
    issue
    for issue in issues
    if issue.get("status") != "resolved"
]

resolved = [
    issue
    for issue in issues
    if issue.get("status") == "resolved"
]

print("TOTAL:   ", len(issues))
print("OPEN:    ", len(open_issues))
print("RESOLVED:", len(resolved))

print()
print("TYPES:")

counter = Counter(
    issue.get(
        "type",
        "unknown"
    )
    for issue in issues
)

for name, count in counter.most_common():
    print(
        f"  {count:3d}  {name}"
    )

if open_issues:
    print()
    print("OPEN ISSUES:")

    for issue in open_issues:
        print(
            " -",
            issue.get("title"),
            "| page:",
            issue.get("page"),
            "| source:",
            repr(
                issue.get(
                    "sourceText"
                )
            )[:120]
        )
PY

echo
echo "============================================================"
echo "FIELDS"
echo "============================================================"
echo

python3 - <<'PY'
import json
import os
from pathlib import Path

path = (
    Path("storage/contracts")
    / os.environ["CONTRACT_ID"]
    / "parsed"
    / "document.fields.json"
)

if not path.is_file():
    print("document.fields.json: MISSING")
    raise SystemExit(0)

data = json.loads(
    path.read_text(
        encoding="utf-8"
    )
)

fields = data.get(
    "fields",
    {}
)

print(
    "contractNumbers:",
    fields.get(
        "contractNumbers"
    )
)

print(
    "partyA:",
    fields.get(
        "partyA"
    )
)

print(
    "partyB:",
    fields.get(
        "partyB"
    )
)

print(
    "filenameDate:",
    fields.get(
        "filenameDate"
    )
)

print(
    "labeledDates:",
    fields.get(
        "labeledDates"
    )
)

print()
print("TABLE CHECKS:")

for check in data.get(
    "tableChecks",
    []
):
    print(
        " page",
        check.get("page"),
        "|",
        check.get("quantity"),
        "x",
        check.get("years"),
        "x",
        check.get("unitPrice"),
        "=",
        check.get("expectedTotal"),
        "| document:",
        check.get("documentTotal"),
        "| passed:",
        check.get("passed"),
    )
PY

echo
echo "============================================================"
echo "FINAL CONSISTENCY"
echo "============================================================"
echo

DRAFT="$ROOT/parsed/document.draft.md"
FINAL="$ROOT/final/document.md"

if [ -f "$DRAFT" ] && [ -f "$FINAL" ]; then

  if cmp -s "$DRAFT" "$FINAL"; then
    echo "PASS: draft.md == final/document.md"
  else
    echo "FAIL: draft.md != final/document.md"
  fi

  echo

  shasum -a 256 \
    "$DRAFT" \
    "$FINAL"

else
  echo "Final Markdown has not been generated yet."
fi

echo
echo "============================================================"
echo "CHECK COMPLETE"
echo "============================================================"
