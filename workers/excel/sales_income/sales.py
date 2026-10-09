import pandas as pd

from rules import (
    rule_document_reference_offset,
    rule_text_keyword,
    rule_trading_partner_offset
)


def analyze_sales(
    input_file,
    output_file
):
    """
    销售收入分析入口

    input_file:
        用户上传Excel路径

    output_file:
        分析结果输出路径
    """


    # 1.读取Excel

    df = pd.read_excel(
        input_file
    )


    print(
        "读取销售数据:",
        len(df),
        "行"
    )


    # =========================
    # 2.执行分析规则
    # =========================


    offset_index = set()


    # Rule 1
    rule1 = rule_document_reference_offset(
        df,
        document_col="sales document",
        reference_col="Reference",
        amount_col="Amount in local currency"
    )

    offset_index.update(rule1)



    # Rule 2

    rule2 = rule_text_keyword(
        df,
        text_col="Text",
        keywords=[
            "royalty",
            "adj"
        ]
    )

    offset_index.update(rule2)



    # Rule 3

    rule3 = rule_trading_partner_offset(
        df,
        partner_col="Trading partner",
        amount_col="Amount in local currency"
    )

    offset_index.update(rule3)



    # =========================
    # 3.生成结果
    # =========================


    df["offset"] = False


    df.loc[
        list(offset_index),
        "offset"
    ] = True



    # 保留未抵消数据

    result = df[
        df["offset"] == False
    ]



    # 输出

    return result


