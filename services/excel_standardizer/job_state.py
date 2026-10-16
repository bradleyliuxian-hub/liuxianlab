import json
from datetime import datetime, timezone
from pathlib import Path


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def read_job(job_dir: Path):
    path = job_dir / "job.json"
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def update_job(job_dir: Path, **patch):
    current = read_job(job_dir)
    current.update(patch)
    current["updatedAt"] = now_iso()
    tmp = job_dir / ".job.python.tmp"
    tmp.write_text(json.dumps(current, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(job_dir / "job.json")
    return current
