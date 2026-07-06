# HAKCD v0.7.0 — The Loop (+ cleaner bedroom)

Two big changes, both aimed at "too busy / not fun", inspired by Under the Tree.

## Phase 1 (shipped in 0.6.1): de-clutter
Stripped the HUD to almost nothing. Walking a room shows just the room + you;
next to something interactable, one quiet chevron over it + its name at the top.
No objective bar, no star counter, no per-object dots, no rings, no fps.

## Phase 2 (this build): a real loop
The game is no longer an errand list. It's a hub-and-dives progression loop:

- BEDROOM = hub. Walk to the COMPUTER to open the WAR DIALER.
- DIALER = a clean list of target boards + your cred + a RIG entry. One status
  word each: DIAL / LOCKED / CRACKED.
- DIVE a target -> run its single hack (the Mentor intro, a lockpick, a blue
  box). Clear it -> loot: cred + a piece of the HOLLOWPOINT intel.
- RIG (shop) -> spend cred on the Password Cracker, which opens the deeper
  Aegis dive.
- DEEPER -> Aegis needs the cracker; clearing it pays big and drops the next
  clue. "One more dive to afford the next tool."

First slice: 3 targets (DEADLINE BBS, PhoenixDown, Aegis), 1 upgrade. Fully
playable start to finish.

## Cleaner art
Bedroom regenerated via the local Aseprite pipeline with restraint: one clear
focal desk, few props, open central floor, generous negative space, sparing
dither. (2.4KB vs the old 7.5KB dense version.)

## Honest caveats
- Image/file reads were blocked in this session, so art is machine-validated
  (1-bit + dims) but not eyeballed by me; loop code is compile-clean (pdc) and
  flow-traced but not sim-tested.
- Bedroom hotspot coordinates (computer/bed/door) were tuned for the OLD art;
  they may need nudging against the new cleaner layout.

## Controls
D-pad walk/select - A interact/dial/buy - B back - crank drives the hacks.
