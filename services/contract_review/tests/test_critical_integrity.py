import json
import tempfile
import unittest
from pathlib import Path

from services.contract_review import critical_integrity as ci
from services.contract_review.issue_locator import locate_issues
from services.contract_review.review_artifacts import (
    prepare_review_artifacts,
)


def write_md(text):
    handle = tempfile.NamedTemporaryFile(
        "w",
        suffix=".md",
        delete=False,
        encoding="utf-8",
    )
    handle.write(text)
    handle.close()
    return handle.name


def evaluate(text, original_name=""):
    return ci.evaluate_critical_integrity(
        markdown_path=write_md(text),
        original_name=original_name,
    )


class ContractNumberStateTests(unittest.TestCase):

    def test_valid(self):
        obs, findings = ci.observe_contract_number(
            "合同编号：RSH260812MTZ\n正文",
            "",
        )
        self.assertEqual(obs["status"], ci.STATE_VALID)
        self.assertEqual(findings, [])

    def test_malformed(self):
        obs, findings = ci.observe_contract_number(
            "合同编号:RSH>60812MT2\n正文",
            "",
        )
        self.assertEqual(obs["status"], ci.STATE_MALFORMED)
        self.assertEqual(
            findings[0]["code"],
            ci.REASON_CONTRACT_MALFORMED,
        )
        self.assertTrue(findings[0]["requiresStandard"])

    def test_absent(self):
        obs, findings = ci.observe_contract_number(
            "没有任何标签的正文",
            "",
        )
        self.assertEqual(obs["status"], ci.STATE_ABSENT)
        self.assertEqual(findings, [])

    def test_conflict_with_filename(self):
        obs, findings = ci.observe_contract_number(
            "合同编号:RSH260812MT2",
            "RSH260812MTZ-设备租赁协议.pdf",
        )
        self.assertEqual(obs["status"], ci.STATE_CONFLICT)
        self.assertEqual(
            findings[0]["code"],
            ci.REASON_CONTRACT_CONFLICT,
        )
        self.assertTrue(findings[0]["requiresStandard"])

    def test_valid_matching_filename_is_not_conflict(self):
        obs, findings = ci.observe_contract_number(
            "合同编号:RSH260812MTZ",
            "RSH260812MTZ-设备租赁协议.pdf",
        )
        self.assertEqual(obs["status"], ci.STATE_VALID)
        self.assertEqual(findings, [])


class LabeledDateStateTests(unittest.TestCase):

    def test_valid(self):
        obs, findings = ci.observe_labeled_date(
            "合同签订日期：2026年9月14日",
            "",
        )
        self.assertEqual(obs["status"], ci.STATE_VALID)
        self.assertEqual(obs["normalizedValue"], "2026-09-14")
        self.assertEqual(findings, [])

    def test_malformed(self):
        obs, findings = ci.observe_labeled_date(
            "合同签订日期:20>6年9月14日",
            "",
        )
        self.assertEqual(obs["status"], ci.STATE_MALFORMED)
        self.assertEqual(
            findings[0]["code"],
            ci.REASON_DATE_MALFORMED,
        )
        self.assertTrue(findings[0]["requiresStandard"])

    def test_absent(self):
        obs, findings = ci.observe_labeled_date(
            "没有日期标签的正文",
            "",
        )
        self.assertEqual(obs["status"], ci.STATE_ABSENT)

    def test_conflict_with_filename(self):
        obs, findings = ci.observe_labeled_date(
            "合同签订日期：2026年9月11日",
            "RSH260812MTZ-设备租赁协议-20260914.pdf",
        )
        self.assertEqual(obs["status"], ci.STATE_CONFLICT)
        self.assertEqual(
            findings[0]["code"],
            ci.REASON_DATE_CONFLICT,
        )


class AmountPairTests(unittest.TestCase):

    def test_match_passes(self):
        result = evaluate(
            "支付租赁费¥48万元/年（大写：肆拾捌万元整）。"
        )
        codes = [f["code"] for f in result["findings"]]
        self.assertNotIn(ci.REASON_AMOUNT_MISMATCH, codes)
        self.assertNotIn(ci.REASON_AMOUNT_MALFORMED, codes)

    def test_mismatch(self):
        result = evaluate(
            "支付租赁费¥8万元/年（大写：肆拾捌万元整）。"
        )
        codes = [f["code"] for f in result["findings"]]
        self.assertIn(ci.REASON_AMOUNT_MISMATCH, codes)
        self.assertTrue(result["requiresStandard"])

    def test_sixteen_wan_mismatch(self):
        result = evaluate(
            "共计¥96万元（大写：拾陆万元整）。"
        )
        codes = [f["code"] for f in result["findings"]]
        self.assertIn(ci.REASON_AMOUNT_MISMATCH, codes)

    def test_ninety_six_match(self):
        result = evaluate(
            "共计¥96万元（大写：玖拾陆万元整）。"
        )
        codes = [f["code"] for f in result["findings"]]
        self.assertNotIn(ci.REASON_AMOUNT_MISMATCH, codes)

    def test_malformed_unit(self):
        result = evaluate(
            "第2年租赁费￥48万元/年 (写:肆拾捌方元整"
        )
        codes = [f["code"] for f in result["findings"]]
        self.assertIn(ci.REASON_AMOUNT_MALFORMED, codes)

    def test_multiple_pairs_no_cross_binding(self):
        result = evaluate(
            "租赁费¥24万元/年/台（大写:贰拾肆万元整），"
            "单台共计¥48万元（大写:肆拾捌万元整），"
            "总额¥96万元（大写: 拾陆万元整）。"
        )
        mismatches = [
            f
            for f in result["findings"]
            if f["code"] == ci.REASON_AMOUNT_MISMATCH
        ]
        # Only the third pair is wrong (960000 vs 160000).
        self.assertEqual(len(mismatches), 1)
        self.assertEqual(mismatches[0]["parsedValue"], "960000")

    def test_paren_uppercase_table_form_not_flagged(self):
        # "人民币（大写）960,000元整（¥:玖拾陆万元整）" is
        # ambiguous and must never be treated as a 大写 pair.
        result = evaluate(
            "人民币（大写）960,000元整（¥:玖拾陆万元整）"
        )
        codes = [f["code"] for f in result["findings"]]
        self.assertNotIn(ci.REASON_AMOUNT_MISMATCH, codes)
        self.assertNotIn(ci.REASON_AMOUNT_MALFORMED, codes)

    def test_jiao_fen_pair_pass(self):
        result = evaluate(
            "总额¥123.45（大写：壹佰贰拾叁元肆角伍分）。"
        )
        codes = [f["code"] for f in result["findings"]]
        self.assertNotIn(ci.REASON_AMOUNT_MISMATCH, codes)
        self.assertNotIn(ci.REASON_AMOUNT_MALFORMED, codes)

    def test_jiao_fen_pair_mismatch(self):
        result = evaluate(
            "总额¥123.46（大写：壹佰贰拾叁元肆角伍分）。"
        )
        codes = [f["code"] for f in result["findings"]]
        self.assertIn(ci.REASON_AMOUNT_MISMATCH, codes)
        self.assertTrue(result["requiresStandard"])

    def test_amount_text_malformed_does_not_require_standard(self):
        result = evaluate(
            "第2年租赁费￥48万元/年 (写:肆拾捌方元整"
        )
        malformed = [
            f
            for f in result["findings"]
            if f["code"] == ci.REASON_AMOUNT_MALFORMED
        ]
        self.assertTrue(malformed)
        self.assertFalse(malformed[0]["requiresStandard"])
        self.assertTrue(malformed[0]["requiresReview"])
        self.assertFalse(result["requiresStandard"])


class SuspiciousPatternTests(unittest.TestCase):

    def test_mixed_script_detected_when_enabled(self):
        findings = ci.detect_suspicious_patterns(
            "安装调试费E软件系统维护费用",
            [],
        )
        self.assertTrue(findings)
        self.assertEqual(
            findings[0]["code"],
            ci.REASON_SUSPICIOUS,
        )
        self.assertFalse(findings[0]["requiresStandard"])
        self.assertTrue(findings[0]["requiresReview"])

    def test_legit_token_not_detected(self):
        findings = ci.detect_suspicious_patterns(
            "购买T恤衫若干",
            [],
        )
        self.assertEqual(findings, [])

    def test_disabled_by_default_in_evaluate(self):
        # Real contracts produced false positives, so the generic
        # mixed-script hint is off by default.
        self.assertFalse(
            ci.ENABLE_SUSPICIOUS_OCR_PATTERN
        )
        result = evaluate("安装调试费E软件系统维护费用")
        codes = [f["code"] for f in result["findings"]]
        self.assertNotIn(ci.REASON_SUSPICIOUS, codes)


class CrossTierTests(unittest.TestCase):

    def _basic_standard(self, basic_text, standard_text, name=""):
        basic = evaluate(basic_text, name)
        standard = evaluate(standard_text, name)
        return ci.compare_critical_observations(
            basic,
            standard,
        )

    def test_contract_number_disagreement(self):
        findings = self._basic_standard(
            "合同编号:RSH260812MT1",
            "合同编号:RSH260812MT2",
        )
        self.assertTrue(findings)
        self.assertEqual(
            findings[0]["code"],
            ci.REASON_CROSS_TIER,
        )
        self.assertFalse(findings[0]["requiresStandard"])
        self.assertTrue(findings[0]["requiresReview"])

    def test_amount_disagreement(self):
        findings = self._basic_standard(
            "支付租赁费¥8万元/年（大写：捌万元整）。",
            "支付租赁费¥48万元/年（大写：肆拾捌万元整）。",
        )
        self.assertTrue(
            any(
                f["field"] == "amount"
                for f in findings
            )
        )

    def test_normal_prose_difference_no_cross_issue(self):
        findings = self._basic_standard(
            "双方同意本协议",
            "双方同意本協議",
        )
        self.assertEqual(findings, [])


class ReviewIssueConversionTests(unittest.TestCase):

    def test_issue_preserved_without_bbox(self):
        findings = [
            ci._finding(
                code=ci.REASON_CONTRACT_CONFLICT,
                field="contract_number",
                title="合同编号需要核对",
                message="不一致",
                severity="error",
                requires_standard=True,
                requires_review=True,
                page=1,
                anchor_text="合同编号",
                parsed_value="RSH260812MT2",
                reference_value="RSH260812MTZ",
            )
        ]
        issues = ci.findings_to_review_issues(findings)
        self.assertEqual(len(issues), 1)
        self.assertIsNone(issues[0]["bbox"])
        self.assertEqual(issues[0]["page"], 1)
        self.assertEqual(
            issues[0]["type"],
            "critical_integrity",
        )
        self.assertEqual(issues[0]["suggestedText"], "")


class LocatorAndArtifactTests(unittest.TestCase):

    def _middle(self):
        handle = tempfile.NamedTemporaryFile(
            "w",
            suffix=".json",
            delete=False,
            encoding="utf-8",
        )
        json.dump(
            {
                "pages": [
                    {
                        "page_idx": 0,
                        "blocks": [
                            {
                                "type": "text",
                                "content": [
                                    {
                                        "type": "text",
                                        "content": "完全无关的正文",
                                    }
                                ],
                            }
                        ],
                    }
                ]
            },
            handle,
        )
        handle.close()
        return handle.name

    def test_locator_preserves_page_without_bbox(self):
        issue = {
            "id": "x",
            "type": "critical_integrity",
            "severity": "error",
            "title": "合同编号需要核对",
            "message": "m",
            "sourceText": "找不到的片段",
            "suggestedText": "",
            "page": 3,
            "pageIdx": None,
            "bbox": None,
            "bboxMode": None,
            "locationConfidence": 0.0,
            "status": "open",
        }
        located = locate_issues([issue], self._middle())[0]
        self.assertEqual(located["page"], 3)
        self.assertIsNone(located["bbox"])

    def test_prepare_review_without_critical(self):
        directory = tempfile.mkdtemp()
        raw = Path(directory) / "document.raw.md"
        raw.write_text("本合同正文。" * 200, encoding="utf-8")

        prepare_review_artifacts(
            str(raw),
            original_name="contract.pdf",
        )

        document = json.loads(
            (
                Path(directory) / "issues.json"
            ).read_text(encoding="utf-8")
        )
        self.assertIn("issues", document)

    def test_prepare_review_keeps_critical_without_bbox(self):
        directory = tempfile.mkdtemp()
        raw = Path(directory) / "document.raw.md"
        raw.write_text("本合同正文。" * 200, encoding="utf-8")

        critical = [
            {
                "id": "c1",
                "type": "critical_integrity",
                "severity": "error",
                "title": "合同编号需要核对",
                "message": "不一致",
                "sourceText": "RSH260812MT2",
                "suggestedText": "",
                "page": 1,
                "pageIdx": None,
                "bbox": None,
                "bboxMode": None,
                "locationConfidence": 0.0,
                "status": "open",
                "reasonCode": "contract_number_filename_conflict",
            }
        ]

        prepare_review_artifacts(
            str(raw),
            original_name="contract.pdf",
            critical_issues=critical,
        )

        document = json.loads(
            (
                Path(directory) / "issues.json"
            ).read_text(encoding="utf-8")
        )
        reason_codes = {
            issue.get("reasonCode")
            for issue in document["issues"]
        }
        self.assertIn(
            "contract_number_filename_conflict",
            reason_codes,
        )


class CrossTierDedupTests(unittest.TestCase):

    NAME = "RSH260812MTZ-设备租赁协议.pdf"

    def test_final_finding_merges_cross_tier_evidence(self):
        # Unit-level check of the de-dup helper: a final finding and a
        # cross-tier finding on the same field must produce ONE card
        # with supplemental evidence.
        final = {
            "findings": [
                {
                    "code": ci.REASON_CONTRACT_CONFLICT,
                    "field": "contract_number",
                    "title": "合同编号需要核对",
                    "message": "不一致",
                    "severity": "error",
                    "requiresStandard": True,
                    "requiresReview": True,
                    "page": 1,
                    "anchorText": "合同编号",
                    "parsedValue": "RSH260812MT2",
                    "referenceValue": "RSH260812MTZ",
                    "locateText": "RSH260812MT2",
                }
            ],
            "observations": {},
        }
        cross = [
            {
                "code": ci.REASON_CROSS_TIER,
                "field": "contract_number",
                "title": "t",
                "message": "m",
                "severity": "error",
                "requiresStandard": False,
                "requiresReview": True,
                "page": None,
                "anchorText": "合同编号",
                "parsedValue": "RSH260812MT1",
                "referenceValue": "RSH260812MT2",
                "locateText": "RSH260812MT1",
            }
        ]

        issues = ci.build_critical_review_issues(final, cross)

        contract_issues = [
            issue
            for issue in issues
            if issue["category"] == "contract_number"
        ]

        self.assertEqual(len(contract_issues), 1)
        self.assertTrue(
            contract_issues[0]["crossTierDisagreement"]
        )
        self.assertIn(
            "cross_tier_critical_disagreement",
            contract_issues[0]["evidenceCodes"],
        )

    def test_standalone_cross_tier_when_final_amount_passes(self):
        final = evaluate(
            "支付¥48万元/年（大写:肆拾捌万元整）"
        )
        basic = evaluate(
            "支付¥8万元/年（大写:捌万元整）"
        )

        cross = ci.compare_critical_observations(
            basic,
            final,
        )

        issues = ci.build_critical_review_issues(
            final,
            cross,
        )

        standalone = [
            issue
            for issue in issues
            if issue["category"] == "amount"
            and issue["reasonCode"]
            == ci.REASON_CROSS_TIER
        ]

        self.assertEqual(len(standalone), 1)
        self.assertTrue(
            standalone[0]["crossTierDisagreement"]
        )

    def test_different_fields_not_wrongly_deduped(self):
        final = evaluate(
            "合同编号:RSH260812MT2\n"
            "支付¥48万元/年（大写:肆拾捌万元整）",
            self.NAME,
        )
        basic = evaluate(
            "合同编号:RSH>60812MT2\n"
            "支付¥8万元/年（大写:捌万元整）",
            self.NAME,
        )

        cross = ci.compare_critical_observations(
            basic,
            final,
        )

        issues = ci.build_critical_review_issues(
            final,
            cross,
        )

        contract_issues = [
            issue
            for issue in issues
            if issue["category"] == "contract_number"
        ]
        amount_issues = [
            issue
            for issue in issues
            if issue["category"] == "amount"
        ]

        self.assertEqual(len(contract_issues), 1)
        self.assertEqual(len(amount_issues), 1)
        self.assertEqual(
            amount_issues[0]["reasonCode"],
            ci.REASON_CROSS_TIER,
        )


class BlankStateTests(unittest.TestCase):

    def test_blank_contract_number(self):
        obs, findings = ci.observe_contract_number(
            "合同编号:\n\n甲方:ABC公司",
            "",
        )
        self.assertEqual(obs["status"], ci.STATE_BLANK)
        self.assertIsNone(obs["rawValue"])
        self.assertEqual(findings, [])

    def test_blank_contract_does_not_swallow_next_line(self):
        result = evaluate(
            "合同编号:\n\n甲方:ABC公司",
            "",
        )
        self.assertFalse(result["requiresStandard"])
        self.assertEqual(result["findings"], [])

    def test_blank_contract_same_line_next_label(self):
        obs, findings = ci.observe_contract_number(
            "合同编号: 甲方:ABC公司",
            "",
        )
        self.assertEqual(obs["status"], ci.STATE_BLANK)
        self.assertIsNone(obs["rawValue"])
        self.assertEqual(findings, [])

    def test_blank_labeled_date(self):
        obs, findings = ci.observe_labeled_date(
            "合同签订日期:\n甲方:ABC公司",
            "",
        )
        self.assertEqual(obs["status"], ci.STATE_BLANK)
        self.assertEqual(findings, [])


class MalformedNumericPairTests(unittest.TestCase):

    def test_numeric_malformed_triggers_review_and_standard(self):
        result = evaluate(
            "中期款二:¥626.400.00元"
            "（大写:人民币陆拾贰万陆仟肆佰元整）"
        )
        codes = [f["code"] for f in result["findings"]]
        self.assertIn(
            ci.REASON_AMOUNT_NUMERIC_MALFORMED,
            codes,
        )
        self.assertTrue(result["requiresStandard"])

    def test_valid_amounts_do_not_trip(self):
        result = evaluate(
            "中期款二:¥626,400.00元"
            "（大写:人民币陆拾贰万陆仟肆佰元整）"
        )
        codes = [f["code"] for f in result["findings"]]
        self.assertNotIn(
            ci.REASON_AMOUNT_NUMERIC_MALFORMED,
            codes,
        )


class CrossTierValidityTests(unittest.TestCase):

    def _cross(self, basic_text, standard_text):
        return ci.compare_critical_observations(
            evaluate(basic_text),
            evaluate(standard_text),
        )

    def test_malformed_basic_valid_standard_no_cross(self):
        findings = self._cross(
            "合同编号:RSH>60812MT2",
            "合同编号:RSH260812MT2",
        )
        self.assertEqual(findings, [])

    def test_valid_basic_different_valid_standard_cross(self):
        findings = self._cross(
            "合同编号:RSH260812MT1",
            "合同编号:RSH260812MT2",
        )
        self.assertTrue(findings)

    def test_valid_basic_same_valid_standard_no_issue(self):
        findings = self._cross(
            "合同编号:RSH260812MT2",
            "合同编号:RSH260812MT2",
        )
        self.assertEqual(findings, [])

    def test_amount_occurrence_not_mispaired(self):
        basic = evaluate(
            "首期款:¥100万元（大写:壹佰万元整）\n"
            "尾款:¥50万元（大写:伍拾万元整）"
        )
        standard = evaluate(
            "首期款:¥200万元（大写:贰佰万元整）\n"
            "尾款:¥50万元（大写:伍拾万元整）"
        )
        findings = ci.compare_critical_observations(
            basic,
            standard,
        )
        amount_findings = [
            f for f in findings if f["field"] == "amount"
        ]
        self.assertEqual(len(amount_findings), 1)
        self.assertEqual(
            amount_findings[0]["parsedValue"],
            "1000000",
        )

    def test_malformed_basic_amount_valid_standard_no_cross(self):
        basic = evaluate(
            "尾款:¥540.000.00元"
            "（大写:人民币伍拾肆万元整）"
        )
        standard = evaluate(
            "尾款:¥540,000.00元"
            "（大写:人民币伍拾肆万元整）"
        )
        findings = ci.compare_critical_observations(
            basic,
            standard,
        )
        self.assertEqual(findings, [])


class GenericAnchorLocateTests(unittest.TestCase):

    def test_generic_anchor_yields_no_bbox(self):
        middle = tempfile.NamedTemporaryFile(
            "w",
            suffix=".json",
            delete=False,
            encoding="utf-8",
        )
        json.dump(
            {
                "pages": [
                    {
                        "page_idx": 1,
                        "blocks": [
                            {
                                "type": "text",
                                "bbox": [0.1, 0.1, 0.9, 0.2],
                                "content": [
                                    {
                                        "type": "text",
                                        "content": "大写:¥720,000.00元",
                                    }
                                ],
                            }
                        ],
                    }
                ]
            },
            middle,
        )
        middle.close()

        issue = {
            "id": "x",
            "type": "critical_integrity",
            "category": "amount",
            "severity": "error",
            "title": "金额需要核对",
            "message": "m",
            "sourceText": "",
            "suggestedText": "",
            "page": 2,
            "pageIdx": None,
            "bbox": None,
            "bboxMode": None,
            "locationConfidence": 0.0,
            "status": "open",
            "reasonCode": ci.REASON_CROSS_TIER,
        }

        located = locate_issues([issue], middle.name)[0]

        self.assertIsNone(located["bbox"])
        self.assertEqual(located["page"], 2)


if __name__ == "__main__":
    unittest.main()
