-- sdk_runtime_lua/scene_transition.lua
-- Ported from HAKCD source/systems/scene_transition.lua.
-- Fullscreen 1-bit dither fade transition between scenes.
--
-- Timing (ms):  fade_out 250 / hold 100 / fade_in 250 = 600 total
--
-- API:
--   scene_transition.start(target_id, spawn_pos, on_complete)
--   scene_transition.update(dt)
--   scene_transition.draw()
--   scene_transition.is_active() -> bool
--   scene_transition.get_phase() -> "idle" | "fade_out" | "hold" | "fade_in"
--
-- on_complete fires exactly once at the apex (between fade_out and fade_in).

local gfx <const> = playdate.graphics

local M = {}

local FADE_OUT_DURATION <const> = 0.25
local HOLD_DURATION     <const> = 0.10
local FADE_IN_DURATION  <const> = 0.25
local SCREEN_W          <const> = 400
local SCREEN_H          <const> = 240

local state = {
    phase = "idle", elapsed = 0,
    target_id = nil, spawn_pos = nil, on_complete = nil, fired = false
}

function M.start(target_id, spawn_pos, on_complete)
    state.phase = "fade_out"
    state.elapsed = 0
    state.target_id = target_id
    state.spawn_pos = spawn_pos
    state.on_complete = on_complete
    state.fired = false
end

function M.is_active() return state.phase ~= "idle" end
function M.get_phase() return state.phase end

function M.update(dt)
    if state.phase == "idle" then return end
    dt = dt or 0
    state.elapsed = state.elapsed + dt
    if state.phase == "fade_out" then
        if state.elapsed >= FADE_OUT_DURATION then
            state.phase = "hold"; state.elapsed = state.elapsed - FADE_OUT_DURATION
            if not state.fired then
                state.fired = true
                if type(state.on_complete) == "function" then
                    state.on_complete(state.target_id, state.spawn_pos)
                end
            end
        end
    elseif state.phase == "hold" then
        if state.elapsed >= HOLD_DURATION then
            state.phase = "fade_in"; state.elapsed = state.elapsed - HOLD_DURATION
        end
    elseif state.phase == "fade_in" then
        if state.elapsed >= FADE_IN_DURATION then
            state.phase = "idle"; state.elapsed = 0
            state.target_id = nil; state.spawn_pos = nil
            state.on_complete = nil; state.fired = false
        end
    end
end

local function compute_opacity()
    if state.phase == "fade_out" then
        local t = state.elapsed / FADE_OUT_DURATION
        return math.max(0, math.min(1, t))
    elseif state.phase == "hold" then
        return 1.0
    elseif state.phase == "fade_in" then
        local t = state.elapsed / FADE_IN_DURATION
        return 1.0 - math.max(0, math.min(1, t))
    end
    return 0.0
end

function M.draw()
    if state.phase == "idle" then return end
    local opacity = compute_opacity()
    if opacity <= 0 then return end
    local dither = math.max(0, math.min(1, 1.0 - opacity))
    gfx.setColor(gfx.kColorBlack)
    gfx.setDitherPattern(dither, gfx.image.kDitherTypeBayer4x4)
    gfx.fillRect(0, 0, SCREEN_W, SCREEN_H)
    gfx.setDitherPattern(0)
    gfx.setColor(gfx.kColorBlack)
end

_G.scene_transition = M
return M
