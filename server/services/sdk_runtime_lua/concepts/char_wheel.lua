-- systems/char_wheel.lua
-- Crank-driven character entry component for coin phrase submission.
--
-- API:
--   wheel = char_wheel.new(opts)
--     opts: max_length, allowed_chars (default A-Z 0-9 + space hyphen apostrophe),
--           x, y, width
--   :update()                                  per-frame tick (no dt needed)
--   :draw()                                    paints current state at (x, y, w)
--   :crank_input(degrees_delta)                advances current letter
--   :button_a()                                commit current letter, advance pos
--   :button_b()                                backspace
--   :get_value()                               returns current entered string
--   :clear()                                   resets to empty
--
-- UI: a 5-char window showing the buffer with the current position
-- bracketed. Crank rotates the alphabet ring under the bracket. Up/Down
-- d-pad jumps to next/prev block (alpha / num / special) - handled by
-- the parent scene via :jump_block(dir).
--
-- Visual reference: old console name-entry screens.

local gfx <const> = playdate.graphics

local M = {}
M.__index = M

local CRANK_QUANTUM = 18  -- degrees per character advance (20 chars/rev-ish)

local function build_default_chars()
    local out = {}
    for c = string.byte("A"), string.byte("Z") do
        table.insert(out, string.char(c))
    end
    for c = string.byte("0"), string.byte("9") do
        table.insert(out, string.char(c))
    end
    table.insert(out, " ")
    table.insert(out, "-")
    table.insert(out, "'")
    return out
end

-- Three blocks for up/down d-pad jump: alpha (1..26), num (27..36),
-- special (37..39).
local BLOCKS = { alpha = 1, num = 27, special = 37 }
local BLOCK_ORDER = { "alpha", "num", "special" }

local function current_block(self)
    if self.cursor_char <= 26 then return "alpha" end
    if self.cursor_char <= 36 then return "num"   end
    return "special"
end

function M.new(opts)
    opts = opts or {}
    local self = setmetatable({}, M)
    self.chars = opts.allowed_chars or build_default_chars()
    self.max_length = opts.max_length or 32
    self.x = opts.x or 0
    self.y = opts.y or 0
    self.width = opts.width or 240
    self.buffer = {}             -- list of single-char strings
    self.cursor_char = 1         -- index into self.chars
    self.crank_accum = 0
    return self
end

function M:get_value()
    return table.concat(self.buffer)
end

function M:clear()
    self.buffer = {}
    self.cursor_char = 1
    self.crank_accum = 0
end

function M:button_a()
    if #self.buffer >= self.max_length then return end
    table.insert(self.buffer, self.chars[self.cursor_char])
end

function M:button_b()
    if #self.buffer == 0 then return end
    table.remove(self.buffer)
end

function M:jump_block(dir)
    local cur = current_block(self)
    local idx = 1
    for i, name in ipairs(BLOCK_ORDER) do
        if name == cur then idx = i end
    end
    if dir == "up" then
        idx = idx - 1
        if idx < 1 then idx = #BLOCK_ORDER end
    else
        idx = idx + 1
        if idx > #BLOCK_ORDER then idx = 1 end
    end
    self.cursor_char = BLOCKS[BLOCK_ORDER[idx]]
end

function M:crank_input(delta)
    if delta == nil or delta == 0 then return end
    self.crank_accum = self.crank_accum + delta
    while self.crank_accum >= CRANK_QUANTUM do
        self.cursor_char = self.cursor_char + 1
        if self.cursor_char > #self.chars then self.cursor_char = 1 end
        self.crank_accum = self.crank_accum - CRANK_QUANTUM
    end
    while self.crank_accum <= -CRANK_QUANTUM do
        self.cursor_char = self.cursor_char - 1
        if self.cursor_char < 1 then self.cursor_char = #self.chars end
        self.crank_accum = self.crank_accum + CRANK_QUANTUM
    end
end

function M:update()
    -- No internal animation yet; reserved for future blink/cursor pulse.
end

function M:draw()
    local x, y, w = self.x, self.y, self.width
    gfx.setColor(gfx.kColorWhite)
    gfx.drawRect(x, y, w, 28)

    local entered = self:get_value()
    gfx.setImageDrawMode(gfx.kDrawModeFillWhite)
    gfx.drawText("> " .. entered, x + 4, y + 6)
    gfx.setImageDrawMode(gfx.kDrawModeCopy)

    -- Picker strip below: shows surrounding chars with current bracketed.
    local picker_y = y + 32
    gfx.drawRect(x, picker_y, w, 22)
    gfx.setImageDrawMode(gfx.kDrawModeFillWhite)
    local view = {}
    for offset = -2, 2 do
        local idx = ((self.cursor_char - 1 + offset) % #self.chars) + 1
        local c = self.chars[idx]
        if c == " " then c = "_" end
        if offset == 0 then
            table.insert(view, "[" .. c .. "]")
        else
            table.insert(view, " " .. c .. " ")
        end
    end
    gfx.drawText("crank: " .. table.concat(view, ""), x + 4, picker_y + 4)
    gfx.setImageDrawMode(gfx.kDrawModeCopy)
end

_G.char_wheel = M
return M
