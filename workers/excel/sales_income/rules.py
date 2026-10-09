import pandas as pd


def rule_document_reference_offset(
    df,
    document_col,
    reference_col,
    amount_col
):
    """
    Rule 1:
    相同凭证 + Reference
    正负金额抵消
    """

    result = []

    groups = df.groupby(
        [document_col, reference_col]
    )

    for key, group in groups:

        total = group[amount_col].sum()

        if abs(total) < 0.01:

            for idx in group.index:
                result.append(idx)

    return result



def rule_text_keyword(
    df,
    text_col,
    keywords
):
    """
    Rule 2:
    文本关键词匹配
    """

    result = []

    for idx, value in df[text_col].items():

        if pd.isna(value):
            continue

        text = str(value).lower()

        for keyword in keywords:

            if keyword.lower() in text:
                result.append(idx)
                break

    return result



def rule_trading_partner_offset(
    df,
    partner_col,
    amount_col
):
    """
    Rule 3:
    Trading Partner + 金额正负抵消
    """

    result = []


    df = df.copy()

    df["abs_amount"] = (
        df[amount_col]
        .abs()
    )


    groups = df.groupby(
        [
            partner_col,
            "abs_amount"
        ]
    )


    for key, group in groups:

        amounts = group[amount_col].tolist()


        if (
            any(x > 0 for x in amounts)
            and
            any(x < 0 for x in amounts)
        ):

            for idx in group.index:
                result.append(idx)


    return result