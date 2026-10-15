# deployment / runbook

Preflight -> approve -> apply -> verify -> rollback. Steps live in the
`deployment-safety` skill checklist. The active deploy script location is not
confirmed in-repo — verify it before use.

Never push / SSH / restart PM2 / modify Nginx / run migrations without explicit
approval after the preflight.

## Operator sequence (check, then apply)

Preflight (read-only):

1. Production clean — branch `main`, worktree clean.
2. Local health pre-check passes before touching anything.
3. Active-work scan — no queued/processing Contract Review or Excel Review jobs,
   and no running parser/worker processes. Human-review-pending items do not block.
4. Release identity — intended annotated tag, fast-forward from the current
   commit, reachable from `origin/main`.
5. Dependency check — Node dependency-section change requires a matching lockfile
   change; any Python manifest change stops for manual environment review.
6. Migration check — only newly added migration files; no historical migration
   edited/renamed/deleted; destructive SQL stops.
7. Backup point exists.
8. Syntax (`node --check` / `py_compile`) and the real test suites pass.
9. MinerU production-env and seal-patch markers intact.

Apply (with approval): install deps if the lock changed -> apply only new
migrations -> `nginx -t` -> restart PM2 -> verify.

Verify: local health passes; then public health as an additional signal; confirm
clean worktree and HEAD equals the target.

Rollback (operator notes): return code to the previous commit; reinstall deps if
the lock changed; restart. Database changes are NOT rolled back automatically —
schema rollback is a separate, reviewed operation.
