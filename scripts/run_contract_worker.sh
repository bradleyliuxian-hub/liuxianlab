#!/usr/bin/env bash

set -euo pipefail

ROOT="$(
  cd "$(
    dirname "${BASH_SOURCE[0]}"
  )/.."
  pwd
)"

cd "$ROOT"

mkdir -p logs

exec /usr/bin/nice \
  -n 10 \
  "$ROOT/.mineru/bin/python" \
  -m services.contract_review.worker \
  >> "$ROOT/logs/contract-worker.log" \
  2>&1
