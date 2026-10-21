# One-command production deployment

Local entry point:

```bash
npm run deploy:prod
```

Implementation: `scripts/local/deploy-production.sh`.

Server mode (`liuxianlab-deploy`) is documented in
`server-auto-deploy.md`. Server mode ignores this local SSH config.

In local mode this is a thin local orchestrator. It does **not** replace the
production deployer; it invokes the existing
`/usr/local/bin/deploy-liuxianlab.sh` over SSH.

## Flow

```text
1. Verify repository root, branch main, clean worktree.
2. Fetch origin/main and require HEAD == origin/main.
3. Run scripts/local/pre-push-check.sh --full.
4. Load ~/.config/liuxianlab/deploy.conf.
5. Create a unique annotated tag:
     liuxianlab-deploy-YYYYmmdd-HHMMSS-<12-char-sha>
   - query origin and distinguish tag present / absent / lookup error
   - create the local tag only when the remote lookup succeeded and the tag is absent
   - push the tag; never force
   - re-query origin and verify tag object + commit before deployment
6. SSH: fetch tags in /var/www/liuxianlab.
7. SSH: run the existing deployer with --dry-run.
8. Parse dry-run output:
   - dependencies satisfied -> continue without prompting
   - missing/out-of-spec -> show manifest/environment/plan, ask [y/N] once
   - user refuses -> stop before formal deployment
   - unknown/unregistered environment -> stop
9. SSH: run formal deployment. Add --yes-python-deps only after explicit approval.
10. SSH: curl the configured health endpoint and report the result.
```

Any failure stops; there is no automatic retry. No business commit is created.
The local script only creates/pushes the release tag.

## First-time SSH configuration

The script reads (no secrets):

```text
~/.config/liuxianlab/deploy.conf
```

Create it once:

```bash
mkdir -p ~/.config/liuxianlab
cp scripts/local/deploy-production.conf.example ~/.config/liuxianlab/deploy.conf
chmod 600 ~/.config/liuxianlab/deploy.conf
```

Edit `DEPLOY_SSH_HOST` to an existing SSH host alias:

```sshconfig
Host liuxianlab-prod
  HostName <real-host>
  User <deploy-user>
  IdentityFile ~/.ssh/<key>
```

Example config:

```text
DEPLOY_SSH_HOST=liuxianlab-prod
DEPLOY_APP_DIR=/var/www/liuxianlab
DEPLOY_SCRIPT=/usr/local/bin/deploy-liuxianlab.sh
DEPLOY_HEALTH_URL=http://127.0.0.1:8080/health
```

Optional: `DEPLOY_SSH_PORT=22`.

Do not put passwords, private keys, or tokens in this file. SSH uses
`BatchMode=yes` and the configured host/agent/key.

## Dependency confirmation

The production deployer already performs target-release dependency planning and
checks. The local script only parses its dry-run output:

- No missing dependencies: no extra prompt; formal deploy runs normally.
- Missing/out-of-spec: manifest/environment/reason lines are shown; one `[y/N]`
  prompt is asked locally. On approval, formal deploy receives
  `--yes-python-deps`. On refusal, production code is not switched.
- Unknown manifest/format or environment mapping: dry-run fails; no formal deploy.

`--yes-python-deps` is never added speculatively.

## Usage

```bash
# Preconditions
git switch main
git status --short          # must be empty
git pull --ff-only origin main

npm run deploy:prod
```

The script creates and pushes a new annotated tag. It does not tag an old release
or overwrite an existing tag.

## Failure recovery

- Local checks fail: no tag is created; fix the branch/worktree/tests.
- Remote tag lookup fails (network/auth/Git): stop before creating a local tag.
  Check connectivity/credentials; the release was not started.
- Remote tag exists: stop without overwriting it. Investigate the existing tag.
- Tag push fails: the script never force-pushes or deletes the remote tag. It
  re-queries origin. If the tag is absent, the local tag is kept for inspection.
  If lookup fails or the remote tag does not match, stop for manual review.
- `git push` reports success but origin has no matching tag: stop as unconfirmed;
  do not treat the release as published.
- SSH fetch/dry-run fails: production was not intentionally changed; inspect SSH
  connectivity and the remote deploy log. The release tag may already exist.
- Dependency prompt refused: deployment stops before code switch; rerun after
  resolving dependencies or after reviewing the plan.
- Formal deploy fails: the remote deployer handles backup/rollback and prints its
  log path. Do not rerun automatically. Inspect `/var/log/liuxianlab-deploy/` and
  verify production health before a new release.
- Health check fails after deploy: treat deployment as failed until verified;
  inspect remote logs and roll back according to the deployer runbook.

The local log is under:

```text
~/.local/state/liuxianlab/deploy/
```

## Testing

```bash
bash -n scripts/local/deploy-production.sh
bash tests/deployment/deploy-production.test.sh
bash tests/deployment/deploy-server-auto.test.sh
bash tests/deployment/python-dependency-manager.test.sh \
  deploy-liuxianlab.sh scripts/local/python-dependency-manager.sh scripts/python-environments.tsv
```

The tests use a temporary Git repository, a bare local origin, a fake SSH
command, and no real production server.

## Protected untracked files

The script never removes or ignores protected untracked files (for example,
`services/journal_entry.zip` when present). Because `deploy:prod` requires a clean
worktree, such a file must be moved outside the repo or otherwise handled by the
owner before a one-command deployment.
