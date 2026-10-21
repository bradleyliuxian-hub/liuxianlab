# Project Status

Updated: 2026-10-21

> 当前状态快照。事实源是仓库 + Git；不写 secret、不写完整 diff、不写聊天历史。

## Git State

- 分支：`main`
- HEAD：`5fd2ca88a571b629298b399b874ba472102e9fac`
- 工作区：dirty 14 项（12 个已跟踪文件修改 + 2 个未跟踪文件/目录）。
- 既有 dirty 改动未清理；本轮未 reset / clean / stash / checkout / restore / commit / push。

## Current Focus

**股权结构图编辑器 v1.2.2：自动识别初稿 + 人工可视化编辑 + 保存恢复 + 统一导出；标题/内容/背景布局已重排。**

- 新增“＋关联公司”：一次创建上游股东或下游被投资公司、关系和比例；关联对象默认当前选中公司，也可在弹窗选择。
- 上游支持递归多层：给一级股东再加父层时自动整层 rebase，新增一层 row、整体下移、画布高度扩展，局部分支不并入核心主体总 bus。
- 新增公司/个人/基金/机构/其他节点，支持复制、删除、锁定、坐标/尺寸编辑。
- 新增股权连线（选择源/目标节点）、删除、关系类型/比例编辑。
- 新增比例标签添加、编辑、独立拖动、隐藏/恢复自动位置。
- 新增属性面板：节点/连线/比例/画布的颜色、字体、边框、圆角、线型、箭头。
- 新增审计米金/简约灰白/蓝灰商务/自定义主题。
- 业务数据、布局、样式分离；布局+样式保存到 `manual-layout.json`，业务数据保存到 `manual-result.json`。
- Undo/Redo 覆盖新增/删除、名称/比例、布局、尺寸、颜色；快捷键 Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y、Delete、Esc。
- SVG/PNG 使用页面最终编辑状态；PDF 读取保存后的 result + layout styles；Excel 读取 result 数据。

Flowchart-to-Excel 仍为 **PAUSED / Coming Soon**，见 `docs/agent/flowchart-excel/archive/PROJECT-ARCHIVED.md`；本任务未改变其状态。

## Known Broken / Unresolved

- Golden Fixture 原始 XLSX 在 Excel 中触发修复提示；包结构修复版已生成，但 **Mac/Windows Excel 均 NOT RUN**。
- V4 大图布局、connector runtime、泳道/图例/控制标记、模板样式仍未通过视觉 QA。
- 打印可读性未定版（10pt × 48% ≈ 4.8pt；A3 高度余量约 0.9pt）。
- Windows Excel 对目标业务规模候选验收缺失。
- `edit_as=pending`；正式 `exportReady=false`。
- V4 / layout / Golden Fixture 代码位于 `~/AI-Workspace/tools/`，不在网站 Git 仓库内。
- 股权编辑器已做 headless Chrome + mock API 冒烟（无登录/无真实客户数据）；真实登录浏览器与人工截图验收仍 NOT RUN。
- PDF 样式已接入代码并通过生成测试，但未做 PDF 视觉逐项验收。
- 本机 LibreOffice 未渲染 Microsoft YaHei UI 中文字形，预览不能替代 Excel。

## Last Verification

- 2026-10-21 股权编辑器 v1.2.2：
  - `node --test tests/equity-structure/*.test.js` = **16 pass / 0 fail**
  - `npm test` = **414 pass / 0 fail**
  - `services/equity_structure` Python = **40 tests OK（1 skipped）**
  - `GET /health` = `{"ok":true}`
  - Headless Chrome（mock API，无登录/无客户数据）冒烟：
    - 上游：选中 Core Co → 添加“示例投资机构 A” fund / 5.6789% → 节点 3→4、关系 2→3、edge source=新节点 target=n2、relation=shareholder_to_core、layout 含新节点、标签和 styles；Undo 3、Redo 4。
    - 下游：选中 Core Co → 添加“示例食品有限公司” company / 75.25% → edge source=n2 target=新节点、relation=investment、新节点 level=3、layout/标签/styles 保存；console error 0。
    - 布局：标题 y=54，内容顶部 y=120，页脚 padding 80；新增上游节点落在 y=120，标题与内容间距 66px；新增下游后 SVG 高度 610→640；背景/导出高度使用同一 bounds；console error 0。
    - 递归上游：给一级股东加父层，高度 610→770；再加祖父层，高度 770→930；levels: Grand X=1 / Parent X=2 / 一级股东=3 / Core=4 / Sub=5；核心主体 shareholder bus 始终 1 条；console error 0。
    - 立即 PDF 导出前自动保存 result=4 节点、layout 含新节点和 styles。
  - 真实登录浏览器/人工截图验收 = **NOT RUN**。
- 2026-10-21 Golden Fixture：
  - .NET 19 pass；Node schema 5 pass；Python 6 OK；
  - static validation 73 PASS；package audit 38/38 PASS；Open XML SDK 0 errors。
- 历史：Slice 5.1 旧 anchor 候选 Mac A/B 58/58 PASS；V2–V4 视觉 QA FAIL；Windows NOT RUN。

## Pending Decision

- 是否永久放弃，或未来重新进入开发。
- 若恢复：先阅读封存档案，再按 `coming-soon-rollback.md` 恢复状态；不得直接打开正式导出。

## Next Action

- 在真实浏览器打开股权结构图工具，验证 v1.2.2 的添加/连线/比例/颜色/Undo/保存恢复/PNG/SVG/PDF。
- 如人工验收发现问题，按“只改一个明确失败原因”的原则修复；不要重跑 OCR 或改已识别业务关系。
- 当前不继续 Flowchart-to-Excel 开发。
- 生产维护窗口：重启 8080 后确认 `config/tools.json` 的 Coming Soon 和写 API gate 已加载。
- 未删除代码/数据；未生成 XLSX；未调用 AI；未改数据库。
