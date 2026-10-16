# DARK_THEME_TYPOGRAPHY_FIX.md
# Liuxian Lab — Dark Theme Typography / Contrast Repair

日期：2026-10-16
范围：仅修暗色模式的**文字层级 / 对比度 / 可读性**（tokens 为主）。未重做布局/Sidebar/Workbench/Tool Shell，
未改业务逻辑、Excel 工具逻辑、认证。

---

## 1. 暗色模式问题总结

- 文字层级不足：标题不够亮、正文与辅助接近、卡片描述过暗、meta/badge 过暗 → “糊成一片”。
- 根因之一（我在 V1.2/V1.3 引入的回归）：为了亮色模式统一，追加了**只适合亮色的字面量颜色**（如 `.drop-zone{background:#fff}`、`.card-heading h2{color:#101828}`、`.drop-zone strong{color:#101828}`），
  这些规则带 `!important` 且作用在 `.page-shell` 作用域，**同样作用于暗色**，导致暗色下出现白底区块/深色标题。

## 2. 重新定义的 Dark Theme Text Tokens（`private/styles.css` `body.dark`）

```
--text:           #F5F7FA  /* primary   — 标题 / 卡片标题 / 关键数字 */
--text-strong:    #FFFFFF
--muted:          #D7DFEA  /* secondary — 正文 / 描述 / 次级标题 */
--muted-2:        #A9B8CC  /* tertiary  — 辅助说明 / meta / 小标签 */
--text-tertiary:  #A9B8CC
--text-muted:     #7F91A8  /* 低优先级 */
--text-disabled:  #5E728A  /* 禁用态 */
```
层级保证：primary > secondary > tertiary > muted > disabled。

## 3. 重新定义的 Dark Surfaces / Borders（`private/styles.css`）

```
--page:#07111F  --canvas:#0B1627  --surface:#10213A  --surface-soft:#132846  --surface-blue:#152A4D
--bg-hover:#132846  --bg-active:#173154
--line:#1E3350  --line-strong:#294567
--primary:#5B9CFF  --blue:#67A3FF  --blue-soft:rgba(103,163,255,.14)  --blue-ring:rgba(103,163,255,.22)
```
形成 Background < Panel < Card < Hover < Active 的清晰层级；边框由半透明改为**实色**，卡片轮廓清楚。

## 4. 修复了哪些组件

**Workbench（`private/styles.css`）**
- 文字规则从“亮色字面量”改为 **token 化**（`.page-greeting/.breadcrumb/.section-subtitle/.result-meta/.tool-card-body h3/.tool-description/.feature-card p/.intro-status/.empty-state p/.app-footer` → `var(--muted/-2/text-strong)`），两主题同时正确。
- 暗色专属打磨：`content-section`(panel)、`nav-panel`、`topbar`(glass)、`global-search`(输入/placeholder/kbd/icon)、`category-tab`(default/hover/active)、`tool-card`/`tool-glyph`/`version-badge`/`favorite-button`/`tool-arrow`、`feature-card`、`intro-status`、`empty-state`、`nav-group h2`/`nav-count`、`panel-collapse`、`account-menu` 等。

**Tool pages（`private/app-shell.css`）**
- 删除 V1.2/V1.3/V1.4 的“亮色字面量”块，替换为**主题正确**的单一块（token 驱动 + 明确暗色规则）：Excel Viewer（工具栏/表头/单元格/公式栏/tab/按钮）、风险列表文字、筛选控件、表格、按钮（深底白字）、卡片/标题/subtitle、风险徽标、Overlay 下拉（门户）。
- 暗色 token 二次桥接：`body.dark > .page-shell/.tool-shell { --text/#muted/... }`，避免亮色桥接在暗色泄漏。

**Header / Sidebar / Breadcrumb / Search / Tabs / Badge / Button** 均随 token 修复，对比度提升。

## 5. 哪些页面已验证

- Workbench `/`（暗色 + 亮色）— 标题/描述/Feature 卡/TOOL LIBRARY/分类 Tab/工具卡标题与描述/meta/Sidebar/Header/Search 全部清晰。
- Tool `/tools/excel-decimal-check`（暗色 + 亮色）— 标题、上传卡（暗色下 drop-zone 正确为深色）、扫描选项、按钮、chip、Viewer 工具栏/表头/网格。
- 计算样式探针（暗色）：`body text = #f5f7fa`、`--muted = #d7dfea`、卡片标题 `#f5f7fa`、drop-zone 背景不再强制白、卡片背景 `#10213a`。
- 回归：`npm test` 216 pass / 0 fail；`node --check` 全通过；`/health` ok。

## 6. 是否保持 light theme 不受影响

**是。** 亮色 `:root` tokens 未改；修复方式为“把亮色字面量改成 token”，亮色解析值不变（`var(--muted)`=#667085 等）。
亮色 Tool 页与 Workbench 截图复核正常。

## 7. 具体修改文件列表

- `private/styles.css` —— 重写 `body.dark` token 块；把 Workbench 可读性规则 token 化；新增暗色组件打磨块。
- `private/app-shell.css` —— 移除亮色字面量块，改为单一块（token + 暗色适配）：Viewer / 风险列表 / 筛选 / 表格 / 按钮 / 卡片 / 下拉门户 / 暗色 token 桥接。

（未改 `private/tools/**` 业务脚本；`excel-decimal-check/script.js` 的下拉门户为上一轮 V1.4 变更，本轮未再改。）

## 8. 已知问题（如有）

- 下拉门户（portal）位于 `<body>`，其暗色样式通过 `.ms-panel--portal` + `body.dark` 提供；若未来引入 `prefers-color-scheme` 自动主题，需同步该选择器（当前项目用 `body.dark` class，已覆盖）。
- 强烈建议后续把 `body.dark` 升级为 `[data-theme="dark"]` 与 `prefers-color-scheme` 双通道（本次未做，避免扩大改动面）。

---

## 验收对照

- [x] 页面标题/描述清晰 · [x] Sidebar 导航与分类清晰 · [x] Header/Breadcrumb 清晰 · [x] Search placeholder 清晰
- [x] Tool Library 清晰 · [x] Tab/Filter 清晰 · [x] 工具卡标题/描述/meta 清晰 · [x] 用户卡片清晰
- [x] Badge 清晰 · [x] 按钮文字清晰（深底白字） · [x] hover/active 清晰 · [x] 暗色层次清楚、不再糊
- [x] **Light theme 未破坏**

**Business Logic Modified: NO**
```bash
npm run dev   # http://127.0.0.1:8080 （需登录）
```
