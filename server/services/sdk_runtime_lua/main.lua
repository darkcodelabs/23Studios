-- sdk_runtime_lua/main.lua
-- Boot entry. Loaded by the SDK exporter into source/main.lua.
-- Imports the standard runtime modules and starts the first scene listed
-- in game_data.startup_scene.

import "CoreLibs/object"
import "CoreLibs/graphics"
import "CoreLibs/sprites"
import "CoreLibs/timer"
import "CoreLibs/crank"
import "CoreLibs/animation"

import "runtime/save_state"
import "runtime/audio_manager"
import "runtime/animation"
import "runtime/input"
import "runtime/sprite_base"
import "runtime/scene_manager"
import "runtime/scene_transition"

-- Concept modules: imported in dependency order.
-- save_state must be loaded before inventory (inventory reads/writes through it).
import "concepts/inventory"
import "concepts/collision"
import "concepts/interaction"
-- debug_overlay last: no downstream deps; call draw() after gfx.sprite.update().
import "concepts/debug_overlay"

-- game_data.lua is emitted by the exporter and provides:
--   game_data.startup_scene  (string id, optional — falls back to "title")
--   game_data.scenes         (table id -> require path)
import "assets/game_data"

local gfx <const> = playdate.graphics

save_state.init()
audio_manager.init()

local last_time_ms = playdate.getCurrentTimeMilliseconds()

local function require_scene(scene_id)
    local path = game_data.scenes and game_data.scenes[scene_id]
    if not path then return nil end
    -- Scenes live under scenes/<id>.lua. They MUST return a table that
    -- exposes init/enter/update/draw/exit/input (any subset).
    local mod = nil
    local ok, err = pcall(function() mod = import(path) end)
    if not ok then
        print("require_scene("..tostring(scene_id).."): "..tostring(err))
        return nil
    end
    return mod
end

local function start_at(scene_id, spawn_pos)
    local mod = require_scene(scene_id)
    if mod == nil then
        print("scene not found: "..tostring(scene_id))
        return
    end
    scene_manager.replace(mod, { spawn = spawn_pos })
end

_G.go_to_scene = function(scene_id, spawn_pos)
    if scene_transition.is_active() then return end
    scene_transition.start(scene_id, spawn_pos, function(id, spawn)
        start_at(id, spawn)
    end)
end

-- Boot.
start_at(game_data.startup_scene or "title", nil)

function playdate.update()
    local now = playdate.getCurrentTimeMilliseconds()
    local dt = (now - last_time_ms) / 1000.0
    last_time_ms = now
    if dt < 0 then dt = 0 end
    if dt > 0.1 then dt = 0.1 end  -- clamp on big pauses

    Input.update()
    scene_transition.update(dt)
    if not scene_transition.is_active() then
        scene_manager.update(dt)
    end
    playdate.timer.updateTimers()
    gfx.sprite.update()
    debug_overlay.draw()
    scene_transition.draw()
end
