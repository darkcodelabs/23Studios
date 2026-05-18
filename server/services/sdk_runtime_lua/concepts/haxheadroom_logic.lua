-- systems/haxheadroom_logic.lua
-- HaxHeadroom "Catch the Wav" game state machine.
--
-- An instance owns:
--   - the current level definition (from haxheadroom_levels)
--   - the 4 dial values (freq/band/rate/delay)
--   - the 4 dial targets (mutable when drift is enabled)
--   - the currently active dial name
--   - a drift accumulator
--
-- API (called by scenes/haxheadroom/catch_the_wav.lua):
--   new(level_number)              -> instance
--   :update(dt)                    advance drift if enabled
--   :on_a_press()                  cycle active dial, skipping LOCKED ones
--   :on_b_press()                  -> bool (true = lock fired, false = error)
--   :on_crank_change(degrees)      apply crank step to the active dial
--   :get_quality()                 -> 0..1 product of per-param quality
--   :get_active_dial()             -> "freq"|"band"|"rate"|"delay"
--   :get_value(name)               -> number
--   :get_target(name)              -> number
--   :get_tolerance(name)           -> 0..1 fraction of range
--   :get_normalized_distance(name) -> 0..1, dist(value,target) / range
--   :is_lock_available()           -> bool
--   :is_dial_locked(name)          -> bool (tolerance == 0 for this level)
--
-- Architectural note: per docs/PROJECT_RULES.md this module never uses
-- `local X = import "..."` captures. It reads haxheadroom_levels as a
-- global, which main.lua binds during bootstrap.

local M = {}

local DIAL_NAMES = { "freq", "band", "rate", "delay" }

-- Drift cadence: ~120 frames @ 60fps = 2 seconds.
local DRIFT_PERIOD_S = 2.0
local DRIFT_FRACTION = 0.01   -- ±1% of range per drift tick

local function clamp(v, lo, hi)
    if v < lo then return lo end
    if v > hi then return hi end
    return v
end

local function range_of(name)
    return haxheadroom_levels.ranges[name]
end

local function snap_to_step(v, range)
    local steps = math.floor((v - range.min) / range.step + 0.5)
    return range.min + steps * range.step
end

-- For a parameter, return tolerance fraction stored on the level def.
local function tolerance_field(name)
    return name .. "_tolerance"
end

local function target_field(name)
    return "target_" .. name
end

-- Pick a random starting value that's at least 30% of the range
-- away from the target so the player has tuning work to do.
local function random_off_tune(target, range)
    local span = range.max - range.min
    local min_dist = span * 0.30
    -- Try a few times to find a value that's far enough off; if the
    -- target is near a boundary, fall back to the farthest end.
    for _ = 1, 8 do
        local v = range.min + math.random() * span
        if math.abs(v - target) >= min_dist then
            return snap_to_step(clamp(v, range.min, range.max), range)
        end
    end
    -- Fallback: pick whichever end is farther from target.
    local lo_dist = math.abs(range.min - target)
    local hi_dist = math.abs(range.max - target)
    local v = (hi_dist > lo_dist) and range.max or range.min
    return snap_to_step(v, range)
end

function M.new(level_number)
    local self = setmetatable({}, { __index = M })

    self.level_number = level_number or 1
    self.level        = haxheadroom_levels[self.level_number]
    assert(self.level, "haxheadroom_logic.new: invalid level " .. tostring(level_number))

    -- Mutable copies of the targets so drift can walk them.
    self.targets = {
        freq  = self.level.target_freq,
        band  = self.level.target_band,
        rate  = self.level.target_rate,
        delay = self.level.target_delay,
    }

    -- Spawn the dials at off-tune positions.
    self.values = {}
    for _, name in ipairs(DIAL_NAMES) do
        self.values[name] = random_off_tune(self.targets[name], range_of(name))
    end

    -- Active dial defaults to the first UNLOCKED one (level 1 has rate
    -- and delay locked, so we don't want the cursor sitting on a dial
    -- that can't be tuned).
    self.active = "freq"
    for _, name in ipairs(DIAL_NAMES) do
        if self.level[tolerance_field(name)] > 0 then
            self.active = name
            break
        end
    end

    self.drift_accumulator = 0.0

    return self
end

function M:get_active_dial()
    return self.active
end

function M:is_dial_locked(name)
    return self.level[tolerance_field(name)] <= 0
end

function M:get_value(name)
    return self.values[name]
end

function M:get_target(name)
    return self.targets[name]
end

function M:get_tolerance(name)
    return self.level[tolerance_field(name)]
end

-- Distance from value to target normalized by the parameter's full range.
function M:get_normalized_distance(name)
    local r = range_of(name)
    local span = r.max - r.min
    if span <= 0 then return 0 end
    local d = math.abs(self.values[name] - self.targets[name])
    if d > span then d = span end
    return d / span
end

-- Per-parameter quality. Locked dials contribute 1.0 (no penalty).
local function per_param_quality(self, name)
    if self:is_dial_locked(name) then
        return 1.0
    end
    local d = self:get_normalized_distance(name)
    local q = 1.0 - d
    if q < 0 then q = 0 end
    return q
end

function M:get_quality()
    local q = 1.0
    for _, name in ipairs(DIAL_NAMES) do
        q = q * per_param_quality(self, name)
    end
    return q
end

function M:is_lock_available()
    for _, name in ipairs(DIAL_NAMES) do
        if not self:is_dial_locked(name) then
            local tol = self.level[tolerance_field(name)]
            if self:get_normalized_distance(name) > tol then
                return false
            end
        end
    end
    return true
end

-- Cycle active dial; skip LOCKED dials so the player can't waste a
-- cycle landing on a dial they can't tune.
function M:on_a_press()
    -- Find current index, then advance until we find an unlocked dial.
    local start_idx = 1
    for i, name in ipairs(DIAL_NAMES) do
        if name == self.active then
            start_idx = i
            break
        end
    end
    for offset = 1, #DIAL_NAMES do
        local idx = ((start_idx - 1 + offset) % #DIAL_NAMES) + 1
        local name = DIAL_NAMES[idx]
        if not self:is_dial_locked(name) then
            self.active = name
            return
        end
    end
    -- Every dial locked (shouldn't happen for a valid level). Leave as-is.
end

function M:on_b_press()
    if self:is_lock_available() then
        return true
    end
    return false
end

-- One crank degree = one step of the active parameter.
function M:on_crank_change(degrees)
    if degrees == nil or degrees == 0 then return end
    local name = self.active
    if self:is_dial_locked(name) then return end
    local r = range_of(name)
    local new_val = self.values[name] + degrees * r.step
    new_val = clamp(new_val, r.min, r.max)
    -- Snap so the displayed integer matches a real step.
    self.values[name] = snap_to_step(new_val, r)
end

-- Drift walks each UNLOCKED target by ±1% of its range every
-- DRIFT_PERIOD_S seconds. Locked targets are pinned because they're
-- treated as already correct.
function M:_drift_tick()
    if not self.level.drift_enabled then return end
    for _, name in ipairs(DIAL_NAMES) do
        if not self:is_dial_locked(name) then
            local r = range_of(name)
            local span = r.max - r.min
            local delta = (math.random() * 2 - 1) * span * DRIFT_FRACTION
            local new_target = clamp(self.targets[name] + delta, r.min, r.max)
            self.targets[name] = snap_to_step(new_target, r)
        end
    end
end

function M:update(dt)
    dt = dt or (1 / 60)
    if self.level.drift_enabled then
        self.drift_accumulator = self.drift_accumulator + dt
        if self.drift_accumulator >= DRIFT_PERIOD_S then
            self.drift_accumulator = self.drift_accumulator - DRIFT_PERIOD_S
            self:_drift_tick()
        end
    end
end

_G.haxheadroom_logic = M
return M
