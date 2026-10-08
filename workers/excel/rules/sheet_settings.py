from openpyxl.utils import get_column_letter


def apply(workbook, audit, config):
    if not config.get("enabled", True):
        return
    freeze_header = bool(config.get("freeze_header", True))
    auto_filter = bool(config.get("auto_filter", True))

    for ws in workbook.worksheets:
        if ws.max_row < 1 or ws.max_column < 1:
            continue
        has_header = any(cell.value not in (None, "") for cell in ws[1])
        if not has_header:
            continue

        if freeze_header:
            before = ws.freeze_panes.coordinate if getattr(ws.freeze_panes, "coordinate", None) else ws.freeze_panes
            after = "A2"
            if before != after:
                ws.freeze_panes = after
                audit.add(
                    rule="sheet_settings",
                    sheet=ws.title,
                    target="worksheet",
                    change_type="sheet",
                    before={"freezePanes": before},
                    after={"freezePanes": after},
                    reason="冻结第一行表头",
                )

        if auto_filter and ws.max_row >= 2:
            end_col = get_column_letter(ws.max_column)
            after = f"A1:{end_col}{ws.max_row}"
            before = ws.auto_filter.ref
            if before != after:
                ws.auto_filter.ref = after
                audit.add(
                    rule="sheet_settings",
                    sheet=ws.title,
                    target="worksheet",
                    change_type="sheet",
                    before={"autoFilter": before},
                    after={"autoFilter": after},
                    reason="为数据区域启用自动筛选",
                )
