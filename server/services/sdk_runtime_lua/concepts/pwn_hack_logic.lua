-- systems/pwn_hack_logic.lua
-- Pure-logic state machine for the PwnGlove keycard-clone mini-game.
-- Three timed stages, advanced by player input passed in from the scene:
--
--   1. SCAN  (5s)  Crank slowly to fill a frequency-lock meter. The
--                  more crank rotation the player accumulates the faster
--                  it fills. Time-out without lock = failed.
--   2. ALIGN (8s)  A queue of 6-8 button prompts moves from spawn time
--                  toward a "press now" zone. Player must press each
--                  matching button within +/- 0.4s of when it crosses
--                  the zone. Missing more than 2 prompts = failed.
--   3. CLONE (5s)  Hold A steady. Progress bar fills over 5 seconds of
--                  continuous hold. Release = progress resets to 0.
--                  Reach 100% = complete.
--
-- Architectural note: this module follows the main.lua bootstrap pattern
-- per docs/PROJECT_RULES.md "Lua module loading". It has no other-system
-- dependencies (pure data + math) so it carries no `import` lines and no
-- `local X = import` captures. It self-binds via `_G.pwn_hack_logic = M`.
--
-- API (constructor + instance methods):
--   inst = pwn_hack_logic.new()
--
--   inst:update(dt, input)
--       input is a table:
--         { crank_change   = <degrees this frame, signed>,
--           just_pressed   = { A = bool, B = bool, up=..., down=...,
--                              left=..., right=...,
--                              crank_cw = bool, crank_ccw = bool },
--           is_pressed     = { A = bool, ... } }
--       Missing fields are treated as false / 0.
--
--   inst:get_stage()        -> "scan" | "align" | "clone" | "complete" | "failed"
--   inst:get_progress()     -> 0..1 progress for the current stage
--   inst:get_next_prompt()  -> token string of the next align prompt
--                              currently inside the press window, or nil
--   inst:get_align_queue()  -> array of { token=..., time_to_press=... }
--                              for all upcoming/active prompts, sorted by
--                              earliest first. time_to_press is seconds
--                              (negative = already past the zone).
--   inst:is_complete()      -> bool
--   inst:is_failed()        -> bool

local M = {}
M.__index = M

-- ---------------------------------------------------------------------------
-- Tunables. Adjust here, not in the per-instance state.
-- ---------------------------------------------------------------------------
local SCAN_TIME_LIMIT          = 5.0     -- seconds before SCAN times out
local SCAN_DEGREES_TO_LOCK     = 540     -- ~1.5 full crank rotations to fill

local ALIGN_TIME_LIMIT         = 8.0     -- seconds before ALIGN times out
local ALIGN_PROMPT_COUNT       = 7       -- tokens in the align queue (6-8 range)
local ALIGN_PROMPT_TRAVEL_TIME = 2.2     -- seconds from spawn to zone
local ALIGN_FIRST_SPAWN_OFFSET = 0.6     -- first prompt spawns this late
local ALIGN_PROMPT_INTERVAL    = 0.9     -- seconds between successive spawns
local ALIGN_PRESS_WINDOW       = 0.4     -- +/- seconds tolerance
local ALIGN_MAX_MISSES         = 2       -- 3rd miss fails the stage

local CLONE_HOLD_TIME          = 5.0     -- seconds of continuous A-hold
local CLONE_TIME_LIMIT         = 30.0    -- overall stage cap as safety net

local ALIGN_TOKENS = {
    "A", "B", "up", "down", "left", "right", "crank_cw", "crank_ccw",
}

-- ---------------------------------------------------------------------------
-- Helpers.
-- ---------------------------------------------------------------------------
local function clamp(v, lo, hi)
    if v < lo then return lo end
    if v > hi then return hi end
    return v
end

local function pick_token()
    return ALIGN_TOKENS[math.random(1, #ALIGN_TOKENS)]
end

-- Build the align prompt queue at stage entry. Each entry has a `token`
-- and an absolute `press_at` (seconds from align-stage start).
local function build_align_queue()
    local q = {}
    for i = 1, ALIGN_PROMPT_COUNT do
        local press_at = ALIGN_FIRST_SPAWN_OFFSET
                       + ALIGN_PROMPT_TRAVEL_TIME
                       + (i - 1) * ALIGN_PROMPT_INTERVAL
        q[i] = {
            token       = pick_token(),
            press_at    = press_at,
            resolved    = false,    -- once true, ignore in match scan
            hit         = false,    -- becomes true on successful press
        }
    end
    return q
end

-- Map an input table into a per-token-press boolean. Used in ALIGN to
-- detect when the player has pressed the token within the window.
local function input_press_for(input, token)
    if not input then return false end
    if token == "crank_cw" then
        local c = input.crank_change or 0
        return c > 8   -- ~8 degrees in one frame = clear CW tick
    elseif token == "crank_ccw" then
        local c = input.crank_change or 0
        return c < -8
    else
        local jp = input.just_pressed or {}
        return jp[token] == true
    end
end

-- Map any input press at all (used to detect "wrong button" miss). Returns
-- the offending token name or nil.
local function any_press_token(input)
    if not input then return nil end
    local jp = input.just_pressed or {}
    if jp.A then return "A" end
    if jp.B then return "B" end
    if jp.up then return "up" end
    if jp.down then return "down" end
    if jp.left then return "left" end
    if jp.right then return "right" end
    local c = input.crank_change or 0
    if c > 8 then return "crank_cw" end
    if c < -8 then return "crank_ccw" end
    return nil
end

-- ---------------------------------------------------------------------------
-- Constructor.
-- ---------------------------------------------------------------------------
function M.new()
    local self = setmetatable({}, M)

    self.stage           = "scan"
    self.stage_elapsed   = 0

    -- SCAN state.
    self.scan_degrees    = 0    -- accumulated abs crank rotation

    -- ALIGN state (populated lazily on entry).
    self.align_queue     = nil
    self.align_misses    = 0

    -- CLONE state.
    self.clone_progress  = 0    -- seconds of consecutive hold so far

    return self
end

-- ---------------------------------------------------------------------------
-- Stage transitions. Centralised so we can fire one-shot setup.
-- ---------------------------------------------------------------------------
function M:_enter_stage(new_stage)
    self.stage         = new_stage
    self.stage_elapsed = 0

    if new_stage == "align" then
        self.align_queue  = build_align_queue()
        self.align_misses = 0
    elseif new_stage == "clone" then
        self.clone_progress = 0
    end
end

function M:_fail()
    self.stage = "failed"
end

function M:_succeed()
    self.stage = "complete"
end

-- ---------------------------------------------------------------------------
-- Per-frame update.
-- ---------------------------------------------------------------------------
function M:update(dt, input)
    dt = dt or 0
    input = input or {}

    if self.stage == "complete" or self.stage == "failed" then
        return
    end

    self.stage_elapsed = self.stage_elapsed + dt

    if self.stage == "scan" then
        self:_update_scan(dt, input)
    elseif self.stage == "align" then
        self:_update_align(dt, input)
    elseif self.stage == "clone" then
        self:_update_clone(dt, input)
    end
end

-- ---------------------------------------------------------------------------
-- SCAN: crank to fill, time-out fails.
-- ---------------------------------------------------------------------------
function M:_update_scan(dt, input)
    local change = input.crank_change or 0
    -- Either direction counts.
    self.scan_degrees = self.scan_degrees + math.abs(change)

    if self.scan_degrees >= SCAN_DEGREES_TO_LOCK then
        self:_enter_stage("align")
        return
    end

    if self.stage_elapsed >= SCAN_TIME_LIMIT then
        self:_fail()
    end
end

-- ---------------------------------------------------------------------------
-- ALIGN: timed token queue.
-- ---------------------------------------------------------------------------
function M:_update_align(dt, input)
    local t = self.stage_elapsed
    local queue = self.align_queue or {}

    -- Resolve any prompts whose window has now passed without a hit.
    for i = 1, #queue do
        local p = queue[i]
        if not p.resolved and t > p.press_at + ALIGN_PRESS_WINDOW then
            p.resolved = true
            p.hit      = false
            self.align_misses = self.align_misses + 1
        end
    end

    -- See whether the player pressed anything this frame and try to
    -- match it against an active prompt (one inside its press window).
    local pressed = any_press_token(input)
    if pressed then
        local matched = false
        for i = 1, #queue do
            local p = queue[i]
            if not p.resolved
               and t >= (p.press_at - ALIGN_PRESS_WINDOW)
               and t <= (p.press_at + ALIGN_PRESS_WINDOW)
               and input_press_for(input, p.token)
            then
                p.resolved = true
                p.hit      = true
                matched    = true
                break
            end
        end
        if not matched then
            -- Wrong button counts as a miss (player is hashing).
            self.align_misses = self.align_misses + 1
        end
    end

    if self.align_misses > ALIGN_MAX_MISSES then
        self:_fail()
        return
    end

    if self.stage_elapsed >= ALIGN_TIME_LIMIT then
        self:_fail()
        return
    end

    -- All prompts resolved + at least one hit (we're in spec only if
    -- misses <= MAX). Advance to clone.
    local all_resolved = true
    for i = 1, #queue do
        if not queue[i].resolved then
            all_resolved = false
            break
        end
    end
    if all_resolved then
        self:_enter_stage("clone")
    end
end

-- ---------------------------------------------------------------------------
-- CLONE: hold A for CLONE_HOLD_TIME continuous seconds.
-- ---------------------------------------------------------------------------
function M:_update_clone(dt, input)
    local held = false
    if input.is_pressed then
        held = input.is_pressed.A == true
    end

    if held then
        self.clone_progress = self.clone_progress + dt
        if self.clone_progress >= CLONE_HOLD_TIME then
            self:_succeed()
            return
        end
    else
        -- Release resets progress per spec.
        self.clone_progress = 0
    end

    if self.stage_elapsed >= CLONE_TIME_LIMIT then
        self:_fail()
    end
end

-- ---------------------------------------------------------------------------
-- Accessors.
-- ---------------------------------------------------------------------------
function M:get_stage()
    return self.stage
end

function M:get_progress()
    if self.stage == "scan" then
        return clamp(self.scan_degrees / SCAN_DEGREES_TO_LOCK, 0, 1)
    elseif self.stage == "align" then
        local queue = self.align_queue or {}
        if #queue == 0 then return 0 end
        local done = 0
        for i = 1, #queue do
            if queue[i].resolved then done = done + 1 end
        end
        return clamp(done / #queue, 0, 1)
    elseif self.stage == "clone" then
        return clamp(self.clone_progress / CLONE_HOLD_TIME, 0, 1)
    elseif self.stage == "complete" then
        return 1
    end
    return 0
end

function M:get_next_prompt()
    if self.stage ~= "align" then return nil end
    local t = self.stage_elapsed
    local queue = self.align_queue or {}
    for i = 1, #queue do
        local p = queue[i]
        if not p.resolved
           and t >= (p.press_at - ALIGN_PRESS_WINDOW)
           and t <= (p.press_at + ALIGN_PRESS_WINDOW)
        then
            return p.token
        end
    end
    return nil
end

function M:get_align_queue()
    local out = {}
    if self.stage ~= "align" then return out end
    local t = self.stage_elapsed
    local queue = self.align_queue or {}
    for i = 1, #queue do
        local p = queue[i]
        if not p.resolved then
            out[#out + 1] = {
                token         = p.token,
                time_to_press = p.press_at - t,
            }
        end
    end
    table.sort(out, function(a, b) return a.time_to_press < b.time_to_press end)
    return out
end

function M:is_complete()
    return self.stage == "complete"
end

function M:is_failed()
    return self.stage == "failed"
end

-- ---------------------------------------------------------------------------
-- Debug accessors (not part of the public API contract; harmless to expose).
-- ---------------------------------------------------------------------------
function M:get_align_misses()
    return self.align_misses
end

function M:get_align_travel_time()
    return ALIGN_PROMPT_TRAVEL_TIME
end

_G.pwn_hack_logic = M
return M
