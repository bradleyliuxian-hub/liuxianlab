# Windows Target-Style Acceptance

状态：**NOT RUN**

包：

```text
~/Downloads/flowchart-excel-anchor-validation-2026-10-20/windows-target-style-acceptance-2026-10-20.zip
```

包含：

- A: `flowchart-revision5-anchor-default-twoCell.xlsx`
- B: `flowchart-revision5-anchor-oneCell.xlsx`
- Mac 保存后参考副本
- 结构 JSON / SHA-256 / 逐步清单

Windows 版本、步骤结果、保存后 XML 均未执行；不得填写伪造结果。

## 必须记录

```text
Windows Excel 版本：
文件 SHA-256：
打开修复提示：PASS / FAIL
58 条连接器初始绑定：PASS / FAIL
移动 N001/N002/N004/N063 后绑定：PASS / FAIL
保存/关闭/重开：PASS / FAIL
行高/列宽调整：PASS / FAIL
A3 打印预览：PASS / FAIL
泳道/图例/分支标签/控制标记：PASS / FAIL
中文长文本/节点重叠/连线避障：PASS / FAIL
最终结果：PASS / FAIL
```

## 当前状态

```text
A: Windows NOT RUN
B: Windows NOT RUN
```

只有 Windows 实测和视觉 QA 都通过，才可把 `edit_as` 定版、`exportReady` 改为 true。
