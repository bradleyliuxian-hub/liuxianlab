#!/bin/bash

set -u

PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
OUTPUT="$HOME/Desktop/liuxianlab-contract-review-context-$TIMESTAMP.txt"

cd "$PROJECT_ROOT" || exit 1

FILES=(
  "server.js"

  "server/contracts/routes.js"
  "server/contracts/repository.js"
  "server/contracts/db.js"
  "server/contracts/review-store.js"
  "server/contracts/parse-runner.js"

  "private/tools/contract-review/index.html"
  "private/tools/contract-review/script.js"
  "private/tools/contract-review/review.html"
  "private/tools/contract-review/review.js"
  "private/tools/contract-review/review-issues.js"
  "private/tools/contract-review/review-fields.js"

  "services/contract_review/database.py"
  "services/contract_review/mineru_service.py"
  "services/contract_review/mineru_api_client.py"
  "services/contract_review/credential_store.py"
  "services/contract_review/parse_profile.py"
  "services/contract_review/parse_cache.py"
  "services/contract_review/worker.py"
  "services/contract_review/review_artifacts.py"
  "services/contract_review/consistency_artifacts.py"
  "services/contract_review/consistency_checker.py"
  "services/contract_review/issue_detector.py"
  "services/contract_review/issue_locator.py"
)

{
  echo "============================================================"
  echo "LIUXIAN LAB - CONTRACT REVIEW DEVELOPMENT CONTEXT"
  echo "============================================================"
  echo

  echo "Generated:"
  date
  echo

  echo "Project:"
  echo "$PROJECT_ROOT"
  echo

  echo "============================================================"
  echo "GIT STATUS"
  echo "============================================================"
  git status --short 2>&1 || true
  echo

  echo "============================================================"
  echo "CURRENT BRANCH / COMMIT"
  echo "============================================================"
  git branch --show-current 2>&1 || true
  git rev-parse HEAD 2>&1 || true
  echo

  echo "============================================================"
  echo "RUNTIME VERSIONS"
  echo "============================================================"
  node --version 2>&1 || true
  python --version 2>&1 || true
  echo

  echo "============================================================"
  echo "CONTRACT ROUTE SUMMARY"
  echo "============================================================"
  grep -nE \
    'router\.(get|post|put|patch|delete)|/:id/(draft|final|finalize|issues|fields|result)|issues/:|result\.md' \
    server/contracts/routes.js \
    2>&1 || true
  echo

  echo "============================================================"
  echo "FRONTEND REVIEW ACTION SUMMARY"
  echo "============================================================"
  grep -nE \
    'saveDraft|finalize|applySuggestion|resolveIssue|locateIssue|ContractReviewIssues|ContractReviewDraft|fetch\(|dirty|resolved|resolution|result\.md' \
    private/tools/contract-review/review.js \
    private/tools/contract-review/review-issues.js \
    2>&1 || true
  echo

  echo "============================================================"
  echo "SYNTAX CHECKS"
  echo "============================================================"

  for file in \
    server.js \
    server/contracts/routes.js \
    server/contracts/repository.js \
    server/contracts/db.js \
    server/contracts/review-store.js \
    server/contracts/parse-runner.js \
    private/tools/contract-review/script.js \
    private/tools/contract-review/review.js \
    private/tools/contract-review/review-issues.js \
    private/tools/contract-review/review-fields.js
  do
    echo
    echo "--- node --check $file ---"

    if [ -f "$file" ]; then
      node --check "$file" 2>&1

      if [ $? -eq 0 ]; then
        echo "OK"
      fi
    else
      echo "MISSING"
    fi
  done

  echo

  for file in \
    services/contract_review/database.py \
    services/contract_review/mineru_service.py \
    services/contract_review/mineru_api_client.py \
    services/contract_review/credential_store.py \
    services/contract_review/parse_profile.py \
    services/contract_review/parse_cache.py \
    services/contract_review/worker.py \
    services/contract_review/review_artifacts.py \
    services/contract_review/consistency_artifacts.py \
    services/contract_review/consistency_checker.py \
    services/contract_review/issue_detector.py \
    services/contract_review/issue_locator.py
  do
    echo
    echo "--- python compile $file ---"

    if [ -f "$file" ]; then
      python -m py_compile "$file" 2>&1

      if [ $? -eq 0 ]; then
        echo "OK"
      fi
    else
      echo "MISSING"
    fi
  done

  echo
  echo "============================================================"
  echo "FULL SOURCE FILES"
  echo "============================================================"

  for file in "${FILES[@]}"
  do
    echo
    echo
    echo "################################################################"
    echo "FILE: $file"
    echo "################################################################"
    echo

    if [ -f "$file" ]; then
      nl -ba "$file"
    else
      echo "[MISSING FILE]"
    fi
  done

  echo
  echo
  echo "============================================================"
  echo "END OF CONTEXT"
  echo "============================================================"

} > "$OUTPUT"

echo
echo "Context file created:"
echo "$OUTPUT"
echo

wc -l "$OUTPUT"
wc -c "$OUTPUT"

echo
echo "Opening Finder..."
open -R "$OUTPUT"
