-- systems/hotspot_navigator.lua
-- Reusable radial / snap-style hotspot navigator. Given a list of
-- hotspot tables (each with x, y, and arbitrary payload fields), the
-- navigator sorts them by polar angle from the screen center and
-- cycles between them as the crank turns — a "radial menu" feel, not
-- a free-cursor feel.
--
-- API:
--   nav = hotspot_navigator.new(hotspot_list)
--   nav:update(dt)             -- per-frame tick (currently no-op,
--                                 kept for symmetry / future easing)
--   nav:crank_input(degrees)   -- forward playdate.getCrankChange()
--   nav:get_current()          -- current hotspot table
--   nav:get_index()            -- 1-based index into the angle-sorted list
--   nav:draw()                 -- draws cursor at current hotspot
--   nav:set_cursor_options(o)  -- forwarded to cursor_renderer.draw
--
-- Hotspots are sorted by angle once at construction. Hotspot order
-- in the input list is preserved as a stable tiebreaker for identical
-- angles (rare; same x and same y relative to center). The 1-based
-- index returned by :get_index() refers to that sorted order.

local M = {}
M.__index = M

-- Screen center. Playdate display is 400x240 → center is (200, 120).
local SCREEN_CX <const> = 200
local SCREEN_CY <const> = 120

-- Crank accumulator threshold: ~40 degrees per hop. Picked as a
-- compromise between input_buffer.lua's 30° kombo quantum (too jittery
-- for a discrete menu cursor) and the ~60° that would feel sluggish
-- with 7 hotspots laid out around 360°. With 7 hotspots the angular
-- spacing averages ~51°, so 40° per hop means one crank-step ≈ one
-- hotspot transition without skipping.
local CRANK_DEG_PER_HOP <const> = 40

local function angle_from_center(hs)
    -- math.atan(y, x) returns angle in [-π, π]. We normalize to
    -- [0, 2π) so sort order corresponds to a clockwise sweep starting
    -- from straight up (negative y on Playdate's screen coords).
    local dx = hs.x - SCREEN_CX
    local dy = hs.y - SCREEN_CY
    local a = math.atan(dy, dx)
    if a < 0 then a = a + 2 * math.pi end
    return a
end

function M.new(hotspot_list)
    assert(type(hotspot_list) == "table", "hotspot_navigator.new: hotspot_list must be a table")

    local sorted = {}
    for i, hs in ipairs(hotspot_list) do
        sorted[i] = {
            hs = hs,
            angle = angle_from_center(hs),
            original_index = i,
        }
    end
    table.sort(sorted, function(a, b)
        if a.angle == b.angle then
            return a.original_index < b.original_index
        end
        return a.angle < b.angle
    end)

    local self = setmetatable({}, M)
    self.hotspots = {}
    for i, wrapper in ipairs(sorted) do
        self.hotspots[i] = wrapper.hs
    end
    self.count = #self.hotspots
    self.index = 1
    self.crank_accum = 0
    self.cursor_options = nil  -- pass-through to cursor_renderer.draw
    return self
end

function M:set_cursor_options(options)
    self.cursor_options = options
end

function M:update(_dt)
    -- Reserved for future per-frame easing (cursor lerp between
    -- hotspots, halo pulse). Intentional no-op for now so the
    -- scene-level update loop has a stable hook.
end

function M:crank_input(degrees_delta)
    if not degrees_delta or degrees_delta == 0 or self.count == 0 then
        return
    end
    self.crank_accum = self.crank_accum + degrees_delta

    while self.crank_accum >= CRANK_DEG_PER_HOP do
        self.index = (self.index % self.count) + 1
        self.crank_accum = self.crank_accum - CRANK_DEG_PER_HOP
    end
    while self.crank_accum <= -CRANK_DEG_PER_HOP do
        self.index = ((self.index - 2) % self.count) + 1
        self.crank_accum = self.crank_accum + CRANK_DEG_PER_HOP
    end
end

function M:get_current()
    if self.count == 0 then return nil end
    return self.hotspots[self.index]
end

function M:get_index()
    return self.index
end

function M:draw()
    local hs = self:get_current()
    if not hs then return end
    cursor_renderer.draw(hs.x, hs.y, self.cursor_options)
end

_G.hotspot_navigator = M
return M
