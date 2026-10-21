# Python dependency management during production deployment

## Policy

The production deployer no longer stops merely because a tracked `requirements*.txt` changed. It asks for confirmation, then checks whether the packages required by the release are already satisfied in their mapped Python environments. Missing or out-of-constraint packages are installed only after approval.

The same check runs on normal releases even when no dependency manifest changed. This catches a missing package or an absent virtual environment before the service restart.

## Environment mapping

`scripts/python-environments.tsv` is a tab-separated registry with these columns:

1. manifest glob (or `@always` for a script-managed environment)
2. repository-relative virtual environment path
3. handler type (`requirements` or `script`)
4. comma-separated smoke imports, or `-`
5. installer script for `@always` rows, or `-`

Specific rows must appear before generic rows. Existing shared/special environments are explicitly mapped. New `services/<module>/requirements*.txt` manifests default to `.<module-with-hyphens>-venv`, so the module's worker must use the same path or the manifest must have an explicit registry override.

## Behavior

- The target release is extracted to a temporary tree and checked **before backup or code switch**. `--dry-run` runs this full check and reports missing/out-of-spec environments, but never installs or creates a venv.
- A real deployment prompts `[y/N]` before installing missing packages; cancelling leaves production code untouched.
- After approval and a successful backup, installation runs **before** the code switch. A post-switch `check` verifies the installed environments again.
- `--yes-python-deps` is an explicit opt-in for non-interactive deployments; use it only when unattended installation is approved.
- The manager uses pip's dry-run/report mode; for older pip it falls back to a read-only PEP 508 check using pip's vendored packaging library. It runs registered smoke imports after installation.
- Deleting a manifest does not automatically uninstall packages from the environment.
- Unknown Python manifest formats (`pyproject.toml`, `poetry.lock`, `uv.lock`, `Pipfile`) and unregistered `requirements*.txt` paths fail closed. There is no guessed `.<module>-venv` fallback; add an explicit registry row.
- `workers/*/requirements*.txt` maps to the shared `.venv`.
- Dependency installation can modify a Python environment even if a later deployment stage rolls code back. The manager isolates new module dependencies only when explicitly mapped, and shared environments should only be mapped intentionally.

## Test

Run:

```bash
bash -n /usr/local/bin/deploy-liuxianlab.sh
bash -n scripts/local/python-dependency-manager.sh
bash tests/deployment/python-dependency-manager.test.sh \
  /usr/local/bin/deploy-liuxianlab.sh \
  scripts/local/python-dependency-manager.sh \
  scripts/python-environments.tsv
```

The test uses a temporary Git repository and a fake Python interpreter; it does not install packages or modify production.
