import pandas as pd

from rules import (
    rule_document_reference_offset,
    rule_text_keyword,
    rule_trading_partner_offset,
)


def _prepare_dataframe(input_file, config):
    sheet_name = config.get("sheetName")
    header_row = int(config.get("headerRow", 1))

    if header_row < 1:
        raise ValueError("headerRow 必须大于等于 1")

    df = pd.read_excel(
        input_file,
        sheet_name=sheet_name,
        header=header_row - 1,
    )

    df.columns = [
        str(column).strip()
        for column in df.columns
    ]

    return df


def _get_mapping(config):
    mapping = config.get("mapping")

    if not isinstance(mapping, dict):
        raise ValueError("缺少字段 mapping 配置")

    required = [
        "document",
        "reference",
        "amount",
        "text",
        "partner",
    ]

    missing = [
        key
        for key in required
        if not str(mapping.get(key, "")).strip()
    ]

    if missing:
        raise ValueError(
            "缺少字段配置: "
            + ", ".join(missing)
        )

    return {
        key: str(mapping[key]).strip()
        for key in required
    }


def _validate_columns(df, mapping):
    missing_columns = [
        column
        for column in mapping.values()
        if column not in df.columns
    ]

    if missing_columns:
        raise ValueError(
            "Excel 中找不到以下已选择字段: "
            + ", ".join(missing_columns)
        )


def _add_rule_marks(
    rule_marks,
    indexes,
    rule_name,
    reason,
):
    """
    记录每一行命中了哪些规则。
    同一行可以同时命中多个规则。
    """

    for index in indexes:
        info = rule_marks.setdefault(
            index,
            {
                "rules": [],
                "reasons": [],
            },
        )

        if rule_name not in info["rules"]:
            info["rules"].append(
                rule_name
            )

        if reason not in info["reasons"]:
            info["reasons"].append(
                reason
            )


def analyze_sales(input_file, config):
    """
    销售分析。

    返回：
        clean_result
        offset_detail
    """

    df = _prepare_dataframe(
        input_file,
        config,
    )

    mapping = _get_mapping(
        config
    )

    _validate_columns(
        df,
        mapping,
    )

    document_col = mapping["document"]
    reference_col = mapping["reference"]
    amount_col = mapping["amount"]
    text_col = mapping["text"]
    partner_col = mapping["partner"]

    header_row = int(
        config.get(
            "headerRow",
            1,
        )
    )

    print("开始销售收入分析...")

    print(
        f"工作表: {config.get('sheetName')}"
    )

    print(
        f"表头行: {header_row}"
    )

    print(
        f"读取销售数据: {len(df)} 行"
    )

    print(
        "字段映射:",
        mapping,
    )

    df[amount_col] = pd.to_numeric(
        df[amount_col],
        errors="coerce",
    )

    # ========================================
    # Rule 1
    # Sales Document + Reference 金额抵消
    # ========================================

    rule1 = rule_document_reference_offset(
        df,
        document_col=document_col,
        reference_col=reference_col,
        amount_col=amount_col,
    )

    # ========================================
    # Rule 2
    # 文本关键词
    # ========================================

    rule2 = rule_text_keyword(
        df,
        text_col=text_col,
        keywords=[
            "royalty",
            "adj",
        ],
    )

    # ========================================
    # Rule 3
    # Trading Partner + 金额抵消
    # ========================================

    rule3 = rule_trading_partner_offset(
        df,
        partner_col=partner_col,
        amount_col=amount_col,
    )

    # ========================================
    # 建立审计记录
    # ========================================

    rule_marks = {}

    _add_rule_marks(
        rule_marks,
        rule1,
        "Rule 1",
        (
            f"{document_col} + "
            f"{reference_col} 金额合计为 0"
        ),
    )

    _add_rule_marks(
        rule_marks,
        rule2,
        "Rule 2",
        (
            f"{text_col} 命中销售分析关键词 "
            "(royalty / adj)"
        ),
    )

    _add_rule_marks(
        rule_marks,
        rule3,
        "Rule 3",
        (
            f"{partner_col} 下存在相同绝对金额"
            "的正负记录"
        ),
    )

    offset_index = set(
        rule_marks.keys()
    )

    # ========================================
    # 最终保留数据
    # ========================================

    clean_result = df.loc[
        ~df.index.isin(
            offset_index
        )
    ].copy()

    clean_result.reset_index(
        drop=True,
        inplace=True,
    )

    # ========================================
    # 抵消 / 排除明细
    # ========================================

    offset_detail = df.loc[
        df.index.isin(
            offset_index
        )
    ].copy()

    if not offset_detail.empty:
        excel_rows = [
            header_row
            + 1
            + int(index)
            for index
            in offset_detail.index
        ]

        offset_detail.insert(
            0,
            "原Excel行号",
            excel_rows,
        )

        offset_detail["抵消规则"] = [
            "; ".join(
                rule_marks[index]["rules"]
            )
            for index
            in offset_detail.index
        ]

        offset_detail["抵消原因"] = [
            "; ".join(
                rule_marks[index]["reasons"]
            )
            for index
            in offset_detail.index
        ]

    else:
        offset_detail.insert(
            0,
            "原Excel行号",
            pd.Series(dtype="int64"),
        )

        offset_detail["抵消规则"] = ""
        offset_detail["抵消原因"] = ""

    offset_detail.reset_index(
        drop=True,
        inplace=True,
    )

    print(
        f"销售分析完成: "
        f"原始 {len(df)} 行, "
        f"抵消/排除 {len(offset_detail)} 行, "
        f"最终保留 {len(clean_result)} 行"
    )

    print(
        f"Rule 1 命中: {len(rule1)} 行"
    )

    print(
        f"Rule 2 命中: {len(rule2)} 行"
    )

    print(
        f"Rule 3 命中: {len(rule3)} 行"
    )

    return (
        clean_result,
        offset_detail,
    )
