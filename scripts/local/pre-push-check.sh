#!/usr/bin/env bash
#
# Liuxian Lab — local pre-push / pre-deploy checker
#
# Purpose: catch the *code-level* problems that the production deployer
# (/usr/local/bin/deploy-liuxianlab.sh) would otherwise only discover AFTER a
# push has already reached GitHub — most importantly trailing whitespace and
# new-blank-line-at-EOF via `git diff --check`.
#
# Design rules (do NOT relax):
#   - read-only: never modifies code, never commits/pushes/deploys
#   - never deletes files, never git reset/clean/merge/rebase, never `git add .`
#   - no new npm / python dependencies; only bash + git + node + python
#   - stays consistent with the production deployer (same `git diff --check`)
#   - deliberately does NOT add subjective Markdown lint rules
#
# Usage:
#   scripts/local/pre-push-check.sh            # QUICK (default)
#   scripts/local/pre-push-check.sh --full     # QUICK + conditional regression tests
#   scripts/local/pre-push-check.sh --hook ...  # internal: invoked by .git/hooks/pre-push
#   scripts/local/pre-push-check.sh --range A..B  # explicit commit range (repeatable)
#
set -uo pipefail

MODE="quick"
HOOK_MODE=0
declare -a RANGES=()

while [ $# -gt 0 ]; do
  case "$1" in
    --full) MODE="full" ;;
    --quick) MODE="quick" ;;
    --hook) HOOK_MODE=1 ;;
    --range) shift; [ $# -gt 0 ] && RANGES+=("$1") ;;
    -h|--help)
      sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    -*)
      echo "pre-push-check: unknown option: $1" >&2; exit 2 ;;
    *)
      # Positional args come from Git's pre-push protocol (<remote-name> <remote-url>);
      # ignore them so the hook invocation never fails on argument parsing.
      : ;;
  esac
  shift
done

# ---------------------------------------------------------------------------
# Locate repo root & move there (never assume cwd).
# ---------------------------------------------------------------------------
ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "pre-push-check: not inside a git repository" >&2; exit 2; }
cd "$ROOT" || exit 2

# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------
FAILS=0
FAIL_REASONS=""
WARNINGS=0

banner() {
  printf '\n%s\n%s\n%s\n' \
    "==================================================" "$1" \
    "=================================================="
}
phase() {
  printf '\n%s\n' "--------------------------------------------------"
  printf '%s\n' "$1"
}
fail() { FAILS=$((FAILS + 1)); FAIL_REASONS="${FAIL_REASONS}${1}"$'\n'; }
warn() { WARNINGS=$((WARNINGS + 1)); printf '  WARN: %s\n' "$1"; }
ok()   { printf '  PASS\n'; }

have() { [ -x "$1" ] && return 0; command -v "$1" >/dev/null 2>&1; }

# Paths never checked / always excluded (build & vendor & runtime).
is_excluded_path() {
  case "$1" in
    */node_modules/*|node_modules/*) return 0 ;;
    */private/vendor/*|private/vendor/*) return 0 ;;
    */vendor/*|vendor/*) return 0 ;;
    */dist/*|dist/*|*/build/*|build/*) return 0 ;;
    */.venv/*|.venv/*|*/.mineru/*|.mineru/*) return 0 ;;
    */__pycache__/*|__pycache__/*) return 0 ;;
    *.min.js) return 0 ;;
  esac
  return 1
}

# ---------------------------------------------------------------------------
# 1. Git state
# ---------------------------------------------------------------------------
banner "LIUXIAN LAB PRE-PUSH CHECK"
printf 'Mode: %s\n' "$([ "$MODE" = full ] && echo FULL || echo QUICK)"
printf 'Repo: %s\n' "$ROOT"

phase "1. Git state"
BRANCH="$(git branch --show-current)"
HEAD_SHA="$(git rev-parse --short HEAD)"
printf '  branch : %s\n' "${BRANCH:-<detached>}"
printf '  HEAD   : %s %s\n' "$HEAD_SHA" "$(git log -1 --pretty=%s)"
if UPSTREAM="$(git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null)"; then
  printf '  upstream: %s\n' "$UPSTREAM"
else
  printf '  upstream: <none>\n'
fi
printf '  remote : %s\n' "$(git remote get-url origin 2>/dev/null || echo '<none>')"

# Unmerged / conflict detection.
UNMERGED="$(git diff --name-only --diff-filter=U 2>/dev/null)"
if [ -n "$UNMERGED" ]; then
  printf '%s\n' "$UNMERGED" | sed 's/^/    conflict: /'
  fail "Unmerged/conflicted files present (resolve the merge before pushing)."
  printf '  FAIL (merge conflicts)\n'
else
  ok
fi
# Report (but do not touch) dirty working tree.
DIRTY="$(git status --porcelain)"
if [ -n "$DIRTY" ]; then
  printf '  note: working tree not clean (%s entries) — reported only, not modified\n' \
    "$(printf '%s\n' "$DIRTY" | wc -l | tr -d ' ')"
fi

# ---------------------------------------------------------------------------
# Determine commit ranges to check
# ---------------------------------------------------------------------------
ZERO="0000000000000000000000000000000000000000"

resolve_default_base() {
  local base
  if base="$(git rev-parse --verify --quiet '@{upstream}')"; then
    printf '%s' "$base"; return 0
  fi
  if base="$(git rev-parse --verify --quiet 'origin/main')"; then
    printf '%s' "$base"; return 0
  fi
  if base="$(git rev-parse --verify --quiet 'origin/HEAD')"; then
    printf '%s' "$base"; return 0
  fi
  return 1
}

if [ "$HOOK_MODE" -eq 1 ] && [ ! -t 0 ]; then
  # Git pre-push protocol: "<local-ref> <local-sha> <remote-ref> <remote-sha>"
  while read -r l_ref l_sha r_ref r_sha; do
    [ -z "${l_sha:-}" ] && continue
    [ "$l_sha" = "$ZERO" ] && continue                    # local deletion — nothing to check
    if [ -z "${r_sha:-}" ] || [ "$r_sha" = "$ZERO" ]; then
      # New remote ref/branch: find a safe merge base, fall back to root commit.
      default_base="$(resolve_default_base || true)"
      base=""
      [ -n "$default_base" ] && base="$(git merge-base "$l_sha" "$default_base" 2>/dev/null || true)"
      [ -z "$base" ] && base="$(git rev-list --max-parents=0 "$l_sha" 2>/dev/null | tail -1)"
      [ -n "$base" ] && RANGES+=("$base..$l_sha")
      RANGE_DESC="${base:-?}..${l_sha} (new ref ${r_ref:-$l_ref})"
    else
      RANGES+=("$r_sha..$l_sha")
      RANGE_DESC="$r_sha..$l_sha"
    fi
  done
fi

if [ "${#RANGES[@]}" -eq 0 ]; then
  base="$(resolve_default_base || true)"
  if [ -n "$base" ]; then
    RANGES+=("$base..HEAD")
    RANGE_DESC="$base..HEAD"
    printf '  compare base: %s (%s)\n' "$RANGE_DESC" "$base"
  else
    RANGE_DESC="<none>"
    printf '  compare base: none resolved (no upstream, no origin/main)\n'
  fi
else
  printf '  compare base: %s\n' "$RANGE_DESC"
fi

# Deduplicate ranges.
if [ "${#RANGES[@]}" -gt 0 ]; then
  deduped="$(printf '%s\n' "${RANGES[@]}" | awk '!seen[$0]++')"
  RANGES=()
  while IFS= read -r r; do [ -n "$r" ] && RANGES+=("$r"); done <<< "$deduped"
fi

# ---------------------------------------------------------------------------
# Collect changed files (pushed range + staged + working tree)
# ---------------------------------------------------------------------------
changed_files() {
  {
    for r in "${RANGES[@]:-}"; do
      [ -n "$r" ] && git diff --name-only "$r" 2>/dev/null
    done
    git diff --name-only 2>/dev/null
    git diff --cached --name-only 2>/dev/null
  } | sort -u | grep -v '^$' || true
}
CHANGED="$(changed_files)"
CHANGED_COUNT="$(printf '%s\n' "$CHANGED" | grep -c . || true)"
printf '  changed files in scope: %s\n' "${CHANGED_COUNT:-0}"

# ---------------------------------------------------------------------------
# 2. Whitespace / git diff --check  (THE most important check)
# ---------------------------------------------------------------------------
phase "2. Whitespace (git diff --check — parity with production deployer)"
WS_OUT=""
WS_FAIL=0
for r in "${RANGES[@]:-}"; do
  [ -z "$r" ] && continue
  out="$(git diff --check "$r" 2>&1)"
  if [ -n "$out" ]; then WS_FAIL=1; WS_OUT="${WS_OUT}${out}"$'\n'; fi
done
# Uncommitted (unstaged) + staged whitespace problems.
if [ -n "$(git diff --name-only)" ]; then
  out="$(git diff --check 2>&1)"; [ -n "$out" ] && { WS_FAIL=1; WS_OUT="${WS_OUT}${out}"$'\n'; }
fi
if [ -n "$(git diff --cached --name-only)" ]; then
  out="$(git diff --cached --check 2>&1)"; [ -n "$out" ] && { WS_FAIL=1; WS_OUT="${WS_OUT}${out}"$'\n'; }
fi

if [ "$WS_FAIL" -eq 1 ]; then
  printf '%s\n' "$WS_OUT" | grep -v '^$' | sed 's/^/    /'
  fail "git diff --check failed (trailing whitespace / blank line at EOF)."
  printf '  FAIL\n'
else
  ok
fi

# ---------------------------------------------------------------------------
# 3. JavaScript syntax (changed files only)
# ---------------------------------------------------------------------------
phase "3. JavaScript syntax (node --check)"
JS_FAIL=0
JS_COUNT=0
if have node; then
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    case "$f" in *.js|*.mjs|*.cjs) ;; *) continue ;; esac
    is_excluded_path "$f" && continue
    [ -f "$f" ] || continue
    JS_COUNT=$((JS_COUNT + 1))
    if ! out="$(node --check "$f" 2>&1)"; then
      printf '    %s\n' "$f"
      printf '%s\n' "$out" | sed 's/^/      /'
      JS_FAIL=1
    fi
  done <<< "$CHANGED"
  printf '  checked %s file(s)\n' "$JS_COUNT"
  if [ "$JS_FAIL" -eq 1 ]; then
    fail "Node syntax error in changed JavaScript file(s)."; printf '  FAIL\n'; else ok; fi
else
  warn "node not found — JavaScript syntax check skipped."
fi

# ---------------------------------------------------------------------------
# 4. Python syntax (py_compile, no bytecode written into the repo)
# ---------------------------------------------------------------------------
phase "4. Python syntax (py_compile)"
PY_FAIL=0
PY_COUNT=0

pick_python() {
  local f="$1" c
  case "$f" in
    services/contract_review/*)
      for c in .mineru/bin/python .venv/bin/python python3; do have "$c" && { printf '%s' "$c"; return 0; }; done ;;
    services/excel_review/*)
      for c in .venv/bin/python python3; do have "$c" && { printf '%s' "$c"; return 0; }; done ;;
    *)
      for c in .venv/bin/python python3; do have "$c" && { printf '%s' "$c"; return 0; }; done ;;
  esac
  return 1
}

py_syntax_ok() {
  # py_compile to a throwaway temp file: validates without polluting __pycache__.
  "$1" -c 'import sys, py_compile, tempfile, os
src = sys.argv[1]
fd, out = tempfile.mkstemp(suffix=".pyc"); os.close(fd)
try:
    py_compile.compile(src, cfile=out, doraise=True)
finally:
    try: os.remove(out)
    except OSError: pass' "$2"
}

while IFS= read -r f; do
  [ -z "$f" ] && continue
  case "$f" in *.py) ;; *) continue ;; esac
  is_excluded_path "$f" && continue
  [ -f "$f" ] || continue
  PY_COUNT=$((PY_COUNT + 1))
  if py="$(pick_python "$f")"; then
    if ! out="$(py_syntax_ok "$py" "$f" 2>&1)"; then
      printf '    %s (via %s)\n' "$f" "$py"
      printf '%s\n' "$out" | sed 's/^/      /'
      PY_FAIL=1
    fi
  else
    printf '    %s\n' "$f"
    printf '      no usable Python interpreter found (.mineru/.venv/python3)\n'
    PY_FAIL=1
    fail "No Python interpreter available to check $f."
  fi
done <<< "$CHANGED"
printf '  checked %s file(s)\n' "$PY_COUNT"
if [ "$PY_FAIL" -eq 1 ]; then
  fail "Python syntax error in changed file(s)."; printf '  FAIL\n'; else ok; fi

# ---------------------------------------------------------------------------
# 5. Sensitive files
# ---------------------------------------------------------------------------
phase "5. Sensitive files"
SENS_FAIL=0
while IFS= read -r f; do
  [ -z "$f" ] && continue
  case "$f" in
    .env.example|*/.env.example) continue ;;                 # allowed
    .env|.env.*|*/.env|*/.env.*) SENS_FAIL=1; printf '    HIGH: %s\n' "$f" ;;
    storage/contracts/*|storage/contracts-cache/*) SENS_FAIL=1; printf '    HIGH: %s\n' "$f" ;;
    *.pem|*.key|*/*.pem|*/*.key) SENS_FAIL=1; printf '    HIGH: %s\n' "$f" ;;
    *.pdf|*/*.pdf)
      case "$f" in
        */tests/*|*/fixtures/*|tests/*) : ;;                 # test fixtures allowed
        *) SENS_FAIL=1; printf '    HIGH: %s (real PDF?)\n' "$f" ;;
      esac ;;
  esac
done <<< "$CHANGED"
if [ "$SENS_FAIL" -eq 1 ]; then
  fail "High-risk file(s) staged for push (secrets / runtime data / PDF / keys)."
  printf '  FAIL\n'
else
  ok
fi

# ---------------------------------------------------------------------------
# FULL mode — conditional regression tests
# ---------------------------------------------------------------------------
if [ "$MODE" = full ] && [ "$FAILS" -eq 0 ]; then
  phase "6. Regression tests (--full, conditional)"
  ran_any=0
  if printf '%s\n' "$CHANGED" | grep -Eq '^(services/contract_review/|server/contracts/|private/tools/contract-review/)'; then
    ran_any=1
    printf '  [contract-review] .mineru/bin/python -m unittest discover -s services/contract_review/tests\n'
    if [ -x .mineru/bin/python ]; then
      if .mineru/bin/python -m unittest discover -s services/contract_review/tests -t . ; then
        printf '  PASS\n'
      else
        fail "contract_review regression tests failed."; printf '  FAIL\n'
      fi
    else
      warn ".mineru/bin/python missing — contract_review tests skipped."
    fi

    if [ -d tests/contracts ]; then
      printf '  [contract-review] node --test tests/contracts/*.test.js\n'
      if have node; then
        if node --test tests/contracts/*.test.js ; then printf '  PASS\n';
        else fail "contract-review Node tests failed."; printf '  FAIL\n'; fi
      else
        warn "node missing — contract-review Node tests skipped."
      fi
    fi
  fi

  if printf '%s\n' "$CHANGED" | grep -Eq '^(tests/excel-decimal-check/|private/tools/excel-decimal-check/)'; then
    ran_any=1
    printf '  [excel-decimal-check] node --test tests/excel-decimal-check/*.test.js\n'
    if have node; then
      if node --test tests/excel-decimal-check/*.test.js ; then printf '  PASS\n';
      else fail "excel-decimal-check regression tests failed."; printf '  FAIL\n'; fi
    else
      warn "node missing — excel-decimal-check tests skipped."
    fi
  fi

  if printf '%s\n' "$CHANGED" | grep -Eq '^(services/excel_review/|server/excel-review/|private/tools/excel-review/)'; then
    ran_any=1
    printf '  [excel-review] .venv/bin/python -m unittest discover -s services/excel_review/tests\n'
    if [ -x .venv/bin/python ]; then
      if .venv/bin/python -m unittest discover -s services/excel_review/tests -t . ; then printf '  PASS\n';
      else fail "excel_review regression tests failed."; printf '  FAIL\n'; fi
    else
      warn ".venv/bin/python missing — excel_review tests skipped."
    fi
  fi

  if [ "$ran_any" -eq 0 ]; then
    printf '  no changed files matched a test suite — SKIP\n'
  fi
fi

# ---------------------------------------------------------------------------
# Verdict
# ---------------------------------------------------------------------------
if [ "$FAILS" -gt 0 ]; then
  banner "PRE-PUSH CHECK FAILED"
  printf 'Reason:\n'
  printf '%s' "$FAIL_REASONS" | sed 's/^/  - /'
  printf '\nFix the reported file(s), commit the correction,\nthen run the check again.\n'
  exit 1
fi

banner "PRE-PUSH CHECK PASSED"
[ "$WARNINGS" -gt 0 ] && printf '(%s warning(s) — see above)\n' "$WARNINGS"
exit 0
