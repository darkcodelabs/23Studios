#!/usr/bin/env bash
# preflight.sh — 5-step ship gate for 23 Studios.
# Ported from HAKCD's tools/preflight.sh shape, adapted for our layout.
#
# Steps:
#   1. Lint pulp_runtime_lua/ Lua imports (no cross-scene cross-talk)
#   2. AJV-validate every project's pulp_data/project.json
#   3. ui build clean (vite)
#   4. server tests pass (node --test)
#   5. asset patrol (no placeholder/missing) for every project
#
# Exit non-zero on first failure with a clear "step N failed:" prefix.
#
# Usage:
#   bash server/scripts/preflight.sh           # full gate
#   bash server/scripts/preflight.sh --quick   # skip build + tests

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
QUICK=0
for a in "$@"; do
  if [ "$a" = "--quick" ]; then QUICK=1; fi
done

red()   { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }
yel()   { printf '\033[33m%s\033[0m\n' "$*"; }

fail() {
  red "step $1 failed: $2"
  exit 1
}

echo "=== preflight: 5-step ship gate ==="
echo "root: $ROOT"
cd "$ROOT"

# ---------------------------------------------------------------- step 1 ---
echo
echo "--- step 1: lua import discipline ---"
LUA_RT="server/services/pulp_runtime_lua"
if [ -d "$LUA_RT" ]; then
  # No scene should require another scene directly.
  bad=$(grep -rn "require('runtime\." "$LUA_RT" | grep -vE "(pulp_runtime\.lua|^Binary file)" \
        | grep -v "pulp_tiles\|pulp_rooms\|pulp_sound\|pulp_player\|pulp_characters\|audio_manager" || true)
  if [ -n "$bad" ]; then
    echo "$bad"
    fail 1 "unexpected runtime.* require"
  fi
  green "step 1 ok"
else
  yel  "step 1 skipped (no $LUA_RT dir)"
fi

# ---------------------------------------------------------------- step 2 ---
echo
echo "--- step 2: schema validation ---"
node - <<'NODE'
const path = require('path');
const fs = require('fs');
const Ajv = require(path.join(process.cwd(), 'server/node_modules/ajv')).default;
const schema = require(path.join(process.cwd(), 'server/data/schema/pulp_project.schema.json'));
const ajv = new Ajv({ allErrors: true, strict: false });
const validate = ajv.compile(schema);
const roots = [
  path.join(process.cwd(), 'server/data/scratch_projects'),
  path.join(process.cwd(), 'server/server/data/scratch_projects')
];
let total = 0, bad = 0;
for (const r of roots) {
  if (!fs.existsSync(r)) continue;
  for (const id of fs.readdirSync(r)) {
    const p = path.join(r, id, 'pulp_data', 'project.json');
    if (!fs.existsSync(p)) continue;
    total++;
    try {
      const data = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (!validate(data)) {
        bad++;
        console.error(`  FAIL ${id}: ${ajv.errorsText(validate.errors).slice(0, 240)}`);
      }
    } catch (e) {
      bad++;
      console.error(`  FAIL ${id} parse: ${e.message}`);
    }
  }
}
console.log(`projects checked: ${total}, failures: ${bad}`);
process.exit(bad === 0 ? 0 : 1);
NODE
if [ $? -ne 0 ]; then fail 2 "schema validation failed"; fi
green "step 2 ok"

# ---------------------------------------------------------------- step 3 ---
if [ $QUICK -eq 0 ]; then
  echo
  echo "--- step 3: ui build ---"
  if ! npm --prefix ui run build > /tmp/preflight_ui_build.log 2>&1; then
    tail -20 /tmp/preflight_ui_build.log
    fail 3 "ui build"
  fi
  tail -3 /tmp/preflight_ui_build.log
  green "step 3 ok"

  # ------------------------------------------------------------- step 4 ---
  echo
  echo "--- step 4: server tests ---"
  if ! npm --prefix server test > /tmp/preflight_server_tests.log 2>&1; then
    tail -30 /tmp/preflight_server_tests.log
    fail 4 "server tests"
  fi
  tail -5 /tmp/preflight_server_tests.log
  green "step 4 ok"
else
  yel "steps 3+4 skipped (--quick)"
fi

# ---------------------------------------------------------------- step 5 ---
echo
echo "--- step 5: asset patrol per project ---"
# Find every project id with a pulp_data dir.
PROJECT_IDS=$(find server/server/data/scratch_projects -maxdepth 2 -name 'pulp_data' -type d 2>/dev/null \
              | awk -F/ '{print $(NF-1)}')
if [ -z "$PROJECT_IDS" ]; then
  yel "step 5 skipped (no projects)"
else
  bad=0
  for id in $PROJECT_IDS; do
    echo "  patrolling $id"
    if ! ( cd server && node scripts/patrol_cli.js "$id" 2>&1 | tail -10 | tee /tmp/preflight_patrol_$id.log ); then
      bad=$((bad+1))
      continue
    fi
    placeholders=$(grep -oE 'placeholder [0-9]+' /tmp/preflight_patrol_$id.log | tail -1 | awk '{print $2}')
    missing=$(grep -oE 'missing [0-9]+' /tmp/preflight_patrol_$id.log | head -1 | awk '{print $2}')
    if [ "${placeholders:-0}" != "0" ] || [ "${missing:-0}" != "0" ]; then
      red "    $id: $placeholders placeholder, $missing missing"
      bad=$((bad+1))
    fi
  done
  if [ $bad -gt 0 ]; then fail 5 "$bad projects with placeholder/missing assets"; fi
  green "step 5 ok"
fi

echo
green "=== preflight: ALL GREEN ==="
