# Liuxian Lab — Coding Agent Guide

## Product intent
Liuxian Lab is a private authenticated tools workspace hosted under `liuxianlab.com`. Users must sign in before they can access the dashboard or any tool.

The product should feel calm, capable, modern and useful rather than like a marketing landing page.

## Current architecture
- Node.js + Express server-side authentication.
- Admin creates users from the terminal; no public registration.
- `public/` contains the login experience only.
- `private/` contains authenticated dashboard and tool assets.
- `config/tools.json` is the single source of truth for tool cards.
- Each real tool should eventually live under `private/tools/<slug>/`.

## Visual direction
- Warm off-white background with fluorescent lime accent.
- Minimal, editorial, productivity-oriented UI.
- Strong typography, restrained borders, generous whitespace.
- Avoid generic gradient-heavy SaaS styling.
- Keep Chinese copy concise and natural.
- Maintain excellent mobile behavior and dark mode.

## Authentication rules
Do not put credentials in frontend HTML, CSS or JavaScript.
Do not add public signup routes unless explicitly requested.
All dashboard pages, tool pages and related static assets must remain behind `requireAuth`.
Do not expose `data/users.json`, `.env`, or session files through static routes.

## Tool development convention
1. Add/edit metadata in `config/tools.json`.
2. A card automatically appears on the dashboard.
3. Until implemented, `/tools/<slug>` shows the shared placeholder page.
4. To implement it, create:

```text
private/tools/<slug>/
├── index.html
├── tool.css
└── tool.js
```

5. The server automatically loads the real `index.html` when it exists.
6. Reuse shared design tokens and provide a clear "返回工作台" path.

## Deployment direction
Target environment is Tencent Cloud. Production traffic should go through Nginx + HTTPS to Node.js bound to `127.0.0.1:8080`. Do not expose the Node.js port directly to the public internet.
## Xiaohongshu MCP 使用规则

当使用 xiaohongshu-mcp 时：

1. 默认只进行读取操作。
2. 禁止自动点赞、收藏、评论、关注或发布内容。
3. search_feeds 对同一个搜索任务最多调用一次。
4. get_feed_detail 对同一个 feed_id 最多调用一次。
5. 如果 get_feed_detail 失败，不要自动重试。
6. 工具调用失败后，应停止并向用户展示具体错误信息。
7. 不要为了获得同一份内容连续打开多个浏览器页面。
8. 在分析 UI 或 Dashboard 时，只提取设计原则，不直接复制原作品。
9. 将适合的设计原则转译成 Liuxian Lab 自己的设计语言。
10. 在修改网站代码之前，先输出设计分析，等待用户确认。
