import http.server
import io
import json
import tempfile
import threading
import unittest
import zipfile
from pathlib import Path
from unittest import mock

from services.contract_review import mineru_api_client as client
from services.contract_review import mineru_service
from services.contract_review.mineru_api_client import (
    MineruApiConfig,
    MineruApiError,
    adapt_middle_json,
    content_list_to_middle,
    safe_extract_zip,
)


CONTRACT_ID = "11111111-1111-1111-1111-111111111111"
CLOUD_NAME = "contract-" + CONTRACT_ID + ".pdf"


def make_config(**overrides):
    values = {
        "base_url": "https://api.example/v4",
        "token": "test-token-value",
        "model_basic": "pipeline",
        "model_standard": "vlm",
        "language": "ch",
        "enable_table": True,
        "enable_formula": True,
        "is_ocr": True,
        "timeout_seconds": 5.0,
        "poll_interval_seconds": 0.0,
        "poll_timeout_seconds": 5.0,
        "max_retries": 1,
        "max_file_bytes": 10 * 1024 * 1024,
        "max_zip_bytes": 10 * 1024 * 1024,
        "max_extract_bytes": 20 * 1024 * 1024,
        "max_extract_files": 100,
    }
    values.update(overrides)
    return MineruApiConfig(**values)


def make_zip(files):
    buffer = io.BytesIO()

    with zipfile.ZipFile(buffer, "w") as archive:
        for name, content in files.items():
            if isinstance(content, str):
                content = content.encode("utf-8")

            archive.writestr(name, content)

    return buffer.getvalue()


def submission(batch_id="batch-1", urls=None):
    return {
        "code": 0,
        "data": {
            "batch_id": batch_id,
            "file_urls": (
                urls
                if urls is not None
                else ["https://upload.example/signed"]
            ),
        },
    }


def batch_result(items):
    return {
        "code": 0,
        "data": {
            "batch_id": "batch-1",
            "extract_result": items,
        },
    }


def done_item(data_id=CONTRACT_ID, url="https://download.example/a.zip"):
    return {
        "data_id": data_id,
        "file_name": CLOUD_NAME,
        "state": "done",
        "full_zip_url": url,
    }


DEFAULT_FILES = {
    "full.md": "# 设备租赁合同\n\n合同编号：RSH260812MT2\n",
    "layout.json": json.dumps(
        {
            "schema": "docvortex.middle",
            "pages": [
                {
                    "page_idx": 0,
                    "blocks": [
                        {
                            "type": "text",
                            "bbox": [10, 10, 200, 30],
                            "content": [
                                {
                                    "type": "text",
                                    "content": "合同编号：RSH260812MT2",
                                }
                            ],
                        }
                    ],
                }
            ],
        },
        ensure_ascii=False,
    ),
    "contract_content_list.json": json.dumps(
        [
            {
                "page_idx": 0,
                "type": "text",
                "bbox": [10, 10, 200, 30],
                "text": "合同编号：RSH260812MT2",
            }
        ],
        ensure_ascii=False,
    ),
}


class FakeTransport:

    def __init__(
        self,
        *,
        submit_payload=None,
        poll_payloads=None,
        zip_files=None,
        upload_failure=None,
    ):
        self.submit_payload = (
            submit_payload
            if submit_payload is not None
            else submission()
        )
        self.poll_payloads = list(poll_payloads or [])
        self.zip_files = (
            zip_files
            if zip_files is not None
            else DEFAULT_FILES
        )
        self.upload_failure = upload_failure

        self.requests = []
        self.uploaded = []
        self.downloaded = []
        self.zipped = None

    def request_json(self, method, path, *, payload=None, retry=True):
        self.requests.append(
            {
                "method": method,
                "path": path,
                "payload": payload,
                "retry": retry,
            }
        )

        if str(method).upper() == "POST":
            return self.submit_payload

        if not self.poll_payloads:
            raise AssertionError("unexpected extra poll")

        return self.poll_payloads.pop(0)

    def upload_file(self, signed_url, source_path, *, retry=True):
        self.uploaded.append(
            {
                "url": signed_url,
                "path": str(source_path),
                "retry": retry,
            }
        )

        if self.upload_failure:
            raise self.upload_failure

    def download_file(
        self,
        signed_url,
        destination,
        *,
        max_bytes,
        retry=True,
    ):
        self.downloaded.append(
            {
                "url": signed_url,
                "max_bytes": max_bytes,
                "retry": retry,
            }
        )

        self.zipped = make_zip(self.zip_files)
        Path(destination).write_bytes(self.zipped)


class CloudParseTests(unittest.TestCase):

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.source = self.root / "source.pdf"
        self.source.write_bytes(b"%PDF-1.4 test")
        self.parsed = self.root / "parsed"

        self.contract = {
            "id": CONTRACT_ID,
            "original_name": "设备租赁合同.pdf",
            "file_path": "storage/contracts/x/source.pdf",
            "page_count": 1,
        }

    def tearDown(self):
        self.tmp.cleanup()

    def _run(self, transport, *, tier="basic", config=None):
        stages = []

        result = client.parse_contract_cloud(
            self.contract,
            tier=tier,
            on_stage=stages.append,
            source_path=self.source,
            parsed_dir=self.parsed,
            config=config or make_config(),
            transport=transport,
            sleep=lambda _: None,
        )

        return result, stages

    def test_success_maps_artifacts(self):
        transport = FakeTransport(
            poll_payloads=[
                batch_result([done_item()]),
            ]
        )

        result, stages = self._run(transport)

        self.assertEqual(result["backend"], "cloud")
        self.assertEqual(result["model_version"], "pipeline")
        self.assertEqual(result["tier"], "basic")

        markdown = Path(result["markdown_path"])
        middle = Path(result["middle_json_path"])
        structured = Path(result["structured_json_path"])

        self.assertTrue(markdown.is_file())
        self.assertIn("设备租赁合同", markdown.read_text("utf-8"))
        self.assertTrue(middle.is_file())
        self.assertTrue(structured.is_file())

        middle_data = json.loads(middle.read_text("utf-8"))
        self.assertEqual(len(middle_data["pages"]), 1)
        self.assertEqual(
            middle_data["pages"][0]["blocks"][0]["content"],
            "合同编号：RSH260812MT2",
        )

        self.assertEqual(
            result["middle_json_source"],
            "layout_json",
        )

        self.assertIn("upload", stages)
        self.assertIn("queued", stages)
        self.assertIn("download", stages)
        self.assertIn("adapt", stages)

        self.assertEqual(len(transport.uploaded), 1)
        self.assertEqual(len(transport.downloaded), 1)
        self.assertEqual(
            transport.downloaded[0]["url"],
            "https://download.example/a.zip",
        )

        submit = transport.requests[0]
        self.assertEqual(submit["method"], "POST")
        self.assertEqual(
            submit["payload"]["model_version"],
            "pipeline",
        )
        self.assertEqual(
            submit["payload"]["files"][0]["data_id"],
            CONTRACT_ID,
        )
        self.assertTrue(
            submit["payload"]["files"][0]["is_ocr"]
        )

    def test_standard_tier_uses_vlm(self):
        transport = FakeTransport(
            poll_payloads=[batch_result([done_item()])]
        )

        result, _ = self._run(transport, tier="standard")

        self.assertEqual(result["model_version"], "vlm")
        self.assertEqual(
            transport.requests[0]["payload"]["model_version"],
            "vlm",
        )

    def test_poll_matches_data_id_not_first_result(self):
        other = done_item(
            data_id="other-contract",
            url="https://download.example/other.zip",
        )

        running = {
            "data_id": CONTRACT_ID,
            "file_name": CLOUD_NAME,
            "state": "running",
        }

        transport = FakeTransport(
            poll_payloads=[
                batch_result([other, running]),
                batch_result([other, done_item()]),
            ]
        )

        result, stages = self._run(transport)

        self.assertEqual(
            transport.downloaded[0]["url"],
            "https://download.example/a.zip",
        )
        self.assertIn("parsing", stages)
        self.assertTrue(
            Path(result["markdown_path"]).is_file()
        )

    def test_ambiguous_multi_result_is_rejected(self):
        transport = FakeTransport(
            poll_payloads=[
                batch_result(
                    [
                        done_item(data_id="a"),
                        done_item(data_id="b"),
                    ]
                )
            ]
        )

        with self.assertRaises(MineruApiError) as context:
            self._run(transport)

        self.assertEqual(context.exception.stage, "poll")
        self.assertIn("多个结果", str(context.exception))
        self.assertEqual(transport.downloaded, [])

    def test_failed_state_raises_parse_error(self):
        transport = FakeTransport(
            poll_payloads=[
                batch_result(
                    [
                        {
                            "data_id": CONTRACT_ID,
                            "file_name": CLOUD_NAME,
                            "state": "failed",
                            "err_msg": "模型服务失败",
                        }
                    ]
                )
            ]
        )

        with self.assertRaises(MineruApiError) as context:
            self._run(transport)

        self.assertEqual(context.exception.stage, "parse")
        self.assertIn("模型服务失败", str(context.exception))

    def test_missing_markdown_is_adapt_error(self):
        files = dict(DEFAULT_FILES)
        files.pop("full.md")

        transport = FakeTransport(
            poll_payloads=[batch_result([done_item()])],
            zip_files=files,
        )

        with self.assertRaises(MineruApiError) as context:
            self._run(transport)

        self.assertEqual(context.exception.stage, "adapt")
        self.assertIn("full.md", str(context.exception))

    def test_layout_falls_back_to_content_list(self):
        files = dict(DEFAULT_FILES)
        files.pop("layout.json")

        transport = FakeTransport(
            poll_payloads=[batch_result([done_item()])],
            zip_files=files,
        )

        result, _ = self._run(transport)

        self.assertEqual(
            result["middle_json_source"],
            "content_list_fallback",
        )

        middle = json.loads(
            Path(result["middle_json_path"]).read_text("utf-8")
        )
        self.assertEqual(
            middle["pages"][0]["blocks"][0]["content"],
            "合同编号：RSH260812MT2",
        )

    def test_layout_without_text_falls_back_to_content_list(self):
        files = dict(DEFAULT_FILES)
        files["layout.json"] = json.dumps(
            {"pages": [{"page_idx": 0, "blocks": []}]}
        )

        transport = FakeTransport(
            poll_payloads=[batch_result([done_item()])],
            zip_files=files,
        )

        result, _ = self._run(transport)

        self.assertEqual(
            result["middle_json_source"],
            "content_list_fallback",
        )

    def test_layout_without_text_and_no_content_list_is_error(self):
        files = {
            "full.md": "合同正文",
            "layout.json": json.dumps(
                {"pages": [{"page_idx": 0, "blocks": []}]}
            ),
        }

        transport = FakeTransport(
            poll_payloads=[batch_result([done_item()])],
            zip_files=files,
        )

        with self.assertRaises(MineruApiError) as context:
            self._run(transport)

        self.assertEqual(context.exception.stage, "adapt")
        self.assertIn("可识别文本", str(context.exception))

    def test_invalid_layout_without_content_list_is_adapt_error(self):
        files = {
            "full.md": "合同正文",
            "layout.json": "{}",
        }

        transport = FakeTransport(
            poll_payloads=[batch_result([done_item()])],
            zip_files=files,
        )

        with self.assertRaises(MineruApiError) as context:
            self._run(transport)

        self.assertEqual(context.exception.stage, "adapt")
        self.assertIn("pages", str(context.exception))

    def test_submit_url_count_mismatch(self):
        transport = FakeTransport(
            submit_payload=submission(
                urls=[
                    "https://upload.example/1",
                    "https://upload.example/2",
                ]
            ),
            poll_payloads=[batch_result([done_item()])],
        )

        with self.assertRaises(MineruApiError) as context:
            self._run(transport)

        self.assertEqual(context.exception.stage, "submit")
        self.assertEqual(transport.uploaded, [])

    def test_missing_token_is_config_error(self):
        transport = FakeTransport(
            poll_payloads=[batch_result([done_item()])]
        )

        with self.assertRaises(MineruApiError) as context:
            self._run(
                transport,
                config=make_config(token=""),
            )

        self.assertEqual(context.exception.stage, "config")
        self.assertIn("MINERU_API_TOKEN", str(context.exception))

    def test_page_limit_is_config_error(self):
        self.contract["page_count"] = 201

        transport = FakeTransport(
            poll_payloads=[batch_result([done_item()])]
        )

        with self.assertRaises(MineruApiError) as context:
            self._run(transport)

        self.assertEqual(context.exception.stage, "config")
        self.assertIn("200", str(context.exception))


class AdapterTests(unittest.TestCase):

    def test_current_middle_shape_is_preserved(self):
        data = {
            "schema": "docvortex.middle",
            "pages": [
                {
                    "page_idx": 0,
                    "blocks": [
                        {
                            "type": "text",
                            "bbox": [0, 0, 10, 10],
                            "content": "hello",
                        }
                    ],
                }
            ],
        }

        result = adapt_middle_json(data)

        self.assertEqual(result["pages"][0]["page_idx"], 0)
        self.assertEqual(
            result["pages"][0]["blocks"][0]["content"],
            "hello",
        )
        self.assertEqual(
            result["pages"][0]["blocks"][0]["bbox"],
            [0.0, 0.0, 10.0, 10.0],
        )

    def test_legacy_pdf_info_lines_are_converted(self):
        data = {
            "pdf_info": [
                {
                    "page_idx": 0,
                    "preproc_blocks": [
                        {
                            "type": "text",
                            "bbox": [1, 2, 3, 4],
                            "lines": [
                                {
                                    "spans": [
                                        {"content": "合同编号"},
                                        {"content": "RSH260812MT2"},
                                    ]
                                }
                            ],
                        }
                    ],
                }
            ]
        }

        result = adapt_middle_json(data)

        self.assertNotIn("pdf_info", result)
        block = result["pages"][0]["blocks"][0]
        self.assertEqual(
            block["content"],
            "合同编号 RSH260812MT2",
        )
        self.assertEqual(block["bbox"], [1.0, 2.0, 3.0, 4.0])

    def test_content_list_flattens_text_but_keeps_child_nodes(self):
        data = {
            "pages": [
                {
                    "page_idx": 0,
                    "blocks": [
                        {
                            "type": "text",
                            "bbox": [0, 0, 1, 1],
                            "content": [
                                {
                                    "type": "text",
                                    "bbox": [0, 0, 0.5, 0.2],
                                    "content": "合同编号",
                                }
                            ],
                        }
                    ],
                }
            ]
        }

        result = adapt_middle_json(data)
        block = result["pages"][0]["blocks"][0]

        self.assertEqual(block["content"], "合同编号")
        self.assertEqual(
            block["contentNodes"][0]["bbox"],
            [0.0, 0.0, 0.5, 0.2],
        )

    def test_missing_pages_raises(self):
        with self.assertRaises(MineruApiError) as context:
            adapt_middle_json({"layout": []})

        self.assertEqual(context.exception.stage, "adapt")

    def test_empty_pages_raises(self):
        with self.assertRaises(MineruApiError):
            adapt_middle_json({"pages": []})

    def test_content_list_nested_groups(self):
        result = content_list_to_middle(
            [
                [
                    {
                        "type": "text",
                        "bbox": [0, 0, 1, 1],
                        "text": "page-0",
                    }
                ],
                [
                    {
                        "type": "text",
                        "bbox": [0, 0, 1, 1],
                        "text": "page-1",
                    }
                ],
            ]
        )

        self.assertEqual(
            [page["page_idx"] for page in result["pages"]],
            [0, 1],
        )
        self.assertEqual(
            result["pages"][1]["blocks"][0]["content"],
            "page-1",
        )

    def test_content_list_without_blocks_raises(self):
        with self.assertRaises(MineruApiError):
            content_list_to_middle([{"page_idx": 0}])


class ZipSafetyTests(unittest.TestCase):

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def _extract(self, files):
        zip_path = self.root / "result.zip"
        zip_path.write_bytes(make_zip(files))

        safe_extract_zip(
            zip_path,
            self.root / "out",
            max_bytes=10 * 1024 * 1024,
            max_files=100,
        )

    def test_traversal_is_rejected(self):
        with self.assertRaises(MineruApiError) as context:
            self._extract({"../evil.txt": "nope"})

        self.assertEqual(context.exception.stage, "extract")
        self.assertFalse((self.root / "evil.txt").exists())

    def test_absolute_path_is_rejected(self):
        with self.assertRaises(MineruApiError):
            self._extract({"/tmp/evil.txt": "nope"})

    def test_symlink_is_rejected(self):
        buffer = io.BytesIO()

        with zipfile.ZipFile(buffer, "w") as archive:
            info = zipfile.ZipInfo("link.txt")
            info.external_attr = 0o120777 << 16
            archive.writestr(info, "../inside")

        zip_path = self.root / "result.zip"
        zip_path.write_bytes(buffer.getvalue())

        with self.assertRaises(MineruApiError) as context:
            safe_extract_zip(
                zip_path,
                self.root / "out",
                max_bytes=10 * 1024 * 1024,
                max_files=100,
            )

        self.assertIn("符号链接", str(context.exception))

    def test_extract_size_limit_is_enforced(self):
        zip_path = self.root / "result.zip"
        zip_path.write_bytes(
            make_zip({"full.md": "x" * 1000})
        )

        with self.assertRaises(MineruApiError) as context:
            safe_extract_zip(
                zip_path,
                self.root / "out",
                max_bytes=10,
                max_files=100,
            )

        self.assertEqual(context.exception.stage, "extract")


class ErrorRedactionTests(unittest.TestCase):

    def test_http_error_redacts_token_and_url(self):
        transport = client.HttpTransport(make_config())

        body = json.dumps(
            {
                "code": "A0202",
                "msg": (
                    "bad Bearer test-token-value "
                    "https://signed.example/secret"
                ),
            }
        ).encode("utf-8")

        with self.assertRaises(MineruApiError) as context:
            transport._http_error(401, body, "submit")

        text = str(context.exception)
        self.assertNotIn("test-token-value", text)
        self.assertNotIn("https://signed.example", text)

    def test_server_error_is_retryable(self):
        transport = client.HttpTransport(make_config())

        with self.assertRaises(MineruApiError) as context:
            transport._http_error(502, b"{}", "poll")

        self.assertTrue(context.exception.retryable)

    def test_token_api_code_is_not_retryable(self):
        transport = client.HttpTransport(make_config())

        body = json.dumps(
            {"code": "A0211", "msg": "expired"}
        ).encode("utf-8")

        with self.assertRaises(MineruApiError) as context:
            transport._http_error(200, body, "submit")

        self.assertFalse(context.exception.retryable)
        self.assertIn("Token", str(context.exception))


class HttpTransportTests(unittest.TestCase):

    def setUp(self):
        test_case = self

        class Handler(http.server.BaseHTTPRequestHandler):

            def do_POST(self):
                length = int(
                    self.headers.get("Content-Length") or 0
                )
                body = self.rfile.read(length)

                test_case.attempts += 1

                test_case.last_request = {
                    "path": self.path,
                    "authorization": self.headers.get(
                        "Authorization"
                    ),
                    "body": json.loads(
                        body.decode("utf-8") or "{}"
                    ),
                }

                if test_case.retry_once and test_case.attempts == 1:
                    payload = json.dumps(
                        {"code": -10001, "msg": "busy"}
                    ).encode("utf-8")
                    self.send_response(200)
                    self.send_header(
                        "Content-Type",
                        "application/json",
                    )
                    self.send_header(
                        "Content-Length",
                        str(len(payload)),
                    )
                    self.end_headers()
                    self.wfile.write(payload)
                    return

                if self.path == "/redirect":
                    self.send_response(302)
                    self.send_header(
                        "Location",
                        "https://evil.example/",
                    )
                    self.end_headers()
                    return

                payload = json.dumps(
                    {"code": 0, "data": {"ok": True}}
                ).encode("utf-8")

                self.send_response(200)
                self.send_header(
                    "Content-Type",
                    "application/json",
                )
                self.send_header(
                    "Content-Length",
                    str(len(payload)),
                )
                self.end_headers()
                self.wfile.write(payload)

            def log_message(self, *args):
                pass

        self.last_request = None
        self.retry_once = False
        self.attempts = 0
        self.server = http.server.ThreadingHTTPServer(
            ("127.0.0.1", 0),
            Handler,
        )
        self.thread = threading.Thread(
            target=self.server.serve_forever,
            daemon=True,
        )
        self.thread.start()

        self.config = make_config(
            base_url=(
                "http://127.0.0.1:"
                + str(self.server.server_address[1])
            )
        )

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)

    def test_json_request_sends_bearer_and_payload(self):
        transport = client.HttpTransport(self.config)

        response = transport.request_json(
            "POST",
            "/file-urls/batch",
            payload={"files": [{"name": "x.pdf"}]},
            retry=False,
        )

        self.assertEqual(response["code"], 0)
        self.assertEqual(
            self.last_request["authorization"],
            "Bearer test-token-value",
        )
        self.assertEqual(
            self.last_request["body"]["files"][0]["name"],
            "x.pdf",
        )

    def test_retryable_api_code_is_retried(self):
        self.retry_once = True

        transport = client.HttpTransport(
            make_config(
                base_url=self.config.base_url,
                max_retries=1,
            ),
            sleep=lambda _: None,
        )

        response = transport.request_json(
            "POST",
            "/file-urls/batch",
            payload={"files": []},
            retry=True,
        )

        self.assertEqual(response["code"], 0)
        self.assertEqual(self.attempts, 2)

    def test_api_redirect_is_not_followed(self):
        transport = client.HttpTransport(self.config)

        with self.assertRaises(MineruApiError) as context:
            transport.request_json(
                "POST",
                "/redirect",
                payload={},
                retry=False,
            )

        self.assertEqual(context.exception.stage, "submit")
        self.assertNotIn(
            "test-token-value",
            str(context.exception),
        )


class BackendDispatchTests(unittest.TestCase):

    def test_cloud_backend_calls_cloud_client(self):
        with mock.patch.object(
            mineru_service,
            "parse_backend",
            return_value="cloud",
        ), mock.patch.object(
            mineru_service,
            "parse_contract_cloud",
            return_value={"backend": "cloud"},
        ) as cloud, mock.patch.object(
            mineru_service,
            "_parse_contract_local",
        ) as local:
            result = mineru_service.parse_contract(
                {"id": "x"},
                tier="basic",
            )

        self.assertEqual(result["backend"], "cloud")
        cloud.assert_called_once()
        local.assert_not_called()

    def test_local_backend_calls_local_parser(self):
        with mock.patch.object(
            mineru_service,
            "parse_backend",
            return_value="local",
        ), mock.patch.object(
            mineru_service,
            "_parse_contract_local",
            return_value={"backend": "local"},
        ) as local, mock.patch.object(
            mineru_service,
            "parse_contract_cloud",
        ) as cloud:
            result = mineru_service.parse_contract(
                {"id": "x"},
                tier="basic",
            )

        self.assertEqual(result["backend"], "local")
        local.assert_called_once()
        cloud.assert_not_called()


if __name__ == "__main__":
    unittest.main()
