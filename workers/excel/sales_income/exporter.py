import os
import pandas as pd
from datetime import datetime


def export_excel(
    df,
    output_dir,
    filename
):
    """
    输出Excel文件

    df:
        分析结果DataFrame

    output_dir:
        输出目录

    filename:
        文件名
    """


    # 创建目录

    os.makedirs(
        output_dir,
        exist_ok=True
    )


    # 防止文件覆盖

    timestamp = datetime.now().strftime(
        "%Y%m%d_%H%M%S"
    )


    name, ext = os.path.splitext(filename)


    final_name = (
        f"{name}_{timestamp}{ext}"
    )


    output_path = os.path.join(
        output_dir,
        final_name
    )


    # 输出Excel

    df.to_excel(
        output_path,
        index=False
    )


    return output_path