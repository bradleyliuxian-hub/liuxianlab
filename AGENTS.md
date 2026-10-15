# Liuxian Lab — Agent Guide (project constitution)

Authoritative, long-lived rules for AI agents in this repository. It holds only
rules that never change; domain facts live in `docs/agent/`. Keep it lean.

Onboarding order (first read, in this sequence):
`AGENTS.md` -> `PROJECT_STATUS.md` -> `PROJECT_INDEX.md` -> relevant `docs/agent/*` -> code.

## 0. Six layers (one job each)

```
AGENTS.md       long-lived, non-negotiable rules
commands/       user entry points (thin)
agents/         work roles (architect/debugger/verifier/reviewer/deployer)
skills/         repeatable project workflows (narrow triggers, no facts)
docs/agent/     project facts & domain knowledge (single source of truth)
Repo            final ground truth
```

## 1. Source-of-truth priority (never invert)

```
Real Repo  >  Git State  >  PROJECT_STATUS.md  >  docs/agent  >  skill references  >  handoff  >  chat
```

Never let stale docs, `PROJECT_STATUS.md`, or a handoff override the real code +
Git. When they disagree, code + Git win and the doc is corrected.

### 1.1 Evidence labels (mandatory)

- Only a fact whose implementing file was actually read **in this task** may be
  called `confirmed` / `current-code`.
- Anything from docs / handoff / history / memory / inference must be labeled one
  of: `documented`, `expected`, `inferred`, `historical`, `unverified in current code`.
- Never present memory ("server.js should be …") as current fact.

### 1.2 User hard constraints are never relaxed

- If the user says 只读 / 不得创建文件 / 不得运行测试 / 不得访问某目录, the agent must
  not add its own exceptions.
- Forbidden: "除本记录外不创建文件", "为了诊断临时生成报告", "为了方便创建 scratch".
- If a constraint blocks progress, state the limitation explicitly; never secretly bypass it.

### 1.3 Test-status vocabulary

- Use exactly: `PASS` / `FAIL` / `BLOCKED` / `NOT RUN`.
- Partial runs or import errors are never "all green": e.g. "99 pass + 2 import
  errors" → `PARTIAL PASS / BLOCKED BY ENVIRONMENT`.

### 1.4 Read-only zero-change proof

- before: `git status --short`, `git diff --name-only`, `git diff --cached --name-only`;
  after: run the same and compare.
- If the repo was already dirty, do not argue "status unchanged" vaguely — state
  "pre-existing changes unchanged".

### 1.5 Static vs runtime

- Static source confirmation ≠ reproduced at runtime.
- "No call path found" ≠ "cannot happen".
- Frequency / production share / production health require runtime or production
  evidence; otherwise mark `UNKNOWN`.

## 2. Project & architecture (core)

- Private, authenticated tools workspace. Node.js >= 20, CommonJS, Express (`server.js`).
- Real repo path: `~/AI-Workspace/projects/liuxianlab-online` (this repo; own `.git`, origin = `liuxianlab.git`).
  - Note: the parent `~/AI-Workspace` also has a `.git` pointing at the same origin — always confirm cwd before Git ops.
- Local: `npm run dev` -> `http://127.0.0.1:8080`; health `GET /health` -> `{"ok":true}`.
- Auth: server-side Express sessions (`requireAuth`). `public/` = login only; `private/` = authenticated dashboard + tools.
- `config/tools.json` is the single source of truth for dashboard tool cards.
- Tools live at `private/tools/<slug>/`.
- Excel Standardizer & Sales/Income = Node routes + Python workers (`server/excel/`, `server/sales-income/`, `workers/excel/`).
- Excel Review = Node routes + PostgreSQL + private server storage + Python (`server/excel-review/`, `services/excel_review/`).
- Excel Tail-Risk (尾差检查) & Hardcode (死数检查) = **browser-local Vanilla JS** (`private/tools/excel-decimal-check/`, `private/tools/excel-hardcode-check/`, shared `private/shared/`); no server storage.
- Contract review = Node routes + PostgreSQL + Python service/worker (`server/contracts/`, `services/contract_review/`).
- Runtime data (gitignored): `sessions/`, `storage/`, `logs/`, `data/`.
- Production direction: Nginx + HTTPS -> Node on `127.0.0.1:8080` (PM2 via `ecosystem.config.js`). Never expose the Node port.

## 3. Security boundaries (never weaken)

Protected — do not read, print, copy, overwrite, commit, or expose unless explicitly and narrowly required:

- `.env`, `data/users.json`, `data/*.json`, `sessions/`, `storage/`, `.mineru/`, runtime logs
- SSH keys, cloud/DB credentials, API keys, tokens (e.g. `tools/xiaohongshu-mcp/cookies.json`)

Rules:

- Never add a public signup route unless explicitly requested.
- All dashboard/tool/download/private APIs stay behind authentication.
- Do not weaken `requireAuth`, same-origin checks, rate limiting, Helmet, or session protections.
- Never hardcode secrets, credentials, domains, absolute local paths, or production-only values.

## 4. Skills / Agents / Commands

- **Skills** = repeatable project workflows, narrow triggers, short (`SKILL.md` <= ~200 lines). They store *how to inspect / decide / operate*, never *current facts*. Detail lives in `docs/agent/*` and is loaded on demand.
- **Agents** = roles, not domains: `architect`, `debugger`, `verifier`, `reviewer`, `deployer`. Domain knowledge comes from skills, never from a per-domain agent.
- **Commands** = thin entry points; no business knowledge in commands.
- Load at most ONE domain skill per task unless the task is explicitly cross-module. Do not stack design/UI skills onto development tasks.
- Do not create a per-action skill (no `bug-fix`, `feature`, `review` skill). Those are commands/agents.
- If a skill and `docs/agent` disagree, fix the doc; skills must not carry facts.

## 5. Complexity routing (cost & context)

- SIMPLE (copy tweak, button, small CSS, one clear condition, single-file fix): understand -> edit -> minimal check -> 1–3 line report. No architect/reviewer.
- MEDIUM (ordinary API, page feature, front/back interaction, ordinary bug): understand -> read only relevant files -> edit -> verifier -> short report.
- COMPLEX (DB schema, auth, multi-module, contract-review core, background worker, large refactor, production deploy): architect -> builder -> verifier -> reviewer.

Never call agents "to be safe". Triggers: architect (COMPLEX only), reviewer (high-risk/large diffs), debugger (non-obvious failures / after a failed fix), verifier (scoped checks, MEDIUM/COMPLEX).

## 6. Read strategy & token budget

1. Search names first (file / function / route).
2. Read only relevant snippets; do not open a large file whole first.
3. Widen to references, then related modules, only if still unclear.
4. Do not re-read files already read this session unless changed.
5. Never scan unless task-related: `node_modules/`, `.git/`, `.venv/`, `venv/`, `.mineru/`, `sessions/`, `storage/`, `logs/`, `backups/`, `__pycache__/`, `dist/`, `build/`.

Budget: SIMPLE = AGENTS + PROJECT_STATUS + PROJECT_INDEX + 1–3 code files. MEDIUM = + 1 skill + 1–2 docs + 3–8 code files + tests. COMPLEX = + architecture + domain docs + cross-module files. COMPLEX means hard reasoning, not "load the whole repo".

## 7. Thinking policy

Non-thinking by default for SIMPLE/MEDIUM. Extended thinking only for complex architecture, hard-to-locate bugs, multi-module data flow, DB migration design, security-sensitive changes, repeated failed fixes, or production incidents.

## 8. Natural-language intent routing

- Feature (新增/实现/改成/create/add/support): read relevant code, smallest coherent change, scoped verify.
- Bug (报错/坏了/卡住/failing): do not guess-patch; trace the real path; smallest safe fix; verify.
- Verify (检查/验证/能不能跑/test): inspect diff, run narrow checks, `GET /health`, exercise the affected route; return PASS/FAIL/NOT RUN.
- Review (review/有没有风险): read-only; findings by severity; no edits.
- Deploy (上线/部署/deploy): preflight only; never execute production actions without explicit approval after the preflight.
- Explain (为什么/解释): answer/analyze without editing.
- Shortcuts: 开始做=implement agreed plan; 继续/从上次继续=resume flow (§9); 修掉=fix the just-identified issue; 再检查一下=re-verify latest change; 可以上线了吗=deployment preflight.
- Ambiguous: prefer inspect/explain; ask one short question only if it materially changes the implementation.

## 9. Checkpoint / Resume

`PROJECT_STATUS.md` is a short current-state snapshot (<= 200 lines). Overwrite it; never append chat history, full diffs, or secrets.

Fields: Git (branch/HEAD/dirty), Current Focus, Known Broken, Pending Decision, Next Action, Last Verification, Last Updated.

Update after: a feature sub-step, bug fix, verification, review, stage end, before deploy prep, and on pause phrases (先到这里 / 暂停 / 保存进度 / 下次继续 / 下班). On pause: check `git status` + `git diff`, summarize, update the snapshot, confirm saved; do not commit/push/deploy.

Resume (继续 before work / 恢复工作 / 接着做 / 上班): read `PROJECT_STATUS.md`, `git status --short`, `git diff --stat`, recent commits (full `git diff` only if needed); reconcile with reality (Git wins); give a 2–4 line summary; if the next action is safe, do it. Any Git write or production action needs explicit approval.

Commands: `/checkpoint` (save; no commit/push/deploy), `/resume` and `/recover` (resume flow), `/status`.

## 10. Git & deploy safety

- Before staging: inspect `git status`, `git diff --check`, `git diff`. Stage only intended files; never `git add .`.
- Never commit secrets or runtime data. Never force-push, `reset --hard`, rewrite history, delete branches, or push without explicit approval.
- Deployment is a separate phase: preflight (branch, candidate commit, deps, env names, migrations, PM2/Nginx, health check, rollback). Do not push / SSH / restart PM2 / modify Nginx / run migrations unless explicitly told.
- Deploying is only ever done through the `deployment-safety` skill + `/deploy`; never improvise a production action.

## 11. Where to look next

- `PROJECT_INDEX.md` — knowledge map: "I hit X, read Y".
- `docs/agent/` — project facts and per-domain knowledge (single source of truth).
- Skills under `.opencode/skills/` — 7 project workflows (`repo-inspector`, `development-task`, `contract-review`, `excel-review`, `excel-tail-risk`, `excel-hardcode`, `deployment-safety`).
- No `.opencode/optional-skills/` content is auto-loaded; it is opt-in only.

## 12. Output standard

Default: 完成 / 修改 / 验证 / 未验证 / 下一步 — short bullets. Do not narrate tool calls, repeat the request, paste whole files, re-list passing checks, or write long summaries.
