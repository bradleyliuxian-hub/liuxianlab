---
description: Plan and implement a feature with cost-aware verification
agent: build
---
Implement this feature request:

$ARGUMENTS

Choose the workflow by complexity (AGENTS §3.1):
- SIMPLE (copy/CSS/one condition/single-file small fix): understand -> edit -> minimal check -> 1–3 line report. No architect, no reviewer.
- MEDIUM (ordinary API/page/frontend-backend/ordinary bug): read only relevant files -> edit -> verifier -> short report.
- COMPLEX (DB schema/auth/multi-module/contract-review core/worker/large refactor): architect -> builder -> verifier -> reviewer.

Rules:
- Read AGENTS.md and only the relevant files; narrow-first (§3.3). Do not scan ignored dirs; do not re-read unchanged files.
- Make the smallest coherent change. Do not touch protected secrets/runtime data.
- Add architect only for COMPLEX/ambiguous; add reviewer only for high-risk or large diffs.
- Report as 完成 / 修改 / 验证 / 未验证 / 下一步.

Do not deploy.
