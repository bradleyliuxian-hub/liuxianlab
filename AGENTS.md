# Liuxian Lab — Agent Guide

Authoritative working agreement for AI agents in this repository. Keep it lean.
Detailed module docs live in `docs/agent/` and are read only when a task needs them (see §7).

## 1. Project & architecture (core)

- Private, authenticated tools workspace. Node.js >= 20, CommonJS, Express (`server.js`).
- Local: `npm run dev` -> `http://127.0.0.1:8080`. Health: `GET /health` -> `{"ok":true}`.
- Auth is server-side Express sessions (`requireAuth`). `public/` = login only; `private/` = authenticated dashboard + tools.
- `config/tools.json` is the source of truth for dashboard tool cards.
- Tools live at `private/tools/<slug>/`.
- Excel = Node routes + Python workers. Contract review = Node routes + PostgreSQL + Python service/worker.
- Runtime data (gitignored): `sessions/`, `storage/`, `logs/`, `data/`.
- Production direction: Nginx + HTTPS -> Node on `127.0.0.1:8080` (PM2 via `ecosystem.config.js`). Never expose the Node port.

## 2. Security boundaries (never weaken)

Protected — do not read, print, copy, overwrite, commit, or expose unless explicitly and narrowly required:

- `.env`, `data/users.json`, `data/*.json`, `sessions/`, `storage/`, `.mineru/`, runtime logs
- SSH keys, cloud/DB credentials, API keys, tokens

Rules:

- Never add a public signup route unless explicitly requested.
- All dashboard/tool/download/private APIs stay behind authentication.
- Do not weaken `requireAuth`, same-origin checks, rate limiting, Helmet, or session protections.
- Never hardcode secrets, credentials, domains, absolute local paths, or production-only values.

## 3. Cost & context discipline (token optimization)

Use DeepSeek V4.1 Flash and default to the lowest-cost mode that preserves quality.

### 3.1 Complexity routing

- SIMPLE (copy tweak, button, small CSS, one clear condition, single-file small fix)
  -> understand -> edit -> minimal check -> 1–3 line report. No architect, no reviewer.
- MEDIUM (ordinary API, a page feature, frontend/backend interaction, ordinary bug)
  -> understand -> read only relevant files -> edit -> verifier -> short report.
- COMPLEX (DB schema, auth, multi-module, contract-review core, background worker, large refactor, production deployment)
  -> architect -> builder -> verifier -> reviewer.

### 3.2 Never call agents unconditionally

Do not "to be safe" run every agent. Triggers:

- architect: only COMPLEX work or genuinely ambiguous design.
- reviewer: only high-risk or large/risky diffs.
- debugger: only non-obvious failures, or after a fix already failed.
- verifier: minimal, scoped checks for MEDIUM/COMPLEX only.

### 3.3 Read strategy — narrow first

1. Search names first (file / function / route).
2. Read only relevant snippets; do not open a large file whole as a first step.
3. Widen to references, then related modules, only if still unclear.
4. Do not re-read files already read this session if unchanged.
5. Do not scan unless task-related: `node_modules/`, `.git/`, `.venv/`, `venv/`, `.mineru/`, `sessions/`, `storage/`, `logs/`, `backups/`, `__pycache__/`, `dist/`, `build/`.

### 3.4 Thinking (reasoning) policy

Non-thinking by default for SIMPLE/MEDIUM. Enable extended thinking only for: complex architecture, hard-to-locate bugs, multi-module data-flow, DB migration design, security-sensitive changes, repeated failed fixes, or production incidents.

### 3.5 Avoid duplicate agent work

- architect identifies files -> builder starts there; no full re-scan.
- debugger finds root cause -> builder fixes directly from it.
- verifier does not re-analyze architecture.
- reviewer inspects only the current diff + necessary context.

### 3.6 Default output (concise)

完成 / 修改 / 验证 / 未验证 / 下一步. Short bullets.
Do not narrate tool calls, repeat the request, paste whole files, re-list passing checks, or write long summaries.

## 4. Natural-language intent routing

- Feature (新增/实现/改成/create/add/support...): read relevant code, make the smallest coherent change, scoped verify. Add architect only if COMPLEX; reviewer only if high-risk/large.
- Bug (报错/坏了/卡住/failing...): do not guess-patch; trace the real path; smallest safe fix; verify. Use debugger only for non-obvious failures.
- Verify (检查/验证/能不能跑/test...): inspect diff, run narrow checks, `/health` when app-level, exercise the affected route; return PASS/FAIL/NOT RUN.
- Review (review/有没有风险...): read-only; findings by severity; no edits.
- Deploy (上线/部署/deploy...): preflight only; never execute production actions without explicit approval after the preflight.
- Explain (为什么/解释...): answer or analyze without editing.
- Shortcuts: 开始做=implement agreed plan; 继续=continue current workflow (§5 for fresh-session resume); 修掉=fix just-identified issue; 再检查一下=re-verify latest change; 可以上线了吗=deployment preflight.
- Ambiguous: prefer inspect/explain; ask a short question only if it materially changes the implementation.

## 5. Checkpoint / Resume

`PROJECT_STATUS.md` is a short current-state snapshot (<= 60 lines). Overwrite it; never append chat history, full diffs, or secrets (names only).

Fields: Current Goal, Current Task, Completed, Pending, Changed Files, Verification, Known Issues, Git State (branch / dirty / uncommitted), Deployment Impact (deps / env / migrations / restart), Next Action, Last Updated.

Update after: feature sub-step, bug fix, verification, review, stage end, before deploy prep; and on pause phrases (先到这里 / 暂停 / 我先关机 / 保存进度 / 下次继续 / 今天先这样 / 下班 / 我下班了). On pause: check `git status` + `git diff`, summarize, update snapshot, confirm saved; do not commit/push/deploy.

Resume (继续 before work / 继续之前的工作 / 恢复工作 / 接着做 / 从上次继续 / 上班): read `PROJECT_STATUS.md`, `git status --short`, `git diff --stat`, recent commits (full `git diff` only if needed); reconcile with reality (real Git wins); give a 2–4 line summary; if the next action is safe, do it. Any git write or production action needs explicit approval.

Commands: `/checkpoint` (save; no commit/push/deploy), `/resume` and `/recover` (resume flow).

## 6. Git & deploy safety

- Before staging: inspect `git status`, `git diff --check`, `git diff`. Stage only intended files; never `git add .`.
- Never commit secrets or runtime data. Never force-push, `reset --hard`, rewrite history, delete branches, or push without explicit approval.
- Deployment is a separate phase: preflight (branch, candidate commit, deps, env names, migrations, PM2/Nginx, health check, rollback). Do not push / SSH / restart PM2 / modify Nginx / run migrations unless explicitly told.

## 7. Module docs (read on demand)

- `docs/agent/architecture.md` — runtime topology and module map
- `docs/agent/contract-review.md` — contract review core flow
- `docs/agent/excel-and-sales.md` — excel-standardizer and sales-income analysis
- `docs/agent/deployment.md` — production deployment details
- `docs/agent/tools.md` — adding a dashboard tool + UI direction
