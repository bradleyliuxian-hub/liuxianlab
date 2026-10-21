# Anchor Decision Record — trade_purchase_cn

状态：**PENDING — not confirmed**

- 日期：2026-10-20
- 目标模板：`Trade purchase.CN.xlsx`
- 模板 SHA-256：`c2d8426ae6f45846ca1036100761604ad9f58c83fc55fdf7b4345118db3b2a80`
- 真实业务图：job `551a6811-52aa-40ba-a790-b472e695b549`，review revision 5，3 lanes / 63 nodes / 58 edges。

## 决策

```text
anchor.type = twoCellAnchor
target template explicit editAs = null
productions edit_as = pending
exportReady = false
```

不把 target 模板的“无显式 editAs”直接等同于已验收的 twoCell 生产语义。

## 已比较方案

### A — 无显式 editAs（目标模板默认语义）

- 优点：最忠实目标模板；OpenXML 与模板结构一致。
- Mac Excel 16.113.1：63/58 图移动、保存、重开、行列调整后 58/58 连接器绑定；PASS。
- 保存后 marker/xfrm 差异：0/121。
- 缺点/未知：Windows NOT RUN；默认 twoCell 可能随行高/列宽改变节点尺寸；视觉 QA FAIL。

### B — editAs="oneCell"

- 优点：节点尺寸更稳定；历史 POC 有 Mac 证据，用户曾报告 Windows 验收。
- Mac Excel 16.113.1：63/58 图 PASS（58/58 绑定）。
- 保存后 marker/xfrm 差异：89/121，几何一致性风险较高。
- 缺点：偏离目标模板默认语义；Windows 本次未实测；视觉 QA FAIL。

## 暂定倾向

在 Windows 结果未知、视觉 QA 未通过前，不正式选型。若后续 A/B 中 A 的 Windows 结果与 Mac 一致，A 应优先，因为：

1. 目标模板全部使用无显式 editAs 的 twoCellAnchor；
2. 保存后 marker/xfrm 一致性显著优于 B；
3. Mac 真实业务图已通过连接器绑定检查。

但这只是倾向，不是 confirmed。

## 解除 pending 的条件

1. Windows Excel 对 A/B 完整图实测；
2. 目标样式视觉 QA 通过（泳道、图例、分支标签、控制标记、文字/避障）；
3. 重新生成 A/B 并完成保存后结构复验；
4. 由明确记录确认最终 editAs；
5. 才能把 `exportReady` 改为 true。

## 禁止事项

- 不得仅凭 POC 三节点结果选择 anchor。
- 不得在视觉 QA FAIL 时输出正式客户 XLSX。
- 不得把 `edit_as` 改成 confirmed 或把 `exportReady` 改成 true。
