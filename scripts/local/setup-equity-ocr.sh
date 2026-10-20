#!/usr/bin/env bash
# Create the dedicated PaddleOCR environment used by services/equity_structure.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
VENV="${EQUITY_VENV_DIR:-.equity-venv}"

if [[ ! -x "$VENV/bin/python" ]]; then
  python3 -m venv "$VENV"
fi

"$VENV/bin/python" -m pip install --upgrade pip setuptools wheel
"$VENV/bin/python" -m pip install -r services/equity_structure/requirements.txt

"$VENV/bin/python" - <<'PY'
import cv2, numpy, paddleocr, rapidfuzz, openpyxl, reportlab
print("equity OCR environment ready")
print("opencv", cv2.__version__)
print("numpy", numpy.__version__)
print("paddleocr", getattr(paddleocr, "__version__", "unknown"))
print("rapidfuzz", rapidfuzz.__version__)
PY
