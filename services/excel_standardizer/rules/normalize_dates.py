from datetime import date, datetime


def apply(workbook, audit, config):
    if not config.get("enabled", True):
        return

    include_date = bool(config.get("include_date", True))
    include_datetime = bool(config.get("include_datetime", True))
    date_format = config.get("format", "yyyy-mm-dd")
    datetime_format = config.get("datetime_format", "yyyy-mm-dd hh:mm")
    audit_rule = config.get("audit_rule")

    for ws in workbook.worksheets:
        for row in ws.iter_rows():
            for cell in row:
                value = cell.value
                is_datetime = isinstance(value, datetime)
                is_date = isinstance(value, date) and not is_datetime

                if is_date and include_date:
                    target_format = date_format
                    rule_name = audit_rule or "normalize_dates"
                    reason = "\u7edf\u4e00\u65e5\u671f\u663e\u793a\u683c\u5f0f"
                elif is_datetime and include_datetime:
                    target_format = datetime_format
                    rule_name = audit_rule or "normalize_datetime"
                    reason = "\u7edf\u4e00\u65e5\u671f\u65f6\u95f4\u663e\u793a\u683c\u5f0f"
                else:
                    continue

                before = cell.number_format
                after = target_format
                if before != after:
                    cell.number_format = after
                    audit.add(
                        rule=rule_name,
                        sheet=ws.title,
                        target=cell.coordinate,
                        change_type="format",
                        before={"numberFormat": before},
                        after={"numberFormat": after},
                        reason=reason,
                    )
