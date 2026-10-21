import json
import urllib.error
import unittest

from services.flowchart_excel import vision_client


class FakeResponse:
    def __init__(self, body, status=200):
        self.body = body
        self.status = status

    def read(self, _n=-1):
        return self.body

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


class FakeOpener:
    def __init__(self, responses=None, error=None):
        self.responses = list(responses or [])
        self.error = error
        self.calls = []

    def __call__(self, request, timeout=None):
        self.calls.append((request, timeout))
        if self.error:
            raise self.error
        return self.responses.pop(0)


def config(api_key="test-placeholder-key", base_url="http://127.0.0.1:9999/v1"):
    return {
        "base_url": base_url,
        "model": "mock-vision",
        "api_key": api_key,
        "provider": "local",
        "timeout_seconds": 5,
        "max_output_tokens": 100,
        "configured": True,
        "missing": [],
    }


class VisionClientTests(unittest.TestCase):
    def test_missing_config_does_not_call_network(self):
        called = []
        def opener(request, timeout=None):
            called.append(request)
            raise AssertionError("must not call")
        with self.assertRaises(vision_client.VisionError) as ctx:
            vision_client.call_vision(
                image_b64="x", width=2, height=2,
                config={"configured": False, "missing": ["FLOWCHART_MODEL"]},
                opener=opener
            )
        self.assertEqual(ctx.exception.code, "CONFIGURATION_REQUIRED")
        self.assertEqual(called, [])

    def test_valid_json_is_strictly_parsed(self):
        raw = {"nodes": [], "edges": [], "document": {}}
        body = json.dumps({"choices": [{"message": {"content": json.dumps(raw)}}]}).encode()
        opener = FakeOpener([FakeResponse(body)])
        value, meta = vision_client.call_vision(
            image_b64="x", width=2, height=2, config=config(), opener=opener
        )
        self.assertEqual(value, raw)
        self.assertEqual(meta["model"], "mock-vision")
        self.assertEqual(meta["prompt_version"], vision_client.PROMPT_VERSION)

    def test_markdown_fence_is_rejected(self):
        body = json.dumps({"choices": [{"message": {"content": "```json\n{}\n```"}}]}).encode()
        with self.assertRaises(vision_client.VisionError) as ctx:
            vision_client.call_vision(
                image_b64="x", width=2, height=2, config=config(), opener=FakeOpener([FakeResponse(body)])
            )
        self.assertEqual(ctx.exception.code, "MODEL_INVALID_JSON")

    def test_http_error_does_not_include_api_key(self):
        error = urllib.error.HTTPError("http://x", 500, "server error", {}, None)
        with self.assertRaises(vision_client.VisionError) as ctx:
            vision_client.call_vision(
                image_b64="x", width=2, height=2, config=config("test-placeholder-key"), opener=FakeOpener(error=error)
            )
        self.assertEqual(ctx.exception.code, "MODEL_HTTP_ERROR")
        self.assertNotIn("test-placeholder-key", str(ctx.exception))

    def test_timeout_is_reported_without_key(self):
        error = urllib.error.URLError("timed out")
        with self.assertRaises(vision_client.VisionError) as ctx:
            vision_client.call_vision(
                image_b64="x", width=2, height=2, config=config("test-placeholder-key"), opener=FakeOpener(error=error)
            )
        self.assertEqual(ctx.exception.code, "MODEL_TIMEOUT")
        self.assertNotIn("test-placeholder-key", str(ctx.exception))

    def test_response_too_large_is_rejected(self):
        body = b"x" * (vision_client.DEFAULT_MAX_RESPONSE_BYTES + 1)
        with self.assertRaises(vision_client.VisionError) as ctx:
            vision_client.call_vision(
                image_b64="x", width=2, height=2, config=config(), opener=FakeOpener([FakeResponse(body)])
            )
        self.assertEqual(ctx.exception.code, "MODEL_RESPONSE_TOO_LARGE")

    def test_empty_content_is_rejected(self):
        body = json.dumps({"choices": [{"message": {"content": ""}}]}).encode()
        with self.assertRaises(vision_client.VisionError) as ctx:
            vision_client.call_vision(
                image_b64="x", width=2, height=2, config=config(), opener=FakeOpener([FakeResponse(body)])
            )
        self.assertEqual(ctx.exception.code, "MODEL_EMPTY_RESPONSE")

    def test_config_env_status_does_not_expose_values(self):
        status = vision_client.config_from_env({})
        self.assertFalse(status["configured"])
        self.assertIn("FLOWCHART_BASE_URL", status["missing"])
        self.assertIn("FLOWCHART_MODEL", status["missing"])
        self.assertNotIn("api_key", status["missing"])


if __name__ == "__main__":
    unittest.main()
