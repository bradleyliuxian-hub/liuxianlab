import unittest

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
        original = parse_profile.parser_signature("basic")

        parse_profile.CONTRACT_PARSE_PROFILE_VERSION = "v9.9.9"

        try:
            changed = parse_profile.parser_signature("basic")
        finally:
            parse_profile.CONTRACT_PARSE_PROFILE_VERSION = "v1.1.0"

        self.assertNotEqual(original, changed)

    def test_backend_change_invalidates(self):
        import os

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


if __name__ == "__main__":
    unittest.main()
