-- systems/kombo_detector.lua
-- Circular 12-slot input buffer. Matches against kombos.lua entries
-- scoped to active_tool ("all" entries always considered). Resets
-- after 2 s of input idle.
--
-- Tokens (case-insensitive):
--   "up", "down", "left", "right", "A", "B"
--   "crank_cw", "crank_ccw", "crank_full_turn"

local M = {}
M.__index = M

local BUFFER_SIZE = 12
local IDLE_MS = 2000

local function now_ms()
    return playdate.getCurrentTimeMilliseconds()
end

function M.new(kombo_list)
    local self = setmetatable({}, M)
    self.kombos = kombo_list or {}
    self.buf = {}
    self.last_input = 0
    self.active_tool = nil
    self.on_match = nil
    return self
end

function M:set_active_tool(id)
    self.active_tool = id
end

function M:set_on_match(fn)
    self.on_match = fn
end

function M:reset()
    self.buf = {}
end

local function tokens_match(seq, tail)
    if #seq > #tail then return false end
    local offset = #tail - #seq
    for i = 1, #seq do
        if seq[i] ~= tail[offset + i] then return false end
    end
    return true
end

function M:push(token)
    if token == nil then return nil end
    local t = now_ms()
    if t - self.last_input > IDLE_MS then
        self.buf = {}
    end
    self.last_input = t

    table.insert(self.buf, token)
    if #self.buf > BUFFER_SIZE then
        table.remove(self.buf, 1)
    end

    for _, k in ipairs(self.kombos) do
        local applies = (k.applies_to == "all") or (k.applies_to == self.active_tool)
        if applies and tokens_match(k.sequence, self.buf) then
            if self.on_match then self.on_match(k) end
            self:reset()
            return k
        end
    end
    return nil
end

_G.kombo_detector = M
return M
