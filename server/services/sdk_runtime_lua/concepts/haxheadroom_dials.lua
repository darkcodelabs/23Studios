-- systems/haxheadroom_dials.lua
-- HaxHeadroom "Catch the Wav" dial strip renderer.
--
-- Single public draw call:
--   haxheadroom_dials.draw(logic, x, y, w, h)
--
-- Layout: w is split into 4 equal columns (96px wide when w=384).
-- Each column has three rows:
--   row 1: label (FREQ / BAND / RATE / DELAY), bracketed with `<` `>`
--          for the active dial, dimmed for inactive dials, "LOCKED"
--          on the value row when the dial is forced (level 1).
--   row 2: numeric value (bold system font)
--   row 3: tolerance bar, 8 segments wide, density driven by
--          logic:get_normalized_distance(name).
--
-- Active-dial border: a 1px white rectangle around the column.
-- Hot bar pulse: alternates fill every ~6 frames using the
-- playdate frame counter so we don't need internal timing state.
--
-- ASCII `<` `>` triangle indicators per the agent charter (spec
-- mentions Unicode `◀ ▶` but the system font doesn't reliably
-- ship those glyphs; the Nerd-font glyph module was retired).
--
-- Architectural note: no `local X = import "..."` captures. Reads
-- haxheadroom_levels and (via playdate.graphics) the SDK globals.

local M = {}

local gfx <const> = playdate.graphics

local SEGMENTS = 8                 -- bar width in pixels
local BAR_HEIGHT = 4               -- bar visual thickness
local DIAL_NAMES = { "freq", "band", "rate", "delay" }
local LABELS = {
    freq  = "FREQ",
    band  = "BAND",
    rate  = "RATE",
    delay = "DELAY",
}
local UNITS = {
    freq  = "Hz",
    band  = "Hz",
    rate  = "Hz",
    delay = "ms",
}

-- Format the numeric value for display. RATE numbers get big (up to
-- 48000) so we abbreviate as "32k" to fit the column.
local function format_value(name, value)
    if name == "rate" then
        if value >= 1000 then
            return string.format("%.1fk", value / 1000):gsub("%.0k$", "k")
        end
        return string.format("%d", value)
    elseif name == "delay" then
        return string.format("%dms", math.floor(value + 0.5))
    else
        return string.format("%d", math.floor(value + 0.5))
    end
end

-- How many of the 8 segments to light, given distance + tolerance.
-- Locked dials show all 8 (they're already at target).
local function segments_lit(distance, tolerance)
    if tolerance <= 0 then
        return SEGMENTS  -- locked: solid bar
    end
    if distance <= tolerance then
        return SEGMENTS              -- in tolerance: full bar
    elseif distance <= tolerance * 2 then
        return 5                     -- warm-close
    elseif distance <= tolerance * 4 then
        return 3                     -- warm
    else
        return 1                     -- cold
    end
end

-- Draw a centered 8-segment bar. `hot` adds a pulsing fill.
local function draw_bar(cx, by, lit, hot)
    local total_w = SEGMENTS    -- 1px per segment, centered on cx
    local start_x = cx - math.floor(total_w / 2)
    -- Frame counter pulse: blink at ~5Hz (every 6 frames flip).
    local frame = playdate.getCurrentTimeMilliseconds() or 0
    local pulse_on = (math.floor(frame / 120) % 2) == 0

    for i = 0, SEGMENTS - 1 do
        local seg_x = start_x + i
        -- Center the lit segments: lit count fills from the middle out.
        local from_center = math.abs(i - (SEGMENTS - 1) / 2)
        local light_radius = (lit - 1) / 2
        local on = from_center <= light_radius + 0.0001
        if on then
            if hot and not pulse_on then
                -- pulse off-phase: skip every other pixel for shimmer
                if (i % 2) == 0 then
                    gfx.fillRect(seg_x, by, 1, BAR_HEIGHT)
                end
            else
                gfx.fillRect(seg_x, by, 1, BAR_HEIGHT)
            end
        else
            -- Dim slot: draw a single bottom pixel as a "track" marker
            gfx.fillRect(seg_x, by + BAR_HEIGHT - 1, 1, 1)
        end
    end
end

local function draw_locked_bar(cx, by)
    -- Gray-ish dither: alternating pixels across the full bar.
    local total_w = SEGMENTS
    local start_x = cx - math.floor(total_w / 2)
    for i = 0, SEGMENTS - 1 do
        if (i % 2) == 0 then
            gfx.fillRect(start_x + i, by, 1, BAR_HEIGHT)
        else
            gfx.fillRect(start_x + i, by + BAR_HEIGHT - 1, 1, 1)
        end
    end
end

function M.draw(logic, x, y, w, h)
    if not logic then return end

    local col_w = math.floor(w / #DIAL_NAMES)

    -- Fonts: system + bold variant. Keep references local to draw().
    local font_label = gfx.getSystemFont()
    local font_value = gfx.getSystemFont(gfx.font.kVariantBold) or font_label
    local label_h = font_label:getHeight()
    local value_h = font_value:getHeight()

    local prev_mode = gfx.getImageDrawMode()
    local prev_color = gfx.getColor()

    for i, name in ipairs(DIAL_NAMES) do
        local cx_left = x + (i - 1) * col_w
        local cx_mid  = cx_left + math.floor(col_w / 2)
        local is_active = (logic:get_active_dial() == name)
        local is_locked = logic:is_dial_locked(name)

        -- Active border: 1px rect around the column with a small inset.
        if is_active then
            gfx.setColor(gfx.kColorWhite)
            gfx.setImageDrawMode(gfx.kDrawModeCopy)
            gfx.drawRect(cx_left + 1, y + 1, col_w - 2, h - 2)
        end

        -- Label row.
        local label = LABELS[name] or name
        local label_text
        if is_active then
            label_text = "< " .. label .. " >"
        else
            label_text = label
        end
        if is_locked then
            -- Dim by drawing with kDrawModeWhiteTransparent? Not 1-bit
            -- friendly. Instead, draw the label normally; the LOCKED
            -- marker on the value row signals it's not tunable.
        end
        local label_w = font_label:getTextWidth(label_text)
        gfx.setImageDrawMode(gfx.kDrawModeCopy)
        font_label:drawText(label_text, cx_mid - math.floor(label_w / 2), y + 2)

        -- Value row.
        local value_text
        if is_locked then
            value_text = "LOCKED"
        else
            value_text = format_value(name, logic:get_value(name)) .. UNITS[name]
        end
        local value_w = font_value:getTextWidth(value_text)
        gfx.setImageDrawMode(gfx.kDrawModeCopy)
        font_value:drawText(value_text, cx_mid - math.floor(value_w / 2),
                            y + 2 + label_h + 2)

        -- Bar row.
        local bar_y = y + 2 + label_h + 2 + value_h + 2
        if is_locked then
            draw_locked_bar(cx_mid, bar_y)
        else
            local d = logic:get_normalized_distance(name)
            local t = logic:get_tolerance(name)
            local lit = segments_lit(d, t)
            local hot = (d <= t)
            draw_bar(cx_mid, bar_y, lit, hot)
        end
    end

    gfx.setImageDrawMode(prev_mode)
    gfx.setColor(prev_color)
end

_G.haxheadroom_dials = M
return M
