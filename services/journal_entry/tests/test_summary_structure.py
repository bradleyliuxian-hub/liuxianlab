import unittest

from services.journal_entry.summary_structure import (
    SemanticType,
    extract_derived_fields,
    infer_account_rule,
    infer_summary_structure,
)
from services.journal_entry.summary_structure.semantics import (
    score_person,
    parse_date_candidate,
)
from services.journal_entry.summary_structure.tokenizer import normalize_parts


def rule_for(code, name, summaries, known=None):
    return infer_account_rule(
        account_code=code,
        account_name=name,
        summaries=summaries,
        known_counterparties=set(known or []),
    )


class SummaryStructureInferenceTests(unittest.TestCase):
    def test_employee_person_inference(self):
        rule = rule_for("224103", "员工垫付", ["费用报销_陈威涛", "费用报销_丁家蕙"])
        self.assertEqual(rule.status, "auto")
        self.assertEqual([field.semantic_type for field in rule.fields],
                         [SemanticType.ITEM, SemanticType.PERSON])
        self.assertEqual([field.label for field in rule.fields], ["费用项目", "员工姓名"])
        values = extract_derived_fields("费用报销_陈威涛", rule)
        self.assertEqual(values["summary:auto:224103:part:0"], "费用报销")
        self.assertEqual(values["summary:auto:224103:part:1"], "陈威涛")

    def test_bank_optional_date(self):
        rule = rule_for("100201", "银行存款", [
            "银行手续费_2025.01.07",
            "银行手续费_-",
            "银行手续费",
        ])
        self.assertEqual(rule.status, "auto")
        self.assertEqual([field.label for field in rule.fields], ["交易事项", "交易日期"])
        self.assertEqual(
            extract_derived_fields("银行手续费_2025.01.07", rule)[
                "summary:auto:100201:part:1"
            ].isoformat(),
            "2025-01-07",
        )
        self.assertIsNone(
            extract_derived_fields("银行手续费_-", rule)[
                "summary:auto:100201:part:1"
            ]
        )
        self.assertIsNone(
            extract_derived_fields("银行手续费", rule)[
                "summary:auto:100201:part:1"
            ]
        )

    def test_department_inference(self):
        rule = rule_for("660201", "市内交通费", [
            "市内交通费_效果研发二部（上海）",
            "差旅费_上海办",
        ])
        self.assertEqual(rule.status, "auto")
        self.assertEqual(rule.fields[1].semantic_type, SemanticType.DEPARTMENT)
        self.assertEqual(rule.fields[1].label, "部门/机构")

    def test_organization_counterparty(self):
        known = ["上海某某科技有限公司", "北京某某传媒有限公司"]
        rule = rule_for("112201", "应收账款", [
            "广告款_001_上海某某科技有限公司_2025.01.10_-",
            "广告款_002_上海某某科技有限公司_-",
            "广告款_003_北京某某传媒有限公司",
        ], known)
        self.assertEqual(rule.status, "auto")
        org = next(field for field in rule.fields if field.part_index == 2)
        self.assertEqual(org.semantic_type, SemanticType.COUNTERPARTY)
        self.assertGreaterEqual(org.confidence, 0.95)
        self.assertEqual(rule.fields[3].semantic_type, SemanticType.DATE)

    def test_commercial_structure_family_normalization(self):
        rule = rule_for("999999", "通用业务", [
            "服务_A_客户甲",
            "服务_A_客户甲_-",
            "服务_A_客户甲_2025.01.10_-",
        ], ["客户甲"])
        self.assertEqual(rule.status, "auto")
        self.assertEqual(len(rule.fields), 4)
        self.assertEqual(rule.fields[0].semantic_type, SemanticType.ITEM)
        self.assertEqual(rule.fields[1].semantic_type, SemanticType.REFERENCE)
        self.assertEqual(rule.fields[2].semantic_type, SemanticType.COUNTERPARTY)
        self.assertEqual(rule.fields[3].semantic_type, SemanticType.DATE)

    def test_generic_account_codes_are_not_hardcoded(self):
        one = rule_for("ABC001", "新科目", ["事项甲_2025.01.01", "事项乙_2025.01.02"])
        two = rule_for("XYZ999", "另一科目", ["事项甲_2025.01.01", "事项乙_2025.01.02"])
        self.assertEqual(one.status, "auto")
        self.assertEqual(two.status, "auto")
        self.assertEqual(one.fields[1].semantic_type, SemanticType.DATE)
        self.assertEqual(two.fields[1].semantic_type, SemanticType.DATE)

    def test_hyphen_is_not_a_structural_delimiter(self):
        rule = rule_for("888888", "工位费", ["2024.1.1-2024.12.31工位费"])
        self.assertEqual(rule.status, "none")
        self.assertEqual(rule.fields, [])

    def test_person_false_positives(self):
        for text in ("个税", "本部", "广告", "费用"):
            self.assertLess(score_person(text, "其他"), 0.5)

    def test_placeholders_and_date_formats(self):
        self.assertEqual(normalize_parts(["A", "B", "-", "--", ""]), ["A", "B"])
        self.assertIsNotNone(parse_date_candidate("2025.01.07"))
        self.assertIsNotNone(parse_date_candidate("2025-01-07"))
        self.assertIsNotNone(parse_date_candidate("2025/01/07"))

    def test_result_contract_counts_rules(self):
        vouchers = [
            {"lines": [
                {"account_code": "224103", "account_name": "员工垫付", "description": "费用报销_陈威涛"},
                {"account_code": "224103", "account_name": "员工垫付", "description": "费用报销_丁家蕙"},
                {"account_code": "100201", "account_name": "银行存款", "description": "银行手续费_2025.01.07"},
                {"account_code": "100201", "account_name": "银行存款", "description": "银行手续费_-"},
                {"account_code": "888888", "account_name": "其他", "description": "普通摘要"},
            ]}
        ]
        payload = infer_summary_structure(vouchers)
        self.assertEqual(payload["version"], 1)
        self.assertEqual(payload["account_count"], 3)
        self.assertEqual(payload["auto_rule_count"], 2)
        self.assertEqual(payload["review_rule_count"], 0)
        self.assertEqual(payload["none_rule_count"], 1)
        self.assertEqual(payload["covered_line_count"], 4)
        self.assertEqual(len(payload["rules"]), 3)
