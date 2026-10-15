---
name: contract-review
description: Use for the 合同审阅 / contract-review tool at /tools/contract-review — MinerU PDF parsing, FAST/ACCURATE/AUTO modes, quality gate, critical integrity checks, issue locator, review workspace, PostgreSQL migrations. Triggers "合同审阅", "contract review", "PDF 解析", "MinerU", "FAST", "ACCURATE", "AUTO", "质量门", "integrity", "locator", "印章". NOT for Excel tools.
---

# contract-review

Maintain the contract-review module (Node routes + PostgreSQL + Python/MinerU
worker + review UI). High-risk: read the invariants before touching anything.
Detail lives in `docs/agent/contract-review/*` — read on demand.

## Scope

- Node: `server/contracts/` (`db.js`, `repository.js`, `review-store.js`,
  `parse-runner.js`, `routes.js`, `migrations/001..003`).
- Python: `services/contract_review/` (`worker.py`, `database.py`,
  `mineru_service.py`, `issue_detector.py`, `issue_locator.py`,
  `consistency_*`, `review_artifacts.py`, `quality_gate.py`, `parse_cache.py`).
- Frontend: `private/tools/contract-review/`. Tests: `services/contract_review/tests/*`.

## Purpose (definition)

Contract Review = **digitization + deterministic integrity checks + human
review**. It is NOT an AI that renders automatic legal judgments. The tool
surfaces evidence and locates it; a human decides.

## Invariants (must preserve)

1. **Not an AI legal judge.** No automatic legal conclusions; output is
   evidence + locations for human review.
2. **Do not rewrite the module wholesale.** Make the smallest coherent change.
   **Do not refactor `worker.py` lightly** — it is the fragile orchestration core.
3. **Mode semantics are fixed**:
   - `FAST` = Basic only.
   - `ACCURATE` = Standard only.
   - `AUTO` = Basic -> Structural Quality Gate -> Critical Integrity -> optional
     Standard fallback.
4. **Standard is not ground truth.** It is a second parse, not the source of
   truth; never let it silently override Basic without the gate/integrity path.
5. **Cache reuse is limited.** Reuse only **raw MinerU artifacts**; never reuse
   human review state (reviews/decisions) as if it were a parse.
6. **Owner scope** on every job/review/artifact and private download.
7. **Migrations must be additive and backward-compatible** (`001..003` pattern;
   `BEGIN/COMMIT`, idempotent, no destructive/renamed columns).
8. **MinerU concurrency = 1.** Do not raise it; the host is shared/small.
9. **Protect environment contracts:** `LIUXIANLAB_MINERU_PRODUCTION_ENV_V1` and
   `LIUXIANLAB_SAFE_SEAL_CROP_V3` are stable interfaces — do not rename, repurpose,
   or weaken them.
10. **Never auto-modify the contract body text.** The source document is read-only;
    issues are annotated/located, not rewritten.
11. **Locator principle:** a *wrong* localization is more dangerous than no
    localization. Be conservative; prefer "not located" over a wrong highlight.
12. **High-risk surface:** auth, PostgreSQL, MinerU worker, concurrency. Do not
    touch when the task is not about contract review.

## How to work

- Parse pipeline / modes → `docs/agent/contract-review/overview.md` +
  `worker.py` + `quality_gate.py` + `parse_cache.py`.
- Integrity / consistency → `issue_detector.py`, `consistency_*`.
- Locator → `issue_locator.py` (apply invariant 11).
- Review workspace / artifacts → `review_artifacts.py`, `server/contracts/review-store.js`, frontend.
- Run: `.venv/bin/python -m unittest discover -s services/contract_review/tests -t .`
  (`node --check` on changed JS).

## Anti-goals

- No "AI decides the legal issue" features.
- No wholesale rewrite / speculative refactor of the worker.
- No cache of human review state presented as parse output.
- No destructive migrations; no concurrency bump; no change to the two env contracts.

## Keep in sync

Behavior changes update `docs/agent/contract-review/*` + `PROJECT_STATUS.md`.
The large historical handoff stays an archive source (not loaded by default).
