-- concepts/chrome_theme.lua — generalized theme + chrome system for 23studios.
--
-- HAKCD-derived (source/systems/chrome_theme.lua) and generalized per
-- 23studios CLAUDE.md rule: "Generalize beyond PwnGlove". The PwnGlove
-- pattern (global theme takeover, live-read each frame) is preserved;
-- the specific hardcoded fields are replaced with a registry.
--
-- Themes are configured at runtime via chrome_theme.register(name, spec).
-- Each spec defines:
--   inset          { x, y, w, h }     (drawable region after chrome)
--   border_image   path | nil          (animated frame image table)
--   border_frames  int                 (count, default 1)
--   border_ms      int                 (per-frame ms, default 100)
--   draw_overlay   function(self)      (custom overlay draw, optional)
--
-- Active theme is read LIVE from a getter function (typically a
-- closure that reads asset_library.getActivePicks()[<axis>].theme_key
-- OR save_state.<key>). This matches the PwnGlove "read each query"
-- pattern but is project-agnostic.
--
-- Bootstrap pattern: self-binds to _G.chrome_theme.

local gfx <const> = playdate.graphics

local M = {}

local SCREEN_W, SCREEN_H = 400, 240

local themes = {}
local _active_theme_getter = nil  -- function() return theme_name end
local _frame = 0
local _border_table_cache = {}

-- Default theme: full screen, no chrome.
themes['default'] = {
  inset = { x = 0, y = 0, w = SCREEN_W, h = SCREEN_H },
  border_image = nil,
  border_frames = 1,
  border_ms = 0,
  draw_overlay = nil
}

-- Public registration: scenes or main.lua can register additional themes.
function M.register(name, spec)
  if type(name) ~= 'string' or name == '' then return end
  themes[name] = spec or {}
  themes[name].inset = themes[name].inset or { x = 0, y = 0, w = SCREEN_W, h = SCREEN_H }
end

-- Set the live-read getter. main.lua wires this once after asset_library
-- bridge is initialized. The getter is called on every chrome query.
function M.set_active_theme_getter(getter)
  _active_theme_getter = getter
end

-- For tests + transitional code: explicitly set the active theme name
-- (overrides the getter if both are wired).
local _active_theme_override = nil
function M.set_active_theme(name)
  _active_theme_override = name
end

function M.current()
  if _active_theme_override then return _active_theme_override end
  if _active_theme_getter then
    local ok, name = pcall(_active_theme_getter)
    if ok and themes[name] then return name end
  end
  return 'default'
end

function M.get_inset()
  local t = themes[M.current()] or themes['default']
  return t.inset
end

local function load_border_table(path)
  if _border_table_cache[path] then return _border_table_cache[path] end
  local ok, t = pcall(gfx.imagetable.new, path)
  if ok then _border_table_cache[path] = t end
  return _border_table_cache[path]
end

local function tick()
  _frame = (_frame + 1) % 240
end

function M.draw_overlay()
  tick()
  local name = M.current()
  local t = themes[name]
  if not t then return end
  if type(t.draw_overlay) == 'function' then
    t.draw_overlay(t)
    return
  end
  if not t.border_image then return end

  local frames = t.border_frames or 1
  local frame_ms = t.border_ms or 100
  local fps_frames = math.max(1, math.floor((frames * frame_ms) / 33))
  local idx = (math.floor(_frame / math.max(1, fps_frames)) % frames) + 1

  local table_img = load_border_table(t.border_image)
  if not table_img then return end
  local img = table_img:getImage(idx)
  if not img then return end

  -- Default border draw: 4 strips along edges
  local bw = t.border_width or 12
  -- top
  img:draw(0, 0)
  -- bottom
  img:draw(0, SCREEN_H - bw)
  -- left
  img:draw(0, 0)
  -- right
  img:draw(SCREEN_W - bw, 0)
end

_G.chrome_theme = M
return M
