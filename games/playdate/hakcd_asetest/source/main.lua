-- HAKCD -- reference-aesthetic slice (v0.5.0).
-- Visual model matches design_handoff: full-screen 1-bit illustrated frames
-- (bedroom, DEADLINE BBS) with a persistent dialogue bar (name + mono text +
-- framed portrait) and monospace HUD chrome. Scene art here is processed from
-- the handoff references to strict 1-bit 400x240 (INTERIM); final scenes will
-- be raster-generated in the same style once an image API is available.
--
-- Architecture (23studios canon): every module is imported ONCE here in
-- dependency order and self-binds to a _G.<name>. Scenes access siblings via
-- those globals -- never `local x = import`.

import "CoreLibs/object"
import "CoreLibs/graphics"
import "CoreLibs/sprites"
import "CoreLibs/timer"
import "CoreLibs/crank"

-- core systems (order matters)
import "core/audio"
import "core/fx"
import "core/save_state"
import "core/inventory"
import "core/quest"
import "core/dialogue"
import "core/hud"
import "core/scene_manager"
import "core/isoroom"

-- minigames
import "minigames/wardialer"
import "minigames/redbox"
import "minigames/lockpick"
import "minigames/bluebox"

-- scenes
import "scenes/bbs"
import "scenes/bedroom"
import "scenes/overworld"
import "scenes/payphone"
import "scenes/pedestal"
import "scenes/title"

local gfx <const> = playdate.graphics

save_state.load()

-- crank-out reminder overlay when the player docks the crank in a crank scene
playdate.setCrankSoundsDisabled(true)

scene_manager.push(scene_title)

function playdate.update()
    playdate.timer.updateTimers()
    gfx.clear(gfx.kColorBlack)
    scene_manager.update()
    fx.update()
    fx.draw()
    playdate.drawFPS(4, 224)
end
