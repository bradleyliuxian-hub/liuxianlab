---
description: Plan and implement a feature with verification
agent: build
---
Implement this feature request:

$ARGUMENTS

Required workflow:
1. Read AGENTS.md.
2. Inspect the relevant existing code.
3. Use the architect subagent for non-trivial changes.
4. Explain the intended implementation briefly before editing.
5. Make the smallest coherent implementation.
6. Do not touch protected secrets/runtime-user-data paths.
7. Run relevant syntax/static/local checks.
8. Use the verifier subagent.
9. Use the reviewer subagent.
10. Fix material review findings if they are within scope, then re-verify.
11. Finish with:
   - files changed
   - behavior implemented
   - verification performed
   - unverified items
   - dependency/env/migration impact
   - deployment notes

Do not deploy.
