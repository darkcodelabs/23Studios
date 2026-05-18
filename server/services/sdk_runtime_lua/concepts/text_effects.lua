-- systems/text_effects.lua
-- Returns updater closures for animated text. Each updater is called
-- per-frame from a scene's :update() and exposes `:draw(x, y)` plus
-- `:is_done()` for transition gating.
--
-- Effects:
--   typewriter(text, opts)   reveals one char every ~30 ms (opts.ms_per_char)
--   decrypt(text, opts)      scramble window slides L->R locking chars
--   scattered(text, opts)    each char lerps from random pos to target

local gfx <const> = playdate.graphics

local M = {}

local DEFAULT_TYPEWRITER_MS = 30
local DEFAULT_DECRYPT_MS = 25
local DEFAULT_SCATTER_MS = 500

local SCRAMBLE_CHARS = "!@#$%^&*()_+-=[]{}|;:,.<>/?~`"

local function now_ms()
    return playdate.getCurrentTimeMilliseconds()
end

local function random_scramble_char()
    local idx = math.random(1, #SCRAMBLE_CHARS)
    return SCRAMBLE_CHARS:sub(idx, idx)
end

local Typewriter = {}
Typewriter.__index = Typewriter

function Typewriter:update()
    if self.done then return end
    local elapsed = now_ms() - self.start
    local n = math.floor(elapsed / self.ms_per_char)
    if n >= #self.text then
        n = #self.text
        self.done = true
    end
    self.visible = self.text:sub(1, n)
end

function Typewriter:draw(x, y)
    gfx.setImageDrawMode(gfx.kDrawModeFillWhite)
    gfx.drawText(self.visible, x, y)
    gfx.setImageDrawMode(gfx.kDrawModeCopy)
end

function Typewriter:is_done() return self.done end

function Typewriter:reset()
    self.start = now_ms()
    self.visible = ""
    self.done = false
end

function M.typewriter(text, opts)
    opts = opts or {}
    local t = setmetatable({}, Typewriter)
    t.text = text or ""
    t.visible = ""
    t.ms_per_char = opts.ms_per_char or DEFAULT_TYPEWRITER_MS
    t.start = now_ms()
    t.done = (#t.text == 0)
    return t
end

local Decrypt = {}
Decrypt.__index = Decrypt

function Decrypt:update()
    if self.done then return end
    local elapsed = now_ms() - self.start
    local locked = math.floor(elapsed / self.ms_per_char)
    if locked >= #self.text then
        locked = #self.text
        self.done = true
    end
    local out = self.text:sub(1, locked)
    for i = locked + 1, #self.text do
        out = out .. random_scramble_char()
    end
    self.visible = out
end

function Decrypt:draw(x, y)
    gfx.setImageDrawMode(gfx.kDrawModeFillWhite)
    gfx.drawText(self.visible, x, y)
    gfx.setImageDrawMode(gfx.kDrawModeCopy)
end

function Decrypt:is_done() return self.done end

function M.decrypt(text, opts)
    opts = opts or {}
    local d = setmetatable({}, Decrypt)
    d.text = text or ""
    d.visible = string.rep(" ", #d.text)
    d.ms_per_char = opts.ms_per_char or DEFAULT_DECRYPT_MS
    d.start = now_ms()
    d.done = (#d.text == 0)
    return d
end

local Scattered = {}
Scattered.__index = Scattered

function Scattered:update()
    if self.done then return end
    local elapsed = now_ms() - self.start
    local t = math.min(1.0, elapsed / self.duration_ms)
    self.t = t
    if t >= 1.0 then self.done = true end
end

function Scattered:draw(x, y)
    gfx.setImageDrawMode(gfx.kDrawModeFillWhite)
    for i, c in ipairs(self.chars) do
        local px = c.tx + (1.0 - self.t) * c.ox
        local py = c.ty + (1.0 - self.t) * c.oy
        gfx.drawText(c.ch, x + px, y + py)
    end
    gfx.setImageDrawMode(gfx.kDrawModeCopy)
end

function Scattered:is_done() return self.done end

function M.scattered(text, opts)
    opts = opts or {}
    local s = setmetatable({}, Scattered)
    s.text = text or ""
    s.duration_ms = opts.duration_ms or DEFAULT_SCATTER_MS
    s.start = now_ms()
    s.t = 0
    s.done = (#s.text == 0)
    s.chars = {}
    local cw = 8  -- monospace-ish slot width for scatter targets
    for i = 1, #s.text do
        local ch = s.text:sub(i, i)
        table.insert(s.chars, {
            ch = ch,
            tx = (i - 1) * cw,
            ty = 0,
            ox = math.random(-80, 80),
            oy = math.random(-40, 40),
        })
    end
    return s
end

_G.text_effects = M
return M
