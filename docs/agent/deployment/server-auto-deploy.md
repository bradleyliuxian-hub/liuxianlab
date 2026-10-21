# Server auto-deploy from latest `origin/main`

Server entry point:

```bash
liuxianlab-deploy
```

Reviewed source: `scripts/local/deploy-production.sh`.

The same file still supports the earlier local `npm run deploy:prod` workflow. When
invoked as `liuxianlab-deploy` (or with `--server`), it runs server mode and does
not use SSH or the local deployment config.

## Install once on the server

The command should live outside the production checkout. A copy, not a symlink,
avoids re-reading the script from the checkout while deployment fast-forwards it.

```bash
sudo install -m 0755 /var/www/liuxianlab/scripts/local/deploy-production.sh \
  /usr/local/bin/liuxianlab-deploy
```

The existing production deployer must already be installed at:

```text
/usr/local/bin/deploy-liuxianlab.sh
```

Reinstall the wrapper after an approved change to
`scripts/local/deploy-production.sh`.

## Flow

```text
1. Enter /var/www/liuxianlab (override with DEPLOY_APP_DIR).
2. Require branch main and a clean worktree.
3. Fetch only origin/main from GitHub.
4. Resolve origin/main to a commit and verify it exists.
5. Require origin/main to be a fast-forward descendant of production HEAD.
6. Create a unique local annotated tag at that exact commit.
   - tag is never pushed to GitHub
   - a second run gets a unique suffix instead of reusing the tag
7. Run the existing deployer with --dry-run.
8. Re-check that origin/main did not advance during dry-run.
9. Show Python dependency changes and ask once if required.
10. Run the existing deployer for backup, code switch, migrations, PM2,
    health checks, and rollback behavior.
```

The deployer receives `--yes-python-deps` only after explicit local approval.
There is no automatic retry. The local-only tag is retained for audit and is
never pushed.

## Why the local tag survives

`deploy-liuxianlab.sh` runs:

```bash
git fetch origin --tags --prune
```

Normally this does not prune local tags. However, if Git is configured with
`fetch.pruneTags=true`, that fetch deletes local tags that are not on the remote.
The wrapper therefore forces `fetch.pruneTags=false` for the deployer and its
child Git commands via `GIT_CONFIG_COUNT` / `GIT_CONFIG_KEY_n` /
`GIT_CONFIG_VALUE_n`, without modifying the deployer or Git config.

The test suite sets `fetch.pruneTags=true` globally and verifies that the
temporary local tag survives the deployer's fetch/prune.

## Safety behavior

Stop before creating a tag when:

- GitHub fetch fails.
- Production is not on `main`.
- The worktree is dirty.
- `origin/main` is missing or not a commit.
- `origin/main` is not a fast-forward descendant of production HEAD.
- The generated tag is invalid or already exists.

Stop before formal deployment when:

- Dry-run fails.
- `origin/main` advances during dry-run.
- Python dependencies are required but the operator declines.
- The dependency environment is unknown/unregistered.

The existing deployer still owns backup, migrations, PM2, health checks, and
code rollback. The wrapper never commits or pushes business code and never pushes
the deployment tag.

## Optional overrides

Primarily for tests or unusual installations:

```text
DEPLOY_APP_DIR       production repo path (default /var/www/liuxianlab)
DEPLOY_SCRIPT        deployer path (default /usr/local/bin/deploy-liuxianlab.sh)
DEPLOY_TAG           exact local tag name; fails if it already exists
LIUXIANLAB_DEPLOY_MODE=server
                     force server mode without the command name
```

`DEPLOY_TAG` is not required in normal use.

## Testing

```bash
bash -n scripts/local/deploy-production.sh
bash tests/deployment/deploy-production.test.sh
bash tests/deployment/deploy-server-auto.test.sh
npm test
```

Tests use temporary Git repositories, a bare local origin, and a fake deployer.
They do not connect to production.
