#!/usr/bin/env bash
# Create the dedicated PaddleOCR environment used by services/equity_structure.
#
# This environment is intentionally separate from the shared .venv and is not
# installed by the production Node deployer. Pins live here so a routine deploy
# does not treat a service-local manifest as a shared Python dependency change.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
VENV="${EQUITY_VENV_DIR:-.equity-venv}"

if [[ ! -x "$VENV/bin/python" ]]; then
  python3 -m venv "$VENV"
fi

"$VENV/bin/python" -m pip install --upgrade pip setuptools wheel
"$VENV/bin/python" -m pip install \
  "paddlepaddle==3.3.1" \
  "paddleocr==2.10.0" \
  "numpy<2" \
  "protobuf==3.20.2" \
  "Pillow>=10.4" \
  "rapidfuzz>=3.9" \
  "openpyxl>=3.1" \
  "reportlab>=4.2" \
  "cairosvg>=2.7"

"$VENV/bin/python" - <<'PY'
import cv2, numpy, paddleocr, rapidfuzz, openpyxl, reportlab
print("equity OCR environment ready")
print("opencv", cv2.__version__)
print("numpy", numpy.__version__)
print("paddleocr", getattr(paddleocr, "__version__", "unknown"))
print("rapidfuzz", rapidfuzz.__version__)
PY
