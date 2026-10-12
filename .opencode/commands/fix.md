---
description: Diagnose and fix a bug from evidence
agent: build
---
Fix this problem:

$ARGUMENTS

Workflow (AGENTS §4 Bug):
1. Trace the real failure path from evidence; do not guess-patch.
2. Use the debugger subagent only for non-obvious failures or after a fix already failed.
3. Make the smallest safe fix; avoid unrelated refactors; do not touch protected data.
4. Verify narrowly (verifier for MEDIUM/COMPLEX); add reviewer only for high-risk or large diffs.
5. Report as 完成 / 修改 / 验证 / 未验证 / 下一步.

Do not deploy.
