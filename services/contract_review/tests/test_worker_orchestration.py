import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from services.contract_review import parse_cache
from services.contract_review.mineru_api_client import MineruApiError
import services.contract_review.worker as worker


FIXED_SHA = "c" * 64

GOOD_TEXT = "甲方与乙方签订设备租赁合同，约定租赁期限与租金。 " * 200
BAD_TEXT = "[Illegible] " * 60


class FakeDatabase:

    def __init__(self):
        self.progress_values = []
        self.metadata = []
        self.states = []

    def is_contract_deleted(self, contract_id):
        return False

    def update_contract_state(
        self,
        contract_id,
        *,
        status,
        stage,
        progress,
        error_message=None,
    ):
        self.states.append((status, stage, progress))
        return {}

    def update_contract_progress(
        self,
        contract_id,
        *,
        progress,
        progress_message=None,
        stage=None,
        status=None,
    ):
        self.progress_values.append(progress)
        return {}

    def update_parse_metadata(self, contract_id, **fields):
        self.metadata.append(fields)
        return True

    def delete_contract_row(self, contract_id):
        return None


class FakeCredentials:

    def __init__(self):
        self.tokens = {}
        self.deleted = []
        self.pruned = 0

    def get_contract_token(self, contract_id, owner_username=None):
        return self.tokens.get(contract_id)

    def delete_contract_credential(self, contract_id):
        self.deleted.append(contract_id)

    def prune_expired_credentials(self):
        self.pruned += 1


class Harness:

    def __init__(self, root, tier_text):
        self.root = root
        self.tier_text = tier_text
        self.calls = []
        self.backends = []
        self.tokens = []
        self.review_calls = 0
        self.parsed_pages = 4
        self.critical_issues = []

    def parse(
        self,
        contract,
        *,
        tier,
        on_stage=None,
        backend=None,
        token=None,
    ):
        self.calls.append(tier)
        self.backends.append(backend)
        self.tokens.append(token)

        parsed_dir = (
            (self.root / contract["file_path"]).resolve().parent
            / "parsed"
        )
        parsed_dir.mkdir(parents=True, exist_ok=True)

        text = self.tier_text.get(tier, "")

        raw = parsed_dir / "document.raw.md"
        raw.write_text(text, encoding="utf-8")

        pages = [
            {
                "page_idx": index,
                "blocks": [
                    {"type": "text", "content": text[:200]}
                ],
            }
            for index in range(self.parsed_pages)
        ]

        middle = parsed_dir / "document.middle.json"
        middle.write_text(
            json.dumps({"pages": pages}),
            encoding="utf-8",
        )

        if on_stage is not None:
            on_stage("layout")

        return {
            "output_path": str(raw),
            "markdown_path": str(raw),
            "middle_json_path": str(middle),
            "structured_json_path": None,
            "output_size": raw.stat().st_size,
            "tier": tier,
        }

    def prepare_review(
        self,
        raw,
        *,
        original_name,
        middle_json_path,
        critical_issues=None,
    ):
        self.review_calls += 1
        self.critical_issues = list(critical_issues or [])
        return {"draft_path": "d", "issues_path": "i", "issue_count": 0}

    def consistency(self, *, raw_markdown_path, original_name, middle_json_path):
        return {
            "fields_path": "f",
            "consistency_issue_count": 0,
        }


class WorkerOrchestrationTests(unittest.TestCase):

    def setUp(self):
        self._original_root = worker.PROJECT_ROOT
        self._original_db = worker.database
        self._original_parse = worker.parse_contract
        self._original_prepare = worker.prepare_review_artifacts
        self._original_consistency = worker.build_consistency_artifacts
        self._original_sha = worker._sha256_file
        self._original_cache_root = parse_cache.CACHE_ROOT
        self._original_credentials = worker.credential_store

        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)

        worker.PROJECT_ROOT = self.root
        parse_cache.CACHE_ROOT = self.root / "contracts-cache"

        self.fake = FakeDatabase()
        worker.database = self.fake
        worker._sha256_file = lambda path: FIXED_SHA

        self.credentials = FakeCredentials()
        worker.credential_store = self.credentials

    def tearDown(self):
        worker.PROJECT_ROOT = self._original_root
        worker.database = self._original_db
        worker.parse_contract = self._original_parse
        worker.prepare_review_artifacts = self._original_prepare
        worker.build_consistency_artifacts = self._original_consistency
        worker._sha256_file = self._original_sha
        parse_cache.CACHE_ROOT = self._original_cache_root
        worker.credential_store = self._original_credentials
        self.tmp.cleanup()

    def _install(self, tier_text):
        harness = Harness(self.root, tier_text)
        worker.parse_contract = harness.parse
        worker.prepare_review_artifacts = harness.prepare_review
        worker.build_consistency_artifacts = harness.consistency
        return harness

    def _contract(
        self,
        contract_id,
        *,
        owner="liuxian",
        mode="auto",
        original_name="contract.pdf",
        parser_backend="local",
    ):
        job_dir = self.root / "storage" / "contracts" / contract_id
        job_dir.mkdir(parents=True, exist_ok=True)
        (job_dir / "source.pdf").write_bytes(b"%PDF-1.4 test")

        return {
            "id": contract_id,
            "owner_username": owner,
            "original_name": original_name,
            "file_path": f"storage/contracts/{contract_id}/source.pdf",
            "parse_mode_requested": mode,
            "parse_backend_requested": parser_backend,
            "page_count": 4,
            "status": "queued",
            "stage": "queued",
            "progress": 0,
        }

    def _run(self, contract):
        result = worker.process_contract(contract)
        self.assertTrue(result)
        return self.fake.metadata[-1]

    def _prestore_basic(self, owner, text, quality_pass):
        """Pre-populate a Basic cache entry with chosen artifacts
        and a chosen (possibly stale) stored qualityPass."""

        source = Path(self.tmp.name) / "prestore-basic"
        source.mkdir(parents=True, exist_ok=True)

        raw = source / "document.raw.md"
        raw.write_text(text, encoding="utf-8")

        pages = [
            {
                "page_idx": index,
                "blocks": [{"type": "text", "content": text[:200]}],
            }
            for index in range(4)
        ]

        middle = source / "document.middle.json"
        middle.write_text(
            json.dumps({"pages": pages}),
            encoding="utf-8",
        )

        parse_cache.store(
            owner,
            FIXED_SHA,
            "basic",
            files=parse_cache.collect_cacheable_files(source),
            quality_pass=quality_pass,
            metrics={},
        )

    # -- AUTO / FAST / ACCURATE --

    def test_auto_basic_pass(self):
        harness = self._install({"basic": GOOD_TEXT})

        meta = self._run(self._contract("job-auto-pass"))

        self.assertEqual(harness.calls, ["basic"])
        self.assertEqual(meta["parse_tier_actual"], "basic")
        self.assertFalse(meta["parse_fallback_used"])

    def test_auto_basic_fail_falls_back_to_standard(self):
        harness = self._install(
            {"basic": BAD_TEXT, "standard": GOOD_TEXT}
        )

        meta = self._run(self._contract("job-auto-fail"))

        self.assertEqual(harness.calls, ["basic", "standard"])
        self.assertEqual(meta["parse_tier_actual"], "standard")
        self.assertTrue(meta["parse_fallback_used"])
        self.assertTrue(
            meta["parse_fallback_reason"].startswith(
                "basic_quality_gate_failed"
            )
        )

    def test_fast_uses_basic_only(self):
        harness = self._install({"basic": BAD_TEXT})

        meta = self._run(
            self._contract("job-fast", mode="fast")
        )

        self.assertEqual(harness.calls, ["basic"])
        self.assertEqual(meta["parse_tier_actual"], "basic")
        self.assertFalse(meta["parse_fallback_used"])

    def test_accurate_uses_standard_only(self):
        harness = self._install({"standard": GOOD_TEXT})

        meta = self._run(
            self._contract("job-accurate", mode="accurate")
        )

        self.assertEqual(harness.calls, ["standard"])
        self.assertEqual(meta["parse_tier_actual"], "standard")

    # -- Cache --

    def test_auto_accepted_basic_cache_hit(self):
        harness = self._install({"basic": GOOD_TEXT})

        self._run(self._contract("job-cache-1"))

        harness.calls = []

        meta = self._run(self._contract("job-cache-2"))

        self.assertEqual(harness.calls, [])
        self.assertTrue(meta["parse_cache_hit"])
        self.assertEqual(meta["parse_tier_actual"], "basic")

    def test_auto_rejected_basic_cache_goes_standard(self):
        harness = self._install(
            {"basic": BAD_TEXT, "standard": GOOD_TEXT}
        )

        # FAST caches a rejected basic result without falling back.
        self._run(self._contract("job-reject-1", mode="fast"))

        harness.calls = []

        meta = self._run(self._contract("job-reject-2", mode="auto"))

        self.assertEqual(harness.calls, ["standard"])
        self.assertTrue(meta["parse_fallback_used"])
        self.assertTrue(
            meta["parse_fallback_reason"].startswith(
                "basic_quality_gate_failed"
            )
        )

    def test_cached_basic_stale_pass_is_revalidated_to_standard(self):
        # Stored manifest says qualityPass=true, but the CURRENT gate
        # (on the actual cached artifacts) fails -> AUTO must fall back.
        self._prestore_basic(
            "liuxian",
            BAD_TEXT,
            quality_pass=True,
        )

        harness = self._install({"standard": GOOD_TEXT})

        meta = self._run(
            self._contract("job-stale-pass", mode="auto")
        )

        self.assertEqual(harness.calls, ["standard"])
        self.assertTrue(meta["parse_fallback_used"])
        self.assertEqual(meta["parse_tier_actual"], "standard")

    def test_cached_basic_stale_fail_is_revalidated_to_basic(self):
        # Stored manifest says qualityPass=false, but the CURRENT gate
        # on the actual artifacts passes -> AUTO may use Basic.
        self._prestore_basic(
            "liuxian",
            GOOD_TEXT,
            quality_pass=False,
        )

        harness = self._install({"basic": GOOD_TEXT})

        meta = self._run(
            self._contract("job-stale-fail", mode="auto")
        )

        self.assertEqual(harness.calls, [])
        self.assertTrue(meta["parse_cache_hit"])
        self.assertEqual(meta["parse_tier_actual"], "basic")
        self.assertFalse(meta["parse_fallback_used"])

    def test_progress_never_below_ten(self):
        self._install(
            {"basic": BAD_TEXT, "standard": GOOD_TEXT}
        )

        self._run(self._contract("job-floor"))

        self.assertTrue(self.fake.progress_values)
        self.assertGreaterEqual(
            min(self.fake.progress_values),
            10,
        )

    def test_standard_cache_hit(self):
        harness = self._install({"standard": GOOD_TEXT})

        self._run(self._contract("job-std-1", mode="accurate"))

        harness.calls = []

        meta = self._run(
            self._contract("job-std-2", mode="accurate")
        )

        self.assertEqual(harness.calls, [])
        self.assertTrue(meta["parse_cache_hit"])
        self.assertEqual(meta["parse_tier_actual"], "standard")

    def test_standard_real_parse_progress_sequence(self):
        # Accurate => real Standard parse. The sequence must be
        # naturally monotonic (no reliance on clamping) and must
        # include 86 (standard finished) but never 70 (that is the
        # cache-restore marker).
        self._install({"standard": GOOD_TEXT})

        self._run(self._contract("job-std-seq", mode="accurate"))

        values = self.fake.progress_values

        self.assertTrue(values)
        self.assertEqual(values, sorted(values))
        self.assertIn(86, values)
        self.assertNotIn(70, values)

    def test_standard_cache_restore_uses_70_not_86(self):
        harness = self._install({"standard": GOOD_TEXT})

        self._run(self._contract("job-std-c1", mode="accurate"))

        # Fresh accumulator for the warm run only.
        self.fake.progress_values = []

        self._run(self._contract("job-std-c2", mode="accurate"))

        values = self.fake.progress_values

        self.assertEqual(values, sorted(values))
        self.assertIn(70, values)
        self.assertNotIn(86, values)

    # -- Progress --

    def test_progress_is_monotonic(self):
        self._install(
            {"basic": BAD_TEXT, "standard": GOOD_TEXT}
        )

        self._run(self._contract("job-progress"))

        values = self.fake.progress_values

        self.assertTrue(values)

        self.assertEqual(
            values,
            sorted(values),
        )

    def test_cache_hit_regenerates_review_artifacts(self):
        harness = self._install({"basic": GOOD_TEXT})

        self._run(self._contract("job-art-1"))

        before = harness.review_calls

        self._run(self._contract("job-art-2"))

        self.assertGreater(
            harness.review_calls,
            before,
        )


    # -- Source page_count semantics --

    def test_source_page_count_not_overwritten_by_parsed(self):
        # contracts.page_count is permanently the SOURCE PDF page
        # count. MinerU's parsed page count (8) must never replace
        # it, so a later retry / reprocess keeps a reliable gate
        # input.
        harness = self._install({"basic": GOOD_TEXT})
        harness.parsed_pages = 8

        contract = self._contract("job-pc-keep", mode="fast")
        contract["page_count"] = 9

        meta = self._run(contract)

        self.assertEqual(contract["page_count"], 9)
        self.assertNotIn("page_count", meta)
        self.assertEqual(
            meta["parse_metrics"]["parsedPageCount"],
            8,
        )

    def test_null_source_page_count_stays_null(self):
        # Upload could not determine the source page count, so it
        # stays NULL. MinerU's parsed count must not be used as a
        # stand-in, and the gate simply skips the comparison.
        harness = self._install({"basic": GOOD_TEXT})
        harness.parsed_pages = 8

        contract = self._contract("job-pc-null", mode="fast")
        contract["page_count"] = None

        meta = self._run(contract)

        self.assertIsNone(contract["page_count"])
        self.assertNotIn("page_count", meta)
        self.assertEqual(
            meta["parse_metrics"]["parsedPageCount"],
            8,
        )


    # -- Critical Integrity orchestration (v1.1.1) --

    def test_critical_malformed_triggers_standard(self):
        harness = self._install(
            {
                "basic": GOOD_TEXT + "合同编号:RSH>60812MT2\n",
                "standard": GOOD_TEXT + "合同编号:RSH260812MT2\n",
            }
        )

        meta = self._run(self._contract("job-ci-1"))

        self.assertEqual(harness.calls, ["basic", "standard"])
        self.assertTrue(
            meta["parse_fallback_reason"].startswith(
                "basic_critical_integrity_failed"
            )
        )

    def test_critical_amount_mismatch_triggers_standard(self):
        harness = self._install(
            {
                "basic": GOOD_TEXT
                + "支付¥8万元/年（大写:肆拾捌万元整）\n",
                "standard": GOOD_TEXT
                + "支付¥48万元/年（大写:肆拾捌万元整）\n",
            }
        )

        meta = self._run(self._contract("job-ci-2"))

        self.assertEqual(harness.calls, ["basic", "standard"])
        self.assertTrue(
            meta["parse_fallback_reason"].startswith(
                "basic_critical_integrity_failed"
            )
        )

    def test_critical_pass_no_fallback(self):
        harness = self._install(
            {
                "basic": GOOD_TEXT + "合同编号:RSH260812MT2\n",
            }
        )

        meta = self._run(self._contract("job-ci-3"))

        self.assertEqual(harness.calls, ["basic"])
        self.assertFalse(meta["parse_fallback_used"])

    def test_standard_final_not_show_fixed_basic_error(self):
        harness = self._install(
            {
                "basic": GOOD_TEXT + "合同编号:RSH>60812MT2\n",
                "standard": GOOD_TEXT + "合同编号:RSH260812MT2\n",
            }
        )

        meta = self._run(self._contract("job-ci-4"))

        codes = meta["parse_metrics"]["criticalIntegrity"][
            "reasonCodes"
        ]
        self.assertNotIn("contract_number_malformed", codes)

        issue_codes = {
            issue.get("reasonCode")
            for issue in harness.critical_issues
        }
        self.assertNotIn("contract_number_malformed", issue_codes)

    def test_standard_conflict_becomes_review_issue(self):
        harness = self._install(
            {
                "basic": GOOD_TEXT + "合同编号:RSH>60812MT2\n",
                "standard": GOOD_TEXT + "合同编号:RSH260812MT2\n",
            }
        )

        self._run(
            self._contract(
                "job-ci-5",
                original_name="RSH260812MTZ-设备租赁协议.pdf",
            )
        )

        codes = {
            issue.get("reasonCode")
            for issue in harness.critical_issues
        }
        self.assertIn(
            "contract_number_filename_conflict",
            codes,
        )

    def test_fast_no_fallback_but_issue(self):
        harness = self._install(
            {
                "basic": GOOD_TEXT + "合同编号:RSH>60812MT2\n",
            }
        )

        meta = self._run(
            self._contract("job-ci-fast", mode="fast")
        )

        self.assertEqual(harness.calls, ["basic"])
        self.assertFalse(meta["parse_fallback_used"])

        codes = {
            issue.get("reasonCode")
            for issue in harness.critical_issues
        }
        self.assertIn("contract_number_malformed", codes)

    def test_accurate_no_reparse_but_issue(self):
        harness = self._install(
            {
                "standard": GOOD_TEXT
                + "合同编号:RSH260812MT2\n",
            }
        )

        self._run(
            self._contract(
                "job-ci-acc",
                mode="accurate",
                original_name="RSH260812MTZ-设备租赁协议.pdf",
            )
        )

        self.assertEqual(harness.calls, ["standard"])

        codes = {
            issue.get("reasonCode")
            for issue in harness.critical_issues
        }
        self.assertIn(
            "contract_number_filename_conflict",
            codes,
        )

    def test_cache_reevaluated_under_new_rules(self):
        # A Basic cache entry that predates the critical rule must
        # still be re-checked with the CURRENT rules on a cache hit.
        self._prestore_basic(
            "liuxian",
            GOOD_TEXT + "合同编号:RSH>60812MT2\n",
            quality_pass=True,
        )

        harness = self._install(
            {
                "standard": GOOD_TEXT
                + "合同编号:RSH260812MT2\n",
            }
        )

        meta = self._run(self._contract("job-ci-cache"))

        self.assertEqual(harness.calls, ["standard"])
        self.assertTrue(meta["parse_fallback_used"])

    def test_amount_text_malformed_only_no_fallback(self):
        harness = self._install(
            {
                "basic": GOOD_TEXT
                + "第2年租赁费￥48万元/年 (写:肆拾捌方元整\n",
            }
        )

        meta = self._run(self._contract("job-mi-1"))

        self.assertEqual(harness.calls, ["basic"])
        self.assertFalse(meta["parse_fallback_used"])

        codes = {
            issue.get("reasonCode")
            for issue in harness.critical_issues
        }
        self.assertIn("amount_text_malformed", codes)

    def test_amount_malformed_plus_mismatch_falls_back(self):
        harness = self._install(
            {
                "basic": GOOD_TEXT
                + "支付¥8万元/年（大写:肆拾捌万元整）\n"
                "第2年租赁费￥48万元/年 (写:肆拾捌方元整\n",
                "standard": GOOD_TEXT,
            }
        )

        meta = self._run(self._contract("job-mi-2"))

        self.assertEqual(harness.calls, ["basic", "standard"])
        self.assertTrue(meta["parse_fallback_used"])

    # -- Per-contract backend / token (v1.3.0) --

    def test_consecutive_local_and_cloud_tasks_do_not_mix(self):
        harness = self._install({"basic": GOOD_TEXT})

        self._run(
            self._contract(
                "job-backend-local",
                parser_backend="local",
            )
        )

        self.credentials.tokens[
            "job-backend-cloud"
        ] = "fictional-user-token"

        meta = self._run(
            self._contract(
                "job-backend-cloud",
                parser_backend="cloud",
            )
        )

        self.assertEqual(
            harness.backends,
            ["local", "cloud"],
        )
        self.assertEqual(
            harness.tokens,
            [None, "fictional-user-token"],
        )
        self.assertEqual(
            meta["parse_metrics"]["parseBackend"],
            "cloud",
        )
        self.assertEqual(
            meta["parse_metrics"]["parseModelVersion"],
            "pipeline",
        )
        self.assertEqual(
            self.credentials.deleted,
            ["job-backend-local", "job-backend-cloud"],
        )

    def test_cloud_uses_server_token_when_no_task_token(self):
        harness = self._install({"basic": GOOD_TEXT})

        with mock.patch.dict(
            os.environ,
            {"MINERU_API_TOKEN": "server-env-token"},
            clear=False,
        ):
            self._run(
                self._contract(
                    "job-server-token",
                    parser_backend="cloud",
                )
            )

        self.assertEqual(
            harness.tokens,
            ["server-env-token"],
        )

    def test_cloud_without_any_token_fails_before_parse(self):
        harness = self._install({"basic": GOOD_TEXT})

        with mock.patch.dict(
            os.environ,
            {"MINERU_API_TOKEN": ""},
            clear=False,
        ):
            result = worker.process_contract(
                self._contract(
                    "job-no-token",
                    parser_backend="cloud",
                )
            )

        self.assertFalse(result)
        self.assertEqual(harness.calls, [])
        self.assertEqual(
            self.fake.states[-1][0],
            "failed",
        )
        self.assertIn(
            "job-no-token",
            self.credentials.deleted,
        )

    def test_cloud_cache_hit_does_not_require_a_token(self):
        harness = self._install({"basic": GOOD_TEXT})

        self.credentials.tokens[
            "job-cloud-cache-1"
        ] = "fictional-user-token"

        self._run(
            self._contract(
                "job-cloud-cache-1",
                parser_backend="cloud",
            )
        )

        harness.calls = []
        harness.backends = []
        harness.tokens = []

        with mock.patch.dict(
            os.environ,
            {"MINERU_API_TOKEN": ""},
            clear=False,
        ):
            meta = self._run(
                self._contract(
                    "job-cloud-cache-2",
                    parser_backend="cloud",
                )
            )

        self.assertEqual(harness.calls, [])
        self.assertTrue(meta["parse_cache_hit"])
        self.assertEqual(
            meta["parse_tier_actual"],
            "basic",
        )

    def test_fast_cloud_is_basic_only(self):
        harness = self._install({"basic": BAD_TEXT})

        self.credentials.tokens[
            "job-fast-cloud"
        ] = "fictional-user-token"

        meta = self._run(
            self._contract(
                "job-fast-cloud",
                mode="fast",
                parser_backend="cloud",
            )
        )

        self.assertEqual(harness.calls, ["basic"])
        self.assertEqual(harness.backends, ["cloud"])
        self.assertFalse(meta["parse_fallback_used"])

    def test_accurate_cloud_uses_standard_only(self):
        harness = self._install({"standard": GOOD_TEXT})

        self.credentials.tokens[
            "job-accurate-cloud"
        ] = "fictional-user-token"

        meta = self._run(
            self._contract(
                "job-accurate-cloud",
                mode="accurate",
                parser_backend="cloud",
            )
        )

        self.assertEqual(harness.calls, ["standard"])
        self.assertEqual(harness.backends, ["cloud"])
        self.assertEqual(
            meta["parse_tier_actual"],
            "standard",
        )
        self.assertEqual(
            meta["parse_metrics"]["parseModelVersion"],
            "vlm",
        )

    def test_auto_cloud_falls_back_only_on_quality_failure(self):
        harness = self._install(
            {
                "basic": BAD_TEXT,
                "standard": GOOD_TEXT,
            }
        )

        self.credentials.tokens[
            "job-auto-cloud"
        ] = "fictional-user-token"

        meta = self._run(
            self._contract(
                "job-auto-cloud",
                parser_backend="cloud",
            )
        )

        self.assertEqual(
            harness.calls,
            ["basic", "standard"],
        )
        self.assertTrue(meta["parse_fallback_used"])
        self.assertEqual(
            meta["parse_metrics"]["parseBackend"],
            "cloud",
        )


    # -- Cloud API errors are not quality fallback --

    def test_cloud_api_error_does_not_trigger_standard_fallback(self):
        self._install({"standard": GOOD_TEXT})
        calls = []

        def fail(
            contract,
            *,
            tier,
            on_stage=None,
            backend=None,
            token=None,
        ):
            calls.append(tier)
            raise MineruApiError(
                "MinerU 云端解析失败",
                stage="parse",
            )

        worker.parse_contract = fail
        self.credentials.tokens[
            "job-cloud-api-fail"
        ] = "fictional-cloud-token"

        result = worker.process_contract(
            self._contract(
                "job-cloud-api-fail",
                parser_backend="cloud",
            )
        )

        self.assertFalse(result)
        self.assertEqual(calls, ["basic"])
        self.assertEqual(self.fake.states[-1][0], "failed")
        self.assertIn(
            "job-cloud-api-fail",
            self.credentials.deleted,
        )


if __name__ == "__main__":
    unittest.main()
