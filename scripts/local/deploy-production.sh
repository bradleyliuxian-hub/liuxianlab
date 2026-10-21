#!/usr/bin/env bash
#
# One-command production deployment.
#
# Usage:
#   npm run deploy:prod                  # local orchestrator (SSH)
#   liuxianlab-deploy                    # server auto-deploy from origin/main
#   bash scripts/local/deploy-production.sh --server
#
# Optional local overrides:
#   DEPLOY_CONF, DEPLOY_TAG, DEPLOY_SSH_BIN, DEPLOY_PRE_PUSH_CHECK
# Optional server overrides:
#   DEPLOY_APP_DIR, DEPLOY_SCRIPT, DEPLOY_TAG
#
# This script never commits business code and never force-pushes tags. Local
# mode pushes a release tag and invokes the deployer over SSH. Server mode
# creates a local-only tag from the fetched origin/main and runs the deployer
# on the server. Nothing is pushed by server mode.

set -Eeuo pipefail
IFS=$'\n\t'

# Server mode is used when this file is installed as `liuxianlab-deploy`:
#   sudo install -m 755 scripts/local/deploy-production.sh /usr/local/bin/liuxianlab-deploy
# It can also be invoked explicitly as:
#   bash scripts/local/deploy-production.sh --server
SERVER_MODE=0
if [[ "${0##*/}" == "liuxianlab-deploy" || "${1:-}" == "--server" || "${LIUXIANLAB_DEPLOY_MODE:-}" == "server" ]]; then
  SERVER_MODE=1
fi
if [[ "${1:-}" == "--server" ]]; then
  shift
fi

# The server command must not depend on the caller's cwd. Local mode keeps its
# existing behavior and operates on the current checkout.
if [[ "$SERVER_MODE" -eq 1 ]]; then
  SERVER_APP_DIR="${DEPLOY_APP_DIR:-/var/www/liuxianlab}"
  if [[ ! -d "$SERVER_APP_DIR/.git" ]]; then
    echo "ERROR: production Git repository not found: $SERVER_APP_DIR" >&2
    exit 2
  fi
  cd "$SERVER_APP_DIR" || {
    echo "ERROR: cannot enter production repository: $SERVER_APP_DIR" >&2
    exit 2
  }
fi

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "ERROR: not inside a Git repository." >&2
  exit 2
}
cd "$ROOT"

XDG_STATE="${XDG_STATE_HOME:-$HOME/.local/state}"
LOG_DIR="$XDG_STATE/liuxianlab/deploy"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/$(date '+%Y%m%d-%H%M%S')-deploy.log"

log() { printf '%s\n' "$*"; }
REMOTE_DEPLOY_STARTED=0
SERVER_DEPLOY_STARTED=0
die() {
  local message="$*"
  echo
  echo "ERROR: $message" >&2
  echo "Log: $LOG_FILE" >&2
  if [[ "${SERVER_DEPLOY_STARTED:-0}" -eq 1 ]]; then
    echo "The production deployer was started. Inspect /var/log/liuxianlab-deploy/ and production health before retrying." >&2
    echo "This wrapper did not automatically retry." >&2
  elif [[ "$REMOTE_DEPLOY_STARTED" -eq 1 ]]; then
    echo "Remote deployment was started. Inspect /var/log/liuxianlab-deploy/ on the host before retrying." >&2
    echo "This script did not automatically retry." >&2
  else
    echo "Production code was not changed by this script." >&2
  fi
  exit 1
}

trap 'status=$?; if [[ $status -ne 0 ]]; then echo "ERROR: command failed (exit=$status)." >&2; echo "Log: $LOG_FILE" >&2; exit $status; fi' ERR

# ---------------------------------------------------------------------------
# Server auto-deploy mode: fetch latest origin/main, validate it, create a
# temporary local annotated tag, then run the existing production deployer.
# The tag is never pushed to GitHub.
# ---------------------------------------------------------------------------
run_server_deployment() {
  local deploy_script="${DEPLOY_SCRIPT:-/usr/local/bin/deploy-liuxianlab.sh}"
  local branch head_sha target_sha short_sha
  local tag_base tag n tag_type tag_commit
  local dry_log="${TMPDIR:-/tmp}/liuxianlab-server-dry-run.$$.log"
  local need_python_deps=0 answer
  local config_count config_key config_value
  local -a deployer_env

  log "Server auto-deploy started at $(date '+%Y-%m-%d %H:%M:%S %z')"
  log "Repository: $ROOT"
  log "Deployer:   $deploy_script"

  [[ -f "$deploy_script" ]] || die "production deployer not found: $deploy_script"

  branch="$(git branch --show-current)"
  [[ "$branch" == "main" ]] || die "production must be on branch main; current branch: '${branch:-<detached>}'"

  if [[ -n "$(git status --porcelain)" ]]; then
    echo "Production worktree is not clean:" >&2
    git status --short >&2
    die "refusing to deploy over local production changes"
  fi

  log "Fetching latest origin/main from GitHub..."
  if ! git -c http.version=HTTP/1.1 fetch origin main; then
    die "could not fetch origin/main; production was not changed. Check GitHub network/authentication."
  fi

  target_sha="$(git rev-parse --verify 'origin/main^{commit}')" \
    || die "origin/main does not resolve to a commit"
  head_sha="$(git rev-parse --verify 'HEAD^{commit}')" \
    || die "current production HEAD does not resolve to a commit"
  [[ "$(git rev-parse 'origin/main')" == "$target_sha" ]] \
    || die "origin/main is not a commit reference"
  git cat-file -e "$target_sha^{commit}" \
    || die "target origin/main commit is unavailable: $target_sha"
  git merge-base --is-ancestor "$head_sha" "$target_sha" \
    || die "origin/main is not a fast-forward descendant of production HEAD"

  short_sha="$(git rev-parse --short=12 "$target_sha")"
  log "Validated target origin/main: $target_sha ($short_sha)"
  log "Current production HEAD:    $head_sha"

  tag_base="${DEPLOY_TAG:-liuxianlab-deploy-$(date '+%Y%m%d-%H%M%S')-${short_sha}}"
  tag="$tag_base"
  if [[ -n "${DEPLOY_TAG:-}" ]]; then
    if git rev-parse -q --verify "refs/tags/$tag" >/dev/null; then
      die "local deployment tag already exists: $tag"
    fi
  else
    n=1
    while git rev-parse -q --verify "refs/tags/$tag" >/dev/null; do
      tag="${tag_base}-$(printf '%02d' "$n")"
      n=$((n + 1))
    done
  fi
  [[ "$tag" =~ ^[A-Za-z0-9._-]+$ ]] || die "generated tag contains unsupported characters: $tag"

  git tag -a "$tag" -m "Production release $tag ($short_sha)" "$target_sha" \
    || die "could not create local annotated deployment tag: $tag"
  tag_type="$(git cat-file -t "refs/tags/$tag")" \
    || die "could not inspect local deployment tag: $tag"
  [[ "$tag_type" == "tag" ]] || die "local deployment tag is not annotated: $tag"
  tag_commit="$(git rev-parse "$tag^{}")" \
    || die "could not resolve local deployment tag commit: $tag"
  [[ "$tag_commit" == "$target_sha" ]] || die "local deployment tag does not point to target origin/main"
  log "Generated local annotated deployment tag: $tag -> $short_sha (not pushed)"

  # The existing deployer runs `git fetch origin --tags --prune` before checking
  # the tag. A global fetch.pruneTags=true would delete this local-only tag, so
  # force it off for the deployer and all child Git commands.
  config_count="${GIT_CONFIG_COUNT:-0}"
  config_key="GIT_CONFIG_KEY_${config_count}"
  config_value="GIT_CONFIG_VALUE_${config_count}"
  deployer_env=(
    "GIT_CONFIG_COUNT=$((config_count + 1))"
    "${config_key}=fetch.pruneTags"
    "${config_value}=false"
  )

  rm -f "$dry_log"
  log "Running production dry-run: $deploy_script $tag --dry-run"
  if ! env "${deployer_env[@]}" bash "$deploy_script" "$tag" --dry-run 2>&1 \
    | tee "$dry_log" | tee -a "$LOG_FILE"; then
    die "production dry-run failed; formal deployment was not started"
  fi

  local latest_main
  latest_main="$(git rev-parse --verify 'origin/main^{commit}')" \
    || die "could not re-read origin/main after dry-run"
  if [[ "$latest_main" != "$target_sha" ]]; then
    die "origin/main advanced during dry-run ($latest_main, target $target_sha); formal deployment was not started. Re-run the server deployment."
  fi

  if grep -Eq 'Python dependency preflight: one or more|DRY-RUN: would install|NEEDS_INSTALL' "$dry_log"; then
    need_python_deps=1
    echo
    echo "Python dependency changes are required:"
    grep -E 'Python dependency|NEEDS_INSTALL|would install|manifest|environment' "$dry_log" | tail -20 || true
    echo
    read -r -p "Install/update Python dependencies and continue? [y/N] " answer
    case "$answer" in
      y|Y|yes|YES) ;;
      *) die "deployment cancelled by user; production code was not changed" ;;
    esac
  else
    log "Python dependency preflight passed; no extra dependency prompt."
  fi

  SERVER_DEPLOY_STARTED=1
  log "Running formal production deployment: $deploy_script $tag"
  if [[ "$need_python_deps" -eq 1 ]]; then
    if ! env "${deployer_env[@]}" bash "$deploy_script" "$tag" --yes-python-deps 2>&1 \
      | tee -a "$LOG_FILE"; then
      die "production deployment failed; the deployer's rollback/log output must be reviewed"
    fi
  else
    if ! env "${deployer_env[@]}" bash "$deploy_script" "$tag" 2>&1 \
      | tee -a "$LOG_FILE"; then
      die "production deployment failed; the deployer's rollback/log output must be reviewed"
    fi
  fi

  log "Production deployment completed: $tag"
  log "Production deployer log: /var/log/liuxianlab-deploy/ (on this server)"
}

if [[ "$SERVER_MODE" -eq 1 ]]; then
  run_server_deployment
  exit 0
fi

log "Liuxian Lab deployment started at $(date '+%Y-%m-%d %H:%M:%S %z')"
log "Repository: $ROOT"

# ---------------------------------------------------------------------------
# 1. Local release checks. No commits, stashes, resets, or source edits.
# ---------------------------------------------------------------------------
BRANCH="$(git branch --show-current)"
[[ "$BRANCH" == "main" ]] || die "current branch is '$BRANCH'; production releases must be from main"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Working tree is not clean:" >&2
  git status --short >&2
  die "commit, move, or clean local changes before deploying"
fi

log "Fetching origin/main..."
git fetch --quiet origin main || die "could not fetch origin/main"
REMOTE_MAIN="$(git rev-parse origin/main)"
HEAD_SHA="$(git rev-parse HEAD)"
SHORT_SHA="$(git rev-parse --short=12 HEAD)"
[[ "$HEAD_SHA" == "$REMOTE_MAIN" ]] || die "local HEAD ($SHORT_SHA) is not equal to origin/main"
git merge-base --is-ancestor "$HEAD_SHA" origin/main || die "HEAD is not in origin/main history"

PRE_PUSH="${DEPLOY_PRE_PUSH_CHECK:-$ROOT/scripts/local/pre-push-check.sh}"
[[ -f "$PRE_PUSH" ]] || die "pre-push checker not found: $PRE_PUSH"
log "Running release checks: $PRE_PUSH --full"
if ! bash "$PRE_PUSH" --full 2>&1 | tee -a "$LOG_FILE"; then
  die "pre-push checks failed; no release tag was created"
fi

# ---------------------------------------------------------------------------
# 2. Load SSH configuration. Config contains no secrets.
# ---------------------------------------------------------------------------
CONF="${DEPLOY_CONF:-${XDG_CONFIG_HOME:-$HOME/.config}/liuxianlab/deploy.conf}"
[[ -f "$CONF" ]] || die "deployment config not found: $CONF
Create it once with:
  mkdir -p \"$(dirname "$CONF")\"
  cp \"$ROOT/scripts/local/deploy-production.conf.example\" \"$CONF\"
  chmod 600 \"$CONF\"
Then set DEPLOY_SSH_HOST to an existing SSH host alias."

DEPLOY_SSH_HOST=""
DEPLOY_SSH_PORT=""
DEPLOY_APP_DIR="/var/www/liuxianlab"
DEPLOY_SCRIPT="/usr/local/bin/deploy-liuxianlab.sh"
DEPLOY_HEALTH_URL="http://127.0.0.1:8080/health"
while IFS='=' read -r key value; do
  key="${key%$'\r'}"; value="${value%$'\r'}"
  [[ -z "$key" || "$key" == \#* ]] && continue
  value="${value%\"}"; value="${value#\"}"
  value="${value%\'}"; value="${value#\'}"
  case "$key" in
    DEPLOY_SSH_HOST) DEPLOY_SSH_HOST="$value" ;;
    DEPLOY_SSH_PORT) DEPLOY_SSH_PORT="$value" ;;
    DEPLOY_APP_DIR) DEPLOY_APP_DIR="$value" ;;
    DEPLOY_SCRIPT) DEPLOY_SCRIPT="$value" ;;
    DEPLOY_HEALTH_URL) DEPLOY_HEALTH_URL="$value" ;;
  esac
done < "$CONF"

[[ -n "$DEPLOY_SSH_HOST" ]] || die "DEPLOY_SSH_HOST is missing in $CONF"
[[ "$DEPLOY_SSH_HOST" =~ ^[A-Za-z0-9_.@:-]+$ ]] || die "DEPLOY_SSH_HOST contains unsupported characters"
[[ -z "$DEPLOY_SSH_PORT" || "$DEPLOY_SSH_PORT" =~ ^[0-9]+$ ]] || die "DEPLOY_SSH_PORT must be numeric"
[[ -n "$DEPLOY_APP_DIR" ]] || die "DEPLOY_APP_DIR must not be empty"
[[ -n "$DEPLOY_SCRIPT" ]] || die "DEPLOY_SCRIPT must not be empty"
[[ -n "$DEPLOY_HEALTH_URL" ]] || die "DEPLOY_HEALTH_URL must not be empty"

SSH_BIN="${DEPLOY_SSH_BIN:-ssh}"
SSH_ARGS=(-o BatchMode=yes -o ConnectTimeout=20)
[[ -z "$DEPLOY_SSH_PORT" ]] || SSH_ARGS+=(-p "$DEPLOY_SSH_PORT")

shquote() {
  local value="$1"
  printf "'%s'" "$(printf '%s' "$value" | sed "s/'/'\\\\''/g")"
}

remote_capture() {
  local command="$1" output="$2"
  set +e
  "$SSH_BIN" "${SSH_ARGS[@]}" "$DEPLOY_SSH_HOST" "$command" 2>&1 | tee "$output" | tee -a "$LOG_FILE" >/dev/null
  local rc=${PIPESTATUS[0]}
  set -e
  return "$rc"
}

# ---------------------------------------------------------------------------
# 3. Create and push a unique annotated release tag.
#
# Remote lookup states:
#   present - refs/tags/<tag> exists
#   absent  - lookup succeeded and this exact tag does not exist
#   error   - network/auth/other Git failure, so existence is unknown
#
# A local tag is created only for the "absent" state. Tag push is verified by
# re-reading origin; failures are never resolved with force-push or deletion.
# ---------------------------------------------------------------------------
REMOTE_TAG_STATE="unknown"
REMOTE_TAG_REF_SHA=""
REMOTE_TAG_COMMIT_SHA=""
REMOTE_TAG_DETAIL=""

probe_remote_tag() {
  local tag="$1" output rc ref_sha commit_sha
  REMOTE_TAG_STATE="unknown"
  REMOTE_TAG_REF_SHA=""
  REMOTE_TAG_COMMIT_SHA=""
  REMOTE_TAG_DETAIL=""

  if output="$(git ls-remote --exit-code --tags origin "refs/tags/$tag*" 2>&1)"; then
    rc=0
  else
    rc=$?
  fi

  if [[ "$rc" -ne 0 && "$rc" -ne 2 ]]; then
    REMOTE_TAG_STATE="error"
    REMOTE_TAG_DETAIL="$(printf '%s' "$output" | tr '\n' ' ' | cut -c1-300)"
    return 0
  fi

  ref_sha="$(printf '%s\n' "$output" | awk -v ref="refs/tags/$tag" '$2 == ref {print $1; exit}')"
  commit_sha="$(printf '%s\n' "$output" | awk -v ref="refs/tags/$tag^{}" '$2 == ref {print $1; exit}')"

  if [[ -z "$ref_sha" ]]; then
    REMOTE_TAG_STATE="absent"
    return 0
  fi
  if [[ ! "$ref_sha" =~ ^[0-9a-f]{40,64}$ || ( -n "$commit_sha" && ! "$commit_sha" =~ ^[0-9a-f]{40,64}$ ) ]]; then
    REMOTE_TAG_STATE="error"
    REMOTE_TAG_DETAIL="remote lookup returned an unexpected ref format"
    return 0
  fi
  REMOTE_TAG_STATE="present"
  REMOTE_TAG_REF_SHA="$ref_sha"
  REMOTE_TAG_COMMIT_SHA="$commit_sha"
  return 0
}

TAG="${DEPLOY_TAG:-liuxianlab-deploy-$(date '+%Y%m%d-%H%M%S')-${SHORT_SHA}}"
[[ "$TAG" =~ ^[A-Za-z0-9._-]+$ ]] || die "tag contains unsupported characters: $TAG"
if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  die "local tag already exists: $TAG"
fi

probe_remote_tag "$TAG"
case "$REMOTE_TAG_STATE" in
  present)
    die "remote tag already exists: $TAG (${REMOTE_TAG_REF_SHA}${REMOTE_TAG_COMMIT_SHA:+ -> $REMOTE_TAG_COMMIT_SHA}); refusing to overwrite"
    ;;
  error)
    die "could not query remote tag $TAG because of a network/authentication/Git error; no local tag was created. Details: $REMOTE_TAG_DETAIL"
    ;;
  absent)
    log "Remote tag does not exist: $TAG"
    ;;
  *)
    die "unexpected remote tag lookup state for $TAG: $REMOTE_TAG_STATE"
    ;;
esac

git tag -a "$TAG" -m "Production release $TAG ($SHORT_SHA)" "$HEAD_SHA" \
  || die "could not create annotated tag $TAG"
TAG_OBJECT_SHA="$(git rev-parse "$TAG")" || die "could not resolve local tag object $TAG"
TAG_COMMIT_SHA="$(git rev-parse "$TAG^{}")" || die "could not resolve local tag commit $TAG"
[[ "$TAG_COMMIT_SHA" == "$HEAD_SHA" ]] || die "local tag $TAG does not point to HEAD"
log "Created annotated tag: $TAG -> $SHORT_SHA"

log "Pushing tag: $TAG"
if git push origin "refs/tags/$TAG:refs/tags/$TAG" 2>&1 | tee -a "$LOG_FILE"; then
  PUSH_RC=0
else
  PUSH_RC=$?
fi

log "Verifying remote tag after push (git push exit=$PUSH_RC)..."
probe_remote_tag "$TAG"
if [[ "$REMOTE_TAG_STATE" == "present" && "$REMOTE_TAG_REF_SHA" == "$TAG_OBJECT_SHA" ]]; then
  if [[ -n "$REMOTE_TAG_COMMIT_SHA" && "$REMOTE_TAG_COMMIT_SHA" != "$TAG_COMMIT_SHA" ]]; then
    die "remote tag $TAG exists with a different peeled commit ($REMOTE_TAG_COMMIT_SHA, expected $TAG_COMMIT_SHA); manual review required. No force-push or remote tag deletion was attempted."
  fi
  if [[ "$PUSH_RC" -ne 0 ]]; then
    log "git push reported failure (exit=$PUSH_RC), but the remote tag matches the local tag object and commit; treating it as pushed after verification."
  else
    log "Pushed and verified tag: $TAG -> $SHORT_SHA"
  fi
elif [[ "$REMOTE_TAG_STATE" == "absent" ]]; then
  die "tag push failed or was not confirmed (git push exit=$PUSH_RC) and remote tag $TAG is absent. The local tag was kept; no force-push and no remote tag deletion were attempted. Inspect the Git remote/authentication and retry with a new release when safe."
elif [[ "$REMOTE_TAG_STATE" == "error" ]]; then
  die "git push exited $PUSH_RC and remote tag $TAG could not be verified because of a network/authentication/Git error. Remote state is uncertain; inspect origin tags manually before retrying. No force-push or remote tag deletion was attempted. Details: $REMOTE_TAG_DETAIL"
else
  die "remote tag $TAG exists but does not match the local tag object. Remote object: ${REMOTE_TAG_REF_SHA:-unknown}; remote commit: ${REMOTE_TAG_COMMIT_SHA:-unknown}; expected object: $TAG_OBJECT_SHA; expected commit: $TAG_COMMIT_SHA. Manual review required; no force-push or remote tag deletion was attempted."
fi

# ---------------------------------------------------------------------------
# 4. Remote preflight: fetch tags, then run the existing deployer dry-run.
# ---------------------------------------------------------------------------
FETCH_CMD="git -C $(shquote "$DEPLOY_APP_DIR") fetch origin --tags --prune"
DRY_RUN_CMD="bash $(shquote "$DEPLOY_SCRIPT") $(shquote "$TAG") --dry-run"

rm -f "${TMPDIR:-/tmp}/liuxianlab-dry-run.log" "${TMPDIR:-/tmp}/liuxianlab-deploy-run.log"
DRY_LOG="${TMPDIR:-/tmp}/liuxianlab-dry-run.log"

log "Remote fetch: $DEPLOY_SSH_HOST"
remote_capture "$FETCH_CMD" "$DRY_LOG" || die "SSH/fetch failed; production was not changed"
log "Remote dry-run: $DRY_RUN_CMD"
remote_capture "$DRY_RUN_CMD" "$DRY_LOG" || die "remote dry-run failed; formal deployment was not started"

NEED_PY_DEPS=0
if grep -Eq 'Python dependency preflight: one or more|DRY-RUN: would install|NEEDS_INSTALL' "$DRY_LOG"; then
  NEED_PY_DEPS=1
  echo
  echo "Python dependency changes are required:"
  grep -E 'Python dependency|NEEDS_INSTALL|would install|manifest|environment' "$DRY_LOG" | tail -20 || true
  echo
  read -r -p "Install/update Python dependencies and continue? [y/N] " answer
  case "$answer" in
    y|Y|yes|YES) ;;
    *) die "deployment cancelled by user; production code was not changed" ;;
  esac
else
  log "Python dependency preflight passed; no extra dependency prompt."
fi

# ---------------------------------------------------------------------------
# 5. Formal deployment. Only --yes-python-deps after explicit confirmation.
# ---------------------------------------------------------------------------
DEPLOY_CMD="bash $(shquote "$DEPLOY_SCRIPT") $(shquote "$TAG")"
if [[ "$NEED_PY_DEPS" -eq 1 ]]; then
  DEPLOY_CMD="$DEPLOY_CMD --yes-python-deps"
fi
DEPLOY_LOG="${TMPDIR:-/tmp}/liuxianlab-deploy-run.log"
REMOTE_DEPLOY_STARTED=1
log "Formal deployment: $DEPLOY_CMD"
remote_capture "$DEPLOY_CMD" "$DEPLOY_LOG" || die "remote formal deployment failed; do not retry automatically"

# ---------------------------------------------------------------------------
# 6. Post-deploy health check.
# ---------------------------------------------------------------------------
HEALTH_CMD="curl --fail --silent --show-error $(shquote "$DEPLOY_HEALTH_URL")"
HEALTH_LOG="${TMPDIR:-/tmp}/liuxianlab-health.log"
log "Health check: $HEALTH_CMD"
remote_capture "$HEALTH_CMD" "$HEALTH_LOG" || die "deployment command completed but health check failed"
log "Health: $(cat "$HEALTH_LOG" 2>/dev/null || true)"
log "Deployment completed: $TAG"
log "Remote deploy logs: check /var/log/liuxianlab-deploy/ on $DEPLOY_SSH_HOST"
