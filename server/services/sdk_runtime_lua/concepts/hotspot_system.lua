-- systems/hotspot_system.lua
-- Manages interactable hotspots in a world-explorer scene.
--
-- This system holds the list of hotspots for the current scene,
-- recomputes which one is "active" (closest within radius) every
-- update, and routes the active hotspot's action through the host
-- scene's request_* callbacks. It deliberately does NOT call
-- scene_manager or any other system directly — the host scene
-- (world_explorer in Agent C's output) is the integration point.
--
-- See docs/PROJECT_RULES.md "Lua module loading" — no `local X =
-- import "..."` captures. Dependencies (gfx, iso_renderer) are
-- referenced as globals bound by main.lua.
--
-- Hotspot schema (contract that scenes build against):
--
--   {
--       id = "modem",
--       x = 10, y = 4,            -- world coordinates (tile units)
--       radius = 1.5,             -- detection radius in tiles
--       label = "Beige Modem",
--       icon = nil,               -- or "images/demo/icon_xxx"
--       action = "dialog" | "scene_change" | "mini_game" | "exit",
--       action_data = {
--           -- "dialog":       { text = "...", portrait = "..." }
--           -- "scene_change": { target_scene = "seckc",
--           --                   spawn = { x = 2, y = 4 } }
--           -- "mini_game":    { game_id = "lockpick" }
--           -- "exit":         {}
--       },
--       visible_when = function() return true end,  -- optional
--   }
--
-- API:
--   hs = hotspot_system.new(hotspots_array)
--   hs:update(dt, player_world_x, player_world_y)
--   hs:draw(iso_renderer_ref)
--   hs:get_active_hotspot()         -> hotspot table or nil
--   hs:trigger_active(host_scene)   -- invokes the routed action

local gfx <const> = playdate.graphics

local M = {}
M.__index = M

-- Marker pulse period (frames). Matches interaction_prompt cycle so
-- a hotspot and its prompt pulse in sync.
local MARKER_PULSE_PERIOD <const> = 60

-- Distance (in tile units) at which the marker is fully transparent.
-- Marker opacity ramps linearly from this distance down to the radius.
local MARKER_FADE_DISTANCE <const> = 6.0

-- Lazy icon cache so we don't reload PNGs every draw. Module-level so
-- it survives instance churn; multiple scenes can share entries.
local icon_cache = {}

local function load_icon(path)
    if not path then return nil end
    local cached = icon_cache[path]
    if cached ~= nil then
        if cached == false then return nil end  -- sentinel: known miss
        return cached
    end
    local img = gfx.image.new(path)
    icon_cache[path] = img or false
    return img
end

local function is_visible(hs)
    if hs.visible_when == nil then return true end
    if type(hs.visible_when) ~= "function" then return true end
    local ok, result = pcall(hs.visible_when)
    return ok and result and true or false
end

local function dist2(ax, ay, bx, by)
    local dx = ax - bx
    local dy = ay - by
    return dx * dx + dy * dy
end

function M.new(hotspots_array)
    assert(type(hotspots_array) == "table",
        "hotspot_system.new: hotspots_array must be a table")
    local self = setmetatable({}, M)
    self.hotspots = hotspots_array
    self.active = nil
    self.player_x = 0
    self.player_y = 0
    self.frame = 0
    return self
end

function M:update(_dt, player_world_x, player_world_y)
    self.frame = self.frame + 1
    self.player_x = player_world_x or 0
    self.player_y = player_world_y or 0

    local best = nil
    local best_d2 = math.huge
    for _, hs in ipairs(self.hotspots) do
        if is_visible(hs) then
            local r = hs.radius or 1.0
            local d2 = dist2(self.player_x, self.player_y, hs.x, hs.y)
            if d2 <= r * r and d2 < best_d2 then
                best = hs
                best_d2 = d2
            end
        end
    end
    self.active = best
end

function M:get_active_hotspot()
    return self.active
end

-- Compute marker alpha (0..1) for a hotspot, based on player distance.
-- Inside the radius -> 1.0. Beyond MARKER_FADE_DISTANCE -> 0.
function M:_marker_alpha(hs)
    local r = hs.radius or 1.0
    local dx = self.player_x - hs.x
    local dy = self.player_y - hs.y
    local d = math.sqrt(dx * dx + dy * dy)
    if d <= r then return 1.0 end
    if d >= MARKER_FADE_DISTANCE then return 0.0 end
    local t = (MARKER_FADE_DISTANCE - d) / (MARKER_FADE_DISTANCE - r)
    if t < 0 then t = 0 end
    if t > 1 then t = 1 end
    return t
end

function M:draw(iso_renderer_ref)
    -- iso_renderer_ref is passed by the host scene so we don't need
    -- to assume a global name during early bootstrap. Falls back to
    -- the global if the caller passes nil.
    local iso = iso_renderer_ref or _G.iso_renderer
    if not iso or not iso.world_to_screen then return end

    -- Pulse phase: 0..1 over MARKER_PULSE_PERIOD frames.
    local phase = (self.frame % MARKER_PULSE_PERIOD) / MARKER_PULSE_PERIOD
    -- Sinusoidal pulse: bright on the peak, dim on the trough.
    local pulse = 0.5 + 0.5 * math.sin(phase * 2 * math.pi)

    for _, hs in ipairs(self.hotspots) do
        if is_visible(hs) then
            local alpha = self:_marker_alpha(hs)
            if alpha > 0 then
                local sx, sy = iso:world_to_screen(hs.x, hs.y)
                if sx and sy then
                    local icon_img = load_icon(hs.icon)
                    if icon_img then
                        -- Custom icon: draw centered above the tile.
                        local iw, ih = icon_img:getSize()
                        -- Dither pulse so the icon also breathes.
                        local d = 0.25 + 0.75 * pulse * alpha
                        gfx.setDitherPattern(1 - d, gfx.image.kDitherTypeBayer4x4)
                        icon_img:drawFaded(
                            sx - iw / 2,
                            sy - ih - 6,
                            d,
                            gfx.image.kDitherTypeBayer4x4
                        )
                    else
                        -- Default marker: 4x4 pulsing white square,
                        -- centered above the tile by 8 px.
                        local size = 4
                        local mx = sx - size / 2
                        local my = sy - 8 - size / 2
                        local d = 1 - (pulse * alpha)
                        -- d=0 -> fully opaque white; d=1 -> invisible.
                        if d < 0 then d = 0 end
                        if d > 1 then d = 1 end
                        gfx.setColor(gfx.kColorWhite)
                        gfx.setDitherPattern(d, gfx.image.kDitherTypeBayer4x4)
                        gfx.fillRect(mx, my, size, size)
                    end
                end
            end
        end
    end
    -- Reset dither so we don't leak state into the next draw caller.
    gfx.setColor(gfx.kColorBlack)
    gfx.setDitherPattern(0)
end

-- Route the active hotspot's action through the host scene's
-- request_* callbacks. The host is responsible for:
--   - request_scene_change(target, spawn)
--   - request_mini_game(game_id)
--   - request_exit()
-- and for rendering the dialog overlay if dialog_text / dialog_portrait
-- get set on it.
function M:trigger_active(host)
    local hs = self.active
    if not hs or not host then return false end
    local action = hs.action
    local data = hs.action_data or {}

    if action == "dialog" then
        host.dialog_text = data.text
        host.dialog_portrait = data.portrait
        return true
    elseif action == "scene_change" then
        if type(host.request_scene_change) == "function" then
            host:request_scene_change(data.target_scene, data.spawn)
            return true
        end
    elseif action == "mini_game" then
        if type(host.request_mini_game) == "function" then
            host:request_mini_game(data.game_id)
            return true
        end
    elseif action == "exit" then
        if type(host.request_exit) == "function" then
            host:request_exit()
            return true
        end
    end
    return false
end

_G.hotspot_system = M
return M
