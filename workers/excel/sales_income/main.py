import json
import os
import sys

from sales import analyze_sales
from income import analyze_income
from exporter import export_excel


def load_config(config_file):
    if not os.path.isfile(
        config_file
    ):
        raise FileNotFoundError(
            f"配置文件不存在: {config_file}"
        )

    with open(
        config_file,
        "r",
        encoding="utf-8",
    ) as file:
        config = json.load(
            file
        )

    if not isinstance(
        config,
        dict,
    ):
        raise ValueError(
            "配置文件格式无效"
        )

    return config


def run_analysis(
    analysis_type,
    input_file,
    output_dir,
    config_file,
):
    config = load_config(
        config_file
    )

    config_type = str(
        config.get(
            "analysisType",
            analysis_type,
        )
    ).lower()

    if (
        config_type !=
        analysis_type
    ):
        raise ValueError(
            "analysisType 与配置文件不一致"
        )

    if analysis_type == "sales":

        (
            clean_result,
            offset_detail,
        ) = analyze_sales(
            input_file,
            config,
        )

        filename = (
            "sales_result.xlsx"
        )

    elif analysis_type == "income":

        (
            clean_result,
            offset_detail,
        ) = analyze_income(
            input_file,
            config,
        )

        filename = (
            "income_result.xlsx"
        )

    else:
        raise ValueError(
            f"不支持的分析类型: "
            f"{analysis_type}"
        )

    output_file = export_excel(
        clean_result,
        offset_detail,
        output_dir,
        filename,
    )

    return output_file


def main():
    if len(sys.argv) != 5:

        print(
            "Usage:\n"
            "python main.py "
            "<sales|income> "
            "<input.xlsx> "
            "<output_dir> "
            "<config.json>",
            file=sys.stderr,
        )

        sys.exit(2)

    analysis_type = (
        sys.argv[1]
        .strip()
        .lower()
    )

    input_file = (
        sys.argv[2]
    )

    output_dir = (
        sys.argv[3]
    )

    config_file = (
        sys.argv[4]
    )

    if not os.path.isfile(
        input_file
    ):
        print(
            f"输入文件不存在: "
            f"{input_file}",
            file=sys.stderr,
        )

        sys.exit(2)

    try:

        output_file = run_analysis(
            analysis_type,
            input_file,
            output_dir,
            config_file,
        )

        print(
            "分析完成:"
        )

        print(
            output_file
        )

    except Exception as error:

        print(
            "分析失败:",
            file=sys.stderr,
        )

        print(
            str(error),
            file=sys.stderr,
        )

        sys.exit(1)


if __name__ == "__main__":
    main()
