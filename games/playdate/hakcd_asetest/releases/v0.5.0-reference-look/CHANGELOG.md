# HAKCD v0.5.0 — Reference Aesthetic Rebuild (bedroom + BBS slice)

Full aesthetic + structural pivot to match the design_handoff references.

## What changed
- **New visual model.** The game is no longer a walkable Mario-64 room. It is
  now a STATIC illustrated adventure — detailed 1-bit cinematic frames with a
  persistent dialogue bar, exactly like the handoff scenes. The character lives
  inside the illustration; you cursor between hotspots and interact.
- **Reference-matched dialogue bar** — bold speaker name, monospace body text
  with typewriter reveal + branching choices, and a framed portrait headshot.
- **Monospace HUD chrome** — thin bordered strips, objective/star readouts,
  control-hint bars, framed panels (core/hud.lua) — matching the handoff.
- **Scenes:** bedroom hub (COMPUTER / POSTER / PHONE hotspots) and the DEADLINE
  BBS terminal where THE MENTOR briefs you. War Dialer reachable from the
  computer after the briefing.

## Art source (important)
Scene art (bedroom, BBS) + portraits (newb, THE MENTOR) are processed from the
design_handoff reference PNGs to strict 1-bit 400x240. This is INTERIM: the
chosen path is raster-generation in the same style (gpt-image-1), staged in
`gen_scenes_raster.js` — it fires the moment a working image API key is present.
OpenRouter is out of credits and OPENAI_API_KEY is empty, so that path is
currently blocked on an external resource.

## Engine
New modules: core/scene_static (illustration + hotspot cursor), core/hud
(chrome). Rewrote core/dialogue, scenes/bedroom, scenes/bbs, scenes/title.
Import-discipline clean, pdc zero-warning.

## Controls
D-pad move cursor - A interact/advance - B back.
