# LIUXIAN_UI_V1_4_FIX_REPORT.md
# Enterprise UI V1.4 — Tool Unification + Excel Scroll Engine + Overlay + Contrast

日期：2026-10-16
范围：系统性修复 Excel Viewer 滚动引擎（横向 A 列 / 纵向 314 行）、风险自动定位、
Filter 下拉浮层、蓝底黑字对比度、Tool 页面统一、响应式。
未改业务逻辑（解析/风险/公式/导出/认证）。

---

## 1. 发现的问题

- **P0-A 横向**：Excel Viewer 无法稳定拖回 A 列（视觉最左是 C/F）。
- **P0-B 纵向**：从第 314 行无法继续向上滚动到第 1 行。
- **P0-C**：风险自动定位可能与手动滚动冲突 / 反复回拉。
- **P0-D**：Filter 下拉浮层被卡片 `overflow` 裁切、层叠不清晰。
- **P0-E**：蓝底黑字（旧工具 CSS 的 `background:var(--accent); color:var(--dark)` 在蓝色桥接下变蓝底近黑字）。
- **P1**：Tool 页面视觉语言与 Workbench 不统一（步骤/徽标/卡片/表格/按钮）。

## 2. Excel Vertical Scroll Root Cause

`excel-viewer.js#renderFocus()`（focus 模式）把**行**做成“以选中项为中心的、视口大小的小窗”：
canvas 高度仅覆盖 `[rowStart..rowEnd]`（如 313..349），因此 `scrollTop` 范围只在这几十行内，
**第 1..312 行根本不在 DOM**，也无法滚动到 → “314 行无法继续向上”。
这与 A 列问题是**同一个 Scroll Engine 缺陷**：视口尺寸的画布丢掉了真实滚动范围。

## 3. Excel Horizontal Scroll Root Cause

同源同因：focus 模式的**列**窗口从 “选中列 - 半窗” 开始（选中 Q6 → 从 F 开始渲染），
A–E 不在 DOM；`scrollLeft` 最小 0 只对应 F → “拖不到 A”。V1.3 曾对列做了锚定，
但根因（视口尺寸画布）未除，纵向仍坏。V1.4 合并为**单一滚动引擎**修复。

## 4. Risk Auto Scroll Root Cause

定位 reveal 依赖 `focusToken`/`mode` 变化触发，**不会**每次 render 都执行（无无限回拉）。
但 focus 模式的画布不随 `scrollTop/scrollLeft` 变化，用户手动滚动时视觉不动，误以为“被拉回/卡住”。
统一为全文画布 + 虚拟窗口后，reveal 仍只在显式导航时发生，手动滚动完全自由。

## 5. Virtualization 分析

- 采用**自研虚拟化**（`.vwr-body` 滚动 + 绝对定位单元格 + 行列头 transform 同步）。
- 缺陷：focus 模式把 canvas 设成“视口大小”，导致总行高/总列宽 ≠ 全表 → 滚动范围错误。
- 修复：canvas **始终**覆盖 `[minRow..maxRow]×[minCol..maxCol]`（含固定余量），
  仅渲染可视窗口单元格（按绝对坐标定位）。`TOTAL = 行数 × 行高` 语义恢复正确。

## 6. scrollTop 分析

- 修复后：`scrollTop ∈ [0, scrollHeight-clientHeight]`。
- 实测（1000 行表）`maxSt=21391`；`scrollTop=0 → 第 1 行`；`scrollTop=max → 第 1062..1100 行`。
- **不自动重置**：仅“切换 Sheet 且非导航”时归零一次；resize/筛选/排序/选择都不重置。

## 7. scrollLeft 分析

- 修复后：`scrollLeft ∈ [0, maxSl]`；实测 `maxSl=1698`。
- `scrollLeft=0 → A`；`scrollLeft=max → W/末列`；风险定位后仍可再拖回 A。

## 8. scrollHeight 分析

- 修复前（focus）：≈ 窗口行数×行高（丢范围）。
- 修复后：≈ 全表行数×行高 + 余量（实测 1000 行 → 可滚动到 1100 行含余量）。

## 9. scrollWidth 分析

- 修复前（focus）：≈ 窗口列宽（丢 A–E）。
- 修复后：≈ 全表列宽（A..末列，实测 2944 = 含行号列 52px）。

## 10. Nested Scroll 分析

- 横向 owner 唯一：`.vwr-body{overflow:auto}`；行/列头用 `transform` 同步，不额外滚动。
- 纵向：页面 `body` 负责整页滚动；`.vwr-body` 负责网格滚动；**两者独立**。
- **无 nested 双横向/双纵向容器**。Risk List 与 Grid 各自的滚动互不影响。

## 11. ResizeObserver 分析

- 观察对象为**固定外框 `.vwr-frame`**（非滚动容器）+ 同尺寸去抖，避免“滚动条↔尺寸”自反馈。

## 12. 重复初始化分析

- Viewer 单实例：`initViewer()` 只在扫描后创建一次；`resetResults()` 会 `destroy()`；
  `app-shell.js` 单例守卫；工具脚本单次加载。无重复创建 Grid/Viewer。

## 13. Dropdown Overlay 架构

- `.ms-panel` 由“卡片内 `position:absolute`（会被 `overflow:hidden` 裁切）”改为
  **Portal：挂到 `<body>` + `position:fixed`**，位置由 `control.getBoundingClientRect()` 计算
  （无硬编码坐标）；下方空间不足时**自动上翻**；`resize/scroll` 时重定位；`Escape`/外部点击关闭。
- 实测：`panelInBody=true, position=fixed, z=1200, withinX=true, withinY=true, bodyOverflowX=0`。

## 14. Z-index Architecture

统一层级（工具页）：Base 0 / Sticky 10 / Header 20 / Sidebar 30 / Dropdown**门户 1200**
（原局部 40 → 门户固定 1200，高于 Viewer 与卡片）。不再随意 `999999`。

## 15. Design Tokens

工具页统一 token（`app-shell.css`）：
`--color-navy:#071B3A`、`--color-primary:#1456B8`、`--color-blue:#1668D9`、
`--color-blue-light:#EAF2FF`、`--color-blue-pale:#F4F8FF`、
`--color-text-primary:#101828`、`--color-text-secondary:#344054`、`--color-text-muted:#667085`、
`--color-border:#D0D5DD`、`--color-border-light:#E4E7EC`、`--color-surface:#FFF`、`--color-background:#F6F8FB`；
桥接 `--accent/--dark/--primary/--blue/--line/--muted` 等旧 token 到上述体系。

## 16. Contrast 修复

- 规则：**深色/蓝色背景 → 白色文字**（作用域 `body > .page-shell/.tool-shell`，未用全局 `button{}`）。
  修复 `.tool-mark/step-no/job-status/drop-icon/file-icon/download-button/locate-button/erh-create/
  vwr-tab.active/summary is-total|is-high/severity-tab.active/result-tabs.active/flow-steps.active` → `#fff`。
- 风险徽标采用企业风险色：High `#FEF3F2/#B42318`、Medium `#FFFAEB/#B54708`、Low `#F2F4F7/#475467`、Watch `#EFF8FF/#175CD3`。
- 选中单元格 `outline: 2px solid #1668D9`（overlay，不改数据/尺寸）；风险格浅 tint + 细描边。

## 17. Tool UI 统一情况

所有工具页（standardizer / decimal-check / hardcode / excel-review / sales-income / contract-review）
在**不改各自业务 JS** 的前提下，经 `app-shell.css` 统一：token、tool-mark/step 徽标、卡片圆角/边框/极轻阴影、
白卡 drop-zone（蓝 hover）、表头/表格配色、按钮对比、Excel Viewer 配色与工具栏。Workbench 保持 V1。

## 18. Mobile 修复

- 页面 `body` 不横向滚动（实测 `bodyOverflowX=0` @1024/390）；
- Excel **仅在 `.vwr-body` 内**横向/纵向滚动；
- 工具页保留 App Shell 抽屉导航（≤820）；下拉浮层宽度限制并自动上翻，不超出视口。

## 19. 修改文件清单

- `private/shared/excel-viewer/excel-viewer.js`
  - 合并为**单一滚动引擎**：两模式都走全表画布 + 虚拟窗口（移除 `renderFocus`/`focusWindow` 特例）；
  - 滚动时重渲染可视窗口（双轴）；`setCanvas` 尺寸去重；ResizeObserver 观察固定 frame + 去抖；
  - 稳定 `viewBounds`；新增附加 API `render()`（同步渲染，便于测试/宿主）。
- `private/tools/excel-decimal-check/script.js`
  - 下拉浮层改 Portal（`body` + `fixed` + 视口定位/上翻/重定位/ESC/外部关闭）。
- `private/app-shell.css`
  - 追加 v1.3 对比度/统一层与 v1.4 overlay + token + 风险色 + 筛选取色规则。

## 20. 未修改的业务核心文件

`decimal-core.js`、`business-type.js`、`reference-map.js`、`risk-core.js`、`decimal-workbook.js`、
`issue-filters.js`、`formula-parser.js`、`formula-pattern.js`、`hardcode-core.js`、`hardcode-workbook.js`、
`shared/excel-viewer/viewer-core.js`、`shared/excel-highlight/ooxml-highlight.js`、
各工具业务 `script.js`、`server.js`、`server/**`、`services/**`、`workers/**`、迁移、`config/tools.json`、`login.js`。

## 21. QA 测试结果

- **横向滚动**：`hasA=true`；`scrollLeft=0→A`；`scrollLeft=max→末列`；风险定位后可拖回 A。✅
- **纵向滚动**：`scrollTop=0→第1行`；`scrollTop=max→第1062..1100行`；可回到任意行。✅
- **风险定位**：`reveal()` → 居中 Q325（首行 ~302），**一次性**，之后手动滚动自由。✅
- **Dropdown**：body 门户、fixed、z1200、完全在视口内、无页面横向溢出。✅
- **对比度**：组件探针显示深/蓝底均为白字。✅
- **回归**：`npm test` **216 pass / 0 fail**；`node --check` 全通过；Workbench 折叠/展开与抽屉正常；`/health` ok。
- 说明：无头 Chrome 的 `--virtual-time-budget` 不驱动 rAF，故初始 reveal 用同步 `render()` 验证；
  真实浏览器中 reveal 由 rAF 正常执行。

## 已知/取舍
- 双轴虚拟窗口按需要求与视口决定渲染量；超宽超长表仍受 `MAX_ROWS=20000` 与列范围约束。
- 风险定位仍为一次性（符合要求），不做“始终跟随”。

**Business Logic Modified: NO**

```bash
npm run dev   # http://127.0.0.1:8080 （需登录）
```
