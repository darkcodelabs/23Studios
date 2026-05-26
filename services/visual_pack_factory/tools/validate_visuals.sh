#!/usr/bin/env bash
# Wrapper for hakcd-v4 build gate. Drop-in target for tools/canon/validate_visuals.sh
# in any game repo. Exits 0 pass, 2 warnings, 3 errors.
#
# Usage:
#   PROJECT_ID=hakcd ./validate_visuals.sh
#   PROJECT_ID=hakcd ENFORCE_HW=1 ./validate_visuals.sh   # v0.2.0+
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-}"
if [ -z "$PROJECT_ID" ]; then
  echo "FATAL: PROJECT_ID env required" >&2
  exit 1
fi

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FACTORY="$(cd "$HERE/.." && pwd)"
VENV_PY="$FACTORY/.venv-visual-pack/bin/python"
PY="${VISUAL_PACK_PYTHON:-${VENV_PY:-python3}}"

ARGS=( -m tools.validate_pack --project "$PROJECT_ID" )
if [ "${ENFORCE_HW:-0}" = "1" ]; then
  ARGS+=( --enforce-hardware )
fi

cd "$FACTORY"
"$PY" "${ARGS[@]}"
