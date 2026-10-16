def apply(workbook, audit, config):
    if not config.get("enabled", True):
        return
    for ws in workbook.worksheets:
        for row in ws.iter_rows():
            for cell in row:
                value = cell.value
                if not isinstance(value, str) or value.startswith("="):
                    continue
                trimmed = value.strip()
                if trimmed != value:
                    cell.value = trimmed
                    audit.add(
                        rule="trim_text",
                        sheet=ws.title,
                        target=cell.coordinate,
                        change_type="value",
                        before=value,
                        after=trimmed,
                        reason="清理文本首尾空格",
                    )
