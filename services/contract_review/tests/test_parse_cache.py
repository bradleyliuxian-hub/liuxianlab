import tempfile
import unittest
from pathlib import Path

from services.contract_review import parse_cache
from services.contract_review import parse_profile


SHA_A = "a" * 64
SHA_B = "b" * 64


class ParseCacheTests(unittest.TestCase):

    def setUp(self):
        self._original_root = parse_cache.CACHE_ROOT

        self._tmp = tempfile.TemporaryDirectory()

        parse_cache.CACHE_ROOT = (
            Path(self._tmp.name) / "contracts-cache"
        ).resolve()

        self._artifacts = Path(self._tmp.name) / "artifacts"

        self._artifacts.mkdir(parents=True, exist_ok=True)

        (self._artifacts / "document.raw.md").write_text(
            "合同正文 " * 100,
            encoding="utf-8",
        )

        (self._artifacts / "document.middle.json").write_text(
            '{"pages": []}',
            encoding="utf-8",
        )

    def tearDown(self):
        parse_cache.CACHE_ROOT = self._original_root
        self._tmp.cleanup()

    def _store(self, owner="liuxian", sha=SHA_A, tier="basic"):
        return parse_cache.store(
            owner,
            sha,
            tier,
            files=parse_cache.collect_cacheable_files(
                self._artifacts
            ),
            quality_pass=True,
            metrics={"basicQualityPass": True},
        )

    def test_same_input_same_entry(self):
        first = parse_cache.entry_dir("liuxian", SHA_A, "basic")
        second = parse_cache.entry_dir("liuxian", SHA_A, "basic")
        self.assertEqual(first, second)

    def test_basic_and_standard_are_isolated(self):
        basic = parse_cache.entry_dir("liuxian", SHA_A, "basic")
        standard = parse_cache.entry_dir(
            "liuxian",
            SHA_A,
            "standard",
        )
        self.assertNotEqual(basic, standard)

    def test_owner_isolation(self):
        a = parse_cache.entry_dir("alice", SHA_A, "basic")
        b = parse_cache.entry_dir("bob", SHA_A, "basic")
        self.assertNotEqual(a, b)

    def test_invalid_sha_is_a_miss(self):
        self.assertIsNone(
            parse_cache.lookup("liuxian", "not-a-sha", "basic")
        )

    def test_store_lookup_restore_roundtrip(self):
        self._store()

        manifest = parse_cache.lookup(
            "liuxian",
            SHA_A,
            "basic",
        )

        self.assertIsNotNone(manifest)
        self.assertEqual(manifest["tier"], "basic")

        destination = Path(self._tmp.name) / "restore"

        restored = parse_cache.restore(
            "liuxian",
            SHA_A,
            "basic",
            destination,
        )

        self.assertIsNotNone(restored)
        self.assertTrue(
            (destination / "document.raw.md").is_file()
        )

    def test_corrupt_manifest_is_safe_miss(self):
        self._store()

        manifest_path = (
            parse_cache.entry_dir("liuxian", SHA_A, "basic")
            / "manifest.json"
        )

        manifest_path.write_text(
            "{ broken",
            encoding="utf-8",
        )

        self.assertIsNone(
            parse_cache.lookup("liuxian", SHA_A, "basic")
        )

    def test_missing_artifact_is_safe_miss(self):
        self._store()

        entry = parse_cache.entry_dir(
            "liuxian",
            SHA_A,
            "basic",
        )

        (entry / "document.raw.md").unlink()

        self.assertIsNone(
            parse_cache.lookup("liuxian", SHA_A, "basic")
        )

    def test_profile_version_change_invalidates(self):
        self._store()

        original = parse_profile.CONTRACT_PARSE_PROFILE_VERSION

        parse_profile.CONTRACT_PARSE_PROFILE_VERSION = "v9.9.9"

        try:
            self.assertIsNone(
                parse_cache.lookup("liuxian", SHA_A, "basic")
            )
        finally:
            parse_profile.CONTRACT_PARSE_PROFILE_VERSION = original

    def test_owner_b_cannot_read_owner_a(self):
        self._store(owner="alice")

        self.assertIsNone(
            parse_cache.lookup("bob", SHA_A, "basic")
        )

    def test_no_human_review_files_cached(self):
        (self._artifacts / "document.draft.md").write_text(
            "human edits",
            encoding="utf-8",
        )

        (self._artifacts / "issues.json").write_text(
            "{}",
            encoding="utf-8",
        )

        self._store()

        entry = parse_cache.entry_dir(
            "liuxian",
            SHA_A,
            "basic",
        )

        names = {
            item.name
            for item in entry.iterdir()
        }

        self.assertNotIn("document.draft.md", names)
        self.assertNotIn("issues.json", names)


if __name__ == "__main__":
    unittest.main()
