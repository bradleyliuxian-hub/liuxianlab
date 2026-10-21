#!/usr/bin/env bash
set -Eeuo pipefail

SOURCE_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SOURCE_SCRIPT="$SOURCE_ROOT/scripts/local/deploy-production.sh"
TMPROOT="$(mktemp -d)"
trap 'rm -rf "$TMPROOT"' EXIT
PASS=0
FAIL=0

ok() { PASS=$((PASS + 1)); printf 'PASS: %s\n' "$1"; }
bad() { FAIL=$((FAIL + 1)); printf 'FAIL: %s\n' "$1" >&2; }

GLOBAL_CONFIG="$TMPROOT/gitconfig-prunetags"
printf '[fetch]\n\tpruneTags = true\n' > "$GLOBAL_CONFIG"

FAKE_DEPLOYER="$TMPROOT/server-deployer"
cat > "$FAKE_DEPLOYER" <<'FAKE'
#!/usr/bin/env bash
set -Eeuo pipefail
tag="${1:?missing tag}"
shift
printf '%s|%s\n' "$tag" "$*" >> "$FAKE_DEPLOY_LOG"

if [[ "${1:-}" == "--dry-run" ]]; then
  # Match the existing deployer's fetch/prune before it checks the tag.
  git fetch origin --tags --prune >/dev/null 2>&1
  if ! git show-ref --verify --quiet "refs/tags/$tag"; then
    echo "ERROR: local deployment tag was deleted by fetch --prune" >&2
    exit 44
  fi
  if [[ "${FAKE_DRY_ADVANCE_MAIN:-}" == "1" ]]; then
    new_main="$(git commit-tree "$(git rev-parse HEAD^{tree})" -m 'advance during dry-run')"
    git update-ref refs/remotes/origin/main "$new_main"
  fi
  printf '%s\n' "${FAKE_DRY_OUTPUT:-}"
  exit "${FAKE_DRY_RC:-0}"
fi

echo "FORMAL_DEPLOY $tag"
exit "${FAKE_DEPLOY_RC:-0}"
FAKE
chmod +x "$FAKE_DEPLOYER"

make_server_repo() {
  local name="$1"
  local origin="$TMPROOT/$name-origin.git"
  local seed="$TMPROOT/$name-seed"
  local repo="$TMPROOT/$name-prod"

  git init -q -b main "$seed"
  git -C "$seed" config user.email test@example.invalid
  git -C "$seed" config user.name Test
  printf 'baseline\n' > "$seed/README.md"
  git -C "$seed" add .
  git -C "$seed" commit -qm baseline

  git init -q --bare "$origin"
  git -C "$seed" remote add origin "$origin"
  git -C "$seed" push -q origin main

  git clone -q "$origin" "$repo"
  git -C "$repo" config user.email test@example.invalid
  git -C "$repo" config user.name Test

  printf '%s' "$repo"
}

advance_origin() {
  local name="$1"
  local seed="$TMPROOT/$name-seed"
  printf 'release-%s\n' "$name" >> "$seed/release.txt"
  git -C "$seed" add release.txt
  git -C "$seed" commit -qm "release $name"
  git -C "$seed" push -q origin main
}

# run_server <repo> <name> [stdin] [command]
# command defaults to the source script with --server. A symlink named
# liuxianlab-deploy can be passed to exercise basename-based mode selection.
run_server() {
  local repo="$1" name="$2" stdin_value="${3:-}" command="${4:-}"
  local log="$TMPROOT/$name-deployer.log"
  local -a cmd envs
  mkdir -p "$TMPROOT/$name-state" "$TMPROOT/$name-tmp"
  : > "$log"

  if [[ -n "$command" ]]; then
    cmd=("$command")
  else
    cmd=(bash "$SOURCE_SCRIPT" --server)
  fi

  envs=(
    "DEPLOY_APP_DIR=$repo"
    "DEPLOY_SCRIPT=$FAKE_DEPLOYER"
    "DEPLOY_TAG="
    "GIT_CONFIG_GLOBAL=$GLOBAL_CONFIG"
    "GIT_CONFIG_NOSYSTEM=1"
    "FAKE_DEPLOY_LOG=$log"
    "FAKE_DRY_OUTPUT=${FAKE_DRY_OUTPUT:-}"
    "FAKE_DRY_RC=${FAKE_DRY_RC:-}"
    "FAKE_DEPLOY_RC=${FAKE_DEPLOY_RC:-}"
    "FAKE_DRY_ADVANCE_MAIN=${FAKE_DRY_ADVANCE_MAIN:-}"
    "XDG_STATE_HOME=$TMPROOT/$name-state"
    "TMPDIR=$TMPROOT/$name-tmp"
  )

  if [[ -n "$stdin_value" ]]; then
    printf '%s\n' "$stdin_value" | env "${envs[@]}" "${cmd[@]}"
  else
    env "${envs[@]}" "${cmd[@]}"
  fi
}

# 1. Auto-select latest origin/main; generate annotated tag; run dry-run and formal.
repo="$(make_server_repo auto)"; advance_origin auto
origin="$TMPROOT/auto-origin.git"
target="$(git --git-dir="$origin" rev-parse refs/heads/main)"
set +e
run_server "$repo" auto >"$TMPROOT/auto.out" 2>&1
rc=$?
set -e
[[ "$rc" -eq 0 ]] && ok 'server auto-deploy succeeds' || bad 'server auto-deploy failed'
tag="$(git -C "$repo" for-each-ref --format='%(refname:short)' refs/tags | head -1)"
[[ -n "$tag" ]] && ok 'server auto-deploy created a local tag' || bad 'server auto-deploy created no tag'
[[ "$tag" == liuxianlab-deploy-* ]] && ok 'server tag uses deployment naming' || bad 'unexpected server tag name'
[[ "$(git -C "$repo" cat-file -t "$tag" 2>/dev/null || true)" == "tag" ]] && ok 'server tag is annotated' || bad 'server tag is not annotated'
[[ "$(git -C "$repo" rev-parse "$tag^{}" 2>/dev/null || true)" == "$target" ]] && ok 'server tag points to latest origin/main' || bad 'server tag points to wrong commit'
[[ -z "$(git --git-dir="$origin" tag -l)" ]] && ok 'server deployment tag was not pushed' || bad 'server deployment tag was pushed'
grep -Fqx "$tag|--dry-run" "$TMPROOT/auto-deployer.log" && ok 'server deployment ran dry-run first' || bad 'server dry-run missing'
grep -Fqx "$tag|" "$TMPROOT/auto-deployer.log" && ok 'server deployment ran formal deploy with the same tag' || bad 'server formal deploy missing or tag mismatch'
grep -q 'TAG_DELETED_BY_FETCH' "$TMPROOT/auto.out" && bad 'local tag was deleted by deployer fetch/prune' || ok 'local tag survived deployer fetch/prune with pruneTags=true'

# 2. Second run creates a different unique tag at the same latest commit.
set +e
run_server "$repo" unique >"$TMPROOT/unique.out" 2>&1
rc=$?
set -e
[[ "$rc" -eq 0 ]] && ok 'second server auto-deploy succeeds' || bad 'second server auto-deploy failed'
tag_count="$(git -C "$repo" tag -l 'liuxianlab-deploy-*' | wc -l | tr -d ' ')"
[[ "$tag_count" -eq 2 ]] && ok 'server generated a unique second tag' || bad "expected 2 tags, got $tag_count"
all_tags_ok=1
for second_tag in $(git -C "$repo" tag -l 'liuxianlab-deploy-*'); do
  [[ "$(git -C "$repo" rev-parse "$second_tag^{}")" == "$target" ]] || all_tags_ok=0
done
[[ "$all_tags_ok" -eq 1 ]] && ok 'all server deployment tags point to latest origin/main' || bad 'a server deployment tag points to the wrong commit'

# 3. Installed command name selects server mode without --server.
ln -s "$SOURCE_SCRIPT" "$TMPROOT/liuxianlab-deploy"
repo="$(make_server_repo commandname)"; advance_origin commandname
set +e
run_server "$repo" commandname '' "$TMPROOT/liuxianlab-deploy" >"$TMPROOT/commandname.out" 2>&1
rc=$?
set -e
[[ "$rc" -eq 0 ]] && ok 'liuxianlab-deploy command name works' || bad 'liuxianlab-deploy command name failed'

# 4. GitHub fetch failure stops before tag/deployer.
repo="$(make_server_repo fetchfail)"
git -C "$repo" remote set-url origin "$TMPROOT/missing-origin.git"
set +e
run_server "$repo" fetchfail >"$TMPROOT/fetchfail.out" 2>&1
rc=$?
set -e
[[ "$rc" -ne 0 ]] && ok 'server fetch failure is rejected' || bad 'server fetch failure was ignored'
[[ -z "$(git -C "$repo" tag -l 'liuxianlab-deploy-*')" ]] && ok 'fetch failure created no deployment tag' || bad 'fetch failure created a tag'
[[ ! -s "$TMPROOT/fetchfail-deployer.log" ]] && ok 'fetch failure did not run deployer' || bad 'fetch failure ran deployer'
grep -q 'could not fetch origin/main' "$TMPROOT/fetchfail.out" && ok 'fetch failure is reported clearly' || bad 'fetch failure message missing'

# 5. Diverged origin/main is not a valid fast-forward target.
repo="$(make_server_repo diverged)"
advance_origin diverged
printf 'local-only\n' > "$repo/local.txt"
git -C "$repo" add local.txt
git -C "$repo" commit -qm local-only
set +e
run_server "$repo" diverged >"$TMPROOT/diverged.out" 2>&1
rc=$?
set -e
[[ "$rc" -ne 0 ]] && ok 'non-fast-forward origin/main is rejected' || bad 'non-fast-forward origin/main was accepted'
[[ -z "$(git -C "$repo" tag -l 'liuxianlab-deploy-*')" ]] && ok 'target validation failure created no tag' || bad 'target validation failure created a tag'
[[ ! -s "$TMPROOT/diverged-deployer.log" ]] && ok 'target validation failure did not run deployer' || bad 'target validation failure ran deployer'
grep -q 'not a fast-forward descendant' "$TMPROOT/diverged.out" && ok 'target validation failure is reported clearly' || bad 'target validation failure message missing'

# 6. Dirty production worktree stops.
repo="$(make_server_repo dirty)"; printf 'dirty\n' > "$repo/untracked.txt"
set +e
run_server "$repo" dirty >"$TMPROOT/dirty.out" 2>&1
rc=$?
set -e
[[ "$rc" -ne 0 ]] && ok 'dirty server worktree is rejected' || bad 'dirty server worktree was accepted'
[[ -z "$(git -C "$repo" tag -l 'liuxianlab-deploy-*')" ]] && ok 'dirty server worktree created no tag' || bad 'dirty server worktree created a tag'
[[ ! -s "$TMPROOT/dirty-deployer.log" ]] && ok 'dirty server worktree did not run deployer' || bad 'dirty server worktree ran deployer'

# 7. Unknown dependency environment from dry-run stops before formal deploy.
repo="$(make_server_repo unknowndeps)"; advance_origin unknowndeps
set +e
FAKE_DRY_RC=3 FAKE_DRY_OUTPUT='no Python environment mapping for manifest' \
  run_server "$repo" unknowndeps >"$TMPROOT/unknowndeps.out" 2>&1
rc=$?
set -e
[[ "$rc" -ne 0 ]] && ok 'unknown dependency environment is rejected' || bad 'unknown dependency environment was accepted'
grep -q '|--dry-run' "$TMPROOT/unknowndeps-deployer.log" && ok 'unknown dependency environment ran dry-run' || bad 'unknown dependency dry-run missing'
grep -q '|$' "$TMPROOT/unknowndeps-deployer.log" && bad 'unknown dependency environment ran formal deploy' || ok 'unknown dependency environment did not deploy'
grep -q 'Deployment completed' "$TMPROOT/unknowndeps.out" && bad 'unknown dependency environment claimed success' || ok 'unknown dependency environment did not claim success'

# 8. Explicit dependency approval passes --yes-python-deps.
repo="$(make_server_repo yesdeps)"; advance_origin yesdeps
set +e
FAKE_DRY_OUTPUT='Python dependency preflight: one or more registered environments are missing packages or are out of specification.' \
  run_server "$repo" yesdeps y >"$TMPROOT/yesdeps.out" 2>&1
rc=$?
set -e
[[ "$rc" -eq 0 ]] && ok 'approved server dependency deployment succeeds' || bad 'approved server dependency deployment failed'
grep -q -- '--yes-python-deps' "$TMPROOT/yesdeps-deployer.log" && ok 'approved server deployment passes explicit flag' || bad 'approved server deployment flag missing'

# 9. Formal deploy failure is reported and does not claim success.
repo="$(make_server_repo deployfail)"; advance_origin deployfail
set +e
FAKE_DEPLOY_RC=1 run_server "$repo" deployfail >"$TMPROOT/deployfail.out" 2>&1
rc=$?
set -e
[[ "$rc" -ne 0 ]] && ok 'server formal deploy failure is rejected' || bad 'server formal deploy failure was accepted'
grep -q '|--dry-run' "$TMPROOT/deployfail-deployer.log" && ok 'server deploy failure ran dry-run first' || bad 'server deploy failure skipped dry-run'
grep -q '|$' "$TMPROOT/deployfail-deployer.log" && ok 'server deploy failure attempted formal deploy' || bad 'server deploy failure did not run formal deploy'
grep -q 'Deployment completed' "$TMPROOT/deployfail.out" && bad 'server deploy failure claimed success' || ok 'server deploy failure did not claim success'

# 10. origin/main advancing during dry-run must stop before formal deploy.
repo="$(make_server_repo mainmoves)"; advance_origin mainmoves
set +e
FAKE_DRY_ADVANCE_MAIN=1 run_server "$repo" mainmoves >"$TMPROOT/mainmoves.out" 2>&1
rc=$?
set -e
[[ "$rc" -ne 0 ]] && ok 'origin/main advance during dry-run is rejected' || bad 'origin/main advance during dry-run was accepted'
grep -q '|--dry-run' "$TMPROOT/mainmoves-deployer.log" && ok 'main advance case ran dry-run' || bad 'main advance dry-run missing'
grep -q '|$' "$TMPROOT/mainmoves-deployer.log" && bad 'main advance case ran formal deploy' || ok 'main advance case did not deploy'
grep -q 'origin/main advanced during dry-run' "$TMPROOT/mainmoves.out" && ok 'main advance is reported clearly' || bad 'main advance message missing'

echo
echo "RESULT: $PASS passed, $FAIL failed"
[[ "$FAIL" -eq 0 ]]
