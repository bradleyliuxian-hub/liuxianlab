# Liuxian Lab — Vibe Coding Agent Guide

## 1. Product and source of truth

This repository is the single source of truth for Liuxian Lab.

Normal workflow:

1. Develop in this repository locally.
2. Verify locally.
3. Review the diff.
4. Commit and push only after verification.
5. Deploy the same Git commit to production.
6. Verify `/health` and the affected feature after deployment.

Do not maintain a separate "local codebase" and "production codebase" by manually copying files between directories.

## 2. Current architecture

- Runtime: Node.js >= 20, CommonJS.
- Main server: `server.js`.
- Local development: `npm run dev`.
- Production start: `npm run start`.
- Default local URL: `http://127.0.0.1:8080`.
- Health endpoint: `GET /health`.
- Authentication: Express server-side auth.
- `public/`: login assets only.
- `private/`: authenticated dashboard and authenticated tool assets.
- `config/tools.json`: source of truth for dashboard tool cards.
- Individual browser tools normally live under `private/tools/<slug>/`.
- Excel processing combines Node.js routes with Python workers.
- Contract review combines Node.js routes, PostgreSQL-backed persistence, and Python services/workers.
- Production process manager currently uses PM2 through `ecosystem.config.js`.
- Production direction: Nginx + HTTPS -> Node.js bound to `127.0.0.1:8080`.

## 3. Critical security boundaries

Never read, print, copy, overwrite, commit, or expose secrets or runtime user data unless the user explicitly asks for a narrowly scoped operation.

Treat these paths as protected:

- `.env`
- `data/users.json`
- `data/*.json`
- `sessions/`
- `storage/`
- `.mineru/`
- logs containing user/runtime data
- SSH keys
- cloud credentials
- database credentials
- API keys and tokens

Never add a public signup route unless explicitly requested.

All dashboard pages, tool pages, downloads, generated artifacts, and private APIs must remain behind authentication unless explicitly designed otherwise.

Do not weaken `requireAuth`, same-origin checks, rate limiting, Helmet configuration, or session protections merely to make a feature work.

Never expose the Node.js application port directly to the public internet as part of a normal deployment.

## 4. Change discipline

Before editing:

1. Identify the user-visible goal.
2. Find the relevant entry points, routes, frontend files, worker/service files, and data flow.
3. Read existing code before inventing a parallel implementation.
4. Prefer the smallest coherent change.
5. State any schema migration, environment-variable, dependency, or deployment impact.

While editing:

- Reuse existing conventions and modules.
- Avoid unnecessary dependencies.
- Avoid broad refactors unless required by the feature.
- Do not silently change unrelated behavior.
- Do not hardcode secrets, credentials, domains, absolute local paths, or production-only values.
- Keep production and local behavior compatible wherever practical.

After editing:

1. Run syntax/static checks that exist for the touched languages.
2. Start the application locally when appropriate.
3. Check `/health`.
4. Exercise the affected route or workflow.
5. Inspect `git diff`.
6. Run the reviewer agent before calling the work finished.
7. Report what was verified and what was not verified.

## 5. JavaScript / Node verification

At minimum for changed JavaScript files, use an appropriate syntax check when possible:

```bash
node --check path/to/file.js
```

For application-level changes, prefer:

```bash
npm install
npm run dev
```

Then verify:

```bash
curl -fsS http://127.0.0.1:8080/health
```

Do not start multiple duplicate server processes. If port 8080 is already in use, inspect the existing process before killing anything.

## 6. Python verification

Use the project-local Python environment when one exists.

For standalone syntax checks:

```bash
python3 -m py_compile path/to/file.py
```

For Excel worker dependencies, follow `workers/excel/requirements.txt`.

Do not modify or recreate `.mineru/` casually. Treat it as runtime/tooling infrastructure.

## 7. Database and migrations

Contract review uses PostgreSQL-related code under `server/contracts/` and migrations under `server/contracts/migrations/`.

For any database change:

1. Inspect existing schema and migration conventions first.
2. Prefer additive, reversible migrations.
3. Never drop production data as part of an automated fix.
4. Never run destructive SQL automatically.
5. Call out required migration order explicitly.
6. If a local database is unavailable, verify code paths statically and clearly report that database integration was not executed.

## 8. Tool development convention

For dashboard tools:

1. Inspect `config/tools.json`.
2. Reuse existing layout and authenticated routing.
3. A typical browser tool lives at:

```text
private/tools/<slug>/
├── index.html
├── styles.css or tool.css
└── script.js or tool.js
```

4. Keep a clear path back to the workspace.
5. Preserve mobile behavior.
6. Keep Chinese UI copy concise and natural.

Existing tools may use richer structures; follow the nearest existing tool rather than forcing the minimal template.

## 9. UI direction

The established product direction is:

- calm
- capable
- modern
- productivity-oriented
- warm off-white base
- fluorescent lime accent
- strong typography
- restrained borders
- generous whitespace
- good mobile behavior
- dark mode support where existing UI supports it

Avoid generic gradient-heavy SaaS styling.

Do not copy third-party designs verbatim.

## 10. Git safety

This repository should be the deployable source of truth.

Before any commit:

```bash
git status --short
git diff --check
git diff
```

Never run `git add .` blindly.

Stage only files that belong to the requested change.

Never commit:

- `.env`
- session files
- runtime storage
- real user data
- generated secrets
- local virtual environments
- editor/system junk

Never force-push, reset hard, rewrite history, delete branches, or push to remote without explicit user approval.

## 11. Deployment safety

Deployment is a separate phase from implementation.

Before deployment, verify:

- working tree state
- target branch and commit
- required environment-variable names (never values)
- dependency changes
- database migration requirements
- service/process restart requirements
- health-check plan
- rollback point

Do not SSH into production, push, pull, restart PM2, alter Nginx, change firewall rules, or run migrations unless the user explicitly requests deployment actions.

A successful local test is not proof of successful production deployment.

## 12. Definition of done

A feature is only "done" when the agent can report:

- files changed
- behavior implemented
- local checks executed
- health check result when applicable
- affected route/workflow verification
- security implications
- migration/dependency/env impact
- remaining unverified items
- deployment notes

If something could not be verified, say so instead of claiming success.

# 13. Natural-Language Intent Routing

The user should normally be able to speak naturally without remembering slash commands.

Interpret the user's intent automatically and choose the appropriate workflow.

## A. Feature / modification intent

Treat the request as a feature workflow when the user asks to:

- 新增
- 添加
- 增加
- 实现
- 开发
- 做一个
- 改成
- 支持
- 优化某个功能
- 调整现有交互
- create
- add
- implement
- build
- modify
- improve
- support

Examples:

- “给合同审查增加一个导出 Excel 的功能”
- “把结果页增加一个返回按钮”
- “帮我做一个批量上传”
- “这个页面优化一下手机端体验”

For feature intent:

1. Read relevant existing code before editing.
2. For non-trivial changes, use the architect subagent first.
3. Identify the smallest coherent implementation.
4. Explain the intended approach briefly.
5. Implement the change.
6. Run relevant local verification.
7. Use the verifier subagent.
8. Use the reviewer subagent.
9. Fix material review findings that are within scope.
10. Re-verify after meaningful fixes.
11. Report:
   - files changed
   - behavior implemented
   - verification performed
   - remaining unverified items
   - dependency/env/migration impact
   - deployment notes

Do not deploy automatically.

## B. Bug / failure intent

Treat the request as a debugging workflow when the user says something is:

- 报错
- 坏了
- 不工作
- 卡住
- 没反应
- 失败
- 不对
- 异常
- 显示错误
- 数据不正确
- broken
- failing
- stuck
- incorrect
- error
- crash
- not working

Examples:

- “上传合同以后一直卡在解析中”
- “这个按钮点了没反应”
- “为什么导出的 Excel 数据少了一行”
- “登录之后跳转失败”

For bug intent:

1. Do not immediately patch based on guesses.
2. Use the debugger subagent for non-obvious failures.
3. Reproduce or inspect the failure where safe.
4. Trace the real code/data path.
5. Identify root cause.
6. Apply the smallest safe fix.
7. Run relevant verification.
8. Use the reviewer subagent.
9. Report:
   - root cause
   - changed files
   - fix applied
   - verification performed
   - remaining risk

Do not deploy automatically.

## C. Verification intent

Treat the request as verification when the user asks things like:

- 检查一下
- 验证一下
- 能不能跑
- 跑一下看看
- 确认有没有问题
- 测一下
- verify
- test this
- check this

Examples:

- “检查一下刚才改的代码能不能跑”
- “验证一下这个功能”
- “帮我看看有没有明显问题”

For verification intent:

1. Avoid unrelated edits.
2. Inspect current Git diff.
3. Use relevant syntax/static checks.
4. Start the app locally when appropriate.
5. Check `http://127.0.0.1:8080/health`.
6. Exercise the affected route/workflow when feasible.
7. Use the verifier subagent.
8. Return PASS / FAIL / NOT RUN with evidence.

## D. Review intent

Treat the request as code review when the user asks:

- review 一下
- 看看代码有没有问题
- 有没有风险
- 有没有安全问题
- 帮我审一下
- 检查 diff
- code review

For review intent:

1. Do not edit files.
2. Use the reviewer subagent.
3. Review current diff and relevant surrounding code.
4. Focus on:
   - correctness
   - regression risk
   - authentication/authorization
   - secret/runtime-data exposure
   - file upload safety
   - database safety
   - frontend/backend mismatch
   - deployment impact
5. Report findings by severity.

## E. Deployment intent

Treat the request as deployment intent when the user says:

- 上线
- 发布
- 部署
- 推到服务器
- 发到线上
- production
- deploy
- release
- publish

Examples:

- “准备上线”
- “这个版本可以部署了吗”
- “把这个功能发到服务器”

For deployment intent:

1. First run deployment preflight.
2. Use the deployer subagent.
3. Check:
   - Git branch
   - Git status
   - candidate commit
   - dependency changes
   - environment variable names
   - database migrations
   - PM2 impact
   - Nginx impact
   - health-check plan
   - rollback plan
4. Do not execute production actions unless the user explicitly approves execution after seeing the preflight.

Do not automatically:
- push
- SSH
- pull on production
- restart PM2
- modify Nginx
- run production migrations

## F. Explanation / question intent

If the user is only asking:

- 这个代码是什么意思
- 为什么这样设计
- 这个模块做什么
- 帮我解释一下
- 分析一下但不要改

then answer or analyze without editing files.

Do not assume every technical question requires a code change.

## G. Ambiguous intent

If the user's intent is ambiguous:

1. Prefer inspection and explanation over editing.
2. Ask a short clarifying question only when the difference would materially change the implementation.
3. If a safe interpretation is obvious, proceed with that interpretation and state it briefly.

## H. Conversational shortcuts

Interpret common natural-language follow-ups using the current context.

Examples:

“开始做”
→ implement the previously agreed plan.

“继续”
→ continue the current workflow from the last incomplete step.

“修掉”
→ fix the issue just identified.

“再检查一下”
→ re-run verification/review relevant to the latest changes.

“可以上线了吗”
→ run deployment preflight.

“上线吧”
→ if preflight has already been shown in the current conversation, ask for or confirm explicit production-action approval before executing production commands.

## I. Default Vibe Coding behavior

The default behavior for implementation work is:

Understand
→ Inspect
→ Plan when needed
→ Implement
→ Verify
→ Review
→ Report

The default behavior is NOT:

Guess
→ Rewrite many files
→ Claim success

Never claim a feature works unless relevant verification was actually performed.
