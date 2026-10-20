"""Deterministic .xlsx fixture builders for Journal Entry tests.

The binary fixtures under ``fixtures/`` are generated from these definitions.
Tests that need a one-off malformed workbook should build it in a temporary
directory instead of adding another binary fixture.
"""

from __future__ import annotations

from datetime import date
from pathlib import Path
from typing import Sequence

from openpyxl import Workbook

BASIC_HEADERS = [
    "日期",
    "期间",
    "凭证号",
    "科目编码",
    "科目名称",
    "明细科目",
    "借方金额",
    "贷方金额",
    "摘要",
    "制单人",
    "币种",
]

FIXTURE_NAMES = (
    "journal_anomaly_basic.xlsx",
    "journal_anomaly_business_groups.xlsx",
    "journal_anomaly_rare_pair.xlsx",
    "journal_anomaly_materiality.xlsx",
    "journal_basic.xlsx",
    "journal_headers_offset.xlsx",
    "journal_unbalanced.xlsx",
    "journal_contra_simple.xlsx",
    "journal_contra_complex.xlsx",
    "journal_negative.xlsx",
    "journal_duplicate_voucher.xlsx",
)


def write_workbook(
    path: Path,
    rows: Sequence[Sequence[object]],
    *,
    sheet_name: str = "序时账",
) -> Path:
    workbook = Workbook()
    worksheet = workbook.active
    worksheet.title = sheet_name
    for row in rows:
        worksheet.append(list(row))
    workbook.save(path)
    workbook.close()
    return path


def basic_rows():
    return [
        BASIC_HEADERS,
        [date(2026, 1, 5), "2026-01", "记-001", "1001", "库存现金", "", 1000, 0, "收到投资款", "张三", "CNY"],
        [date(2026, 1, 5), "2026-01", "记-001", "4001", "实收资本", "", 0, 1000, "收到投资款", "张三", "CNY"],
        [date(2026, 1, 6), "2026-01", "记-002", "1002", "银行存款", "", 500, 0, "采购付款", "李四", "CNY"],
        [date(2026, 1, 6), "2026-01", "记-002", "2202", "应付账款", "供应商A", 0, 500, "采购付款", "李四", "CNY"],
        [date(2026, 2, 1), "2026-02", "记-001", "1001", "库存现金", "", 200, 0, "二月现金", "张三", "CNY"],
        [date(2026, 2, 1), "2026-02", "记-001", "6001", "主营业务收入", "", 0, 200, "二月现金", "张三", "CNY"],
    ]


def header_offset_rows():
    return [
        ["XX公司 2026 年序时账"],
        ["会计期间：2026-01"],
        [],
        ["日期", "凭证号", "科目名称", "借方金额", "贷方金额", "摘要"],
        [date(2026, 1, 10), "记-101", "库存现金", 300, 0, "提现"],
        [date(2026, 1, 10), "记-101", "银行存款", 0, 300, "提现"],
    ]


def unbalanced_rows():
    return [
        BASIC_HEADERS,
        [date(2026, 1, 1), "2026-01", "记-201", "1001", "库存现金", "", 100, 99.99, "一分钱尾差", "", "CNY"],
        [date(2026, 1, 2), "2026-01", "记-202", "1001", "库存现金", "", 100, 90, "明显不平", "", "CNY"],
    ]


def contra_simple_rows():
    return [
        BASIC_HEADERS,
        [date(2026, 1, 1), "2026-01", "记-301", "1001", "库存现金", "", 100, 0, "1v1", "", "CNY"],
        [date(2026, 1, 1), "2026-01", "记-301", "6001", "主营业务收入", "", 0, 100, "1v1", "", "CNY"],
        [date(2026, 1, 2), "2026-01", "记-302", "1001", "库存现金", "", 300, 0, "1v3", "", "CNY"],
        [date(2026, 1, 2), "2026-01", "记-302", "6001", "主营业务收入", "A", 0, 100, "1v3", "", "CNY"],
        [date(2026, 1, 2), "2026-01", "记-302", "6001", "主营业务收入", "B", 0, 100, "1v3", "", "CNY"],
        [date(2026, 1, 2), "2026-01", "记-302", "6001", "主营业务收入", "C", 0, 100, "1v3", "", "CNY"],
        [date(2026, 1, 3), "2026-01", "记-303", "1001", "库存现金", "A", 100, 0, "3v1", "", "CNY"],
        [date(2026, 1, 3), "2026-01", "记-303", "1001", "库存现金", "B", 100, 0, "3v1", "", "CNY"],
        [date(2026, 1, 3), "2026-01", "记-303", "1001", "库存现金", "C", 100, 0, "3v1", "", "CNY"],
        [date(2026, 1, 3), "2026-01", "记-303", "6001", "主营业务收入", "", 0, 300, "3v1", "", "CNY"],
    ]


def contra_complex_rows():
    return [
        BASIC_HEADERS,
        [date(2026, 1, 1), "2026-01", "记-401", "1001", "A", "", 100, 0, "2v2", "", "CNY"],
        [date(2026, 1, 1), "2026-01", "记-401", "1001", "B", "", 200, 0, "2v2", "", "CNY"],
        [date(2026, 1, 1), "2026-01", "记-401", "6001", "C", "", 0, 150, "2v2", "", "CNY"],
        [date(2026, 1, 1), "2026-01", "记-401", "6001", "D", "", 0, 150, "2v2", "", "CNY"],
        [date(2026, 1, 2), "2026-01", "记-402", "1001", "A", "", 100, 0, "3v4", "", "CNY"],
        [date(2026, 1, 2), "2026-01", "记-402", "1001", "B", "", 200, 0, "3v4", "", "CNY"],
        [date(2026, 1, 2), "2026-01", "记-402", "1001", "C", "", 300, 0, "3v4", "", "CNY"],
        [date(2026, 1, 2), "2026-01", "记-402", "6001", "W", "", 0, 150, "3v4", "", "CNY"],
        [date(2026, 1, 2), "2026-01", "记-402", "6001", "X", "", 0, 150, "3v4", "", "CNY"],
        [date(2026, 1, 2), "2026-01", "记-402", "6001", "Y", "", 0, 200, "3v4", "", "CNY"],
        [date(2026, 1, 2), "2026-01", "记-402", "6001", "Z", "", 0, 100, "3v4", "", "CNY"],
        [date(2026, 1, 3), "2026-01", "记-403", "1001", "A", "", 100, 0, "two-solutions", "", "CNY"],
        [date(2026, 1, 3), "2026-01", "记-403", "1001", "B", "", 100, 0, "two-solutions", "", "CNY"],
        [date(2026, 1, 3), "2026-01", "记-403", "6001", "C", "", 0, 100, "two-solutions", "", "CNY"],
        [date(2026, 1, 3), "2026-01", "记-403", "6001", "D", "", 0, 100, "two-solutions", "", "CNY"],
    ]


def negative_rows():
    return [
        BASIC_HEADERS,
        [date(2026, 1, 1), "2026-01", "记-501", "1001", "红字现金", "", -100, 0, "借方负数", "", "CNY"],
        [date(2026, 1, 1), "2026-01", "记-501", "6001", "红字收入", "", 0, -100, "贷方负数", "", "CNY"],
        [date(2026, 1, 2), "2026-01", "记-502", "1001", "红字现金", "", -100, 0, "只有一侧", "", "CNY"],
        [date(2026, 1, 2), "2026-01", "记-502", "6001", "普通收入", "", 0, 100, "只有一侧", "", "CNY"],
    ]


def duplicate_voucher_rows():
    return [
        BASIC_HEADERS,
        [date(2026, 1, 1), "2026-01", "记-001", "1001", "A", "", 100, 0, "duplicate A1", "", "CNY"],
        [date(2026, 1, 1), "2026-01", "记-001", "1001", "A", "", 100, 0, "duplicate A2", "", "CNY"],
        [date(2026, 1, 1), "2026-01", "记-001", "6001", "B", "", 0, 100, "duplicate B1", "", "CNY"],
        [date(2026, 1, 1), "2026-01", "记-001", "6001", "B", "", 0, 100, "duplicate B2", "", "CNY"],
        [date(2026, 2, 1), "2026-02", "记-001", "1001", "C", "", 50, 0, "february", "", "CNY"],
        [date(2026, 2, 1), "2026-02", "记-001", "6001", "D", "", 0, 50, "february", "", "CNY"],
    ]


def _clean_expense_voucher(index, period, amount, voucher_prefix="AN"):
    return [
        [date(2026, int(period[-2:]) if period else 1, (index % 28) + 1), period, "%s-%03d" % (voucher_prefix, index), "6602", "管理费用", "", amount, 0, "费用付款", "王五", "CNY"],
        [date(2026, int(period[-2:]) if period else 1, (index % 28) + 1), period, "%s-%03d" % (voucher_prefix, index), "1002", "银行存款", "", 0, amount, "费用付款", "王五", "CNY"],
    ]


def anomaly_basic_rows():
    rows = [BASIC_HEADERS]
    for index in range(1, 31):
        rows.extend(_clean_expense_voucher(index, "2026-01", 100 + index * 10))
    rows.append([date(2026, 1, 20), "2026-01", "AN-RARE", "6602", "管理费用", "", 500, 0, "罕见组合", "王五", "CNY"])
    rows.append([date(2026, 1, 20), "2026-01", "AN-RARE", "4001", "实收资本", "", 0, 500, "罕见组合", "王五", "CNY"])
    rows.append([date(2026, 1, 21), "2026-01", "AN-BIG", "6602", "管理费用", "", 5000000, 0, "大额常规", "王五", "CNY"])
    rows.append([date(2026, 1, 21), "2026-01", "AN-BIG", "1002", "银行存款", "", 0, 5000000, "大额常规", "王五", "CNY"])
    rows.append([date(2026, 1, 22), "2026-01", "AN-RAREBIG", "1601", "固定资产", "", 2000000, 0, "罕见大额", "王五", "CNY"])
    rows.append([date(2026, 1, 22), "2026-01", "AN-RAREBIG", "4001", "实收资本", "", 0, 2000000, "罕见大额", "王五", "CNY"])
    return rows


def anomaly_business_groups_rows():
    rows = [BASIC_HEADERS]
    patterns = [
        ("6602", "管理费用", "2211", "应付职工薪酬"),
        ("6602", "管理费用", "1002", "银行存款"),
        ("2221", "应交税费", "1002", "银行存款"),
        ("1601", "固定资产", "1002", "银行存款"),
        ("1122", "应收账款", "6001", "主营业务收入"),
        ("1401", "原材料", "2202", "应付账款"),
        ("1002", "银行存款", "1001", "库存现金"),
        ("1002", "银行存款", "2001", "短期借款"),
        ("1002", "银行存款", "4001", "实收资本"),
        ("1123", "预付账款", "2241", "其他应付款"),
    ]
    index = 1
    for left_code, left_name, right_code, right_name in patterns:
        for repeat in range(2):
            voucher = "BG-%03d" % index
            day = (index % 28) + 1
            amount = 100 + index * 10
            rows.append([date(2026, 2, day), "2026-02", voucher, left_code, left_name, "", amount, 0, "业务组样本", "赵六", "CNY"])
            rows.append([date(2026, 2, day), "2026-02", voucher, right_code, right_name, "", 0, amount, "业务组样本", "赵六", "CNY"])
            index += 1
    return rows


def anomaly_rare_pair_rows():
    rows = [BASIC_HEADERS]
    for index in range(1, 26):
        rows.extend(_clean_expense_voucher(index, "2026-03", 100 + index * 10, "RP"))
    rows.append([date(2026, 3, 20), "2026-03", "RP-RARE", "6602", "管理费用", "", 500, 0, "罕见组合", "王五", "CNY"])
    rows.append([date(2026, 3, 20), "2026-03", "RP-RARE", "4001", "实收资本", "", 0, 500, "罕见组合", "王五", "CNY"])
    return rows


def anomaly_materiality_rows():
    rows = [BASIC_HEADERS]
    for index in range(1, 31):
        rows.extend(_clean_expense_voucher(index, "2026-04", 100 + index * 10, "MT"))
    rows.append([date(2026, 4, 21), "2026-04", "MT-BIG", "6602", "管理费用", "", 5000000, 0, "大额常规", "王五", "CNY"])
    rows.append([date(2026, 4, 21), "2026-04", "MT-BIG", "1002", "银行存款", "", 0, 5000000, "大额常规", "王五", "CNY"])
    return rows



DIRECTION_HEADERS = [
    "唯一列",
    "日期",
    "凭证号数",
    "科目编码",
    "科目名称",
    "摘要",
    "币种",
    "方向",
    "数量",
    "原币",
    "金额",
    "借正代付",
    "摘要",
    "订单",
    "客供",
]


def direction_amount_rows():
    return [
        DIRECTION_HEADERS,
        ["U001", date(2025, 1, 1), "记-0001", "660201", "管理费用", "办公费", "CNY", "借", 1, 100, 100, 100, "#NAME?", "", ""],
        ["U002", date(2025, 1, 1), "记-0001", "100201", "银行存款", "办公费", "CNY", "贷", 1, 100, 100, -100, "", "", ""],
        ["U003", date(2025, 1, 2), "记-0002", "660201", "管理费用", "红字调整", "CNY", "借", 1, 100, 100, 100, "", "", ""],
        ["U004", date(2025, 1, 2), "记-0002", "100201", "银行存款", "红字调整", "CNY", "贷", 1, 100, 100, -100, "", "", ""],
        ["U005", date(2025, 1, 2), "记-0002", "660201", "管理费用", "红字调整", "CNY", "借", 1, -20, -20, -20, "", "", ""],
        ["U006", date(2025, 1, 2), "记-0002", "100201", "银行存款", "红字调整", "CNY", "贷", 1, -20, -20, 20, "", "", ""],
        ["U007", date(2025, 1, 3), "记-0003", "660201", "管理费用", "零金额", "CNY", "借", 0, 0, 0, 0, "", "", ""],
        ["U008", date(2025, 1, 3), "记-0003", "100201", "银行存款", "零金额", "CNY", "贷", 0, 0, 0, 0, "", "", ""],
    ]


FIXTURES = {
    "journal_direction_amount.xlsx": direction_amount_rows,
    "journal_anomaly_basic.xlsx": anomaly_basic_rows,
    "journal_anomaly_business_groups.xlsx": anomaly_business_groups_rows,
    "journal_anomaly_rare_pair.xlsx": anomaly_rare_pair_rows,
    "journal_anomaly_materiality.xlsx": anomaly_materiality_rows,
    "journal_basic.xlsx": basic_rows,
    "journal_headers_offset.xlsx": header_offset_rows,
    "journal_unbalanced.xlsx": unbalanced_rows,
    "journal_contra_simple.xlsx": contra_simple_rows,
    "journal_contra_complex.xlsx": contra_complex_rows,
    "journal_negative.xlsx": negative_rows,
    "journal_duplicate_voucher.xlsx": duplicate_voucher_rows,
}


def build_all(directory: Path) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    for name, factory in FIXTURES.items():
        write_workbook(directory / name, factory())


if __name__ == "__main__":
    build_all(Path(__file__).resolve().parent / "fixtures")
    print("fixtures rebuilt")
