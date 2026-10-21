# Connector Routing Report — V2 vs V3

## 约束

- 58 条逻辑边 → 58 个原生 `xdr:cxnSp`；
- 58/58 有 `a:stCxn` + `a:endCxn`；
- 不使用图片/多段线条替代；
- 路径检查是中心线近似，不能还原 Excel 自动重路由。

## V2 → V3

```text
V2: 23 / 58 review
V3: 39 / 58 review
V2 review edges still review in V3: 15
V2 review edges becoming clear: 8
New V3 review edges: 24
```

V2 23 条逐条：

| Edge | V2 crosses | V3 status |
|---|---|---|
| E004 | N004 | clear |
| E005 | N003,N004 | clear |
| E006 | N003,N007 | clear |
| E007 | N003,N008 | review |
| E010 | N008,N009,N012,N013 | clear |
| E012 | N013 | review |
| E016 | N013,N014,N017,N018 | clear |
| E017 | N014 | clear |
| E023 | N021,N025 | review |
| E024 | N025 | review |
| E029 | N026 | review |
| E031 | N026,N027,N030 | review |
| E038 | N034,N039 | review |
| E040 | N038,N039,N042,N043 | review |
| E042 | N039,N044 | review |
| E045 | N043,N044,N047,N048 | clear |
| E047 | N047 | review |
| E049 | N049 | review |
| E050 | N043,N047 | review |
| E051 | N052,N053,N054 | clear |
| E054 | N042,N048 | review |
| E056 | N053 | review |
| E058 | N053,N058 | review |

完整 V3 逐边数据：

```text
~/Downloads/flowchart-excel-visual-fix-v3-2026-10-20/connector-routing-report.json
```

## 分类

当前报告只区分：

- `clear`：中心线近似未命中；
- `review`：中心线近似命中。

尚未达到要求的三分类：

- `confirmed_collision`：真实路径确认穿越；
- `clear`：真实路径可证明无穿越；
- `indeterminate`：无法还原 Excel 实际路径。

因此这些 `review` 必须视为 **indeterminate/待 Excel 视觉复查**，不能改写为 clear。

## 结论

V3 的 graph-rank 布局没有减少整体 review 数，反而从 23 增至 39。不能声称连接器避障修复完成。正式导出仍关闭。
