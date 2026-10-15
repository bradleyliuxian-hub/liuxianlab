---
name: development-task
description: Use after repo-inspector to turn a vague request into a precise, executable task spec for an agent (feature, bug fix, refactor, "实现", "修一下", "改成", "加一个"). Produces the Goal / Scope / Must-Preserve / Tests / Definition-of-Done contract so agents stop re-deriving intent from long prompts.
---

# development-task

Convert a request + repo-inspector output into a fixed-shape task contract.

## When

- Any task that will change code and is more than a one-line tweak.
- Whenever the user's request is underspecified (scope, edge cases, "done").

## Procedure

1. Take input from `repo-inspector` (task class + files). If it was not run,
   run its procedure inline first.
2. Read only the in-scope files. Do not widen scope.
3. Fill the template below. Mark unknowns as `OPEN:` instead of inventing them.
   Never upgrade an upstream `inferred` / `unverified` item into a fact: keep it
   `unverified` in `Current State`, and move anything that must be checked before
   implementing into `Preconditions / Investigation`.
4. Keep `Must Preserve` concrete — these are the invariants that break the
   product if violated (see the relevant domain skill).
5. Hand the contract to the implementing step. Re-check `Definition of Done`
   before declaring completion.

## Output template

```
Goal              One sentence, observable outcome.
Current State     What the code does today (from real code, not docs);
                  keep unread/unconfirmed items tagged `unverified`.
Preconditions     Facts to verify before implementing (if any).
Files In Scope    Exact paths to change.
Files Out of Scope Explicitly must not change.
Required Changes  Numbered, minimal.
Must Preserve     Invariants that must stay true.
Edge Cases        Inputs/conditions that must not break.
Tests             Commands to run + cases to add.
Definition of Done Checklist the result must satisfy.
Do Not Do         Anti-goals (e.g. no framework change, no write-back).
Return Format     完成 / 修改 / 验证 / 未验证 / 下一步.
```

## Rules

- Smallest coherent change. No opportunistic refactors.
- Never widen scope silently; if scope grows, return to the user.
- Tests must use the repo's real runners (Node `node --test`, Python `unittest`)
  — discover them, never invent a new test setup.
- Do not put current facts (hashes, counts) in the contract; reference "run the
  suite" instead.
- For Excel tools, `Must Preserve` must include the domain invariants from the
  matching skill (read-only source, thread-reply-not-a-question, etc.).

## Example (compressed)

```
Goal: Fix Excel Review single .xlsx upload that returns 500.
Files In Scope: server/excel-review/{routes,job-factory}.js
Must Preserve: one upload = one job; no write-back; DB error -> clear code.
Tests: node --test tests/excel-review/*.test.js
Do Not Do: don't change contract-review; don't weaken auth.
```
