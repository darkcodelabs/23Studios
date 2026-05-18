-- systems/terminal_renderer.lua
-- Powerlevel10k-style segmented prompt bar that composes with the
-- existing nfo_renderer. The terminal_renderer draws:
--
--   * a top segment bar    [user]>[~/HAKCD/SKILLZ]>[ main]
--   * a body region        rendered by nfo_renderer in the middle
--   * a bottom prompt line [/dev/COR.23] > > _
--   * a status segment bar (right-aligned, on the prompt line)
--
-- Each [bracket] segment is a "tile" with an icon glyph + text. Tiles
-- alternate "inverted" (filled black box with white text) and "normal"
-- (outlined box with white text on black). Tiles are separated by the
-- Powerline hard-separator glyph (glyphs.pl_right_hard) drawn in the
-- transition color so the seam looks right.
--
-- Falls back to the SDK default font if hakcd-terminal-14 isn't loaded.

local M = {}

local gfx = playdate.graphics

local SCREEN_W       = 400
local SCREEN_H       = 240
local SEGMENT_BAR_H  = 14
local BOTTOM_BAR_H   = 14
local CURSOR_BLINK_MS = 500

local custom_font     -- lazy-loaded; nil if asset missing
local _cursor_visible = true
local _cursor_last_toggle = 0

local function ensure_font()
    if custom_font ~= nil then return end
    local ok, fnt = pcall(gfx.font.new, "fonts/hakcd-terminal-14")
    if ok and fnt then
        custom_font = fnt
    else
        custom_font = false  -- mark missing to avoid retrying every frame
    end
end

local function font_or_default()
    ensure_font()
    if custom_font then return custom_font end
    return nil  -- caller should let gfx use system default
end

-- Width of a segment given icon + text. Inverted tiles add a 4px pad
-- on each side; normal tiles use 3px so they nest.
local function tile_width(font, seg)
    local pad = seg.inverted and 4 or 3
    local content = (seg.icon and seg.icon .. " " or "") .. (seg.text or "")
    local tw = font and font:getTextWidth(content) or (#content * 6)
    return tw + pad * 2
end

local function draw_segment(font, seg, x, y, h)
    local pad = seg.inverted and 4 or 3
    local content = (seg.icon and seg.icon .. " " or "") .. (seg.text or "")
    local tw = font and font:getTextWidth(content) or (#content * 6)
    local w = tw + pad * 2

    if seg.inverted then
        gfx.setColor(gfx.kColorWhite)
        gfx.fillRect(x, y, w, h)
        gfx.setImageDrawMode(gfx.kDrawModeFillBlack)
    else
        gfx.setColor(gfx.kColorWhite)
        gfx.drawRect(x, y, w, h)
        gfx.setImageDrawMode(gfx.kDrawModeFillWhite)
    end
    if font then gfx.setFont(font) end
    gfx.drawText(content, x + pad, y + 1)
    gfx.setImageDrawMode(gfx.kDrawModeCopy)
    return w
end

local function draw_separator(font, prev_inverted, next_inverted, x, y, h)
    local sep_glyph = (glyphs and glyphs.pl_right_hard) or ">"
    -- Color logic: if going from inverted (white bg) to normal, the
    -- separator should be white-on-black. From normal to inverted, the
    -- arrow is "filling forward" so we paint a small wedge in white.
    if prev_inverted then
        gfx.setImageDrawMode(gfx.kDrawModeFillWhite)
    else
        gfx.setImageDrawMode(gfx.kDrawModeFillBlack)
    end
    if font then gfx.setFont(font) end
    gfx.drawText(sep_glyph, x, y + 1)
    gfx.setImageDrawMode(gfx.kDrawModeCopy)
    local sep_w = font and font:getTextWidth(sep_glyph) or 6
    return sep_w
end

local function draw_segment_bar(font, segments, y_top, bar_h)
    if not segments or #segments == 0 then return end
    -- Background strip (black).
    gfx.setColor(gfx.kColorBlack)
    gfx.fillRect(0, y_top, SCREEN_W, bar_h)
    local x = 0
    local prev_inverted = nil
    for i, seg in ipairs(segments) do
        if prev_inverted ~= nil then
            local sw = draw_separator(font, prev_inverted, seg.inverted, x, y_top, bar_h)
            x = x + sw
        end
        local sw = draw_segment(font, seg, x, y_top, bar_h)
        x = x + sw
        prev_inverted = seg.inverted and true or false
    end
end

local function draw_prompt_line(font, prompt, status_segments, y_top, bar_h)
    gfx.setColor(gfx.kColorBlack)
    gfx.fillRect(0, y_top, SCREEN_W, bar_h)

    local prompt_text = (prompt or "/dev/COR.23") .. " "
                     .. ((glyphs and glyphs.pl_right_hard) or ">") .. " "
                     .. ((glyphs and glyphs.pl_right_soft) or ">") .. " "

    if font then gfx.setFont(font) end
    gfx.setImageDrawMode(gfx.kDrawModeFillWhite)
    gfx.drawText(prompt_text, 4, y_top + 1)
    local pw = font and font:getTextWidth(prompt_text) or (#prompt_text * 6)

    -- Blinking cursor.
    local now = playdate.getCurrentTimeMilliseconds()
    if now - _cursor_last_toggle > CURSOR_BLINK_MS then
        _cursor_visible = not _cursor_visible
        _cursor_last_toggle = now
    end
    if _cursor_visible then
        gfx.fillRect(4 + pw, y_top + 1, 6, bar_h - 4)
    end
    gfx.setImageDrawMode(gfx.kDrawModeCopy)

    -- Right-aligned status segments.
    if status_segments and #status_segments > 0 then
        local total = 0
        for i, seg in ipairs(status_segments) do
            total = total + tile_width(font, seg)
            if i > 1 then
                local sep_glyph = (glyphs and glyphs.pl_right_hard) or ">"
                total = total + (font and font:getTextWidth(sep_glyph) or 6)
            end
        end
        local x = SCREEN_W - total - 2
        local prev_inverted = nil
        for i, seg in ipairs(status_segments) do
            if prev_inverted ~= nil then
                local sw = draw_separator(font, prev_inverted, seg.inverted, x, y_top, bar_h)
                x = x + sw
            end
            local sw = draw_segment(font, seg, x, y_top, bar_h)
            x = x + sw
            prev_inverted = seg.inverted and true or false
        end
    end
end

-- Public entry. opts schema:
--   title_segments:  array of { icon, text, inverted } drawn at top
--   body:            array of nfo template rows (existing nfo_renderer)
--   prompt:          string for the bottom prompt line
--   status_segments: array drawn right-aligned on the prompt line
function M.draw(opts)
    opts = opts or {}
    local font = font_or_default()

    -- Top segment bar.
    draw_segment_bar(font, opts.title_segments, 0, SEGMENT_BAR_H)

    -- Body region: pass through nfo_renderer. CRITICAL: reset gfx
    -- state before delegating so the segment-bar fills don't leak
    -- (color + drawMode + dither would otherwise inflict the body
    -- with white fills and inverted text).
    if opts.body then
        gfx.setColor(gfx.kColorWhite)
        gfx.setImageDrawMode(gfx.kDrawModeCopy)
        gfx.setDitherPattern(0.0)
        gfx.setFont(gfx.getSystemFont())
        nfo_renderer.draw(opts.body)
    end

    -- Bottom prompt + status segments.
    draw_prompt_line(font, opts.prompt, opts.status_segments,
        SCREEN_H - BOTTOM_BAR_H, BOTTOM_BAR_H)
end

_G.terminal_renderer = M
return M
