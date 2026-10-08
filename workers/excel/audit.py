import json
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


def json_safe(value: Any):
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if hasattr(value, "isoformat"):
        try:
            return value.isoformat()
        except Exception:
            pass
    if isinstance(value, (list, tuple)):
        return [json_safe(v) for v in value]
    if isinstance(value, dict):
        return {str(k): json_safe(v) for k, v in value.items()}
    return str(value)


@dataclass
class AuditLog:
    path: Path
    total: int = 0
    by_type: Counter = field(default_factory=Counter)
    by_rule: Counter = field(default_factory=Counter)
    by_sheet: Counter = field(default_factory=Counter)
    sheet_types: dict = field(default_factory=lambda: defaultdict(Counter))

    def __post_init__(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.handle = self.path.open("w", encoding="utf-8")

    def add(self, *, rule: str, sheet: str, target: str, change_type: str,
            before: Any, after: Any, reason: str):
        if json_safe(before) == json_safe(after):
            return
        record = {
            "index": self.total + 1,
            "rule": rule,
            "sheet": sheet,
            "target": target,
            "type": change_type,
            "before": json_safe(before),
            "after": json_safe(after),
            "reason": reason,
        }
        self.handle.write(json.dumps(record, ensure_ascii=False) + "\n")
        self.handle.flush()
        self.total += 1
        self.by_type[change_type] += 1
        self.by_rule[rule] += 1
        self.by_sheet[sheet] += 1
        self.sheet_types[sheet][change_type] += 1

    def summary(self):
        return {
            "totalChanges": self.total,
            "byType": dict(self.by_type),
            "byRule": dict(self.by_rule),
            "bySheet": dict(self.by_sheet),
            "sheetTypes": {sheet: dict(counter) for sheet, counter in self.sheet_types.items()},
        }

    def close(self):
        if not self.handle.closed:
            self.handle.close()
