#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV="$HERE/.venv-visual-pack"

if ! command -v python3 >/dev/null 2>&1; then
  echo "FATAL: python3 not found" >&2
  exit 1
fi

PYV="$(python3 -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"
echo "Python $PYV detected"

if [ ! -d "$VENV" ]; then
  python3 -m venv "$VENV"
  echo "venv created at $VENV"
fi

# shellcheck disable=SC1091
source "$VENV/bin/activate"
pip install --quiet --upgrade pip
pip install --quiet -r "$HERE/requirements.txt"
echo "dependencies installed"

if command -v convert >/dev/null 2>&1; then
  echo "ImageMagick: $(convert -version | head -1)"
else
  echo "ImageMagick not found (only required for final Playdate 1-bit conversion)"
fi

cat <<EOF

Visual Pack Factory installed.

To use directly:
  source $VENV/bin/activate
  python -m tools.init_pack --help

To use from the 23 Studios server, ensure VISUAL_PACK_PYTHON points to
$VENV/bin/python in .env (or rely on auto-detect).
EOF
