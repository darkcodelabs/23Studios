# HAKCD v0.3.0 — Act 1 Vertical Slice

A real playable story chunk. 1998 suburban phreaker-noir. Every visual asset
authored by the prompt→Aseprite pipeline (LLM writes an Aseprite Lua script →
headless `aseprite -b` in a bwrap jail → 1-bit/dimension validators → PNG).

## Play
Title → your bedroom (isometric hub). Sit at the computer to war-dial the
DEADLINE BBS. The Mentor — running as a daemon two years after his death —
sets you on PhoenixDown's corporate exchange. Scan it, cross town to the
Greyhound payphones, red-box a free line, take k0nsole's call, then crack a
Bell pedestal at 2am and blue-box the trunk. The wire opens.

## Systems
- Stack-based scene manager (push/pop, exit-before-enter)
- Isometric room engine: 4-direction player, dithered-floor walk, hotspots, HUD
- Portrait dialogue: typewriter text, name tab, branching choices
- 8-step quest chain + inventory, persisted via datastore
- Synth audio: SFX + 3-mood tracker music (calm / tense / night)

## Minigames (all crank-driven)
- WAR DIALER — crank-scan an exchange, signal meter + carrier hiss, log carriers
- RED BOX — listen to a DTMF coin cadence, crank the band dial, reproduce 3 tones
- LOCKPICK — 5-pin, crank tension into the notch, set each pin, 3-fail alarm, 45s
- BLUE BOX — hold 2600 Hz steady to seize the trunk, then dial a 6-key MF route

## Assets (11, all pipeline-authored, first-attempt unless noted)
iso bedroom hub · suburbia overworld · payphone bank · Bell pedestal yard ·
BBS CRT · 16-frame 4-dir player sprite · 4 dialogue portraits (Mentor, k0nsole,
newb, Mom) · floppy pickup. Sources + generating Lua in ../../aseprite_src/.

## Controls
D-pad move · A confirm/interact · B back · crank drives every minigame.
