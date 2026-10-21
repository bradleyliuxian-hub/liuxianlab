# Flowchart-to-Excel — Artifact Index

- 日期：2026-10-21
- 用途：封存索引；只引用现有受控位置，不复制客户图片、业务 ZIP 或 graph 内容。
- 状态词汇：`EXPERIMENTAL` / `BROKEN` / `REPAIRED-NOT-EXCEL-VERIFIED` / `DOCUMENTED` / `NOT FOUND`
- SHA-256 只对本次实际可访问文件计算；未访问的 approved graph 只引用任务 ID 与报告哈希。

---

## 1. 目标模板

| 项目 | 路径 | SHA-256 | 状态 |
|---|---|---|---|
| Trade purchase.CN.xlsx | `~/Downloads/Trade purchase.CN.xlsx` | `c2d8426ae6f45846ca1036100761604ad9f58c83fc55fdf7b4345118db3b2a80` | 参考模板 |

---

## 2. 实验 XLSX 候选

| 版本 | 路径 | SHA-256 | 状态 |
|---|---|---|---|
| V1 | `~/Downloads/flowchart-excel-visual-fix-2026-10-20/flowchart-revision5-visual-fix-default-twoCell.xlsx` | `e876cc2cbbcc49ef832d7446ed697f60f36876193ef03ac8d0ea34dee16751f4` | EXPERIMENTAL；视觉 QA FAIL |
| V2 | `~/Downloads/flowchart-excel-visual-fix-v2-2026-10-20/flowchart-revision5-visual-fix-v2-default-twoCell.xlsx` | `85bde120538b18df74db1f7e10304a2cc03584e5e63a12e793f65374e5c8a892` | EXPERIMENTAL；视觉 QA FAIL |
| V3 | `~/Downloads/flowchart-excel-visual-fix-v3-2026-10-20/flowchart-revision5-visual-fix-v3-default-twoCell.xlsx` | `677b9882cdb5d8f9385a555e3ee55777cfcb291d38a4008640bef5e9593cb97b` | EXPERIMENTAL；视觉 QA FAIL |
| V4 | `~/Downloads/flowchart-excel-visual-fix-v4-2026-10-20/flowchart-revision5-visual-fix-v4-default-twoCell.xlsx` | `c8605b9fafc0de21cb5fb26299db47f1d1d125c589f68dd4ef23a8e705aa95a1` | EXPERIMENTAL；Mac/Windows NOT RUN |
| Anchor A | `~/Downloads/flowchart-excel-anchor-validation-2026-10-20/flowchart-revision5-anchor-default-twoCell.xlsx` | `9b712b47ada34f041ac0bc9ff3f34de05ee6c36ac4d33c00defa91c34fe05ecf` | EXPERIMENTAL；旧候选 Mac A/B PASS，Windows NOT RUN |
| Anchor B | `~/Downloads/flowchart-excel-anchor-validation-2026-10-20/flowchart-revision5-anchor-oneCell.xlsx` | `946b2662b7bc29df65ce99286786499198a9200003ac4dd11fe5f5b243506058` | EXPERIMENTAL；同上 |

> 以上均不是正式客户交付物。

---

## 3. Golden Fixture

| 项目 | 路径 | SHA-256 | 状态 |
|---|---|---|---|
| 原始坏包 | `~/AI-Workspace/tools/flowchart-golden-fixture-phase1/output/golden-fixture-default-twoCell.xlsx` | `dfedfd79e0ad0f7a6b7c85821f32b33545b057cb122de5fb0a3f6f4312896357` | BROKEN：Excel 修复提示；已保留 |
| 原始坏包副本 | `~/AI-Workspace/tools/flowchart-golden-fixture-phase1/output/package-repair-v1/source-original-broken.xlsx` | `dfedfd79e0ad0f7a6b7c85821f32b33545b057cb122de5fb0a3f6f4312896357` | BROKEN 证据 |
| 修复版 | `~/AI-Workspace/tools/flowchart-golden-fixture-phase1/output/package-repair-v1/golden-fixture-package-repaired.xlsx` | `3c271e4b93e9daa9007089185614f16b7eae30d5510984e70d1e0e1f7b667a32` | REPAIRED-NOT-EXCEL-VERIFIED |
| 修复前 audit | `output/package-repair-v1/before-audit/package-validation-report.json` | — | FAIL（6 项） |
| 修复后 audit | `output/package-repair-v1/package-validation-report.json` | — | PASS（38/38） |
| SDK validator log | `output/package-repair-v1/openxml-sdk-validator.log` | — | 0 errors；未做 Excel 验收 |
| 静态结构报告 | `output/package-repair-v1/golden-fixture-structure.json` | — | 9 sp / 9 cxnSp |
| 几何验证 | `output/package-repair-v1/golden-fixture-validation-report.json` | — | 73 checks PASS；8 clear / 1 indeterminate |

---

## 4. 受控业务图（未复制）

| 项目 | 位置 | 标识 | 状态 |
|---|---|---|---|
| Approved graph | 受控 `storage/flowchart-excel/<job>/review/`（本档案不复制） | job `551a6811-52aa-40ba-a790-b472e695b549`；revision 5；3 lanes / 63 nodes / 58 edges | DOCUMENTED；未修改 |
| Reviewed graph SHA-256 | 既有报告 | `e5a3b23439d7b0e2d3365d1fb30fb83a32cc548f99c64d1e3bcdfba438721c68` | DOCUMENTED（来自历史报告，本次未重新读取） |

> 不把客户图片、原始业务 ZIP 或 graph 内容复制进 archive 目录。

---

## 5. 重要报告

| 报告 | 路径 | 状态 |
|---|---|---|
| Phase 0 根因审计 | `docs/agent/flowchart-excel/replan-phase0-root-cause-report.md` | DOCUMENTED |
| Golden Fixture Phase 1 | `docs/agent/flowchart-excel/golden-fixture-phase1-report.md` | DOCUMENTED |
| Golden Fixture connector map | `docs/agent/flowchart-excel/golden-fixture-connector-map.md` | DOCUMENTED |
| Golden Fixture package repair | `docs/agent/flowchart-excel/golden-fixture-package-repair-report.md` | DOCUMENTED |
| Golden Fixture manual acceptance | `docs/agent/flowchart-excel/golden-fixture-manual-acceptance.md` | Mac/Windows NOT RUN |
| Slice 5.5 V4 | `docs/agent/flowchart-excel/slice5-5-elk-orthogonal-routing-report.md` | 自动几何 PASS；真实 Excel NOT RUN |
| V4 visual QA | `docs/agent/flowchart-excel/excel-visual-qa-v4-report.md` | 真实 Excel NOT RUN |
| V4 connector routing | `docs/agent/flowchart-excel/connector-routing-v4-report.md` | 运行时 indeterminate 58 |
| Anchor validation | `docs/agent/flowchart-excel/slice5-1-anchor-validation-report.md` | 旧候选 Mac A/B PASS；Windows NOT RUN |
| Review workbench | `docs/agent/flowchart-excel/slice4-review-workbench-architecture.md` | DOCUMENTED |
| External import | `docs/agent/flowchart-excel/slice3-2-external-helper-import.md` | DOCUMENTED |

---

## 6. 代码与实验目录

| 目录 | 用途 | 状态 |
|---|---|---|
| `server/flowchart-excel/` | 路由、任务、导入、复核、artifact | 保留；写 API 已加 Coming Soon gate |
| `services/flowchart_excel/` | Schema/reference、legacy adapter、Python 校验 | 保留 |
| `private/tools/flowchart-excel/` | 上传页、复核工作台 | 保留；上传/写入入口隐藏或禁用 |
| `tests/flowchart-excel/` | Node 测试 | 保留；新增 Coming Soon 测试 |
| `~/AI-Workspace/tools/flowchart-excel-exporter-poc/` | .NET Open XML POC | 保留；不改 |
| `~/AI-Workspace/tools/flowchart-excel-layout/` | ELK / A* 布局实验 | 保留；不改 |
| `~/AI-Workspace/tools/flowchart-excel-visual-fix-v4/` | V4 生成器/校验器 | 保留；不改 |
| `~/AI-Workspace/tools/flowchart-golden-fixture-phase1/` | Golden Fixture | 保留；package repair 已生成 |

> V4/layout/Golden Fixture 代码位于网站 Git 仓库之外，缺少 Git 版本基线。

---

## 7. 未找到 / 未验证

- 真实 Mac/Windows Excel 对修复版 Golden Fixture 的验收：`NOT RUN`。
- Windows Excel 对 63 节点业务规模候选：`NOT RUN`。
- 真实打印预览与可读性：`NOT RUN`。
- `flowChartConnector` connection site 的真实 Excel 行为：`NOT RUN`。
- 上述未完成项不得用“静态 PASS”替代。
