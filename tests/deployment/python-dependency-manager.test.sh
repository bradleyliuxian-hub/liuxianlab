#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "$#" -ne 3 ]]; then
  echo "Usage: $0 <deploy-script> <manager-script> <environment-config>" >&2
  exit 2
fi
DEPLOY="$1"
MANAGER="$2"
CONFIG_SOURCE="$3"

bash -n "$DEPLOY"
bash -n "$MANAGER"
grep -q '^workers/\*/requirements\*\.txt[[:space:]]\+\.venv' "$CONFIG_SOURCE" || { echo 'FAIL: shared worker requirements mapping missing' >&2; exit 1; }
grep -q 'python-dependency-manager.sh' "$DEPLOY"
grep -q -- '--yes-python-deps' "$DEPLOY"
grep -q 'Python dependency preflight' "$DEPLOY"
grep -q 'PYTHON_DEPS_NEEDED' "$DEPLOY"
if grep -q 'Python dependency manifests changed. Review which environment' "$DEPLOY"; then
  echo "FAIL: old unconditional Python dependency gate remains" >&2
  exit 1
fi
CHECK_LINE="$(grep -n 'PY_PRE_STATUS=0' "$DEPLOY" | head -1 | cut -d: -f1)"
INSTALL_LINE="$(grep -n 'section "6A. PYTHON DEPENDENCIES' "$DEPLOY" | head -1 | cut -d: -f1)"
SWITCH_LINE="$(grep -n 'section "7. SWITCH CODE"' "$DEPLOY" | head -1 | cut -d: -f1)"
POST_LINE="$(grep -n 'section "8A. PYTHON DEPENDENCIES' "$DEPLOY" | head -1 | cut -d: -f1)"
[[ -n "$CHECK_LINE" && -n "$INSTALL_LINE" && -n "$SWITCH_LINE" && -n "$POST_LINE" ]] || { echo "FAIL: missing preflight/install/switch sections" >&2; exit 1; }
[[ "$CHECK_LINE" -lt "$SWITCH_LINE" ]] || { echo "FAIL: Python preflight is after code switch" >&2; exit 1; }
[[ "$INSTALL_LINE" -lt "$SWITCH_LINE" ]] || { echo "FAIL: Python install is after code switch" >&2; exit 1; }
# Dry-run must exit before installation section.
DRY_LINE="$(grep -n 'section "DRY-RUN PASSED"' "$DEPLOY" | head -1 | cut -d: -f1)"
[[ -n "$DRY_LINE" && "$DRY_LINE" -lt "$INSTALL_LINE" ]] || { echo "FAIL: dry-run does not stop before Python install" >&2; exit 1; }
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

ROOT="$TMP/repo"
mkdir -p "$ROOT/scripts/local" "$ROOT/scripts" "$ROOT/.test-venv/bin" "$ROOT/.new-module-venv/bin" "$ROOT/services/new_module"
cp "$MANAGER" "$ROOT/scripts/local/python-dependency-manager.sh"
# Reuse the real registry but omit script-managed rows so this test never
# invokes a production installer. Put a test-only root mapping first.
grep -v '^@always[[:space:]]' "$CONFIG_SOURCE" > "$ROOT/scripts/python-environments.tsv"
{ printf 'requirements.txt\t.test-venv\trequirements\t-\t-\n'; cat "$ROOT/scripts/python-environments.tsv"; } > "$ROOT/scripts/python-environments.tsv.tmp"
mv "$ROOT/scripts/python-environments.tsv.tmp" "$ROOT/scripts/python-environments.tsv"
printf 'services/new_module/requirements*.txt\t.new-module-venv\trequirements\t-\t-\n' >> "$ROOT/scripts/python-environments.tsv"
chmod +x "$ROOT/scripts/local/python-dependency-manager.sh"

cat > "$ROOT/requirements.txt" <<'REQ'
example-package==1.0
REQ

cat > "$ROOT/.test-venv/bin/python" <<'FAKEPY'
#!/usr/bin/env bash
set -Eeuo pipefail
STATE="$(dirname "$0")/../state"
ARGS="$*"
if [[ "$ARGS" == *"--dry-run"* && "$ARGS" == *"--report"* ]]; then
  report=""
  prev=""
  for arg in "$@"; do
    if [[ "$prev" == "--report" ]]; then report="$arg"; break; fi
    prev="$arg"
  done
  if [[ "$(cat "$STATE" 2>/dev/null || echo missing)" == missing ]]; then
    printf '{"install":[{"metadata":{"name":"example-package"}}]}\n' > "$report"
  else
    printf '{"install":[]}\n' > "$report"
  fi
  exit 0
fi
if [[ "$ARGS" == *"pip install -r"* ]]; then
  echo satisfied > "$STATE"
  exit 0
fi
if [[ "$ARGS" == *"pip check"* ]]; then exit 0; fi
if [[ "$ARGS" == *"-c"* ]]; then exit 0; fi
echo "fake python received unsupported args: $ARGS" >&2
exit 9
FAKEPY
chmod +x "$ROOT/.test-venv/bin/python"
cp "$ROOT/.test-venv/bin/python" "$ROOT/.new-module-venv/bin/python"
chmod +x "$ROOT/.new-module-venv/bin/python"

cat > "$ROOT/services/new_module/requirements-prod.txt" <<'REQ2'
another-package==2.0
REQ2

cd "$ROOT"
git init -q
git config user.email test@example.invalid
git config user.name Test
git add scripts/local/python-dependency-manager.sh scripts/python-environments.tsv .test-venv/bin/python
git commit -qm baseline
OLD="$(git rev-parse HEAD)"
git add requirements.txt services/new_module/requirements-prod.txt
git commit -qm add-python-requirements
NEW="$(git rev-parse HEAD)"

PLAN="$(LIUXIANLAB_ROOT="$ROOT" bash scripts/local/python-dependency-manager.sh plan "$OLD" "$NEW")"
printf '%s\n' "$PLAN" | grep -q 'requirements.txt -> .test-venv'
printf '%s\n' "$PLAN" | grep -q 'services/new_module/requirements-prod.txt -> .new-module-venv'

set +e
CHECK_OUT="$(LIUXIANLAB_ROOT="$ROOT" bash scripts/local/python-dependency-manager.sh check 2>&1)"
CHECK_RC=$?
set -e
[[ "$CHECK_RC" -eq 10 ]]
printf '%s\n' "$CHECK_OUT" | grep -q 'NEEDS_INSTALL|requirements.txt|.test-venv'
[[ ! -f "$ROOT/.test-venv/state" ]] || { echo "FAIL: check mode changed the environment" >&2; exit 1; }
printf '%s\n' "$CHECK_OUT" | grep -q 'NEEDS_INSTALL|services/new_module/requirements-prod.txt|.new-module-venv'

LIUXIANLAB_ROOT="$ROOT" bash scripts/local/python-dependency-manager.sh install >/dev/null
LIUXIANLAB_ROOT="$ROOT" bash scripts/local/python-dependency-manager.sh check | grep -q 'Python dependency check passed'

mkdir -p "$ROOT/services/unregistered"
printf 'unknown-package==9.9\n' > "$ROOT/services/unregistered/requirements.txt"
cd "$ROOT"
git add services/unregistered/requirements.txt
git commit -qm add-unregistered-requirements
UNREGISTERED="$(git rev-parse HEAD)"
set +e
LIUXIANLAB_ROOT="$ROOT" bash scripts/local/python-dependency-manager.sh plan "$NEW" "$UNREGISTERED" >"$TMP/unregistered-plan.txt" 2>&1
UNREGISTERED_PLAN_RC=$?
LIUXIANLAB_ROOT="$ROOT" bash scripts/local/python-dependency-manager.sh check >"$TMP/unregistered-check.txt" 2>&1
UNREGISTERED_CHECK_RC=$?
set -e
[[ "$UNREGISTERED_PLAN_RC" -eq 3 ]]
[[ "$UNREGISTERED_CHECK_RC" -ne 0 ]]
grep -q 'no Python environment mapping' "$TMP/unregistered-check.txt"
grep -q 'UNSUPPORTED AUTOMATIC INSTALLER' "$TMP/unregistered-plan.txt"

echo "PASS: generic manifest planning and environment mapping"
echo "PASS: missing packages are detected without installing during check"
echo "PASS: confirmed install repairs environment and post-check passes"
echo "PASS: unregistered manifest fails closed; no guessed environment"
