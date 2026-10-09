import sys
import os

from sales import analyze_sales
from income import analyze_income
from exporter import export_excel



def run_analysis(
    analysis_type,
    input_file,
    output_dir
):
    """
    统一Excel分析入口

    参数：

    analysis_type:
        sales
        income

    input_file:
        用户上传Excel文件路径

    output_dir:
        输出目录

    返回：
        输出文件路径
    """


    # =========================
    # 销售收入分析
    # =========================

    if analysis_type == "sales":

        print("开始销售收入分析...")


        result = analyze_sales(
            input_file,
            None
        )


        filename = "sales_result.xlsx"



    # =========================
    # 收入分析
    # =========================

    elif analysis_type == "income":

        print("开始收入分析...")


        result = analyze_income(
            input_file,
            None
        )


        filename = "income_result.xlsx"



    else:

        raise ValueError(
            f"不支持的分析类型: {analysis_type}"
        )



    # =========================
    # 输出Excel
    # =========================

    output_file = export_excel(
        result,
        output_dir,
        filename
    )


    return output_file




def main():


    if len(sys.argv) < 4:

        print(
            """
================================

Liuxian Lab Excel Analysis

使用方式:

python main.py 类型 输入文件 输出目录


示例:

销售分析:

python main.py sales sales.xlsx output


收入分析:

python main.py income income.xlsx output


================================
"""
        )

        sys.exit(1)



    analysis_type = sys.argv[1]

    input_file = sys.argv[2]

    output_dir = sys.argv[3]



    # 检查输入文件

    if not os.path.exists(input_file):

        print(
            "错误: 文件不存在",
            input_file
        )

        sys.exit(1)



    try:


        result = run_analysis(
            analysis_type,
            input_file,
            output_dir
        )


        print(
            "\n分析完成:"
        )


        print(
            result
        )


    except Exception as e:


        print(
            "分析失败:"
        )

        print(
            str(e)
        )

        sys.exit(1)




if __name__ == "__main__":

    main()