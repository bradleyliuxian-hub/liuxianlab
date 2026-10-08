from datetime import date, datetime


def apply(workbook, audit, config):
    if not config.get("enabled", True):
        return
    target_format = config.get("format", "yyyy-mm-dd")
    include_datetime = bool(config.get("include_datetime", True))
    for ws in workbook.worksheets:
        for row in ws.iter_rows():
            for cell in row:
                value = cell.value
                is_date = isinstance(value, date) and not isinstance(value, datetime)
                is_datetime = isinstance(value, datetime)
                if not is_date and not (include_datetime and is_datetime):
                    continue
                before = cell.number_format
                after = target_format
                if before != after:
                    cell.number_format = after
                    audit.add(
                        rule="normalize_dates",
                        sheet=ws.title,
                        target=cell.coordinate,
                        change_type="format",
                        before={"numberFormat": before},
                        after={"numberFormat": after},
                        reason="统一日期显示格式",
                    )
