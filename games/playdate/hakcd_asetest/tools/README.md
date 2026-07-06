# Asset generation runner

All HAKCD asset-generation batches run through `tools/gen.sh`, which wraps the
`gen_assets_*.js` drivers in a single named tmux session (`hakcd-gen`).

## Why (the v0.4 mishap this prevents)

Backgrounding a bare `node gen_assets.js` is fragile:
- the gen driver spawns `claude` + headless aseprite children;
- a shell-grep kill (`pgrep | kill`) can hit the zsh eval-wrapper instead of the
  node process, leaving it alive;
- a missed parent kill orphans the `claude` children (reparented to PID 1);
- and nothing stops a *second* batch starting while the first is still alive —
  two batches then race on `source/images/` and clobber each other.

That is exactly what happened once during the v0.4 build. A named tmux session
fixes the whole class: one reliable handle, `run` always replaces any prior
session first (so exactly one batch ever exists), and `stop` kills the session's
entire process group — node **and** its children — then reaps any stray
`/tmp`-cwd `claude` orphan for good measure.

Aligns with the DarkCode Process Discipline rule: long-running generators belong
in a named tmux session, never a kill-by-name sweep.

## Usage

```bash
tools/gen.sh run gen_assets_v5.js          # start (replaces any running batch)
tools/gen.sh run gen_assets_v5.js coin     # regen a single asset
tools/gen.sh status                        # running? + last 8 log lines
tools/gen.sh watch                         # attach to the live session
tools/gen.sh stop                          # kill node + all children, reap orphans
```

Never launch a `gen_assets_*.js` driver directly in the background — always via
`tools/gen.sh run`.
