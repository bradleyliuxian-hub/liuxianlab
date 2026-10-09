import os
from datetime import datetime

import pandas as pd
from openpyxl.styles import Font
from openpyxl.utils import get_column_letter


def _format_sheet(worksheet):
    """
    对输出 Sheet 做简单的可读性优化。
    """

    worksheet.freeze_panes = "A2"

    if (
        worksheet.max_row >= 1
        and worksheet.max_column >= 1
    ):
        worksheet.auto_filter.ref = (
            worksheet.dimensions
        )

    for cell in worksheet[1]:
        cell.font = Font(
            bold=True
        )

    # 为避免大文件导出过慢，
    # 宽度计算最多检查前 200 行。
    sample_max_row = min(
        worksheet.max_row,
        200,
    )

    for column_index in range(
        1,
        worksheet.max_column + 1,
    ):
        max_length = 0

        for row_index in range(
            1,
            sample_max_row + 1,
        ):
            value = worksheet.cell(
                row=row_index,
                column=column_index,
            ).value

            if value is None:
                continue

            length = len(
                str(value)
            )

            if length > max_length:
                max_length = length

        width = min(
            max(
                max_length + 2,
                10,
            ),
            40,
        )

        worksheet.column_dimensions[
            get_column_letter(
                column_index
            )
        ].width = width


def export_excel(
    clean_df,
    offset_df,
    output_dir,
    filename,
):
    """
    输出一个包含两个 Sheet 的 Excel：

    1. 分析结果
    2. 抵消明细
    """

    os.makedirs(
        output_dir,
        exist_ok=True,
    )

    timestamp = datetime.now().strftime(
        "%Y%m%d_%H%M%S"
    )

    name, extension = os.path.splitext(
        filename
    )

    if not extension:
        extension = ".xlsx"

    final_name = (
        f"{name}_{timestamp}{extension}"
    )

    output_path = os.path.join(
        output_dir,
        final_name,
    )

    with pd.ExcelWriter(
        output_path,
        engine="openpyxl",
    ) as writer:

        clean_df.to_excel(
            writer,
            sheet_name="分析结果",
            index=False,
        )

        offset_df.to_excel(
            writer,
            sheet_name="抵消明细",
            index=False,
        )

        _format_sheet(
            writer.book["分析结果"]
        )

        _format_sheet(
            writer.book["抵消明细"]
        )

    print(
        f"结果文件已生成: {output_path}"
    )

    print(
        f"分析结果: {len(clean_df)} 行"
    )

    print(
        f"抵消明细: {len(offset_df)} 行"
    )

    return output_path
