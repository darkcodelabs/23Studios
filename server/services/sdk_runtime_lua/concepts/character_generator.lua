-- systems/character_generator.lua
-- Pure logic for the CHARACTER GENERATOR scene. No SDK draw calls --
-- the scene drives ticks + crank input and reads state for rendering.
--
-- DECRYPT-THE-BLOCKCHAIN model: each of the 4 slots auto-cycles for
-- exactly 5 seconds (5000 ms) and then auto-locks. Total sequence is
-- ~20 seconds. The crank is INPUT BUT NOT GATING -- it just makes the
-- current slot's value cycle faster while the 5s timer counts down
-- regardless. Pressing A snap-locks the current slot early; B during
-- the sequence cancels the entire creation.
--
-- Modes:
--   "slot_cycle"     -- one specific slot (self.active_slot_index in
--                       1..4) is auto-cycling. Internal timer counts
--                       0..5000 ms; at 5000 the slot locks and we
--                       advance to the next slot. After slot 4 locks
--                       -> mode = "locked_preview".
--   "locked_preview" -- all 4 done; awaiting A (commit) / B (restart).
--   "cancelled"      -- internal flag the scene reads to pop without
--                       writing save_state.
--
-- API (charter):
--   character_generator.new()        -> instance starting in slot_cycle
--                                       mode with active_slot_index = 1
--   :tick(dt_seconds)                -> advances the active slot's 5s
--                                       timer; cycles the value every
--                                       ~100 ms (every frame while
--                                       cranking, for extra chaos).
--                                       Locks at 5000 ms and bumps the
--                                       active slot index.
--   :on_crank_change(degrees)        -> pumps in extra random pool
--                                       advances on the active slot
--                                       (visual chaos) but does NOT
--                                       affect the 5-second timer.
--   :on_a_press()                    -> in slot_cycle: snap-locks the
--                                       active slot and advances.
--                                       Returns "lock". In
--                                       locked_preview: returns
--                                       "commit" -- caller writes
--                                       save_state.
--   :on_b_press()                    -> in slot_cycle: cancels
--                                       (mode = "cancelled"). Returns
--                                       "cancel". In locked_preview:
--                                       restarts the sequence
--                                       (slot_cycle, slot 1, indices
--                                       re-randomized). Returns
--                                       "restart".
--   :get_mode()                      -> "slot_cycle"|"locked_preview"|
--                                       "cancelled"
--   :get_active_slot_name()          -> "handle"|"alignment"|"origin"|
--                                       "specialty"|nil
--   :get_slot_value(slot)            -> pool entry (string or table)
--   :get_slot_id(slot)               -> canonical id string
--   :is_slot_locked(slot)            -> true if active_slot_index has
--                                       already passed this slot
--   :get_active_progress()           -> 0..1 within the 5-second
--                                       window of the active slot
--   :get_click_event_count()         -> rising-edge counter for the
--                                       scene's SFX layer (every value
--                                       cycle bumps this; scene
--                                       rate-limits to "click" SFX).
--   :get_lock_event_count()          -> rising-edge counter; bumps on
--                                       every slot lock so the scene
--                                       can fire the kombo_hit chime.
--   :commit()                        -> { handle, alignment_id,
--                                          origin_id, specialty_id }

local M = {}

local SLOTS = { "handle", "alignment", "origin", "specialty" }

local SLOT_POOL_KEY = {
    handle    = "handles",
    alignment = "alignments",
    origin    = "origins",
    specialty = "specialties",
}

-- Each slot cycles for exactly this many milliseconds before auto-lock.
-- 4 slots x 5000 ms = ~20-second sequence.
local SLOT_WINDOW_MS = 5000

-- Time between auto-cycles of the active slot's value while NOT
-- cranking. Tuned for the "decrypting the blockchain" strobe -- fast
-- enough to read as chaos, slow enough that the scene's rate-limited
-- click SFX doesn't sound like a machine gun.
local AUTO_CYCLE_MS = 100

local function pool_for(slot)
    local pools = _G.character_pools
    if not pools then return nil end
    local key = SLOT_POOL_KEY[slot]
    if not key then return nil end
    return pools[key]
end

local function pool_size(slot)
    local pool = pool_for(slot)
    if not pool then return 1 end
    local n = #pool
    if n < 1 then return 1 end
    return n
end

local function random_index(slot)
    return math.random(1, pool_size(slot))
end

-- ---------------------------------------------------------------------
-- Construction
-- ---------------------------------------------------------------------

local function reset_to_slot_cycle(instance)
    instance.mode               = "slot_cycle"
    instance.active_slot_index  = 1
    instance.slot_elapsed_ms    = 0
    instance.cycle_accum_ms     = 0
    instance.index = {
        handle    = random_index("handle"),
        alignment = random_index("alignment"),
        origin    = random_index("origin"),
        specialty = random_index("specialty"),
    }
    instance.locked = {
        handle    = false,
        alignment = false,
        origin    = false,
        specialty = false,
    }
end

function M.new()
    -- Seed once per generator instance.
    if playdate and playdate.getCurrentTimeMilliseconds then
        math.randomseed(playdate.getCurrentTimeMilliseconds())
    end

    local instance = {
        -- click_events / lock_events are rising-edge counters; scene
        -- polls and fires SFX on each new tick.
        click_events = 0,
        lock_events  = 0,
    }
    reset_to_slot_cycle(instance)
    return setmetatable(instance, { __index = M })
end

-- ---------------------------------------------------------------------
-- Slot accessors
-- ---------------------------------------------------------------------

function M:get_slot_value(slot)
    local pool = pool_for(slot)
    if not pool then return nil end
    local i = self.index[slot] or 1
    if i < 1 then i = 1 end
    if i > #pool then i = #pool end
    return pool[i]
end

function M:get_slot_id(slot)
    local v = self:get_slot_value(slot)
    if v == nil then return "" end
    if type(v) == "string" then return v end       -- handles
    if type(v) == "table"  then return v.id or "" end
    return tostring(v)
end

function M:get_mode()
    return self.mode
end

function M:get_active_slot_name()
    if self.mode ~= "slot_cycle" then return nil end
    local i = self.active_slot_index or 0
    if i < 1 or i > #SLOTS then return nil end
    return SLOTS[i]
end

function M:is_slot_locked(slot)
    return self.locked[slot] == true
end

function M:get_active_progress()
    if self.mode ~= "slot_cycle" then return 0 end
    local p = (self.slot_elapsed_ms or 0) / SLOT_WINDOW_MS
    if p < 0 then p = 0 end
    if p > 1 then p = 1 end
    return p
end

function M:get_click_event_count()
    return self.click_events
end

function M:get_lock_event_count()
    return self.lock_events
end

-- Internal: cycle the active slot's index to a new random pool entry.
-- Bumps click_events so the scene can fire a (rate-limited) click SFX.
local function cycle_active_slot(self)
    local slot = self:get_active_slot_name()
    if slot == nil then return end
    local n = pool_size(slot)
    if n < 1 then return end
    local cur = self.index[slot] or 1
    local nxt
    if n == 1 then
        nxt = 1
    else
        -- Pick any index OTHER than the current one so the value
        -- visibly changes every cycle (the player needs to see chaos,
        -- not a stuck slot).
        nxt = math.random(1, n - 1)
        if nxt >= cur then nxt = nxt + 1 end
    end
    self.index[slot] = nxt
    self.click_events = self.click_events + 1
end

-- Internal: lock the active slot and advance to the next one. If we
-- just locked slot 4, transition to locked_preview.
local function lock_active_and_advance(self)
    local slot = self:get_active_slot_name()
    if slot ~= nil then
        self.locked[slot] = true
        self.lock_events  = self.lock_events + 1
    end
    self.active_slot_index = (self.active_slot_index or 1) + 1
    self.slot_elapsed_ms   = 0
    self.cycle_accum_ms    = 0
    if self.active_slot_index > #SLOTS then
        self.mode = "locked_preview"
    end
end

-- ---------------------------------------------------------------------
-- Frame ticks
-- ---------------------------------------------------------------------

function M:tick(dt_seconds)
    if self.mode ~= "slot_cycle" then return end
    local dt_ms = (dt_seconds or 0) * 1000.0
    if dt_ms < 0 then dt_ms = 0 end

    self.slot_elapsed_ms = (self.slot_elapsed_ms or 0) + dt_ms
    self.cycle_accum_ms  = (self.cycle_accum_ms  or 0) + dt_ms

    -- Cycle the active slot's value every AUTO_CYCLE_MS so the scene
    -- has continuous strobe motion to render.
    while self.cycle_accum_ms >= AUTO_CYCLE_MS do
        self.cycle_accum_ms = self.cycle_accum_ms - AUTO_CYCLE_MS
        cycle_active_slot(self)
    end

    -- Hit the 5-second auto-lock.
    if self.slot_elapsed_ms >= SLOT_WINDOW_MS then
        lock_active_and_advance(self)
    end
end

function M:on_crank_change(degrees)
    if self.mode ~= "slot_cycle" then return end
    if degrees == nil then return end
    local mag = math.abs(degrees)
    if mag < 0.5 then return end

    -- The crank does NOT advance the 5s timer. It just pumps extra
    -- pool advances into the current slot for visual chaos. Stronger
    -- cranks = more pumps per frame; 5 degrees per pump keeps a
    -- vigorous crank from filling the entire pool ~60 times per
    -- second.
    local pumps = math.floor(mag / 5)
    if pumps < 1 then pumps = 1 end
    if pumps > 8 then pumps = 8 end
    for _ = 1, pumps do
        cycle_active_slot(self)
    end
end

-- ---------------------------------------------------------------------
-- Button events. Return a string the scene can switch on.
-- ---------------------------------------------------------------------

function M:on_a_press()
    if self.mode == "slot_cycle" then
        lock_active_and_advance(self)
        return "lock"
    elseif self.mode == "locked_preview" then
        return "commit"
    end
    return nil
end

function M:on_b_press()
    if self.mode == "slot_cycle" then
        self.mode = "cancelled"
        return "cancel"
    elseif self.mode == "locked_preview" then
        reset_to_slot_cycle(self)
        return "restart"
    end
    return nil
end

function M:commit()
    return {
        handle        = self:get_slot_id("handle"),
        alignment_id  = self:get_slot_id("alignment"),
        origin_id     = self:get_slot_id("origin"),
        specialty_id  = self:get_slot_id("specialty"),
    }
end

_G.character_generator = M
return M
