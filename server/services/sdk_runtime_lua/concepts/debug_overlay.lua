-- concepts/debug_overlay.lua
-- Toggleable debug HUD drawn in the top-right corner.
--
-- Load-once pattern: imported once in main.lua (LAST, no deps on it),
-- self-binds to _G.debug_overlay.
-- NEVER: local dbg = import "concepts/debug_overlay" outside main.lua.
--
-- Call debug_overlay.draw() in playdate.update() AFTER gfx.sprite.update()
-- so the overlay sits on top of everything.
--
-- Toggle via:
--   1. playdate system menu item "Debug" added at init time.
--   2. Hold B + Menu button simultaneously (polled each frame in draw()).
--
-- API:
--   debug_overlay.toggle()         -- flip visibility
--   debug_overlay.draw()           -- call after gfx.sprite.update() each frame
--   debug_overlay.addLine(text)    -- pin a transient line for this frame
--   debug_overlay.fps()            -- returns current FPS (number)

local M = {}

local gfx <const> = playdate.graphics

-- State.
local _visible        = false
local _transient_lines = {}   -- cleared each frame after draw
local _frame_count    = 0
local _last_fps_time  = 0
local _cached_fps     = 0.0
local _menu_item      = nil

-- Layout constants.
local PANEL_W     = 130
local PANEL_H     = 60   -- resizes with line count
local MARGIN      = 4
local LINE_H      = 10
local FONT_SIZE   = 10   -- approximate; uses system font

-- Register system menu item once at load time.
local ok, item = pcall(function()
    return playdate.addMenuItem('Debug', function()
        M.toggle()
    end)
end)
if ok and item then _menu_item = item end

--- Flip the overlay on/off.
function M.toggle()
    _visible = not _visible
    -- Clear transient lines when hiding so stale data isn't shown on re-open.
    if not _visible then _transient_lines = {} end
end

--- Return the current measured FPS.
--- Averaged over 30 frames to avoid noisy single-frame numbers.
function M.fps()
    return _cached_fps
end

--- Pin text as a transient debug line for this frame only.
--- The line is drawn below the fixed stats and cleared after each draw() call.
function M.addLine(text)
    table.insert(_transient_lines, tostring(text or ''))
end

--- Draw the debug overlay. Must be called after gfx.sprite.update() in
--- playdate.update(). Returns immediately when not visible.
function M.draw()
    -- FPS measurement: count frames, sample elapsed time every 30 frames.
    _frame_count += 1
    local now_ms = playdate.getCurrentTimeMilliseconds()
    if _frame_count % 30 == 0 then
        local elapsed = (now_ms - _last_fps_time) / 1000.0
        if elapsed > 0 then
            _cached_fps = 30.0 / elapsed
        end
        _last_fps_time = now_ms
    end

    if not _visible then
        _transient_lines = {}
        return
    end

    -- Gather stats via playdate.getStats().
    local stats = playdate.getStats() or {}
    local mem_kb = math.floor((collectgarbage('count') or 0))  -- Lua heap KB

    -- Build fixed lines.
    local lines = {
        string.format('FPS  %.1f', _cached_fps),
        string.format('Mem  %d KB', mem_kb),
        string.format('GC   %s', (stats.gc or 'n/a')),
        string.format('Img  %s', (stats.pixelsDrawn or 'n/a')),
    }

    -- Append transient lines.
    for _, t in ipairs(_transient_lines) do
        table.insert(lines, t)
    end

    -- Panel dimensions (grows with line count).
    local n = #lines
    local panel_h = MARGIN + n * LINE_H + MARGIN
    local panel_x = 400 - PANEL_W - MARGIN
    local panel_y = MARGIN

    -- Draw panel background (filled white box, then black border).
    gfx.setColor(gfx.kColorWhite)
    gfx.fillRect(panel_x, panel_y, PANEL_W, panel_h)
    gfx.setColor(gfx.kColorBlack)
    gfx.drawRect(panel_x, panel_y, PANEL_W, panel_h)

    -- Draw text lines.
    local text_x = panel_x + MARGIN
    local text_y = panel_y + MARGIN
    gfx.setFont(gfx.getSystemFont())
    for i, ln in ipairs(lines) do
        gfx.drawText(ln, text_x, text_y + (i - 1) * LINE_H)
    end

    -- Clear transient lines after draw.
    _transient_lines = {}
end

_G.debug_overlay = M
return M
