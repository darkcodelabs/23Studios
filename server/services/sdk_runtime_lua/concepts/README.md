# SDK Concepts Library

Logic modules ported from HAKCD (`/home/hakcer/projects/personal/hakcd/source/systems/`).
**Concepts only — no rendering ties.** Drop them into a scene Lua and supply
your own draw code. Each is a pure state machine the scene drives via
`tick(dt)` / input handlers / state getters.

| File | What it gives you |
|---|---|
| `character_generator.lua` + `char_wheel.lua` | 4-slot crank-driven char creation (handle / alignment / origin / aesthetic). 5-sec auto-cycle per slot, A snap-locks, B cancels. |
| `lockpick_logic.lua` | Pin-tumbler lockpick mini-game. Crank sets tension, A drives pin, fail = pin reset. |
| `pwn_hack_logic.lua` | Multi-step PwnGlove hack: badge → jammer → exit. Each step has its own input contract. |
| `kombo_detector.lua` | Konami-code / arbitrary input-sequence detector. Pass a sequence, fires callback on match. |
| `phrase_validator.lua` | Player text matched against alias lists with fuzzy normalization (case + whitespace + punctuation tolerant). |
| `hotspot_system.lua` + `hotspot_navigator.lua` | Point-and-click hotspot zones with d-pad cycling, A interacts. |
| `dialog.lua` | NPC dialog page-flipper. Lines + speaker + portrait_ref. Per-page advance. |
| `reputation.lua` | Per-faction reputation deltas + threshold gates (locked/unlocked endings). |
| `haxheadroom_logic.lua` + `haxheadroom_dials.lua` + `haxheadroom_audio.lua` | Signal-scan mini-game (Catch-the-Wav): 4 dials, crank tunes one at a time, audio tone hints when locked in. |

## Wiring patterns

**Drop into a scene:**

```lua
import "runtime/concepts/character_generator"

local Scene = {}
function Scene:enter()
  self.cg = character_generator.new()
end

function Scene:update(dt)
  self.cg:tick(dt)
end

function Scene:draw()
  -- read state and draw HOWEVER you want, no HAKCD-specific look.
  local slot = self.cg:get_active_slot_name()
  local val  = self.cg:get_current_value()
  -- ...
end

function Scene:input(evt)
  if     evt == "a"     then self.cg:on_a_press()
  elseif evt == "b"     then self.cg:on_b_press() end
end

function playdate.cranked(change, _)
  Scene.cg:on_crank_change(change)
end
```

**Re-skin:** these are LOGIC modules. Look elsewhere for the visual.
HAKCD's `*_renderer.lua` files were intentionally not ported — write your
own draw code that matches your game's aesthetic.

## Loading

`main.lua` does NOT import these by default. Scenes that need them must
`import "runtime/concepts/<name>"` explicitly so unused modules don't
bloat the pdz table.

## Source attribution

All ported verbatim from `https://github.com/haKC-ai/hakcd` source/systems
under the project's own MIT license. Concept ports only; refactor freely.
