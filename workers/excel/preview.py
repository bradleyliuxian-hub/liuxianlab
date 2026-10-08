import json
from pathlib import Path
from typing import Any

from .audit import json_safe


def build_preview(workbook, output_path: Path, max_rows: int = 50, max_cols: int = 20):
    sheets = []
    for ws in workbook.worksheets:
        rows = []
        row_limit = min(ws.max_row or 0, max_rows)
        col_limit = min(ws.max_column or 0, max_cols)
        for row_idx in range(1, row_limit + 1):
            row_values = []
            for col_idx in range(1, col_limit + 1):
                row_values.append(json_safe(ws.cell(row_idx, col_idx).value))
            rows.append(row_values)
        sheets.append({
            "name": ws.title,
            "maxRow": ws.max_row,
            "maxColumn": ws.max_column,
            "previewRows": row_limit,
            "previewColumns": col_limit,
            "rows": rows,
        })
    payload = {
        "limits": {"rowsPerSheet": max_rows, "columnsPerSheet": max_cols},
        "sheets": sheets,
    }
    output_path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    return payload
