import os
import unittest
from unittest import mock

from services.contract_review import parse_profile


class ParseProfileTests(unittest.TestCase):

    def test_valid_modes(self):
        self.assertTrue(parse_profile.is_valid_mode("auto"))
        self.assertTrue(parse_profile.is_valid_mode("FAST"))
        self.assertTrue(parse_profile.is_valid_mode("accurate"))
        self.assertTrue(parse_profile.is_valid_mode(None))
        self.assertFalse(parse_profile.is_valid_mode("turbo"))

    def test_normalize_defaults_to_auto(self):
        self.assertEqual(
            parse_profile.normalize_mode(None),
            parse_profile.MODE_AUTO,
        )
        self.assertEqual(
            parse_profile.normalize_mode(""),
            parse_profile.MODE_AUTO,
        )
        self.assertEqual(
            parse_profile.normalize_mode("turbo"),
            parse_profile.MODE_AUTO,
        )
        self.assertEqual(
            parse_profile.normalize_mode("FAST"),
            parse_profile.MODE_FAST,
        )

    def test_tier_mapping(self):
        self.assertEqual(
            parse_profile.tier_for_mode("fast"),
            parse_profile.TIER_BASIC,
        )
        self.assertEqual(
            parse_profile.tier_for_mode("accurate"),
            parse_profile.TIER_STANDARD,
        )
        self.assertIsNone(
            parse_profile.tier_for_mode("auto")
        )

    def test_initial_tier(self):
        self.assertEqual(
            parse_profile.initial_tier_for_mode("auto"),
            parse_profile.TIER_BASIC,
        )
        self.assertEqual(
            parse_profile.initial_tier_for_mode("fast"),
            parse_profile.TIER_BASIC,
        )
        self.assertEqual(
            parse_profile.initial_tier_for_mode("accurate"),
            parse_profile.TIER_STANDARD,
        )

    def test_basic_and_standard_signatures_differ(self):
        self.assertNotEqual(
            parse_profile.parser_signature("basic"),
            parse_profile.parser_signature("standard"),
        )

    def test_signature_is_stable(self):
        self.assertEqual(
            parse_profile.parser_signature("basic"),
            parse_profile.parser_signature("basic"),
        )

    def test_profile_version_change_invalidates(self):
        original_signature = parse_profile.parser_signature("basic")
        original_version = (
            parse_profile.CONTRACT_PARSE_PROFILE_VERSION
        )

        parse_profile.CONTRACT_PARSE_PROFILE_VERSION = "v9.9.9"

        try:
            changed = parse_profile.parser_signature("basic")
        finally:
            parse_profile.CONTRACT_PARSE_PROFILE_VERSION = (
                original_version
            )

        self.assertNotEqual(original_signature, changed)

    def test_backend_change_invalidates(self):
        original = parse_profile.parser_signature("basic")

        os.environ["MINERU_MODEL_SMALL_BACKEND"] = "torch"

        try:
            changed = parse_profile.parser_signature("basic")
        finally:
            os.environ["MINERU_MODEL_SMALL_BACKEND"] = "onnx"

        self.assertNotEqual(original, changed)

    def test_unknown_tier_raises(self):
        with self.assertRaises(ValueError):
            parse_profile.parser_signature("gold")

    # -- backend selection --

    def test_default_backend_is_local(self):
        original = os.environ.pop(
            "CONTRACT_MINERU_BACKEND",
            None,
        )

        try:
            self.assertEqual(
                parse_profile.parse_backend(),
                parse_profile.BACKEND_LOCAL,
            )
        finally:
            if original is not None:
                os.environ[
                    "CONTRACT_MINERU_BACKEND"
                ] = original

    def test_empty_backend_raises(self):
        with mock.patch.dict(
            os.environ,
            {"CONTRACT_MINERU_BACKEND": ""},
            clear=False,
        ):
            with self.assertRaises(ValueError):
                parse_profile.parse_backend()

    def test_cloud_backend_selected(self):
        with mock.patch.dict(
            os.environ,
            {"CONTRACT_MINERU_BACKEND": "cloud"},
            clear=False,
        ):
            self.assertEqual(
                parse_profile.parse_backend(),
                parse_profile.BACKEND_CLOUD,
            )

    def test_per_task_backend_overrides_env_default(self):
        with mock.patch.dict(
            os.environ,
            {"CONTRACT_MINERU_BACKEND": "local"},
            clear=False,
        ):
            self.assertEqual(
                parse_profile.parse_backend("cloud"),
                parse_profile.BACKEND_CLOUD,
            )

        with mock.patch.dict(
            os.environ,
            {"CONTRACT_MINERU_BACKEND": "cloud"},
            clear=False,
        ):
            self.assertEqual(
                parse_profile.parse_backend("local"),
                parse_profile.BACKEND_LOCAL,
            )

    def test_invalid_per_task_backend_raises(self):
        with self.assertRaises(ValueError):
            parse_profile.parse_backend("turbo")

    def test_explicit_backend_changes_signature(self):
        local = parse_profile.parser_signature(
            "basic",
            backend="local",
        )
        cloud = parse_profile.parser_signature(
            "basic",
            backend="cloud",
        )

        self.assertNotEqual(local, cloud)

    def test_model_for_explicit_cloud_backend(self):
        with mock.patch.dict(
            os.environ,
            {
                "MINERU_API_MODEL_BASIC": "pipeline",
                "MINERU_API_MODEL_STANDARD": "vlm",
            },
            clear=False,
        ):
            self.assertEqual(
                parse_profile.model_for_tier(
                    "basic",
                    backend="cloud",
                ),
                "pipeline",
            )
            self.assertEqual(
                parse_profile.model_for_tier(
                    "standard",
                    backend="cloud",
                ),
                "vlm",
            )

    def test_unknown_backend_raises(self):
        with mock.patch.dict(
            os.environ,
            {"CONTRACT_MINERU_BACKEND": "turbo"},
            clear=False,
        ):
            with self.assertRaises(ValueError):
                parse_profile.parse_backend()

    def test_cloud_model_mapping_defaults(self):
        with mock.patch.dict(
            os.environ,
            {"CONTRACT_MINERU_BACKEND": "cloud"},
            clear=False,
        ):
            os.environ.pop("MINERU_API_MODEL_BASIC", None)
            os.environ.pop("MINERU_API_MODEL_STANDARD", None)

            self.assertEqual(
                parse_profile.cloud_model_for_tier("basic"),
                "pipeline",
            )
            self.assertEqual(
                parse_profile.cloud_model_for_tier("standard"),
                "vlm",
            )

    def test_cloud_model_mapping_is_configurable(self):
        with mock.patch.dict(
            os.environ,
            {
                "CONTRACT_MINERU_BACKEND": "cloud",
                "MINERU_API_MODEL_BASIC": "vlm",
                "MINERU_API_MODEL_STANDARD": "pipeline",
            },
            clear=False,
        ):
            self.assertEqual(
                parse_profile.cloud_model_for_tier("basic"),
                "vlm",
            )
            self.assertEqual(
                parse_profile.cloud_model_for_tier("standard"),
                "pipeline",
            )

    def test_unknown_cloud_model_raises(self):
        with mock.patch.dict(
            os.environ,
            {
                "CONTRACT_MINERU_BACKEND": "cloud",
                "MINERU_API_MODEL_BASIC": "turbo",
            },
            clear=False,
        ):
            with self.assertRaises(ValueError):
                parse_profile.cloud_model_for_tier("basic")

    def test_cloud_signature_differs_from_local(self):
        local = parse_profile.parser_signature("basic")

        with mock.patch.dict(
            os.environ,
            {"CONTRACT_MINERU_BACKEND": "cloud"},
            clear=False,
        ):
            cloud = parse_profile.parser_signature("basic")

        self.assertNotEqual(local, cloud)

    def test_cloud_signature_isolated_by_model(self):
        with mock.patch.dict(
            os.environ,
            {
                "CONTRACT_MINERU_BACKEND": "cloud",
                "MINERU_API_MODEL_BASIC": "pipeline",
            },
            clear=False,
        ):
            first = parse_profile.parser_signature("basic")

        with mock.patch.dict(
            os.environ,
            {
                "CONTRACT_MINERU_BACKEND": "cloud",
                "MINERU_API_MODEL_BASIC": "vlm",
            },
            clear=False,
        ):
            second = parse_profile.parser_signature("basic")

        self.assertNotEqual(first, second)


if __name__ == "__main__":
    unittest.main()
