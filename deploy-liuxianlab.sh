#!/usr/bin/env bash
# Liuxian Lab - Safe one-command production deploy
#
# Usage:
#   deploy-liuxianlab.sh <release-tag>
#   deploy-liuxianlab.sh <release-tag> --dry-run
#   deploy-liuxianlab.sh <release-tag> --yes-python-deps
#
# Example:
#   deploy-liuxianlab.sh excel-tools-v1.0.1
#
# Assumptions:
# - Production repo: /var/www/liuxianlab
# - PM2 app: liuxianlab
# - Health endpoint: http://127.0.0.1:8080/health
# - Backup script: /usr/local/bin/backup-liuxianlab.sh
# - PostgreSQL DATABASE_URL is stored in /var/www/liuxianlab/.env
# - Release tags are annotated tags created from commits on origin/main
#
# Safety model:
# - Refuses dirty production worktrees
# - Refuses non-fast-forward releases
# - Refuses release tags not reachable from origin/main
# - Detects Python dependency drift and asks before installing missing packages
# - Backs up production before changing code
# - Runs syntax checks and known regression tests before migration/restart
# - Applies only NEW migration files added between current production and target
# - Refuses modified/deleted historical migration files
# - Automatically rolls CODE back if deploy/restart/health checks fail
# - Does not roll back additive database migrations

set -Eeuo pipefail
IFS=$'\n\t'

APP="/var/www/liuxianlab"
PM2_APP="liuxianlab"
HEALTH_URL="http://127.0.0.1:8080/health"
PUBLIC_HEALTH_URL="https://liuxianlab.com/health"
BACKUP_SCRIPT="/usr/local/bin/backup-liuxianlab.sh"
BACKUP_DIR="/backup/liuxianlab"
LOG_DIR="/var/log/liuxianlab-deploy"

TAG="${1:-}"
DRY_RUN=0
AUTO_CONFIRM_PY_DEPS=0
PYTHON_DEPS_APPROVED=0
PYTHON_DEPS_NEEDED=0
CODE_SWITCHED=0

for option in "${@:2}"; do
  case "$option" in
    --dry-run) DRY_RUN=1 ;;
    --yes-python-deps) AUTO_CONFIRM_PY_DEPS=1 ;;
    *) echo "ERROR: unknown option: $option"; exit 2 ;;
  esac
done

if [[ -z "$TAG" ]]; then
  cat <<'EOF'
Usage:
  deploy-liuxianlab.sh <release-tag>
  deploy-liuxianlab.sh <release-tag> --dry-run
  deploy-liuxianlab.sh <release-tag> --yes-python-deps

Examples:
  deploy-liuxianlab.sh excel-tools-v1.0.1 --dry-run
  deploy-liuxianlab.sh excel-tools-v1.0.1
  deploy-liuxianlab.sh excel-tools-v1.0.1 --yes-python-deps
EOF
  exit 2
fi

timestamp() {
  date '+%Y-%m-%d %H:%M:%S %z'
}

section() {
  echo
  echo "============================================================"
  echo "$1"
  echo "============================================================"
}

die() {
  local message="$*"
  echo
  echo "ERROR: $message" >&2

  if [[ "${CODE_SWITCHED:-0}" -eq 1 ]] && declare -F rollback >/dev/null 2>&1; then
    rollback "$message"
  fi

  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"
}

# Prevent two deployments from running at the same time.
require_cmd flock
exec 9>/tmp/liuxianlab-deploy.lock
flock -n 9 || die "another Liuxian Lab deployment is already running"

for cmd in git curl psql node npm python3 pm2 sha256sum grep awk sed find tar; do
  require_cmd "$cmd"
done

[[ -d "$APP/.git" ]] || die "Git repository not found: $APP"
[[ -x "$BACKUP_SCRIPT" ]] || die "backup script missing or not executable: $BACKUP_SCRIPT"

cd "$APP"

# Deployment log. Failure to create /var/log must not change production.
sudo mkdir -p "$LOG_DIR"
sudo touch "$LOG_DIR/.write-test"
sudo rm -f "$LOG_DIR/.write-test"
sudo chown "$(id -un)":"$(id -gn)" "$LOG_DIR"

SAFE_TAG="$(printf '%s' "$TAG" | tr -c 'A-Za-z0-9._-' '_')"
LOG_FILE="$LOG_DIR/$(date '+%Y%m%d-%H%M%S')-${SAFE_TAG}.log"
exec > >(tee -a "$LOG_FILE") 2>&1

section "LIUXIAN LAB DEPLOY"
echo "Time:          $(timestamp)"
echo "Release tag:   $TAG"
echo "Mode:          $([[ "$DRY_RUN" -eq 1 ]] && echo DRY-RUN || echo DEPLOY)"
echo "App:           $APP"
echo "Log:           $LOG_FILE"

# ---------------------------------------------------------------------------
# Preflight: production must be pristine.
# ---------------------------------------------------------------------------
section "1. PRODUCTION PREFLIGHT"

BRANCH="$(git branch --show-current)"
[[ "$BRANCH" == "main" ]] || die "production must be on branch main; current branch: $BRANCH"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Production worktree is not clean:"
  git status --short
  die "refusing to deploy over local production changes"
fi

OLD_COMMIT="$(git rev-parse HEAD)"
echo "Current commit:"
git log -1 --oneline --decorate
echo
echo "Current SHA: $OLD_COMMIT"

if ! curl --fail --silent --show-error "$HEALTH_URL" >/tmp/liuxianlab-predeploy-health.json; then
  die "current production health check already fails; refusing to deploy"
fi
echo "Current health: $(cat /tmp/liuxianlab-predeploy-health.json)"

# Avoid switching code while known heavy/background jobs are active.
# Contracts already at processing/reviewing are waiting for human review and
# do not block deployment.
DATABASE_URL="$(
python3 - <<'PY'
from pathlib import Path

env = Path(".env")
if not env.exists():
    raise SystemExit("")

for raw in env.read_text(encoding="utf-8").splitlines():
    line = raw.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    key, value = line.split("=", 1)
    if key.strip() == "DATABASE_URL":
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        print(value)
        break
PY
)"

[[ -n "$DATABASE_URL" ]] || die "DATABASE_URL not found in .env"

table_exists() {
  local table="$1"
  [[ "$(psql "$DATABASE_URL" -Atc "SELECT to_regclass('public.${table}') IS NOT NULL;" 2>/dev/null)" == "t" ]]
}

ACTIVE_JOBS=0

if table_exists "contracts"; then
  COUNT="$(
    psql "$DATABASE_URL" -Atc "
      SELECT COUNT(*)
      FROM contracts
      WHERE deleted_at IS NULL
        AND (
          status = 'queued'
          OR (
            status = 'processing'
            AND COALESCE(stage, '') <> 'reviewing'
          )
        );
    " 2>/dev/null || echo "QUERY_FAILED"
  )"
  if [[ "$COUNT" == "QUERY_FAILED" ]]; then
    die "could not check active contract jobs"
  fi
  echo "Active/queued contract jobs: $COUNT"
  ACTIVE_JOBS=$((ACTIVE_JOBS + COUNT))
fi

if table_exists "excel_review_jobs"; then
  COUNT="$(
    psql "$DATABASE_URL" -Atc "
      SELECT COUNT(*)
      FROM excel_review_jobs
      WHERE status IN ('queued', 'processing');
    " 2>/dev/null || echo "QUERY_FAILED"
  )"
  if [[ "$COUNT" == "QUERY_FAILED" ]]; then
    die "could not check active Excel Review jobs"
  fi
  echo "Active/queued Excel Review jobs: $COUNT"
  ACTIVE_JOBS=$((ACTIVE_JOBS + COUNT))
fi

if pgrep -af 'mineru|services\.contract_review\.worker|services\.excel_review\.worker' >/tmp/liuxianlab-worker-processes.txt 2>/dev/null; then
  echo
  echo "Background parsing processes detected:"
  cat /tmp/liuxianlab-worker-processes.txt
  die "wait for active parsing jobs to finish before deployment"
fi

[[ "$ACTIVE_JOBS" -eq 0 ]] || die "queued/processing jobs exist; deploy when the queue is empty"

# ---------------------------------------------------------------------------
# Fetch the release metadata. No production files are changed by fetch.
# ---------------------------------------------------------------------------
section "2. FETCH RELEASE"

echo "Fetching origin and tags..."
if ! git -c http.version=HTTP/1.1 fetch origin --tags --prune; then
  die "git fetch failed. Production is unchanged. Check GitHub network/authentication."
fi

git show-ref --verify --quiet "refs/tags/$TAG" || die "release tag does not exist locally after fetch: $TAG"

# Require an annotated tag. This makes accidental ad-hoc production commits less likely.
TAG_OBJECT_TYPE="$(git cat-file -t "refs/tags/$TAG")"
[[ "$TAG_OBJECT_TYPE" == "tag" ]] || die "release tag must be an annotated tag: $TAG"

TARGET_COMMIT="$(git rev-list -n 1 "$TAG")"
REMOTE_MAIN="$(git rev-parse origin/main)"

echo "Target commit: $TARGET_COMMIT"
echo "origin/main:   $REMOTE_MAIN"
echo
git show --no-patch --oneline --decorate "$TAG"

git merge-base --is-ancestor "$OLD_COMMIT" "$TARGET_COMMIT" \
  || die "target is not a fast-forward descendant of current production"

git merge-base --is-ancestor "$TARGET_COMMIT" "$REMOTE_MAIN" \
  || die "release tag is not reachable from origin/main"

# ---------------------------------------------------------------------------
# Show and validate exactly what is going to production.
# ---------------------------------------------------------------------------
section "3. RELEASE DIFF"

git diff --check "$OLD_COMMIT" "$TARGET_COMMIT" \
  || die "git diff --check failed"

echo "Commits:"
git log --oneline --decorate "$OLD_COMMIT..$TARGET_COMMIT"

echo
echo "Files:"
git diff --name-status "$OLD_COMMIT" "$TARGET_COMMIT"

echo
echo "Diff stat:"
git diff --stat "$OLD_COMMIT" "$TARGET_COMMIT"

# ---------------------------------------------------------------------------
# Dependency policy.
# Node lock changes can be installed deterministically with npm ci.
# Python dependencies are managed generically through a manifest-to-venv map.
# The manager can detect missing packages even when manifests did not change.
# ---------------------------------------------------------------------------
section "4. DEPENDENCY CHECK"

LOCK_CHANGED=0
if ! git diff --quiet "$OLD_COMMIT" "$TARGET_COMMIT" -- package-lock.json; then
  LOCK_CHANGED=1
  echo "package-lock.json changed -> npm ci will run."
else
  echo "package-lock.json unchanged."
fi

TMP_DEP_DIR="$(mktemp -d)"
TARGET_TREE="$(mktemp -d)"
trap 'rm -rf "$TMP_DEP_DIR" "$TARGET_TREE"' EXIT

if ! git archive "$TARGET_COMMIT" | tar -x -C "$TARGET_TREE"; then
  die "could not extract target release for Python dependency preflight"
fi
TARGET_MANAGER="$TARGET_TREE/scripts/local/python-dependency-manager.sh"
TARGET_CONFIG="$TARGET_TREE/scripts/python-environments.tsv"
[[ -f "$TARGET_MANAGER" ]] || die "target release does not include scripts/local/python-dependency-manager.sh"
[[ -f "$TARGET_CONFIG" ]] || die "target release does not include scripts/python-environments.tsv"

git show "$OLD_COMMIT:package.json" > "$TMP_DEP_DIR/old-package.json" 2>/dev/null || echo '{}' > "$TMP_DEP_DIR/old-package.json"
git show "$TARGET_COMMIT:package.json" > "$TMP_DEP_DIR/new-package.json" 2>/dev/null || echo '{}' > "$TMP_DEP_DIR/new-package.json"

DEPS_CHANGED="$(
python3 - "$TMP_DEP_DIR/old-package.json" "$TMP_DEP_DIR/new-package.json" <<'PY'
import json, sys
keys = ("dependencies", "optionalDependencies", "peerDependencies", "devDependencies")
with open(sys.argv[1], encoding="utf-8") as f:
    old = json.load(f)
with open(sys.argv[2], encoding="utf-8") as f:
    new = json.load(f)
print("1" if any(old.get(k, {}) != new.get(k, {}) for k in keys) else "0")
PY
)"

if [[ "$DEPS_CHANGED" == "1" && "$LOCK_CHANGED" -eq 0 ]]; then
  die "package dependency sections changed but package-lock.json did not; fix Git before deploying"
fi

PY_DEP_CHANGES="$(
  git diff --name-status --find-renames "$OLD_COMMIT" "$TARGET_COMMIT" \
    | awk -F '\t' '
      function ismanifest(p, n, a) {
        n=split(p,a,"/"); p=a[n]
        return p ~ /^requirements.*\.txt$/ || p == "pyproject.toml" || p == "poetry.lock" || p == "uv.lock" || p == "Pipfile" || p == "Pipfile.lock"
      }
      { status=$1; path=(status ~ /^R/ || status ~ /^C/) ? $3 : $2; if (path != "" && ismanifest(path)) print status "\t" path }'
)"

if [[ -n "$PY_DEP_CHANGES" ]]; then
  echo "Python dependency manifest changes:"
  printf '%s\n' "$PY_DEP_CHANGES"
  if ! LIUXIANLAB_ROOT="$APP" LIUXIANLAB_CONFIG="$TARGET_CONFIG" \
    bash "$TARGET_MANAGER" plan "$OLD_COMMIT" "$TARGET_COMMIT"; then
    die "Python dependency change is not supported by the generic dependency manager; add an explicit installer mapping before deployment"
  fi
else
  echo "No Python dependency manifest changes in this release."
fi

# Full target-release dependency preflight. This runs before backup, code
# switch, migrations, or service restart, and never installs.
PY_PRE_STATUS=0
LIUXIANLAB_ROOT="$TARGET_TREE" \
LIUXIANLAB_ENV_ROOT="$APP" \
LIUXIANLAB_CONFIG="$TARGET_CONFIG" \
bash "$TARGET_MANAGER" check || PY_PRE_STATUS=$?

if [[ "$PY_PRE_STATUS" -eq 10 ]]; then
  PYTHON_DEPS_NEEDED=1
  echo "Python dependency preflight: one or more registered environments are missing packages or are out of specification."
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "DRY-RUN: would install the target release requirements into the registered environments."
    echo "DRY-RUN: no Python package was installed; no virtual environment was created."
  else
    if [[ "$AUTO_CONFIRM_PY_DEPS" -eq 1 ]]; then
      PYTHON_DEPS_APPROVED=1
      echo "Python dependency installation approved by --yes-python-deps."
    else
      [[ -t 0 ]] || die "Python packages are missing/out of specification but no interactive terminal is available. Re-run interactively or explicitly pass --yes-python-deps."
      echo
      echo "The deployment will install missing/out-of-spec packages before switching production code."
      read -r -p "Proceed with Python dependency installation? [y/N] " answer
      case "$answer" in
        y|Y|yes|YES) PYTHON_DEPS_APPROVED=1 ;;
        *) die "deployment cancelled by user; no production code has been changed" ;;
      esac
    fi
  fi
elif [[ "$PY_PRE_STATUS" -eq 0 ]]; then
  echo "Python dependency preflight passed: target release requirements are already satisfied."
else
  die "Python dependency preflight failed; see diagnostics above"
fi

# ---------------------------------------------------------------------------
# Migration policy:
# - Only migration files ADDED in this release are automatically applied.
# - Modified/deleted historical migrations are rejected.
# - Destructive SQL requires a manual deployment plan.
# ---------------------------------------------------------------------------
section "5. MIGRATION PLAN"

MIGRATION_DIFF="$(
  git diff --name-status "$OLD_COMMIT" "$TARGET_COMMIT" \
    | awk '$2 ~ /^server\/.*\/migrations\/.*\.sql$/ {print}'
)"

MIGRATIONS=()

if [[ -z "$MIGRATION_DIFF" ]]; then
  echo "No new migrations."
else
  echo "$MIGRATION_DIFF"
  echo

  while IFS=$'\t' read -r status path rest; do
    [[ -z "${status:-}" ]] && continue

    if [[ "$status" != "A" ]]; then
      die "historical migration changed/deleted/renamed ($status $path). Add a NEW migration file instead."
    fi

    MIGRATIONS+=("$path")

    SQL_TEXT="$(git show "$TARGET_COMMIT:$path")"

    if printf '%s\n' "$SQL_TEXT" | grep -Eiq \
      '(^|[[:space:]])(DROP[[:space:]]+(TABLE|COLUMN)|TRUNCATE[[:space:]]|DELETE[[:space:]]+FROM)'; then
      die "destructive SQL detected in $path. This requires a manual migration/rollback plan."
    fi

    echo "Will apply: $path"
  done <<< "$MIGRATION_DIFF"
fi

# ---------------------------------------------------------------------------
# Dry-run stops here. Nothing except git metadata/log files was changed.
# ---------------------------------------------------------------------------
if [[ "$DRY_RUN" -eq 1 ]]; then
  section "DRY-RUN PASSED"
  echo "Production code was NOT changed."
  echo "No backup was created."
  echo "No migration was executed."
  echo "No service was restarted."
  echo "Python dependency installation was not executed."
  echo
  echo "Ready to deploy:"
  echo "  /usr/local/bin/deploy-liuxianlab.sh $TAG"
  exit 0
fi

# ---------------------------------------------------------------------------
# Backup before any production code change.
# ---------------------------------------------------------------------------
section "6. PRODUCTION BACKUP"

BACKUP_START_EPOCH="$(date +%s)"

sudo "$BACKUP_SCRIPT"

RECENT_BACKUP="$(
  sudo find "$BACKUP_DIR" -maxdepth 1 -type f \
    -newermt "@$((BACKUP_START_EPOCH - 2))" \
    -printf '%T@ %p\n' 2>/dev/null \
    | sort -nr \
    | head -1 \
    | cut -d' ' -f2-
)"

if [[ -z "$RECENT_BACKUP" ]]; then
  echo "Could not automatically identify a newly modified backup file."
  echo "Recent backup directory listing:"
  sudo ls -lht "$BACKUP_DIR" | head -10 || true
  die "backup verification failed; production code is still unchanged"
fi

echo "Backup verified: $RECENT_BACKUP"

# ---------------------------------------------------------------------------
# Rollback function: CODE rollback only.
# Database migrations are intentionally additive and are not removed.
# ---------------------------------------------------------------------------
rollback() {
  local reason="${1:-deployment failure}"

  echo
  echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
  echo "ROLLBACK: $reason"
  echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!"
  echo "Returning code to: $OLD_COMMIT"

  if [[ "$CODE_SWITCHED" -eq 1 ]]; then
    git reset --hard "$OLD_COMMIT" || true

    if [[ "$LOCK_CHANGED" -eq 1 && -f package-lock.json ]]; then
      echo "Restoring old Node dependencies with npm ci..."
      npm ci || true
    fi
  fi

  pm2 restart "$PM2_APP" --update-env || true
  sleep 3

  echo
  echo "Health after rollback:"
  curl --silent --show-error "$HEALTH_URL" || true
  echo

  echo
  echo "Recent PM2 logs:"
  pm2 logs "$PM2_APP" --lines 80 --nostream || true

  echo
  echo "NOTE: additive database migrations are NOT removed automatically."
  echo "Backup: $RECENT_BACKUP"
  echo "Log:    $LOG_FILE"
}

on_error() {
  local exit_code=$?
  local line_no="${1:-unknown}"
  rollback "command failed at line $line_no (exit=$exit_code)"
  exit "$exit_code"
}

trap 'on_error $LINENO' ERR

# ---------------------------------------------------------------------------
# Python dependency installation: after backup, before code switch.
# Code rollback cannot undo packages installed into Python environments.
# ---------------------------------------------------------------------------
if [[ "$PYTHON_DEPS_NEEDED" -eq 1 ]]; then
  section "6A. PYTHON DEPENDENCIES (PRE-SWITCH INSTALL)"
  [[ "$PYTHON_DEPS_APPROVED" -eq 1 ]] \
    || die "Python dependency installation was required but not approved; production code has not been changed"
  echo "Installing target release requirements into registered Python environments..."
  LIUXIANLAB_ROOT="$TARGET_TREE" \
  LIUXIANLAB_ENV_ROOT="$APP" \
  LIUXIANLAB_CONFIG="$TARGET_CONFIG" \
  bash "$TARGET_MANAGER" install \
    || die "Python dependency installation failed before code switch; production code has not been changed"
  LIUXIANLAB_ROOT="$TARGET_TREE" \
  LIUXIANLAB_ENV_ROOT="$APP" \
  LIUXIANLAB_CONFIG="$TARGET_CONFIG" \
  bash "$TARGET_MANAGER" check \
    || die "Python dependency verification failed after installation; production code has not been changed"
  echo "Python dependencies installed and verified before code switch."
  echo "NOTE: code rollback will not uninstall packages already installed into Python environments."
else
  echo "Python dependencies already satisfied; no installation before code switch."
fi

# ---------------------------------------------------------------------------
# Switch code to the exact release tag.
# ---------------------------------------------------------------------------
section "7. SWITCH CODE"

git merge --ff-only "$TARGET_COMMIT"
CODE_SWITCHED=1

NEW_COMMIT="$(git rev-parse HEAD)"
[[ "$NEW_COMMIT" == "$TARGET_COMMIT" ]] || die "HEAD does not equal target after fast-forward"

echo "Production code now points to:"
git log -1 --oneline --decorate

# ---------------------------------------------------------------------------
# Deterministic Node dependency install if lockfile changed.
# ---------------------------------------------------------------------------
if [[ "$LOCK_CHANGED" -eq 1 ]]; then
  section "8. NODE DEPENDENCIES"
  npm ci
else
  section "8. NODE DEPENDENCIES"
  echo "No npm install needed."
fi

# ---------------------------------------------------------------------------
# Generic Python dependency verification.
# - Checks every tracked requirements*.txt against its configured environment.
# - Checks registered script-managed environments such as the equity OCR venv.
# - Installs only when missing/out-of-spec packages are detected and the user
#   has approved the operation.
# ---------------------------------------------------------------------------
section "8A. PYTHON DEPENDENCIES (POST-SWITCH VERIFY)"

[[ -x scripts/local/python-dependency-manager.sh ]] \
  || die "generic Python dependency manager missing from target release"
[[ -f scripts/python-environments.tsv ]] \
  || die "Python environment registry missing from target release"

if ! bash scripts/local/python-dependency-manager.sh check; then
  echo "Python dependencies changed or are invalid after code switch." >&2
  echo "Rolling back code will NOT uninstall packages already installed in Python environments." >&2
  die "Python dependency verification failed after code switch"
fi
echo "Python dependency verification passed after code switch."

# ---------------------------------------------------------------------------
# Syntax validation.
# ---------------------------------------------------------------------------
section "9. SYNTAX CHECKS"

while IFS= read -r file; do
  [[ -z "$file" ]] && continue
  [[ -f "$file" ]] || continue
  case "$file" in
    node_modules/*|private/vendor/*) continue ;;
  esac
  echo "node --check $file"
  node --check "$file"
done < <(
  git diff --name-only "$OLD_COMMIT" "$TARGET_COMMIT" \
    | grep -E '\.js$' || true
)

PYTHON_BIN=".venv/bin/python"
[[ -x "$PYTHON_BIN" ]] || PYTHON_BIN="python3"

while IFS= read -r file; do
  [[ -z "$file" ]] && continue
  [[ -f "$file" ]] || continue
  case "$file" in
    .venv/*|.mineru/*) continue ;;
  esac
  echo "$PYTHON_BIN -m py_compile $file"
  "$PYTHON_BIN" -m py_compile "$file"
done < <(
  git diff --name-only "$OLD_COMMIT" "$TARGET_COMMIT" \
    | grep -E '\.py$' || true
)

echo "Syntax checks passed."

# ---------------------------------------------------------------------------
# Known regression suites.
# ---------------------------------------------------------------------------
section "10. REGRESSION TESTS"

if compgen -G "tests/excel-decimal-check/*.test.js" >/dev/null; then
  echo "Running Excel Decimal Check tests..."
  node --test tests/excel-decimal-check/*.test.js
fi

if [[ -d services/excel_review/tests ]]; then
  [[ -x .venv/bin/python ]] || die ".venv/bin/python required for Excel Review tests"
  echo
  echo "Running Excel Review tests..."
  .venv/bin/python -m unittest discover \
    -s services/excel_review/tests \
    -t .
fi

if [[ -d services/contract_review/tests ]]; then
  [[ -x .mineru/bin/python ]] || die ".mineru/bin/python required for Contract Review tests"
  echo
  echo "Running Contract Review regression tests..."
  .mineru/bin/python -m unittest discover \
    -s services/contract_review/tests \
    -t .
fi

echo "Regression tests passed."

# ---------------------------------------------------------------------------
# Production safety markers for MinerU must survive unrelated releases.
# ---------------------------------------------------------------------------
section "11. MINERU SAFETY"

if [[ -f services/contract_review/mineru_service.py ]]; then
  grep -q 'LIUXIANLAB_MINERU_PRODUCTION_ENV_V1' \
    services/contract_review/mineru_service.py \
    || die "LIUXIANLAB_MINERU_PRODUCTION_ENV_V1 marker missing"
fi

if [[ -x .mineru/bin/python ]]; then
  SEAL_FILE="$(
    .mineru/bin/python - <<'PY'
import importlib.util
spec = importlib.util.find_spec("mineru.model.ocr.seal_crop")
print(spec.origin if spec else "")
PY
  )"

  [[ -n "$SEAL_FILE" && -f "$SEAL_FILE" ]] \
    || die "installed MinerU seal_crop.py could not be located"

  grep -q 'LIUXIANLAB_SAFE_SEAL_CROP_V3' "$SEAL_FILE" \
    || die "installed MinerU V3 seal safety patch marker missing"

  echo "MinerU production environment marker: OK"
  echo "MinerU V3 seal patch marker:          OK"
fi

# ---------------------------------------------------------------------------
# Apply only newly-added migration files after code/tests pass.
# Old app is still running during this phase, so migrations are expected to
# remain additive/backward-compatible by project policy.
# ---------------------------------------------------------------------------
section "12. DATABASE MIGRATIONS"

if [[ "${#MIGRATIONS[@]}" -eq 0 ]]; then
  echo "No migrations to apply."
else
  for migration in "${MIGRATIONS[@]}"; do
    echo
    echo "Applying: $migration"
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$migration"
  done
  echo
  echo "Migrations completed."
fi

# ---------------------------------------------------------------------------
# Nginx validation and application restart.
# ---------------------------------------------------------------------------
section "13. NGINX"
sudo nginx -t

section "14. PM2 RESTART"
pm2 restart "$PM2_APP" --update-env

# ---------------------------------------------------------------------------
# Health check with retries.
# ---------------------------------------------------------------------------
section "15. HEALTH CHECK"

HEALTH_OK=0
for attempt in 1 2 3 4 5; do
  echo "Health attempt $attempt/5..."
  if curl --fail --silent --show-error "$HEALTH_URL" >/tmp/liuxianlab-health.json; then
    if grep -q '"ok"[[:space:]]*:[[:space:]]*true' /tmp/liuxianlab-health.json; then
      HEALTH_OK=1
      break
    fi
  fi
  sleep 2
done

[[ "$HEALTH_OK" -eq 1 ]] || die "local health check failed after restart"

echo "Local health: $(cat /tmp/liuxianlab-health.json)"

# Public health is useful but not rollback-critical if local health is healthy.
if curl --fail --silent --show-error --max-time 10 "$PUBLIC_HEALTH_URL" >/tmp/liuxianlab-public-health.json 2>/dev/null; then
  echo "Public health: $(cat /tmp/liuxianlab-public-health.json)"
else
  echo "WARNING: public health URL could not be verified from this server."
fi

pm2 save

# ---------------------------------------------------------------------------
# Final verification.
# ---------------------------------------------------------------------------
section "16. FINAL VERIFICATION"

[[ -z "$(git status --porcelain)" ]] || {
  git status --short
  die "production worktree is dirty after deployment"
}

FINAL_COMMIT="$(git rev-parse HEAD)"
[[ "$FINAL_COMMIT" == "$TARGET_COMMIT" ]] || die "final HEAD no longer matches target"

git log -3 --oneline --decorate
echo
pm2 status
echo
echo "Health: $(curl --fail --silent --show-error "$HEALTH_URL")"

# Deployment is complete; do not run rollback for later shell cleanup errors.
trap - ERR

section "DEPLOY SUCCESS"
echo "Release: $TAG"
echo "Commit:  $TARGET_COMMIT"
echo "Backup:  $RECENT_BACKUP"
echo "Log:     $LOG_FILE"
echo
echo "Production deployment completed successfully."
