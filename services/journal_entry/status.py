"""Atomic progress status for the Journal Entry worker.

The worker is database-free. Node owns the job row and polls status.json.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

STATUS_QUEUED = "queued"
STATUS_RUNNING = "running"
STATUS_COMPLETED = "completed"
STATUS_FAILED = "failed"


def _atomic_write(path: Path, payload: dict) -> None:
    tmp = path.with_name(f".{path.name}.tmp")
    with open(tmp, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(tmp, path)


class Reporter:
    def __init__(self, job_dir, *, floor=0):
        self.job_dir = Path(job_dir)
        self.status_path = self.job_dir / "status.json"
        self.progress = max(0, min(100, int(floor)))
        self.status = STATUS_RUNNING
        self.message = None
        self.error = None
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

    def finish(self, message=None, progress=100, result=None):
        self.status = STATUS_COMPLETED
        self.progress = max(0, min(100, int(progress)))
        if message is not None:
            self.message = message
        if result is not None:
            self.result = result
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
            "error": self.error,
        }
        if self.result:
            payload["result"] = self.result
        _atomic_write(self.status_path, payload)
