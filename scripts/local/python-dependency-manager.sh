#!/usr/bin/env bash
# Generic Liuxian Lab Python dependency manager.
# Modes:
#   plan OLD_COMMIT TARGET_COMMIT  - read-only release plan
#   check                         - detect missing/out-of-spec requirements
#   install                       - install missing requirements in mapped venvs
set -Eeuo pipefail
IFS=$'\n\t'

ROOT="${LIUXIANLAB_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
ENV_ROOT="${LIUXIANLAB_ENV_ROOT:-$ROOT}"
CONFIG_REL="scripts/python-environments.tsv"
CONFIG="${LIUXIANLAB_CONFIG:-$ROOT/$CONFIG_REL}"
MODE="${1:-}"

usage() {
  echo "Usage: $0 plan OLD_COMMIT TARGET_COMMIT | check | install" >&2
  exit 2
}

is_requirements_manifest() {
  local base
  base="$(basename "$1")"
  [[ "$base" == requirements*.txt ]]
}

is_python_manifest() {
  local base
  base="$(basename "$1")"
  [[ "$base" == requirements*.txt || "$base" == pyproject.toml || "$base" == poetry.lock || "$base" == uv.lock || "$base" == Pipfile || "$base" == Pipfile.lock ]]
}

resolve_env() {
  local manifest="$1" config_file="${2:-$CONFIG}" pattern env mode smoke installer
  if [[ -f "$config_file" ]]; then
    while IFS=$'\t' read -r pattern env mode smoke installer; do
      [[ -z "${pattern:-}" || "$pattern" == \#* ]] && continue
      if [[ "$manifest" == $pattern ]]; then
        if [[ "$env" == "@auto" ]]; then
          break
        fi
        printf '%s\n' "$env"
        return 0
      fi
    done < "$config_file"
  fi

  echo "ERROR: no Python environment mapping for manifest: $manifest" >&2
  echo "       Add an explicit row to scripts/python-environments.tsv before deploying." >&2
  return 1
}

resolve_smoke_import() {
  local manifest="$1" config_file="${2:-$CONFIG}" pattern env mode smoke installer
  [[ -f "$config_file" ]] || return 0
  while IFS=$'\t' read -r pattern env mode smoke installer; do
    [[ -z "${pattern:-}" || "$pattern" == \#* ]] && continue
    if [[ "$manifest" == $pattern ]]; then
      [[ "${smoke:--}" == "-" ]] && return 0
      printf '%s\n' "$smoke"
      return 0
    fi
  done < "$config_file"
}

list_changed_manifests() {
  local old="$1" target="$2"
  git -C "$ROOT" diff --name-status --find-renames "$old" "$target" -- \
    | awk -F '\t' '
      function ismanifest(p, n, a) {
        n=split(p,a,"/"); p=a[n]
        return p ~ /^requirements.*\.txt$/ || p == "pyproject.toml" || p == "poetry.lock" || p == "uv.lock" || p == "Pipfile" || p == "Pipfile.lock"
      }
      {
        status=$1
        if (status ~ /^R/ || status ~ /^C/) { path=$3 } else { path=$2 }
        if (path != "" && ismanifest(path)) print status "\t" path
      }'
}

list_tracked_manifests() {
  if git -C "$ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    git -C "$ROOT" ls-tree -r --name-only HEAD | while IFS= read -r path; do
      if is_requirements_manifest "$path"; then printf '%s\n' "$path"; fi
    done
  else
    # Deploy-time target tree extracted with git archive (no .git).
    find "$ROOT" -type d \( -name node_modules -o -name .venv -o -name '*-venv' -o -name .git -o -name .mineru \) -prune -o \
      -type f -name 'requirements*.txt' -print | sed "s#^$ROOT/##" | sort
  fi
}

run_import_check() {
  local python_bin="$1" imports="$2"
  [[ -n "$imports" && "$imports" != "-" ]] || return 0
  "$python_bin" - "$imports" <<'PY'
import importlib
import sys
for name in sys.argv[1].split(','):
    importlib.import_module(name.strip())
PY
}

# Older pip versions (e.g. pip 21) do not support --dry-run. Fall back to a
# read-only PEP 508 requirement check using pip's vendored packaging library.
# Complex manifests (options, URLs, editable installs) fail closed.
fallback_check_requirements() {
  local manifest="$1" venv="$2" python_bin="$3"
  "$python_bin" - "$ROOT/$manifest" <<'PY'
import sys
try:
    from pip._vendor.packaging.requirements import Requirement
except Exception as error:
    print(f"unsupported: pip vendored packaging unavailable: {error}", file=sys.stderr)
    raise SystemExit(2)
try:
    from importlib.metadata import distribution, PackageNotFoundError
except Exception as error:
    print(f"unsupported: importlib.metadata unavailable: {error}", file=sys.stderr)
    raise SystemExit(2)

path = sys.argv[1]
missing = []
unsupported = []
with open(path, encoding="utf-8") as handle:
    for raw in handle:
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("-"):
            unsupported.append(line)
            continue
        try:
            req = Requirement(line)
        except Exception as error:
            unsupported.append(f"{line} ({error})")
            continue
        if req.marker is not None and not req.marker.evaluate():
            continue
        try:
            dist = distribution(req.name)
        except PackageNotFoundError:
            missing.append(f"{req.name} (not installed)")
            continue
        if req.specifier and not req.specifier.contains(dist.version, prereleases=True):
            missing.append(f"{req.name} {dist.version} does not satisfy {req.specifier}")
if unsupported:
    print("unsupported requirements entries: " + "; ".join(unsupported), file=sys.stderr)
    raise SystemExit(2)
if missing:
    print("missing or out-of-spec: " + "; ".join(missing), file=sys.stderr)
    raise SystemExit(10)
raise SystemExit(0)
PY
  local rc=$?
  if [[ "$rc" -eq 10 ]]; then
    echo "NEEDS_INSTALL|$manifest|$venv|one or more packages are missing or outside the declared constraints"
    return 10
  fi
  if [[ "$rc" -ne 0 ]]; then
    echo "ERROR: fallback requirement check failed for $manifest in $venv" >&2
    return 1
  fi
}

# Return status 0 when satisfied, 10 when installation is needed, 1 on an
# actual resolver/manifest error. No packages are installed in check mode.
check_requirements() {
  local manifest="$1" venv="$2" python_bin report output
  python_bin="$ENV_ROOT/$venv/bin/python"
  if [[ ! -x "$python_bin" ]]; then
    echo "NEEDS_INSTALL|$manifest|$venv|virtual environment is missing"
    return 10
  fi
  report="$(mktemp)"
  output="$(mktemp)"
  if "$python_bin" -m pip install --dry-run --report "$report" -r "$ROOT/$manifest" >"$output" 2>&1; then
    if python3 - "$report" <<'PY'
import json, sys
try:
    data = json.load(open(sys.argv[1], encoding='utf-8'))
except Exception:
    raise SystemExit(2)
raise SystemExit(10 if data.get('install') else 0)
PY
    then
      rm -f "$report" "$output"
      return 0
    else
      rc=$?
      if [[ "$rc" -eq 10 ]]; then
        echo "NEEDS_INSTALL|$manifest|$venv|one or more packages are missing or outside the declared constraints"
        rm -f "$report" "$output"
        return 10
      fi
    fi
  else
    if grep -Eiq 'no such option: --dry-run|unrecognized arguments:.*--dry-run' "$output"; then
      # pip 21 and older do not support --dry-run; use the PEP 508 fallback.
      rm -f "$report" "$output"
      fallback_check_requirements "$manifest" "$venv" "$python_bin"
      return $?
    fi
    if grep -Eiq 'no such option: --report|unrecognized arguments:.*--report' "$output"; then
      # Fallback for older pip versions which support --dry-run but not --report.
      if "$python_bin" -m pip install --dry-run -r "$ROOT/$manifest" >"$output" 2>&1; then
        if grep -Eiq 'Would install|Would install:' "$output"; then
          echo "NEEDS_INSTALL|$manifest|$venv|packages are missing or outside the declared constraints"
          rm -f "$report" "$output"
          return 10
        fi
        rm -f "$report" "$output"
        return 0
      fi
    fi
    echo "ERROR: unable to resolve $manifest in $venv without installing packages:" >&2
    cat "$output" >&2
    rm -f "$report" "$output"
    return 1
  fi
  echo "ERROR: pip returned an unreadable dry-run report for $manifest" >&2
  cat "$output" >&2
  rm -f "$report" "$output"
  return 1
}

check_all() {
  local manifest env smoke installer rc needs=0
  while IFS= read -r manifest; do
    [[ -z "$manifest" ]] && continue
    if ! env="$(resolve_env "$manifest")"; then
      return 1
    fi
    smoke="$(resolve_smoke_import "$manifest" || true)"
    if check_requirements "$manifest" "$env"; then
      if [[ -x "$ROOT/$env/bin/python" ]] && [[ -n "$smoke" && "$smoke" != "-" ]]; then
        if ! run_import_check "$ROOT/$env/bin/python" "$smoke"; then
          echo "NEEDS_INSTALL|$manifest|$env|registered smoke-import check failed"
          needs=1
        fi
      fi
    else
      rc=$?
      if [[ "$rc" -eq 10 ]]; then needs=1; else return "$rc"; fi
    fi
  done < <(list_tracked_manifests)

  # Registered script-managed environments (e.g. the dedicated equity OCR
  # environment) are checked even when they intentionally have no requirements.txt.
  if [[ -f "$CONFIG" ]]; then
    local pattern mode
    while IFS=$'\t' read -r pattern env mode smoke installer; do
      [[ "${pattern:-}" == "@always" ]] || continue
      [[ -n "${env:-}" && -n "${installer:-}" && "$installer" != "-" ]] || continue
      if [[ ! -x "$ENV_ROOT/$env/bin/python" ]] || ! run_import_check "$ENV_ROOT/$env/bin/python" "$smoke" 2>/dev/null; then
        echo "NEEDS_INSTALL|@always|$env|registered environment check failed"
        needs=1
      fi
    done < "$CONFIG"
  fi

  [[ "$needs" -eq 0 ]] || return 10
  echo "Python dependency check passed: all registered requirements are satisfied."
}

install_all() {
  local manifest env smoke mode installer python_bin status
  # First repair script-managed environments only when their health check fails.
  if [[ -f "$CONFIG" ]]; then
    while IFS=$'\t' read -r pattern env mode smoke installer; do
      [[ "${pattern:-}" == "@always" ]] || continue
      [[ -n "${env:-}" && -n "${installer:-}" && "$installer" != "-" ]] || continue
      if [[ ! -x "$ENV_ROOT/$env/bin/python" ]] || ! run_import_check "$ENV_ROOT/$env/bin/python" "$smoke" 2>/dev/null; then
        [[ -f "$ROOT/$installer" ]] || { echo "ERROR: registered installer missing: $installer" >&2; return 1; }
        echo "Running registered installer for $env: $installer"
        (cd "$ROOT" && EQUITY_VENV_DIR="$ENV_ROOT/$env" bash "$ROOT/$installer")
      fi
    done < "$CONFIG"
  fi

  while IFS= read -r manifest; do
    [[ -z "$manifest" ]] && continue
    if ! env="$(resolve_env "$manifest")"; then
      return 1
    fi
    smoke="$(resolve_smoke_import "$manifest" || true)"
    python_bin="$ENV_ROOT/$env/bin/python"
    status=0
    check_requirements "$manifest" "$env" >/dev/null || status=$?
    if [[ "$status" -eq 0 ]]; then
      echo "Already satisfied: $manifest -> $env"
      continue
    elif [[ "$status" -ne 10 ]]; then
      return "$status"
    fi

    # Environment paths are constrained to repository-relative paths.
    [[ "$env" != /* && "$env" != *..* ]] || { echo "ERROR: unsafe venv path in config: $env" >&2; return 1; }
    if [[ ! -x "$python_bin" ]]; then
      echo "Creating Python environment: $env"
      python3 -m venv "$ENV_ROOT/$env"
    fi
    [[ -x "$python_bin" ]] || { echo "ERROR: venv creation failed: $env" >&2; return 1; }
    echo "Installing $manifest into $env"
    "$python_bin" -m pip install -r "$ROOT/$manifest"
    "$python_bin" -m pip check
    run_import_check "$python_bin" "$smoke"
  done < <(list_tracked_manifests)

  check_all
}

case "$MODE" in
  plan)
    [[ "$#" -eq 3 ]] || usage
    OLD_COMMIT="$2"
    TARGET_COMMIT="$3"
    CHANGES="$(list_changed_manifests "$OLD_COMMIT" "$TARGET_COMMIT")"
    if [[ -z "$CHANGES" ]]; then
      echo "No Python dependency manifest changes detected."
      exit 0
    fi
    TARGET_CONFIG="$(mktemp)"
    if ! git -C "$ROOT" show "$TARGET_COMMIT:$CONFIG_REL" > "$TARGET_CONFIG" 2>/dev/null; then
      : > "$TARGET_CONFIG"
    fi
    echo "Python dependency manifests changed:"
    printf '%s\n' "$CHANGES"
    echo
    unsupported=0
    while IFS=$'\t' read -r status manifest; do
      [[ -z "${manifest:-}" ]] && continue
      if [[ "$status" == D ]]; then
        echo "  $manifest: removed; installed packages will NOT be automatically uninstalled."
        continue
      fi
      case "$(basename "$manifest")" in
        requirements*.txt)
          if ! env="$(resolve_env "$manifest" "$TARGET_CONFIG")"; then
            echo "  UNSUPPORTED AUTOMATIC INSTALLER: $manifest (no environment mapping)"
            unsupported=1
            continue
          fi
          echo "  $manifest -> $env"
          ;;
        *)
          echo "  UNSUPPORTED AUTOMATIC INSTALLER: $manifest"
          echo "  Add an explicit package-manager handler before deploying this manifest type."
          unsupported=1
          ;;
      esac
    done <<< "$CHANGES"
    rm -f "$TARGET_CONFIG"
    [[ "$unsupported" -eq 0 ]] || exit 3
    ;;
  check)
    check_all
    ;;
  install)
    install_all
    ;;
  *) usage ;;
esac
