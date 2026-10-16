# UI_V1_3_TOOL_INTEGRATION_REPORT.md
# Tool UI 统一 + Excel 横向滚动修复 + 对比度修复

日期：2026-10-16
范围：在保留 Workbench UI V1/V1.2 视觉方向（Navy + Enterprise Blue + Cool Gray + White）前提下，
统一 Tool 页面视觉、修复 **Excel 横向滚动无法到达 A 列（P0）** 与 **蓝底黑字对比度（P0）**。
未改业务逻辑 / Excel 算法 / 风险规则 / 认证。

---

## 1. Tool UI 当前问题

- 工具页使用各自旧版 `styles.css`（绿色时代），通过 `app-shell.css` 的 token 桥接才变成企业蓝，
  但旧样式里大量 **字面量颜色** 与 `background: var(--accent); color: var(--dark)` 组合，
  在蓝色桥接下形成 **蓝底 + 近黑字**（重点问题）。
- 步骤徽标、tool-mark、job-status、下载/定位按钮等在旧样式下对比不足。
- 表格表头/正文颜色不统一。

## 2. Excel A 列 Bug 根因（P0，实测定位）

用同源探针挂载真实 Viewer（选中 `Q6`，工作表 `A1:Z60`）读取渲染结果：
```
mode=focus  minLeft=0  maxLeft=226  sw=1472  cw=1246  hasA=false
firstLabels=[F,G,H,I,J,K,...]  count=23
```
**根因（CASE D/E — 列虚拟化 + 坐标系统）**：
focus 模式把列做成了**以选中项为中心的虚拟窗口**（选中 Q6 → 窗口从第 6 列 F 开始），
canvas 只包含 `[F..]` 这些列，**A/B/C/D/E 根本没有进入 DOM**（`hasA=false`）。
而 `scrollLeft` 最小就是 `0`，此时左边缘显示的是窗口首列 F —— 因此**无论怎么拖都到不了 A**。
这不是 CSS `overflow` 问题，而是**渲染窗口把首列裁掉了**。

## 3. scrollLeft 分析

- 修复前：`scrollLeft ∈ [0, 226]`，但 `0` 对应的视觉列是 **F**（不是 A）。
- 修复后：`scrollLeft ∈ [0, 1698]`，`0` 对应 **A**；`maxLeft` 可达末列。
- reveal（定位）只在“显式导航”时设置一次 `scrollLeft`，普通滚动不会重置（见 §6）。

## 4. scrollWidth 分析

- 修复前 `scrollWidth=1472`（= window 列宽之和，仅 F.. 共 23 列）。
- 修复后 `scrollWidth=2944`（= A..末列全部列宽 + 行号列 52px），因此横向可滚动到 A 与末列。

## 5. 是否存在 nested scroll container

- **不存在双重横向 owner**。横向 owner 唯一：`.vwr-body{overflow:auto}`。
  行号列/列头通过 `transform: translateX(-scrollLeft)` 同步，不额外滚动。
- 结论：**没有** CASE B 的“两层横向滚动”。

## 6. 是否存在 scrollIntoView 问题

- Viewer 内**没有 `scrollIntoView`**；定位用一次性 `body.scrollTop/scrollLeft`。
- 只有 `focusToken`/`mode` 变化才 reveal（`lastFocusToken/lastMode` 守卫），
  普通 render / 滚动 / Resize **不会**重新定位。故不存在“拖回 A 又被弹回 Q6”。

## 7. 是否存在 ResizeObserver 问题

- V1.2 已把 `ResizeObserver` 从“观察滚动容器”改为“观察固定 `.vwr-frame`”并加同尺寸去抖，
  消除 scrollbar↔尺寸反馈。本轮未回退。

## 8. 是否存在重复初始化

- **无**。`initViewer()` 每次扫描创建唯一实例；`resetResults()` 会 `destroy()`；
  `app-shell.js` 有单例守卫；工具脚本单次加载。

## 9. 是否存在 virtual column 问题

- **是（根因）**：focus 模式对列做了虚拟化（居中窗口），导致 A 不渲染。
- 修复：focus 模式**不再对列做虚拟化** —— 横向始终渲染 `minCol(A) .. maxCol(末列)`，
  仅纵向保持窗口化并居中于选中项。

## 10. 最终解决方案

`private/shared/excel-viewer/excel-viewer.js` → `renderFocus()`：
```js
const focus = focusWindow(state.selected, bounds);
focus.colStart = bounds.minCol;   // 永远从 A 列开始
focus.colEnd   = bounds.maxCol;   // 直到最后一列
```
保留纵向窗口居中。效果：`hasA=true`，`firstLabels=[A,B,C,D,E,F...]`，`scrollLeft=0` 显示 A，
可拖到末列并可拖回 A（不再被重置）。

## 11. UI Design Token

工具页统一 token（`app-shell.css` 作用域 `body > .page-shell/.tool-shell`）：
`--accent:#1456B8`、`--accent-strong:#071B3A`、`--primary:#1456B8`、`--blue:#1668D9`、
`--dark:#071B3A`、`--text:#101828`、`--muted:#475467`、`--muted-2:#667085`、
`--line:#E4E7EC`、`--line-strong:#D0D5DD`；并新增 `--accent-soft:rgba(20,86,184,.10)`。
配套色板：LIGHT BLUE `#EAF2FF`、PALE BLUE `#F4F8FF`、PAGE `#F6F8FB`、SURFACE `#FFFFFF`。

## 12. Button Contrast 修复

规则：**深色/蓝色背景 → 白色文字**。已修复（工具页作用域，未用全局 `button{}`）：
`.tool-mark`、`.step-no`、`.job-status`、`.drop-icon`、`.file-icon`、`.download-button`、
`.locate-button`、`.erh-create`、`.vwr-tab.active`、`.summary-grid .is-total/.is-high`、
`.severity-tab.active`、`.result-tabs button.active`、`.flow-steps li.active` → `color:#fff`；
下载/定位/文件图标背景统一 `#1456B8` + 白字；`primary-button/.submit-button` 白字。
Secondary：白底 + `#D0D5DD` 边 + `#344054` 字。

## 13. Excel Cell Contrast 修复

- 单元格文字 `#101828`；网格线 `#D9E1EA`；表头底 `#F2F4F7`、字 `#475467`、边 `#D0D5DD`。
- 公式格 `#0B4A8F`；公式栏 `#344054` 等宽、底 `#F8FAFC`。
- 风险高亮：浅 tint `#FFF6E5` + 细橙内描边（overlay，不改数据/格式）。
- 选中：`2px #1261D6 outline`（不占布局、不改尺寸）。
- 网格数据区**禁用过渡**（无尺寸动画）。

## 14. Tool UI 统一情况

通过 `app-shell.css` 的统一层，所有工具页（standardizer / decimal-check / hardcode / excel-review /
sales-income / contract-review）在**不改各自业务 JS** 的前提下获得：
统一 token、统一 tool-mark/step 徽标、统一卡片圆角/边框/极轻阴影、统一 drop-zone（白卡 + 蓝 hover）、
统一表头/表格配色、统一按钮对比、统一 Excel Viewer 配色与工具栏。Workbench 视觉方向保持。

## 15. Mobile 修复

- 页面 `body` 不横向滚动（工具页 `overflowX=0` 实测 @1440 与 @390）。
- Excel **在网格容器内**独立横向/纵向滚动（`.vwr-body{overflow:auto}`），
  即 `body 不横滚 + 网格可横滚`。
- 移动端工具页保留 App Shell 抽屉导航；`≤820` 隐藏 rail 变抽屉。

---

## QA（实测）

- **A 列**：`hasA=true`；`scrollLeft=0` 显示 A；`maxLeft` 达末列；从风险定位后可再拖回 A（探针）。
- **稳定性**：focus↔sheet 切换滚动位置保留、画布稳定、无震荡（V1.2 探针复测）。
- **页面溢出**：工具页 1440 / 390 `overflowX=0`。
- **对比度**：组件探针截图确认 tool-mark/下载/定位/文件图标/step/job-status 均为**深底白字**。
- **回归**：`npm test` **216 pass / 0 fail**；`node --check` 全通过；真实服务 `/health` ok。

## 修改文件（本轮 v1.3）
- `private/shared/excel-viewer/excel-viewer.js`（focus 模式列锚定 A..末列）
- `private/app-shell.css`（追加 v1.3 对比度 + 工具统一层）

（V1/V1.1/V1.2 的文件改动仍在工作区，未回退。）

## 未修改的业务核心文件
`decimal-core.js`、`business-type.js`、`reference-map.js`、`risk-core.js`、`decimal-workbook.js`、
`issue-filters.js`、`formula-*`、`hardcode-*`、`viewer-core.js`、`ooxml-highlight.js`、
各工具业务 `script.js`、`server.js`、`server/**`、`services/**`、`workers/**`、迁移、`config/tools.json`、`login.js`。

## 已知/取舍
- focus 模式现在横向渲染 `A..末列`（换取 A 可达）。超宽工作表（数百列）会渲染更多列；
  如需极致性能可后续加入“从 A 起的分段渲染”，但**不得再让 A 不可达**。
- 纵向在 focus 模式仍为居中窗口；查看全部行请用「查看完整工作表」。

**Business Logic Modified: NO**

```bash
npm run dev   # http://127.0.0.1:8080 （需登录）
```
