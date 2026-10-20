"""CLI used by Node to turn a saved result JSON into XLSX/PDF."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .exporters import build_excel, build_pdf
from .job_io import read_json
from .schemas import SchemaError, validate_result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Export equity structure result")
    parser.add_argument("--result", required=True)
    parser.add_argument("--format", required=True, choices=("xlsx", "pdf"))
    parser.add_argument("--output", required=True)
    parser.add_argument("--layout")
    args = parser.parse_args(argv)
    try:
        result = validate_result(read_json(args.result))
        layout = read_json(args.layout) if args.layout else None
        data = build_excel(result) if args.format == "xlsx" else build_pdf(result, layout)
        Path(args.output).write_bytes(data)
        return 0
    except (SchemaError, ValueError, OSError) as error:
        print(f"export failed: {error}", file=sys.stderr)
        return 2
    except Exception as error:  # pragma: no cover
        print(f"export failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
