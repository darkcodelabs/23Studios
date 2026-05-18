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

## Kit modules

These are higher-level building blocks that pair with a recipe in
`server/data/minigame_recipes.seed.json`. Unlike the bare logic
concepts above, kit modules own layout + a default `:draw()` so a
recipe template can drop in with minimal scene glue. Scenes may still
bypass the default draw and render from `:get_selection()` (or the
equivalent state-getter on the module).

| File | Kit / recipe id | What it gives you |
|---|---|---|
| `character_creator.lua` | `character_creator_crank` | Multi-category appearance + name wizard. Crank cycles options within a category, d-pad jumps categories, A advances, B retreats. Final category is the onscreen keyboard for the player's name. Selection persists to `playdate.datastore` under `config.storage_key` on confirm. Default `:draw()` stacks the per-category imagetables into a preview rect and shows a right-rail category list with the current option index; scenes can supply their own draw instead by reading `:get_selection()`. Config takes a categories list (`{id, label, imagetable_path, option_count?}` or `{id, label, kind="keyboard", max_length}`) plus `on_confirm(selection)` / `on_cancel()` callbacks. Crank quantum is 18 degrees per tick to match `char_wheel`. |

### Wiring a kit module (character_creator example)

```lua
import "runtime/concepts/character_creator"

local Scene = {}
local state = {}

function Scene.enter()
  state.cc = character_creator.new({
    storage_key = "intro_avatar",
    categories = {
      { id="head_shape", label="HEAD", imagetable_path="images/avatar_head" },
      { id="eyes",       label="EYES", imagetable_path="images/avatar_eyes" },
      { id="name",       label="NAME", kind="keyboard", max_length=12 }
    },
    on_confirm = function(sel) save_state.set("intro_avatar", sel); scene_manager.pop() end,
    on_cancel  = function() scene_manager.pop() end
  })
end

function Scene.update(dt) state.cc:update(dt) end
function Scene.draw()    state.cc:draw()    end
function Scene.input(e)  state.cc:input(e)  end
function playdate.cranked(change, _) state.cc:on_crank(change) end
function Scene.exit() state.cc:teardown() end
```

Missing imagetables degrade gracefully -- the kit falls back to a
six-option debug stub so the autopilot can stub a scene before art
exists. Replace the stubs with real `name-table-W-H.png` assets and the
preview composite lights up automatically.

### Adding new kit modules

1. Author the module here following the `character_creator.lua` shape
   (`new(config)`, `update`, `draw`, `input`, `on_crank`, `teardown`,
   `get_selection`).
2. Add the matching entry to `minigame_recipes.seed.json` so the
   autopilot can drop it into a scene slot. The recipe's `lua_template`
   should `import "runtime/concepts/<name>"` and instantiate the module
   in `Scene.enter`.
3. Document the kit here under the table.
