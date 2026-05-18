-- systems/nfo_renderer.lua
-- Renders an NFO-style screen at 400x240. Templates are Lua tables of
-- typed rows. Pure renderer; state (cursor, scroll) is owned by the
-- caller / scene.
--
-- Row types:
--   { type = "title",     left = "MAIN MENU - ROOT.EXE", right = "1/5" }
--   { type = "rule" }                                -- single-pixel line
--   { type = "spacer",    h = 4 }                    -- vertical gap px
--   { type = "text",      text = "...", align = "left|center|right" }
--   { type = "leader",    left = "label", right = "value" }
--   { type = "menu",      items = { "OPT A", "OPT B" }, cursor = 1 }
--   { type = "signature", text = "-mentor" }         -- right-aligned italic
--   { type = "status",    text = "..." }             -- bottom-bar text
--
-- The renderer queries chrome_theme.get_inset() for the drawable area,
-- per docs/DESIGN_RULES §5.

local gfx <const> = playdate.graphics

-- chrome_theme imported lazily inside M.draw() to avoid load-order
-- upvalue capture. See docs/PROJECT_RULES.md "Lua module loading".

local M = {}

local DEFAULT_FONT = gfx.getSystemFont()
local LINE_H = 16
local DOT_CHAR = "."

local function fill_dotted(width_px, left, right, font)
    font = font or DEFAULT_FONT
    local lw = font:getTextWidth(left)
    local rw = font:getTextWidth(right)
    local dot_w = font:getTextWidth(DOT_CHAR)
    local space_for_dots = width_px - lw - rw - (2 * dot_w)
    if space_for_dots < dot_w then
        return left .. " " .. right
    end
    local n = math.floor(space_for_dots / dot_w)
    return left .. " " .. string.rep(DOT_CHAR, n) .. " " .. right
end

local function draw_title_bar(x, y, w, row)
    gfx.setColor(gfx.kColorWhite)
    gfx.fillRect(x, y, w, LINE_H)
    gfx.setImageDrawMode(gfx.kDrawModeFillBlack)
    gfx.drawText(row.left or "", x + 4, y + 1)
    if row.right then
        local rw = DEFAULT_FONT:getTextWidth(row.right)
        gfx.drawText(row.right, x + w - rw - 4, y + 1)
    end
    gfx.setImageDrawMode(gfx.kDrawModeCopy)
    return y + LINE_H
end

local function draw_rule(x, y, w)
    gfx.setColor(gfx.kColorWhite)
    gfx.drawLine(x, y, x + w, y)
    return y + 2
end

local function draw_text(x, y, w, row)
    gfx.setImageDrawMode(gfx.kDrawModeFillWhite)
    local align = row.align or "left"
    if align == "center" then
        gfx.drawTextAligned(row.text or "", x + w / 2, y, kTextAlignment.center)
    elseif align == "right" then
        gfx.drawTextAligned(row.text or "", x + w - 4, y, kTextAlignment.right)
    else
        gfx.drawText(row.text or "", x + 4, y)
    end
    gfx.setImageDrawMode(gfx.kDrawModeCopy)
    return y + LINE_H
end

local function draw_leader(x, y, w, row)
    local s = fill_dotted(w - 8, row.left or "", row.right or "")
    gfx.setImageDrawMode(gfx.kDrawModeFillWhite)
    gfx.drawText(s, x + 4, y)
    gfx.setImageDrawMode(gfx.kDrawModeCopy)
    return y + LINE_H
end

local function draw_menu(x, y, w, row)
    local items = row.items or {}
    local cur = row.cursor or 1
    gfx.setImageDrawMode(gfx.kDrawModeFillWhite)
    for i, label in ipairs(items) do
        local prefix = (i == cur) and "> " or "  "
        gfx.drawText(prefix .. label, x + 8, y)
        y = y + LINE_H
    end
    gfx.setImageDrawMode(gfx.kDrawModeCopy)
    return y
end

local function draw_signature(x, y, w, row)
    gfx.setImageDrawMode(gfx.kDrawModeFillWhite)
    gfx.drawTextAligned(row.text or "", x + w - 6, y, kTextAlignment.right)
    gfx.setImageDrawMode(gfx.kDrawModeCopy)
    return y + LINE_H
end

local function draw_status(x, y, w, row)
    gfx.setColor(gfx.kColorWhite)
    gfx.drawLine(x, y, x + w, y)
    gfx.setImageDrawMode(gfx.kDrawModeFillWhite)
    gfx.drawText(row.text or "", x + 4, y + 2)
    gfx.setImageDrawMode(gfx.kDrawModeCopy)
    return y + LINE_H + 2
end

-- Fixed-width ASCII art. No reflow, no wrapping. Renders line-by-line.
-- Supports vertical scroll via `row.scroll_offset` (0-based line index)
-- so the parent scene can map crank input to scroll the art when its
-- height exceeds the available inset.
local ASCII_LINE_H = 12
local function draw_ascii_art(x, y, w, h, row)
    local content = row.content or ""
    if content == "" then return y end
    local scroll = row.scroll_offset or 0
    gfx.setImageDrawMode(gfx.kDrawModeFillWhite)
    local visible_lines = math.floor((h - (y - row._inset_y_top or 0)) / ASCII_LINE_H)
    local n = 0
    local line_idx = 0
    for line in content:gmatch("([^\n]*)\n?") do
        if line_idx >= scroll then
            gfx.drawText(line, x + 2, y + n * ASCII_LINE_H)
            n = n + 1
            if n >= 18 then break end
        end
        line_idx = line_idx + 1
    end
    gfx.setImageDrawMode(gfx.kDrawModeCopy)
    return y + n * ASCII_LINE_H
end

function M.draw(template)
    local inset = chrome_theme.get_inset()
    local x, y, w, h = inset.x, inset.y, inset.w, inset.h
    local cursor_y = y
    for _, row in ipairs(template) do
        if row.type == "title" then
            cursor_y = draw_title_bar(x, cursor_y, w, row)
        elseif row.type == "rule" then
            cursor_y = draw_rule(x, cursor_y, w)
        elseif row.type == "spacer" then
            cursor_y = cursor_y + (row.h or 4)
        elseif row.type == "text" then
            cursor_y = draw_text(x, cursor_y, w, row)
        elseif row.type == "leader" then
            cursor_y = draw_leader(x, cursor_y, w, row)
        elseif row.type == "menu" then
            cursor_y = draw_menu(x, cursor_y, w, row)
        elseif row.type == "signature" then
            cursor_y = draw_signature(x, cursor_y, w, row)
        elseif row.type == "status" then
            cursor_y = draw_status(x, cursor_y, w, row)
        elseif row.type == "ascii_art" then
            row._inset_y_top = y
            cursor_y = draw_ascii_art(x, cursor_y, w, h - (cursor_y - y), row)
        end
        if cursor_y > y + h then break end
    end
end

_G.nfo_renderer = M
return M
