def apply(workbook, audit, config):
    if not config.get("enabled", False):
        return
    for ws in workbook.worksheets:
        row_idx = ws.max_row
        while row_idx >= 1:
            values = [ws.cell(row_idx, col_idx).value for col_idx in range(1, (ws.max_column or 0) + 1)]
            if values and all(value in (None, "") for value in values):
                ws.delete_rows(row_idx, 1)
                audit.add(
                    rule="remove_empty_rows",
                    sheet=ws.title,
                    target=f"{row_idx}:{row_idx}",
                    change_type="structure",
                    before="空白行",
                    after="已删除",
                    reason="删除完全空白行",
                )
            row_idx -= 1
