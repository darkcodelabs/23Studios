#!/usr/bin/env bash
# Cyber Glove sprite starter — verify SDK + print run instructions.
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DIR="$PROJECT_ROOT/source"
BUILD_DIR="$PROJECT_ROOT/build"
PDX_NAME="CyberGlove.pdx"

err() { printf '\033[31m%s\033[0m\n' "$*" >&2; }
ok()  { printf '\033[32m%s\033[0m\n' "$*"; }
log() { printf '%s\n' "$*"; }

resolve_sdk() {
    if [[ -n "${PLAYDATE_SDK_PATH:-}" && -d "$PLAYDATE_SDK_PATH" ]]; then
        echo "$PLAYDATE_SDK_PATH"; return 0
    fi
    for cand in \
        "$HOME/Developer/PlaydateSDK" \
        "/opt/PlaydateSDK" \
        "/Applications/PlaydateSDK" \
        "$HOME/PlaydateSDK"; do
        if [[ -d "$cand" ]]; then echo "$cand"; return 0; fi
    done
    return 1
}

SDK="$(resolve_sdk || true)"
if [[ -z "$SDK" ]]; then
    err "Playdate SDK not found."
    err "Install from https://play.date/dev/ and export PLAYDATE_SDK_PATH."
    exit 1
fi
ok "Playdate SDK: $SDK"

PDC_BIN="$SDK/bin/pdc"
SIM_BIN_LINUX="$SDK/bin/PlaydateSimulator"
SIM_BIN_MAC="$SDK/bin/Playdate Simulator.app/Contents/MacOS/Playdate Simulator"

if [[ ! -x "$PDC_BIN" ]]; then
    err "pdc not executable at $PDC_BIN"
    exit 1
fi
ok "pdc:    $PDC_BIN"

if [[ -x "$SIM_BIN_LINUX" ]]; then
    SIM="$SIM_BIN_LINUX"
elif [[ -x "$SIM_BIN_MAC" ]]; then
    SIM="$SIM_BIN_MAC"
else
    SIM=""
    log "Simulator not found in SDK bin/. Skipping launch hint."
fi

mkdir -p "$BUILD_DIR"
log ""
log "Compile with:"
log "  \"$PDC_BIN\" \"$SOURCE_DIR\" \"$BUILD_DIR/$PDX_NAME\""
log ""
if [[ -n "$SIM" ]]; then
    log "Then launch simulator:"
    log "  \"$SIM\" \"$BUILD_DIR/$PDX_NAME\""
    log ""
fi

if [[ ! -f "$SOURCE_DIR/images/cyber_glove-table-80-40.png" ]]; then
    err "WARNING: source/images/cyber_glove-table-80-40.png is missing."
    err "Draw the sprite sheet per README.md before running pdc, or it will fail."
fi

ok "Setup verified. Run the pdc command above to build."
