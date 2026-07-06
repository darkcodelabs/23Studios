#!/usr/bin/env bash
# gen.sh — launch a HAKCD asset-generation batch inside a single named tmux
# session so it is always killable by name and can never race a second batch.
#
# Why: gen drivers spawn `claude` + headless aseprite children. Backgrounding
# bare `node gen_assets.js` makes the parent hard to target (shell-grep can hit
# the zsh wrapper instead of node) and orphans children on a missed kill. A
# named tmux session gives one reliable handle; killing it takes the whole
# process group with it. (DarkCode Process Discipline: named tmux for long jobs.)
#
# Usage:
#   tools/gen.sh run  gen_assets_v5.js [only-asset]   # start (replaces any run)
#   tools/gen.sh stop                                  # kill the batch cleanly
#   tools/gen.sh status                                # is it running? tail log
#   tools/gen.sh watch                                 # attach to the session
set -euo pipefail

SESSION="hakcd-gen"
GAME_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SERVER_DIR="$(cd "$GAME_DIR/../../../server" && pwd)"
LOG="$GAME_DIR/tools/gen.log"

cmd="${1:-status}"

case "$cmd" in
  run)
    driver="${2:?usage: gen.sh run <gen_assets_*.js> [only-asset]}"
    only="${3:-}"
    # exactly one batch: tear down any prior session (and its whole tree) first
    if tmux has-session -t "$SESSION" 2>/dev/null; then
      echo "stopping existing '$SESSION' before starting a new one"
      tmux kill-session -t "$SESSION"
      sleep 1
    fi
    : > "$LOG"
    tmux new-session -d -s "$SESSION" -c "$SERVER_DIR" \
      "node '$GAME_DIR/$driver' $only 2>&1 | tee '$LOG'"
    echo "started '$SESSION': $driver $only"
    echo "  watch:  tools/gen.sh status   |   stop: tools/gen.sh stop"
    ;;
  stop)
    if tmux has-session -t "$SESSION" 2>/dev/null; then
      tmux kill-session -t "$SESSION"
      echo "killed session '$SESSION' (node + all children)"
    else
      echo "no '$SESSION' session running"
    fi
    # belt-and-suspenders: reap any claude the batch left in /tmp (orphaned PPID 1)
    for p in $(pgrep -f '[c]laude' 2>/dev/null || true); do
      [ "$(readlink /proc/$p/cwd 2>/dev/null)" = "/tmp" ] || continue
      [ "$(awk '/^PPid:/{print $2}' /proc/$p/status 2>/dev/null)" = "1" ] || continue
      kill "$p" 2>/dev/null && echo "  reaped orphaned claude pid=$p"
    done
    ;;
  status)
    if tmux has-session -t "$SESSION" 2>/dev/null; then
      echo "RUNNING ('$SESSION')"; echo "--- tail ---"; tail -n 8 "$LOG" 2>/dev/null || true
    else
      echo "not running"; [ -f "$LOG" ] && { echo "--- last log ---"; tail -n 6 "$LOG"; }
    fi
    ;;
  watch)
    tmux attach -t "$SESSION"
    ;;
  *)
    echo "usage: gen.sh {run <driver.js> [asset] | stop | status | watch}"; exit 1
    ;;
esac
