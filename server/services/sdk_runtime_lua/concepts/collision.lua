-- concepts/collision.lua
-- Rectangle collision helpers for Playdate sprites.
--
-- Load-once pattern: imported once in main.lua, self-binds to _G.collision.
-- NEVER: local col = import "concepts/collision" outside main.lua.
--
-- All rect arguments are tables with fields {x, y, w, h} (same shape as
-- playdate.geometry.rect but plain tables are also accepted so callers
-- don't need to construct SDK rect objects for simple checks).
--
-- API:
--   collision.rectsOverlap(r1, r2)              -- bool
--   collision.spriteHit(sprite, x, y)           -- bool
--   collision.queryAt(x, y, layer)              -- {sprite,...} at point
--   collision.queryRect(rect, layer)            -- {sprite,...} overlapping rect
--   collision.lineOfSight(x1,y1,x2,y2,blockers) -- bool (no blocker sprite in path)

local M = {}

local gfx <const> = playdate.graphics

-- Internal: return a normalised rect table from either a plain {x,y,w,h}
-- table or a playdate.geometry.rect object (which exposes the same fields).
local function to_rect(r)
    if type(r) ~= 'table' then return nil end
    local x = tonumber(r.x) or 0
    local y = tonumber(r.y) or 0
    local w = tonumber(r.w) or tonumber(r.width) or 0
    local h = tonumber(r.h) or tonumber(r.height) or 0
    return { x = x, y = y, w = w, h = h }
end

-- Internal: AABB overlap test on two normalised rects.
local function aabb_overlap(a, b)
    return a.x < b.x + b.w
       and a.x + a.w > b.x
       and a.y < b.y + b.h
       and a.y + a.h > b.y
end

--- Returns true when rect r1 and rect r2 overlap.
--- r1, r2 must be tables with {x, y, w, h} fields.
function M.rectsOverlap(r1, r2)
    local a = to_rect(r1)
    local b = to_rect(r2)
    if a == nil or b == nil then return false end
    return aabb_overlap(a, b)
end

--- Returns true when the point (x, y) falls inside sprite's bounding box.
--- Uses sprite:getBounds() — works for any gfx.sprite subclass.
function M.spriteHit(sprite, x, y)
    if sprite == nil then return false end
    local ok, bx, by, bw, bh = pcall(function()
        return sprite:getBounds()
    end)
    if not ok then return false end
    local r = { x = bx, y = by, w = bw, h = bh }
    return aabb_overlap(r, { x = x, y = y, w = 1, h = 1 })
end

-- Internal: collect all sprites, optionally filtering by z-index layer.
-- 'layer' is an optional integer matching sprite:getZIndex().
local function collect_sprites(layer)
    local all = gfx.sprite.getAllSprites()
    if layer == nil then return all end
    local filtered = {}
    for _, s in ipairs(all) do
        if s:getZIndex() == layer then
            table.insert(filtered, s)
        end
    end
    return filtered
end

--- Returns a list of sprites whose bounding box contains point (x, y).
--- layer: optional integer z-index filter (nil = all layers).
function M.queryAt(x, y, layer)
    local point_rect = { x = x, y = y, w = 1, h = 1 }
    local sprites = collect_sprites(layer)
    local result = {}
    for _, s in ipairs(sprites) do
        local bx, by, bw, bh = s:getBounds()
        if aabb_overlap({ x = bx, y = by, w = bw, h = bh }, point_rect) then
            table.insert(result, s)
        end
    end
    return result
end

--- Returns a list of sprites whose bounding box overlaps rect.
--- rect: {x, y, w, h} table.
--- layer: optional integer z-index filter (nil = all layers).
function M.queryRect(rect, layer)
    local r = to_rect(rect)
    if r == nil then return {} end
    local sprites = collect_sprites(layer)
    local result = {}
    for _, s in ipairs(sprites) do
        local bx, by, bw, bh = s:getBounds()
        if aabb_overlap({ x = bx, y = by, w = bw, h = bh }, r) then
            table.insert(result, s)
        end
    end
    return result
end

--- Returns true when the line segment from (x1,y1) to (x2,y2) does NOT
--- intersect any sprite in the blockers list.
---
--- blockers: a list of sprites (as returned by queryRect / queryAt).
--- The check uses per-blocker AABB vs the segment's AABB as a fast
--- broad-phase, then a simple parametric segment-rect test for accuracy.
---
--- Returns false as soon as any blocker intersects the segment.
function M.lineOfSight(x1, y1, x2, y2, blockers)
    if type(blockers) ~= 'table' or #blockers == 0 then return true end

    -- Segment bounding box for broad-phase rejection.
    local seg_min_x = math.min(x1, x2)
    local seg_max_x = math.max(x1, x2)
    local seg_min_y = math.min(y1, y2)
    local seg_max_y = math.max(y1, y2)

    local dx = x2 - x1
    local dy = y2 - y1

    for _, s in ipairs(blockers) do
        local bx, by, bw, bh = s:getBounds()

        -- Broad-phase: segment AABB vs blocker AABB.
        if not (seg_max_x < bx or seg_min_x > bx + bw
             or seg_max_y < by or seg_min_y > by + bh) then

            -- Slab (Cohen-Sutherland) test along each axis.
            local t_min = 0.0
            local t_max = 1.0

            -- X slab.
            if math.abs(dx) < 0.0001 then
                if x1 < bx or x1 > bx + bw then goto continue end
            else
                local inv = 1.0 / dx
                local t1 = (bx - x1) * inv
                local t2 = (bx + bw - x1) * inv
                if t1 > t2 then t1, t2 = t2, t1 end
                t_min = math.max(t_min, t1)
                t_max = math.min(t_max, t2)
                if t_min > t_max then goto continue end
            end

            -- Y slab.
            if math.abs(dy) < 0.0001 then
                if y1 < by or y1 > by + bh then goto continue end
            else
                local inv = 1.0 / dy
                local t1 = (by - y1) * inv
                local t2 = (by + bh - y1) * inv
                if t1 > t2 then t1, t2 = t2, t1 end
                t_min = math.max(t_min, t1)
                t_max = math.min(t_max, t2)
                if t_min > t_max then goto continue end
            end

            return false  -- segment intersects this blocker
        end
        ::continue::
    end

    return true
end

_G.collision = M
return M
