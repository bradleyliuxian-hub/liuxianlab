#!/usr/bin/env bash
set -Eeuo pipefail

SOURCE_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SOURCE_SCRIPT="$SOURCE_ROOT/scripts/local/deploy-production.sh"
TMPROOT="$(mktemp -d)"
trap 'rm -rf "$TMPROOT"' EXIT
PASS=0
FAIL=0
REAL_GIT="$(command -v git)"

mkdir -p "$TMPROOT/fakebin"
cat > "$TMPROOT/fakebin/git" <<EOF
#!/usr/bin/env bash
if [[ "\$1" == "ls-remote" ]]; then
  if [[ "\${FAKE_GIT_LS_REMOTE_FAIL:-}" == "1" ]]; then
    echo "fatal: unable to access 'https://example.invalid/': Could not resolve host" >&2
    exit 128
  fi
  if [[ "\${FAKE_GIT_LS_REMOTE_FAIL_AFTER_PUSH:-}" == "1" && -f "\${FAKE_GIT_PUSH_ATTEMPTED:-}" ]]; then
    echo "fatal: unable to access origin: network is unreachable" >&2
    exit 128
  fi
fi
if [[ "\$1" == "push" && "\$*" == *"refs/tags/"* ]]; then
  printf 'git %s\n' "\$*" >> "\${FAKE_GIT_LOG:-/dev/null}"
  if [[ "\${FAKE_GIT_PUSH_FAIL:-}" == "1" ]]; then
    : > "\${FAKE_GIT_PUSH_ATTEMPTED:-/dev/null}"
    exit 1
  fi
  if [[ "\${FAKE_GIT_PUSH_SILENT_SUCCESS:-}" == "1" ]]; then
    exit 0
  fi
fi
exec "$REAL_GIT" "\$@"
EOF
chmod +x "$TMPROOT/fakebin/git"

ok() { PASS=$((PASS + 1)); printf 'PASS: %s\n' "$1"; }
bad() { FAIL=$((FAIL + 1)); printf 'FAIL: %s\n' "$1" >&2; }

make_repo() {
  local name="$1"
  local repo="$TMPROOT/$name"
  local origin="$TMPROOT/$name-origin.git"
  mkdir -p "$repo/scripts/local"
  git init -q -b main "$repo"
  git -C "$repo" config user.email test@example.invalid
  git -C "$repo" config user.name Test
  cp "$SOURCE_SCRIPT" "$repo/scripts/local/deploy-production.sh"
  cat > "$repo/scripts/local/pre-push-check.sh" <<'FAKE'
#!/usr/bin/env bash
echo "fake pre-push $*"
exit "${FAKE_PREPUSH_RC:-0}"
FAKE
  chmod +x "$repo/scripts/local/deploy-production.sh" "$repo/scripts/local/pre-push-check.sh"
  printf 'baseline\n' > "$repo/README.md"
  git -C "$repo" add .
  git -C "$repo" commit -qm baseline
  git init -q --bare "$origin"
  git -C "$repo" remote add origin "$origin"
  git -C "$repo" push -q origin main

  cat > "$TMPROOT/$name.conf" <<CONF
DEPLOY_SSH_HOST=test-host
DEPLOY_APP_DIR=/var/www/liuxianlab
DEPLOY_SCRIPT=/usr/local/bin/deploy-liuxianlab.sh
DEPLOY_HEALTH_URL=http://127.0.0.1:8080/health
CONF
  cat > "$TMPROOT/$name-ssh" <<'FAKE'
#!/usr/bin/env bash
cmd="${!#}"
printf '%s\n' "$cmd" >> "$FAKE_SSH_LOG"
case "$cmd" in
  *"fetch origin"*)
    exit "${FAKE_FETCH_RC:-0}" ;;
  *"--dry-run"*)
    printf '%s\n' "${FAKE_DRY_OUTPUT:-}"
    exit "${FAKE_DRY_RC:-0}" ;;
  *"curl --fail"*)
    printf '%s\n' '{"ok":true}'
    exit "${FAKE_HEALTH_RC:-0}" ;;
  *)
    printf 'DEPLOY_COMMAND\n' >> "$FAKE_SSH_LOG"
    printf '%s\n' "${FAKE_DEPLOY_OUTPUT:-deployed}"
    exit "${FAKE_DEPLOY_RC:-0}" ;;
esac
FAKE
  chmod +x "$TMPROOT/$name-ssh"
  printf '%s' "$repo"
}

run_deploy() {
  local repo="$1" name="$2" tag="$3"
  local stdin_value="${4:-}"
  mkdir -p "$TMPROOT/$name-state" "$TMPROOT/$name-tmp"
  (
    cd "$repo"
    if [[ -n "$stdin_value" ]]; then
      printf '%s\n' "$stdin_value" | env \
        DEPLOY_CONF="$TMPROOT/$name.conf" \
        DEPLOY_SSH_BIN="$TMPROOT/$name-ssh" \
        DEPLOY_PRE_PUSH_CHECK="${DEPLOY_PRE_PUSH_CHECK_OVERRIDE:-$repo/scripts/local/pre-push-check.sh}" \
        DEPLOY_TAG="$tag" \
        PATH="$TMPROOT/fakebin:$PATH" \
        FAKE_SSH_LOG="$TMPROOT/$name-ssh.log" \
        FAKE_GIT_LOG="$TMPROOT/$name-git.log" \
        FAKE_GIT_PUSH_ATTEMPTED="$TMPROOT/$name-push-attempted" \
        FAKE_GIT_LS_REMOTE_FAIL="${FAKE_GIT_LS_REMOTE_FAIL:-}" \
        FAKE_GIT_LS_REMOTE_FAIL_AFTER_PUSH="${FAKE_GIT_LS_REMOTE_FAIL_AFTER_PUSH:-}" \
        FAKE_GIT_PUSH_FAIL="${FAKE_GIT_PUSH_FAIL:-}" \
        FAKE_GIT_PUSH_SILENT_SUCCESS="${FAKE_GIT_PUSH_SILENT_SUCCESS:-}" \
        FAKE_PREPUSH_RC="${FAKE_PREPUSH_RC:-}" \
        FAKE_FETCH_RC="${FAKE_FETCH_RC:-}" \
        FAKE_DRY_RC="${FAKE_DRY_RC:-}" \
        FAKE_DRY_OUTPUT="${FAKE_DRY_OUTPUT:-}" \
        FAKE_DEPLOY_RC="${FAKE_DEPLOY_RC:-}" \
        FAKE_HEALTH_RC="${FAKE_HEALTH_RC:-}" \
        XDG_STATE_HOME="$TMPROOT/$name-state" \
        TMPDIR="$TMPROOT/$name-tmp" \
        bash scripts/local/deploy-production.sh
    else
      env \
        DEPLOY_CONF="$TMPROOT/$name.conf" \
        DEPLOY_SSH_BIN="$TMPROOT/$name-ssh" \
        DEPLOY_PRE_PUSH_CHECK="${DEPLOY_PRE_PUSH_CHECK_OVERRIDE:-$repo/scripts/local/pre-push-check.sh}" \
        DEPLOY_TAG="$tag" \
        PATH="$TMPROOT/fakebin:$PATH" \
        FAKE_SSH_LOG="$TMPROOT/$name-ssh.log" \
        FAKE_GIT_LOG="$TMPROOT/$name-git.log" \
        FAKE_GIT_PUSH_ATTEMPTED="$TMPROOT/$name-push-attempted" \
        FAKE_GIT_LS_REMOTE_FAIL="${FAKE_GIT_LS_REMOTE_FAIL:-}" \
        FAKE_GIT_LS_REMOTE_FAIL_AFTER_PUSH="${FAKE_GIT_LS_REMOTE_FAIL_AFTER_PUSH:-}" \
        FAKE_GIT_PUSH_FAIL="${FAKE_GIT_PUSH_FAIL:-}" \
        FAKE_GIT_PUSH_SILENT_SUCCESS="${FAKE_GIT_PUSH_SILENT_SUCCESS:-}" \
        FAKE_PREPUSH_RC="${FAKE_PREPUSH_RC:-}" \
        FAKE_FETCH_RC="${FAKE_FETCH_RC:-}" \
        FAKE_DRY_RC="${FAKE_DRY_RC:-}" \
        FAKE_DRY_OUTPUT="${FAKE_DRY_OUTPUT:-}" \
        FAKE_DEPLOY_RC="${FAKE_DEPLOY_RC:-}" \
        FAKE_HEALTH_RC="${FAKE_HEALTH_RC:-}" \
        XDG_STATE_HOME="$TMPROOT/$name-state" \
        TMPDIR="$TMPROOT/$name-tmp" \
        bash scripts/local/deploy-production.sh
    fi
  )
}

expect_fail() {
  local name="$1"; shift
  local repo name_tag
  repo="$(make_repo "$name")"
  name_tag="test-$name"
  set +e
  "$@" >/dev/null 2>&1
  local rc=$?
  set -e
  [[ "$rc" -ne 0 ]] && ok "$name fails closed" || bad "$name unexpectedly succeeded"
  if git -C "$repo" rev-parse -q --verify "refs/tags/$name_tag" >/dev/null; then
    bad "$name created a tag before failing"
  else
    ok "$name did not create a tag"
  fi
}

# 1. Dirty workspace.
repo="$(make_repo dirty)"; printf 'dirty\n' > "$repo/dirty.txt"
set +e
run_deploy "$repo" dirty test-dirty >/dev/null 2>&1
rc=$?
set -e
[[ "$rc" -ne 0 ]] && ok 'dirty workspace is rejected' || bad 'dirty workspace was accepted'
git -C "$repo" rev-parse -q --verify refs/tags/test-dirty >/dev/null 2>&1 && bad 'dirty workspace created a tag' || ok 'dirty workspace did not create a tag'

# 2. Non-main branch.
repo="$(make_repo branch)"; git -C "$repo" checkout -qb feature
set +e
run_deploy "$repo" branch test-branch >/dev/null 2>&1
rc=$?
set -e
[[ "$rc" -ne 0 ]] && ok 'non-main branch is rejected' || bad 'non-main branch was accepted'

# 3. HEAD differs from origin/main.
repo="$(make_repo behind)"; printf 'ahead\n' >> "$repo/README.md"; git -C "$repo" add README.md; git -C "$repo" commit -qm ahead
set +e
run_deploy "$repo" behind test-behind >/dev/null 2>&1
rc=$?
set -e
[[ "$rc" -ne 0 ]] && ok 'local/origin divergence is rejected' || bad 'diverged HEAD was accepted'

# 4. Pre-push failure.
repo="$(make_repo prepush)"
cat > "$TMPROOT/fail-pre-push.sh" <<'FAIL'
#!/usr/bin/env bash
echo "intentional pre-push failure"
exit 1
FAIL
chmod +x "$TMPROOT/fail-pre-push.sh"
set +e
export DEPLOY_PRE_PUSH_CHECK_OVERRIDE="$TMPROOT/fail-pre-push.sh"
run_deploy "$repo" prepush test-prepush >/dev/null 2>&1
rc=$?
unset DEPLOY_PRE_PUSH_CHECK_OVERRIDE
set -e
[[ "$rc" -ne 0 ]] && ok 'pre-push failure stops release' || bad 'pre-push failure was ignored'
git -C "$repo" rev-parse -q --verify refs/tags/test-prepush >/dev/null 2>&1 && bad 'pre-push failure created a tag' || ok 'pre-push failure did not create a tag'

# 5a. Remote tag conflict while the local tag does not exist.
repo="$(make_repo remoteconflict)"
origin="$TMPROOT/remoteconflict-origin.git"
git --git-dir="$origin" update-ref refs/tags/test-remoteconflict "$(git -C "$repo" rev-parse HEAD)"
set +e
run_deploy "$repo" remoteconflict test-remoteconflict >"$TMPROOT/remoteconflict.out" 2>&1
rc=$?
set -e
[[ "$rc" -ne 0 ]] && ok 'remote tag conflict is rejected' || bad 'remote tag conflict was ignored'
git -C "$repo" rev-parse -q --verify refs/tags/test-remoteconflict >/dev/null 2>&1 && bad 'remote conflict created a local tag' || ok 'remote conflict did not create a local tag'
grep -q 'remote tag already exists' "$TMPROOT/remoteconflict.out" && ok 'remote conflict is reported clearly' || bad 'remote conflict message missing'

# 5b. Local tag conflict.
repo="$(make_repo conflict)"; git -C "$repo" tag -a test-conflict -m existing; git -C "$repo" push -q origin test-conflict
set +e
run_deploy "$repo" conflict test-conflict >/dev/null 2>&1
rc=$?
set -e
[[ "$rc" -ne 0 ]] && ok 'local tag conflict is rejected' || bad 'local tag conflict was overwritten'

# 5c. Remote tag lookup network/authentication failure must fail closed.
repo="$(make_repo remotefail)"
set +e
FAKE_GIT_LS_REMOTE_FAIL=1 run_deploy "$repo" remotefail test-remotefail >"$TMPROOT/remotefail.out" 2>&1
rc=$?
set -e
[[ "$rc" -ne 0 ]] && ok 'remote tag lookup failure is rejected' || bad 'remote tag lookup failure was ignored'
git -C "$repo" rev-parse -q --verify refs/tags/test-remotefail >/dev/null 2>&1 && bad 'remote lookup failure created a local tag' || ok 'remote lookup failure did not create a local tag'
grep -q 'no local tag was created' "$TMPROOT/remotefail.out" && ok 'remote lookup failure is reported clearly' || bad 'remote lookup failure message missing'
grep -q 'DEPLOY_COMMAND' "$TMPROOT/remotefail-ssh.log" 2>/dev/null && bad 'remote lookup failure still deployed' || ok 'remote lookup failure did not deploy'

# 6. Dry-run failure.
repo="$(make_repo dryfail)"
set +e
FAKE_DRY_RC=1 run_deploy "$repo" dryfail test-dryfail >/dev/null 2>&1
rc=$?
set -e
[[ "$rc" -ne 0 ]] && ok 'dry-run failure stops deployment' || bad 'dry-run failure was ignored'
grep -q 'DEPLOY_COMMAND' "$TMPROOT/dryfail-ssh.log" 2>/dev/null && bad 'dry-run failure still deployed' || ok 'dry-run failure did not deploy'

# 7. User rejects Python dependency installation.
repo="$(make_repo rejectdeps)"
set +e
FAKE_DRY_OUTPUT='Python dependency preflight: one or more registered environments are missing packages or are out of specification.' \
  run_deploy "$repo" rejectdeps test-rejectdeps n >/dev/null 2>&1
rc=$?
set -e
[[ "$rc" -ne 0 ]] && ok 'user rejection stops before formal deploy' || bad 'user rejection was ignored'
grep -q 'DEPLOY_COMMAND' "$TMPROOT/rejectdeps-ssh.log" 2>/dev/null && bad 'user rejection still deployed' || ok 'user rejection did not deploy'

# 8. Remote tag absent, normal creation/push, dependencies satisfied: no prompt.
repo="$(make_repo okdeps)"
origin="$TMPROOT/okdeps-origin.git"
git --git-dir="$origin" update-ref refs/tags/test-okdeps-prefix "$(git -C "$repo" rev-parse HEAD)"
run_deploy "$repo" okdeps test-okdeps >/dev/null 2>&1 || bad 'satisfied dependency deployment failed'
ok 'satisfied dependency deployment succeeds'
grep -q -- '--yes-python-deps' "$TMPROOT/okdeps-ssh.log" && bad 'unexpected dependency override' || ok 'no dependency override when not needed'
local_tag="$(git -C "$repo" rev-parse refs/tags/test-okdeps 2>/dev/null || true)"
remote_tag="$(git --git-dir="$origin" rev-parse refs/tags/test-okdeps 2>/dev/null || true)"
[[ -n "$local_tag" && "$local_tag" == "$remote_tag" ]] && ok 'created tag was pushed to origin' || bad 'created tag was not verified on origin'
[[ "$(git --git-dir="$origin" rev-parse refs/tags/test-okdeps^{} 2>/dev/null || true)" == "$(git -C "$repo" rev-parse HEAD)" ]] && ok 'pushed tag points to release commit' || bad 'pushed tag points to wrong commit'

# 9. Dependency installation after explicit approval.
repo="$(make_repo yesdeps)"
FAKE_DRY_OUTPUT='Python dependency preflight: one or more registered environments are missing packages or are out of specification.' \
  run_deploy "$repo" yesdeps test-yesdeps y >/dev/null 2>&1 || bad 'approved dependency deployment failed'
ok 'approved dependency deployment succeeds'
grep -q -- '--yes-python-deps' "$TMPROOT/yesdeps-ssh.log" && ok 'approved dependency deployment passes explicit flag' || bad 'approved dependency flag missing'

# 10. Unregistered environment / unsupported dry-run failure.
repo="$(make_repo unknownenv)"
set +e
FAKE_DRY_RC=3 FAKE_DRY_OUTPUT='no Python environment mapping for manifest' run_deploy "$repo" unknownenv test-unknownenv >/dev/null 2>&1
rc=$?
set -e
[[ "$rc" -ne 0 ]] && ok 'unknown Python environment stops deployment' || bad 'unknown Python environment was accepted'
grep -q 'DEPLOY_COMMAND' "$TMPROOT/unknownenv-ssh.log" 2>/dev/null && bad 'unknown environment still deployed' || ok 'unknown environment did not deploy'

# 11. SSH fetch failure.
repo="$(make_repo sshfail)"
set +e
FAKE_FETCH_RC=255 run_deploy "$repo" sshfail test-sshfail >/dev/null 2>&1
rc=$?
set -e
[[ "$rc" -ne 0 ]] && ok 'SSH fetch failure is reported' || bad 'SSH fetch failure was ignored'

# 12. Health failure after deploy.
repo="$(make_repo healthfail)"
set +e
FAKE_HEALTH_RC=1 run_deploy "$repo" healthfail test-healthfail >/dev/null 2>&1
rc=$?
set -e
[[ "$rc" -ne 0 ]] && ok 'post-deploy health failure stops success claim' || bad 'health failure was ignored'
grep -q 'DEPLOY_COMMAND' "$TMPROOT/healthfail-ssh.log" 2>/dev/null && ok 'formal deploy ran before health failure' || bad 'formal deploy did not run'

# 13. Unsafe tag is rejected before any tag creation.
repo="$(make_repo badtag)"
set +e
run_deploy "$repo" badtag 'bad tag;touch-pwn' >/dev/null 2>&1
rc=$?
set -e
[[ "$rc" -ne 0 ]] && ok 'unsafe tag is rejected' || bad 'unsafe tag was accepted'

# 14. Tag push failure: fail closed, no force-push/delete, no deployment.
repo="$(make_repo pushfail)"
origin="$TMPROOT/pushfail-origin.git"
set +e
FAKE_GIT_PUSH_FAIL=1 run_deploy "$repo" pushfail test-pushfail >"$TMPROOT/pushfail.out" 2>&1
rc=$?
set -e
[[ "$rc" -ne 0 ]] && ok 'tag push failure is rejected' || bad 'tag push failure was ignored'
git --git-dir="$origin" rev-parse -q --verify refs/tags/test-pushfail >/dev/null 2>&1 && bad 'push failure left a remote tag' || ok 'push failure left no remote tag'
grep -q 'DEPLOY_COMMAND' "$TMPROOT/pushfail-ssh.log" 2>/dev/null && bad 'push failure still deployed' || ok 'push failure did not deploy'
grep -Eq -- '(^| )--force( |$)|(^| )-f( |$)|(^| )\+refs/tags/' "$TMPROOT/pushfail-git.log" 2>/dev/null && bad 'push failure used force' || ok 'push failure did not use force-push'
grep -Eq -- '(^| )--delete( |$)|(^| )-d( |$)|(^| ):refs/tags/' "$TMPROOT/pushfail-git.log" 2>/dev/null && bad 'push failure deleted remote tag' || ok 'push failure did not delete remote tag'
grep -q 'no force-push' "$TMPROOT/pushfail.out" && ok 'push failure reports no force-push' || bad 'push failure recovery message missing'

# 15. Push outcome uncertain: post-push lookup fails, do not claim success.
repo="$(make_repo pushuncertain)"
set +e
FAKE_GIT_PUSH_FAIL=1 FAKE_GIT_LS_REMOTE_FAIL_AFTER_PUSH=1 \
  run_deploy "$repo" pushuncertain test-pushuncertain >"$TMPROOT/pushuncertain.out" 2>&1
rc=$?
set -e
[[ "$rc" -ne 0 ]] && ok 'uncertain push is rejected' || bad 'uncertain push was accepted'
grep -q 'Deployment completed' "$TMPROOT/pushuncertain.out" && bad 'uncertain push claimed success' || ok 'uncertain push did not claim success'
grep -q 'Remote state is uncertain' "$TMPROOT/pushuncertain.out" && ok 'uncertain push asks for manual review' || bad 'uncertain push warning missing'
grep -q 'DEPLOY_COMMAND' "$TMPROOT/pushuncertain-ssh.log" 2>/dev/null && bad 'uncertain push still deployed' || ok 'uncertain push did not deploy'

# 16. git push reports success but remote tag is absent: do not claim success.
repo="$(make_repo pushsilent)"
origin="$TMPROOT/pushsilent-origin.git"
set +e
FAKE_GIT_PUSH_SILENT_SUCCESS=1 run_deploy "$repo" pushsilent test-pushsilent >"$TMPROOT/pushsilent.out" 2>&1
rc=$?
set -e
[[ "$rc" -ne 0 ]] && ok 'unconfirmed push is rejected' || bad 'unconfirmed push was accepted'
grep -q 'Deployment completed' "$TMPROOT/pushsilent.out" && bad 'unconfirmed push claimed success' || ok 'unconfirmed push did not claim success'
git --git-dir="$origin" rev-parse -q --verify refs/tags/test-pushsilent >/dev/null 2>&1 && bad 'unconfirmed push created a remote tag' || ok 'unconfirmed push left no remote tag'
grep -q 'DEPLOY_COMMAND' "$TMPROOT/pushsilent-ssh.log" 2>/dev/null && bad 'unconfirmed push still deployed' || ok 'unconfirmed push did not deploy'

echo
echo "RESULT: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]]
