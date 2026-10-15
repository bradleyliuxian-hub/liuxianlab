# contract-review / overview

Routing entry for the 合同审阅 module (`/tools/contract-review`). Start here,
then read code. Close-up detail: `docs/agent/contract-review.md`. The large
historical handoff stays in archive (not loaded by default).

- Skill: `.opencode/skills/contract-review/` (load its invariants first).
- Node: `server/contracts/` (db, repository, review-store, parse-runner, routes;
  migrations `001..003`).
- Python: `services/contract_review/` (worker, database, mineru_service,
  issue_detector, issue_locator, consistency_*, review_artifacts, quality_gate,
  parse_cache).
- Frontend: `private/tools/contract-review/`.
- Tests: `services/contract_review/tests/*`.

## Non-negotiable (summary; full list in the skill)

- Digitization + deterministic integrity + human review — **not** an AI legal judge.
- Do not rewrite the module; do not lightly refactor `worker.py`.
- `FAST` = Basic only; `ACCURATE` = Standard only; `AUTO` = Basic -> Structural
  Quality Gate -> Critical Integrity -> optional Standard fallback.
- Standard is not ground truth; cache reuses only raw MinerU artifacts, never
  human review state.
- Owner scope; additive/backward-compatible migrations; MinerU concurrency = 1.
- Protect `LIUXIANLAB_MINERU_PRODUCTION_ENV_V1` and `LIUXIANLAB_SAFE_SEAL_CROP_V3`.
- Never auto-modify the contract body; a wrong locator is worse than none.

## Read next

- Modes / quality gate / AUTO fallback / cache / progress: `quality-and-cache.md`.
- Pipeline / modes: `worker.py`, `quality_gate.py`, `parse_cache.py`.
- Locator: `issue_locator.py` (be conservative).
- API/DB: `server/contracts/routes.js`, `repository.js`.
