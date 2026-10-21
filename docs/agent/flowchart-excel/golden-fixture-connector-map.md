# Golden Fixture — Shape / Connector Map

- 日期：2026-10-21
- 阶段：Phase 1（最小导出闭环）
- Fixture：`/Users/a123/AI-Workspace/tools/flowchart-golden-fixture-phase1/fixtures/golden-flowchart.json`
- 输出：`/Users/a123/AI-Workspace/tools/flowchart-golden-fixture-phase1/output/package-repair-v1/golden-fixture-package-repaired.xlsx`
- XLSX SHA-256：`3c271e4b93e9daa9007089185614f16b7eae30d5510984e70d1e0e1f7b667a32`
- 原始文件 `output/golden-fixture-default-twoCell.xlsx` 已确认包结构缺陷，仅保留作修复证据；业务 XML 与修复版相同。
- 结构来源：`golden-fixture-structure.json` / `golden-fixture-validation-report.json`

## 1. Node → shape ID

| Node | Excel shape ID | preset | lane | fill | 状态 |
|---|---:|---|---|---|---|
| G01 Start | 1001 | `flowChartTerminator` | LANE_A | `D9E2F3` | mappable |
| G02 接收并核对申请资料 | 1002 | `flowChartProcess` | LANE_A | `D9E2F3` | mappable |
| G03 资料是否完整？ | 1003 | `flowChartDecision` | LANE_A | `D9E2F3` | mappable |
| G04 补充缺失资料 | 1004 | `flowChartProcess` | LANE_A | `D9E2F3` | mappable |
| G05 审核通过 | 1005 | `flowChartProcess` | LANE_A | `D9E2F3` | mappable |
| G06 登记处理结果 | 1006 | `flowChartProcess` | LANE_A | `D9E2F3` | mappable |
| G07 归档审批及相关凭证文件 | 1007 | `flowChartDocument` | LANE_A | `FFFF00` | mappable |
| G08 长中文文本节点 | 1008 | `flowChartProcess` | LANE_A | `D9E2F3` | mappable |
| G09 控制点 CA1 | 1009 | `flowChartConnector` | LANE_B | `92D050` | 语义 `unverified`；shape=`other` + `controls=[CA1]` |

G09 没有被伪装成普通 `process`：

```text
shape = other
controls[0].kind = CA
controls[0].code = CA1
controls[0].display = separate_shape
controls[0].attribution_status = needs_review
```

## 2. Edge → connector ID

| Edge | Connector ID | Source shape | Target shape | Source side / idx | Target side / idx | Route | 端点距离 | 状态 |
|---|---:|---:|---:|---|---|---|---:|---|
| GE01 | 2001 | 1001 G01 | 1002 G02 | right / 3 | left / 1 | straight | 0.0px / 0.0px | `clear` |
| GE02 | 2002 | 1002 G02 | 1003 G03 | right / 3 | left / 1 | straight | 0.0px / 0.0px | `clear` |
| GE03 | 2003 | 1003 G03 | 1004 G04 | bottom / 2 | top / 0 | straight vertical | 0.0px / 0.0px | `clear` |
| GE04 | 2004 | 1003 G03 | 1005 G05 | right / 3 | left / 1 | orthogonal | 0.0px / 0.0px | `clear` |
| GE05 | 2005 | 1004 G04 | 1002 G02 | left / 1 | left / 1 | loopback orthogonal | 0.0px / 0.0px | `clear` |
| GE06 | 2006 | 1005 G05 | 1006 G06 | right / 3 | left / 1 | straight | 0.0px / 0.0px | `clear` |
| GE07 | 2007 | 1006 G06 | 1007 G07 | right / 3 | left / 1 | straight | 0.0px / 0.0px | `clear` |
| GE08 | 2008 | 1008 G08 | 1006 G06 | top / 0 | bottom / 2 | orthogonal | 0.0px / 0.0px | `clear` |
| GE09 | 2009 | 1007 G07 | 1009 G09 | bottom / 2 | top / 0 | cross-lane orthogonal | 0.0px / 0.0px | `indeterminate` |

## 3. 连接点索引

已证实的 preset：

```text
flowChartTerminator
flowChartProcess
flowChartDecision
flowChartDocument
```

统一侧别索引（仅对上述 preset 使用）：

```text
top=0 / left=1 / bottom=2 / right=3
```

未证实：

```text
flowChartConnector
flowChartInputOutput   (模板观察 idx 4/5)
flowChartMagneticDrum  (模板观察 idx 4)
```

本 fixture 不使用 `input_output` / `database`，因此不伪造它们的 site mapping。GE09 的几何端点在两侧中心（0.0px），但目标 `flowChartConnector` 的 site index 未证实，所以路由状态为 `indeterminate`，不能写成 `clear`。

## 4. 结构结果

```text
xdr:sp                 9
xdr:cxnSp              9
twoCellAnchor          18
custGeom               9
prstGeom               9
stCxn / endCxn         9 / 9
invalid endpoint refs  0
explicit editAs        0（全部默认 twoCell）
media / external       0 / 0
pictures / customXml   0 / 0
Open XML SDK errors    0
```

每条逻辑边恰好一个 `xdr:cxnSp`；每个 connector 恰好一个 `stCxn` 和一个 `endCxn`，且都指向真实 shape ID。

## 5. 几何与 QA 状态

```text
all 9 endpoints vs bound side center = 0.0px
endpoint tolerance = 1px (9525 EMU)
route status: clear 8 / confirmed_collision 0 / indeterminate 1
indeterminate edge: GE09 (flowChartConnector connection site unverified)
```

`golden-fixture-grid.json` 是生成器与校验器共用的唯一 EMU 换算来源；`shared_grid_marker_diffs = []`，不再存在 168px / 170px 的 2px 偏差。

## 6. 未完成

- connector preset A/B/C 对比：Phase 2。
- Mac/Windows Excel 拖拽、保存、重开：`NOT RUN`。
- flowChartConnector connection site 的真实 Excel 行为：`NOT RUN`。
- `edit_as` 定版、`exportReady`：未改变，仍为 `pending` / `false`。
