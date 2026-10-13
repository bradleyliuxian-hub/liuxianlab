import re
import unittest
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[3]

MIGRATIONS_DIR = PROJECT_ROOT / "server" / "contracts" / "migrations"
REPOSITORY_JS = PROJECT_ROOT / "server" / "contracts" / "repository.js"
DATABASE_PY = PROJECT_ROOT / "services" / "contract_review" / "database.py"


# Columns added by Contract Digitization v1.1.
V11_COLUMNS = {
    "source_sha256",
    "parse_mode_requested",
    "parse_tier_actual",
    "parse_cache_hit",
    "parse_fallback_used",
    "parse_fallback_reason",
    "progress_message",
    "parse_metrics",
    "page_count",
}


def _read(path):
    return Path(path).read_text(encoding="utf-8")


def _schema_columns():
    """Union of contracts columns declared by CREATE TABLE and
    ADD COLUMN across all migrations."""

    columns = set()

    text = "\n".join(
        _read(path)
        for path in sorted(MIGRATIONS_DIR.glob("*.sql"))
    )

    # CREATE TABLE IF NOT EXISTS contracts ( ... );
    match = re.search(
        r"CREATE TABLE[^(]*contracts\s*\((.*?)\);",
        text,
        flags=re.IGNORECASE | re.DOTALL,
    )

    if match:
        body = match.group(1)
        for line in body.splitlines():
            line = line.strip()
            m = re.match(
                r"([a-z_][a-z0-9_]*)\s+"
                r"(UUID|TEXT|BIGINT|SMALLINT|INTEGER|"
                r"TIMESTAMPTZ|BOOLEAN|JSONB)",
                line,
                flags=re.IGNORECASE,
            )
            if m:
                columns.add(m.group(1).lower())

    for m in re.finditer(
        r"ADD COLUMN IF NOT EXISTS\s+([a-z_][a-z0-9_]*)",
        text,
        flags=re.IGNORECASE,
    ):
        columns.add(m.group(1).lower())

    return columns


class SchemaConsistencyTests(unittest.TestCase):

    def setUp(self):
        self.columns = _schema_columns()

    def test_page_count_in_schema(self):
        self.assertIn("page_count", self.columns)

    def test_v11_columns_in_schema(self):
        missing = V11_COLUMNS - self.columns
        self.assertEqual(missing, set())

    def test_repository_insert_columns_exist_in_schema(self):
        source = _read(REPOSITORY_JS)

        match = re.search(
            r"INSERT INTO contracts\s*\((.*?)\)",
            source,
            flags=re.DOTALL,
        )

        self.assertIsNotNone(match)

        insert_columns = {
            token.strip().lower()
            for token in match.group(1).split(",")
            if token.strip()
        }

        unknown = insert_columns - self.columns

        self.assertEqual(
            unknown,
            set(),
            f"repository.js INSERT references unknown columns: {unknown}",
        )

        self.assertIn("page_count", insert_columns)

    def test_worker_database_reads_page_count_and_v11_columns(self):
        source = _read(DATABASE_PY).lower()

        for column in V11_COLUMNS:
            self.assertIn(column, source)


if __name__ == "__main__":
    unittest.main()
