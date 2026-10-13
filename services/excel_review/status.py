"""Progress / status reporting for the Excel Review worker.

The worker is intentionally database-free. It publishes its state to an
atomic ``status.json`` inside the job directory; the Node runner watches
that file and mirrors it into PostgreSQL. This keeps the Excel worker
decoupled from the contract MinerU worker and the pg pool.
"""

import json
import os
from pathlib import Path

STATUS_QUEUED = "queued"
STATUS_PROCESSING = "processing"
STATUS_REVIEW_READY = "review_ready"
STATUS_FAILED = "failed"


class ReviewError(Exception):
    """Expected, user-facing error.

    The message is safe to show to the end user. Anything else is
    reported with a generic message and logged as a traceback.
    """


def _atomic_write(path: Path, payload: dict) -> None:
    tmp = path.with_name(f".{path.name}.tmp")
    with open(tmp, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(tmp, path)


class Reporter:
    """Monotonic status writer.

    Progress never decreases, matching the UX contract of the rest of the
    site.
    """

    def __init__(self, job_dir, *, floor=0):
        self.job_dir = Path(job_dir)
        self.status_path = self.job_dir / "status.json"
        self.progress = max(0, min(100, int(floor)))
        self.status = STATUS_PROCESSING
        self.message = None
        self.error = None
        self.item_count = None
        self.result = {}

    def update(self, progress, message=None, *, status=None):
        value = max(0, min(100, int(progress)))
        if value < self.progress:
            value = self.progress
        self.progress = value
        if message is not None:
            self.message = message
        if status is not None:
            self.status = status
        self._write()

    def finish(self, status, *, message=None, progress=100, result=None,
               item_count=None):
        self.status = status
        self.progress = max(0, min(100, int(progress)))
        if message is not None:
            self.message = message
        if result is not None:
            self.result = result
        if item_count is not None:
            self.item_count = item_count
        self._write()

    def fail(self, message, *, error=None):
        self.status = STATUS_FAILED
        self.progress = 100
        self.message = message
        self.error = error or message
        self._write()

    def _write(self):
        payload = {
            "status": self.status,
            "progress": self.progress,
            "message": self.message,
            "itemCount": self.item_count,
            "error": self.error,
        }
        if self.result:
            payload["result"] = self.result
        _atomic_write(self.status_path, payload)
