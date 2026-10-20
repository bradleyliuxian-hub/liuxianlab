# 股权结构图识别（equity-structure）

纯 Python 本地识别，不调用任何大语言模型或云端语义 API。Node 复用现有
Express + session + PostgreSQL + `storage/` 体系；Python 在独立
`.equity-venv` 中运行 PaddleOCR/OpenCV。

## 流程

1. `POST /api/equity-structures` 上传 PNG/JPG/WebP（≤100MB）到
   `storage/equity-structure/<uuid>/source.*`，按 `owner + SHA256` 命中已完成
   结果时直接返回缓存任务。
2. `POST .../:id/start` 入队；Node runner spawn
   `python -m services.equity_structure.worker`。
3. Worker：解码 → 大图切片 → 多尺度 OCR → 重叠去重 → 节点框检测 →
   横/竖线检测 → 显式线段拓扑 → 持股比例二次裁图 OCR → 注销过滤 →
   `result/result.json`。
4. 页面轮询状态；完成后可编辑节点/关系/比例并重绘，`PUT .../:id/result`
   保存 `manual-result.json`。
5. 导出：页面“下载结果”窗口提供 SVG/PNG（浏览器从当前编辑结果生成）
   与 Excel/PDF（先保存当前修改，再由 Node 调用
   `services.equity_structure.export_cli` 生成）。

## 目录

```text
services/equity_structure/
├── schemas.py            # Node/Edge/Result 类型与校验
├── config.py             # 切片/阈值/字典配置
├── normalize.py          # 文本、百分比、UI 噪声、注销词
├── dictionary.py         # RapidFuzz 字典纠错（difflib fallback）
├── image_preprocess.py   # 解码、缩放、百分比图像变体
├── tiling.py             # 重叠切片与坐标
├── ocr_engine.py         # PaddleOCR 2.x/3.x 适配、多尺度合并、去重
├── ocr_types.py          # 无 cv2 依赖的 OcrItem
├── node_detector.py      # HSV 节点框 + 文本归入 + NMS
├── line_detector.py      # 横/竖线提取与合并
├── geometry.py           # Segment
├── topology.py           # 线段图、路径搜索、关系推断
├── percentage_reader.py  # 二次裁图 + 多版本 OCR 投票
├── structure_builder.py  # 层级、核心主体、注销过滤、质量
├── layout.py             # PDF/SVG 共用布局
├── exporters.py          # SVG / Excel / PDF
├── service.py            # 编排
├── worker.py             # 后台任务
└── export_cli.py         # Excel/PDF 导出 CLI
```

## 环境

```bash
scripts/local/setup-equity-ocr.sh
```

脚本创建 `.equity-venv`（已 gitignore），安装
`services/equity_structure/requirements.txt`：PaddlePaddle 3.3.1 +
PaddleOCR 2.10.0 + numpy<2 + OpenCV（PaddleOCR 依赖）+ RapidFuzz + openpyxl +
reportlab。Node 通过 `EQUITY_STRUCTURE_PYTHON_BIN` 或默认
`.equity-venv/bin/python` 调用。

首次 OCR 会下载 Paddle 中文模型；生产服务器需要提前允许该下载或预置模型。
Ubuntu 上若 `import cv2` 报 `libGL.so.1`，需安装系统库 `libgl1`（以及常见的
`libglib2.0-0`），这属于服务器环境准备，不是 Python 包依赖。

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/equity-structures/meta` | 限制、切片参数、导出格式 |
| `POST` | `/api/equity-structures` | 上传 / 缓存命中 |
| `GET` | `/api/equity-structures` | 当前用户历史 |
| `POST` | `/api/equity-structures/:id/start` | 入队 |
| `GET` | `/api/equity-structures/:id` | 状态/进度 |
| `GET` | `/api/equity-structures/:id/source` | 原图（owner） |
| `GET` | `/api/equity-structures/:id/result` | 结果 JSON |
| `PUT` | `/api/equity-structures/:id/result` | 保存人工修改（12MB JSON） |
| `GET` | `/api/equity-structures/:id/export?format=xlsx\|pdf` | 服务端导出 |
| `POST` | `/api/equity-structures/export/png` | 当前 SVG → CairoSVG PNG |
| `GET` | `/api/equity-structures/:id/layout` | 读取人工布局 |
| `PUT` | `/api/equity-structures/:id/layout` | 保存人工布局 |
| `POST` | `/api/equity-structures/corrections` | 记录 OCR 名称修正 |
| `DELETE` | `/api/equity-structures/:id` | 删除 |

## 字典

`config/equity_structure/company_dictionary.txt`，每行一个完整名称，
`#` 开头为注释。默认只在高相似度（阈值 91）且长度接近时纠正；短个人名不纠错。
所有纠错写入结果的 `dictionary_corrections`（original / corrected /
similarity），并在页面展示。

## 版本更新说明

页面右上角版本号是“版本更新”入口。每次版本号变更必须同步：

- `private/tools/equity-structure/index.html` 版本号与资源 query
- `config/tools.json` 的 `version`
- `script.js` 的 `CURRENT_VERSION` 与 `VERSION_NOTES`

`VERSION_NOTES` 按版本记录功能级变化；不能只修改版本号而不写更新内容。

## 可视化布局编辑器

页面在自动布局之上维护独立的 `layout`（节点位置/尺寸、比例标签位置、总线位置），
不修改 OCR 关系数据。拖动使用 Pointer Events + `getScreenCTM()` 转换坐标，
缩放/平移不改变真实布局坐标。

- 节点拖动：连线、总线、比例标签实时跟随
- 比例拖动：只更新 `labels[edgeId]`，`manual=true`
- 保存：`PUT /api/equity-structures/:id/layout` → `manual-layout.json`
- 刷新：`GET /layout` 合并到自动布局
- Undo/Redo：pointerup 时记录一次快照，栈上限 50
- SVG/PNG：使用当前编辑器布局；PDF：服务端读取 `manual-layout.json`
- 导出模式不渲染选择框、resize handles、辅助线
- 布局状态示例：`{nodes:{id:{x,y,width,height,manualPosition,locked}}, labels:{edgeId:{x,y,manual}}, buses:{shareholder:{y,manual},direct:{y,manual}}, canvas:{width,height}}`
- 已实现：节点/比例拖拽、连线跟随、保存/恢复、Undo/Redo、Zoom/Pan、Fit、锁定、Shift 多选、顶部/居中对齐、水平均分、四角 resize、键盘微调
- 尚未实现：总线直接拖动、属性侧栏数值编辑、框选、手工 bend point、多人并发编辑锁

## PNG 后端导出（CairoSVG）

浏览器不再使用 `SVG -> Image -> Canvas` 生成 PNG（该链路在部分浏览器会触发
`image.onerror`）。当前流程：

```text
编辑器 layout state
-> buildSvgString(exportMode=true) 生成自包含 SVG
-> POST /api/equity-structures/export/png
-> services/equity_structure/png_export.py
-> CairoSVG
-> image/png
```

- SVG 必须包含 `xmlns`、有效 `width/height/viewBox`；禁止 `foreignObject`、
  `<script>`、`<image>`、外部 URL、`@import`。
- 中文由系统字体渲染；Ubuntu 需安装 `fonts-noto-cjk`，CairoSVG 需
  `libcairo2`、`libpango-1.0-0`、`libpangocairo-1.0-0`。
- macOS 本地通过 `scripts/local/equity-python` 设置 Homebrew Cairo 动态库路径。
- 最大 PNG 尺寸 20000px / 1.2 亿像素，超限自动降低 scale，不 OOM。
- 下载窗口提供“调试 SVG”，用于确认 self-contained SVG 本身可打开。
- PNG 完全使用页面当前编辑布局，后端不重新布局。

## 绘图与导出

前端 `buildLayout()` 产生节点坐标，`buildRoutes()` 统一处理关系线：

- 所有 `shareholder_to_core` 使用同一条顶部总线（single busY）
- 所有核心主体直接投资公司使用同一条下级总线（single childBusY）
- 持股比例贴在对应竖线旁，带白底并做碰撞/边界检测
- SVG/PNG 共用同一布局；PNG 导出完整 SVG 画布，超宽时自动降低 scale
- 英文名称保留词间空格，并按单词换行
- 页面容器横向滚动，不压缩超宽图

## 真实天眼查模板适配

当前节点检测同时支持：

- 浅米色 / 金棕色边框节点（参考模板）
- 白底 + 蓝色圆角边框节点（天眼查/企查查常见模板）
- 橙色圆形个人股东

真实微信截图回归（7434×1134）：31 个节点、26 条关系、核心主体
“上海元祖梦果子股份有限公司”、4 个“注销”节点被排除，识别约 50 秒。
长基金名称仍可能出现 1–2 个字的 OCR 误读，应在页面人工修正；页面修改不会
重新跑 OCR。

## 已知限制

- 纯规则/几何方法，不保证对所有截图模板通用；节点颜色、连线样式差异大时
  需要调整 HSV / 形态学参数。
- PaddleOCR 首次运行需要下载模型；生产环境需确认网络或预置模型。
- 持股比例二次裁图对每条候选关系执行多次 OCR，边数很多时耗时明显。
- PDF 优先输出股权图（A3 横向自动缩放），超宽图会缩小；完整数据请用 Excel。
- PDF 中文字体使用系统 CJK 字体（Noto/WQY/微软雅黑/Arial Unicode）；若服务器没有
  可用字体，中文可能无法正确显示，需要在部署机上安装字体。
- 注销状态依赖节点内/邻近文本命中“注销/吊销/撤销”，不会做语义推断。
- 人工修改默认保存在 `manual-result.json`；删除任务会一并删除。
