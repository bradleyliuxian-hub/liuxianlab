---
name: repo-inspector
description: Use FIRST before any development task in the Liuxian Lab repo (bug, feature, refactor, regression, "调查", "复现", "找不到 X", "上传失败", "从哪里看"). Classifies the task and decides exactly which skill + docs + files to read, so the agent stops scanning the whole repo. Use ONLY to route, not to implement.
---

# repo-inspector

Route a task to the smallest set of files. Output is a reading plan, never a fix.

## Why

The biggest cost in this repo is not writing code — it is reading the wrong
files. This skill turns "I don't know where to look" into an explicit list of
files to read and files to ignore, using `PROJECT_INDEX.md` and
`docs/agent/project-map.md`.

## Input

A task in any phrasing, e.g.:

- "Excel Review 单文件上传失败"
- "死数检查 Viewer 滚动回弹"
- "尾差检查要支持 xlsx 压缩包"
- "合同审阅解析变慢"
- "帮我加一个工具卡片"

## Procedure

1. Read `PROJECT_INDEX.md` + `docs/agent/project-map.md` (do not scan code yet).
2. Classify the task into ONE domain:
   `excel-review`, `excel-hardcode`, `excel-tail-risk`, `excel-standardizer`,
   `sales-income`, `contract-review`, `deployment`, `platform/auth`, or `unknown`.
3. For the domain, name:
   - the domain skill (if any),
   - the docs under `docs/agent/<domain>/` to read,
   - the entry code files (2–8),
   - the tests to run.
4. List what is OUT of scope and must NOT be read (other Excel tools, contract
   core, MinerU, deployment) to prevent context bleed.
5. If the domain is genuinely `unknown`, say so and return the 2–3 search
   patterns to disambiguate — do not guess.

## Output template

```
Task class: <domain>
Skill: <skill or none>
Read (docs):  <paths>
Read (code):  <paths>
Run (tests):  <commands>
Do NOT read:  <paths/areas>
Search only if needed: <patterns>
Evidence:     confirmed from current repo | documented | inferred | unverified
```

## Rules

- Label plan items: `confirmed from current repo` only for a file actually read
  in this task; otherwise `documented` / `inferred` / `unverified`. Never mark an
  unread file's implementation as confirmed.
- Never carry project facts (paths of current files are fine; no commit ids,
  no counts, no "current state"). Facts live in code + `docs/agent`.
- Route first, implement later. This skill does not edit files.
- Prefer fewer files. If two domains seem involved, pick the primary one and
  note the secondary explicitly as "cross-module".
- Respect `AGENTS.md` read bans: never propose `node_modules/`, `.venv/`,
  `.mineru/`, `sessions/`, `storage/`, `logs/`, `backups/` for reading.
- If `PROJECT_INDEX.md` disagrees with the repo, the repo wins — report the drift.

## Example

Input: "Excel Review 单文件上传失败"

```
Task class: excel-review
Skill: excel-review
Read (docs):  docs/agent/excel-review/overview.md, docs/agent/excel-review/upload.md
Read (code):  server/excel-review/routes.js, server/excel-review/job-factory.js,
              server/excel-review/repository.js, private/tools/excel-review/script.js
Run (tests):  node --test tests/excel-review/*.test.js
Do NOT read:  contract-review/*, excel-hardcode/*, excel-decimal-check/*, deployment
```
