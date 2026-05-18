-- systems/lockpick_logic.lua
-- Pure-logic state machine for the lockpick mini-game. Owns the per-pin
-- binding angles, the player's current crank angle, the tension/mistake
-- count, and the pin-by-pin set order. The scene layer
-- (scenes/demo/minigame_lockpick) feeds crank angle each frame and asks
-- this module to try_set_pin when the player presses A.
--
-- Architectural note: main.lua-bootstrap pattern per
-- docs/PROJECT_RULES.md "Lua module loading". This file owns no
-- dependencies on other systems — it is a pure-data module — so there
-- are no `import` lines and no `local X = import` captures (the
-- forbidden form). It self-binds via `_G.lockpick_logic = M`.
--
-- API (constructor + instance methods):
--   inst = lockpick_logic.new(num_pins, difficulty)
--       num_pins : default 5
--       difficulty : "easy" | "normal" | "hard"
--                    Sets binding window width (degrees) and the per-
--                    mistake tension cost. Threshold is always 1.0
--                    (alarm fires when tension >= 1.0).
--                       easy   : window = 30 deg, tension/mistake = 0.50 (2 strikes)
--                       normal : window = 15 deg, tension/mistake = 0.34 (3 strikes)
--                       hard   : window =  8 deg, tension/mistake = 0.50 (2 strikes)
--                    (Hard penalizes harder via a narrower window AND
--                    a steeper tension curve to widen the difficulty gap.)
--
--   inst:update(dt, crank_angle_degrees)
--       crank_angle_degrees is absolute 0..360, as returned by
--       playdate.getCrankPosition().
--
--   inst:try_set_pin()
--       Attempts to set the current (lowest unset) pin.
--       Returns "set"    when the crank angle is inside that pin's
--                        binding window — the pin advances.
--       Returns "slip"   when the crank angle is outside the window —
--                        tension is increased.
--       Returns "locked" when the lock is already fully picked or the
--                        player is alarmed (no further state change).
--
--   inst:get_pins()       returns array of "set" | "unset" | "binding"
--                          ("binding" is the current pin when the crank
--                          angle is inside its window — UI hint.)
--   inst:get_tension()    returns number 0..1
--   inst:get_current_pin() returns 1-indexed int (first unset pin)
--   inst:is_complete()    returns bool
--   inst:is_alarmed()     returns bool (tension >= 1.0)

local M = {}
M.__index = M

-- ---------------------------------------------------------------------------
-- Difficulty table. Window in degrees, tension per mistake adds to a
-- running 0..1 meter; alarm fires when meter >= 1.0.
-- ---------------------------------------------------------------------------
local DIFFICULTY = {
    easy   = { window = 30, tension_per_mistake = 0.50 },
    normal = { window = 15, tension_per_mistake = 0.34 },
    hard   = { window =  8, tension_per_mistake = 0.50 },
}

-- Smallest signed difference between two angles in degrees (result is
-- in (-180, 180]).  Used to compare crank position to each pin's
-- binding angle modulo 360.
local function angle_delta(a, b)
    local d = (a - b) % 360
    if d > 180 then d = d - 360 end
    return d
end

local function clamp(v, lo, hi)
    if v < lo then return lo end
    if v > hi then return hi end
    return v
end

-- ---------------------------------------------------------------------------
-- Constructor.
-- ---------------------------------------------------------------------------
function M.new(num_pins, difficulty)
    local self = setmetatable({}, M)

    self.num_pins = num_pins or 5
    if self.num_pins < 1 then self.num_pins = 1 end

    local diff_key = difficulty or "normal"
    local diff_cfg = DIFFICULTY[diff_key] or DIFFICULTY.normal
    self.difficulty           = diff_key
    self.window_deg           = diff_cfg.window
    self.tension_per_mistake  = diff_cfg.tension_per_mistake

    -- Pin binding angles, randomized at construction. The pin set order
    -- is fixed (1..N); the player just has to find each angle.
    self.binding_angles = {}
    for i = 1, self.num_pins do
        self.binding_angles[i] = math.random() * 360
    end

    self.pin_set       = {}                  -- pin_set[i] = bool
    self.current_pin   = 1
    self.tension       = 0
    self.crank_angle   = 0
    self.alarmed       = false

    return self
end

-- ---------------------------------------------------------------------------
-- Per-frame update. Caller is responsible for reading
-- playdate.getCrankPosition() and forwarding the absolute angle.
-- ---------------------------------------------------------------------------
function M:update(dt, crank_angle_degrees)
    -- dt currently unused; we keep the param so the scene layer can
    -- stay consistent with other system :update(dt, ...) calls and a
    -- future tension-decay-over-time mechanic can land without an API
    -- change.
    self.crank_angle = (crank_angle_degrees or 0) % 360
end

-- ---------------------------------------------------------------------------
-- Player input: try to set the current pin.
-- ---------------------------------------------------------------------------
function M:try_set_pin()
    if self.alarmed then return "locked" end
    if self:is_complete() then return "locked" end

    local idx = self.current_pin
    local binding = self.binding_angles[idx]
    if binding == nil then return "locked" end

    local delta = math.abs(angle_delta(self.crank_angle, binding))
    if delta <= self.window_deg then
        self.pin_set[idx] = true
        self.current_pin  = idx + 1
        return "set"
    else
        self.tension = clamp(self.tension + self.tension_per_mistake, 0, 1)
        if self.tension >= 1.0 then
            self.alarmed = true
        end
        return "slip"
    end
end

-- ---------------------------------------------------------------------------
-- State accessors.
-- ---------------------------------------------------------------------------
function M:get_pins()
    local out = {}
    for i = 1, self.num_pins do
        if self.pin_set[i] then
            out[i] = "set"
        elseif i == self.current_pin and not self.alarmed
               and self.binding_angles[i]
               and math.abs(angle_delta(self.crank_angle, self.binding_angles[i])) <= self.window_deg
        then
            out[i] = "binding"
        else
            out[i] = "unset"
        end
    end
    return out
end

function M:get_tension()
    return self.tension
end

function M:get_current_pin()
    return self.current_pin
end

function M:is_complete()
    return self.current_pin > self.num_pins
end

function M:is_alarmed()
    return self.alarmed
end

-- ---------------------------------------------------------------------------
-- Debug / testing helpers (not in the public API but harmless to expose).
-- ---------------------------------------------------------------------------
function M:get_binding_angle(i)
    return self.binding_angles[i]
end

function M:get_crank_angle()
    return self.crank_angle
end

_G.lockpick_logic = M
return M
