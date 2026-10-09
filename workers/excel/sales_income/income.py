import pandas as pd

from rules import (
    rule_document_reference_offset,
    rule_text_keyword,
    rule_trading_partner_offset
)


def analyze_income(
    input_file,
    output_file
):
    """
    收入分析入口

    input_file:
        上传的收入明细Excel

    output_file:
        输出结果Excel
    """


    # 读取Excel

    df = pd.read_excel(
        input_file
    )


    print(
        "读取收入数据:",
        len(df),
        "行"
    )


    offset_index = set()


    # =========================
    # Rule 1
    # Document Number + Text
    # =========================

    rule1 = rule_document_reference_offset(
        df,
        document_col="Document Number",
        reference_col="Text",
        amount_col="Amount in local currency"
    )

    offset_index.update(rule1)



    # =========================
    # Rule 2
    # 文本关键词
    # =========================

    rule2 = rule_text_keyword(
        df,
        text_col="Text",
        keywords=[
            "royalty",
            "accrual fee"
        ]
    )

    offset_index.update(rule2)



    # =========================
    # Rule 3
    # Trading Partner抵消
    # =========================

    rule3 = rule_trading_partner_offset(
        df,
        partner_col="Trading partner",
        amount_col="Amount in local currency"
    )

    offset_index.update(rule3)



    # 标记

    df["offset"] = False


    df.loc[
        list(offset_index),
        "offset"
    ] = True



    # 保留未抵消

    result = df[
        df["offset"] == False
    result = result.drop(
    columns=["offset"]
    )
    ]



 

    print(
        "收入分析完成:",
        output_file
    )


    return result