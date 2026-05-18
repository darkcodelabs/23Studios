-- systems/static_terminal_menu.lua
-- Renders a terminal-style menu screen by drawing text at fixed pixel
-- positions on a black background. SDK-built-in fonts only. The CRT
-- bezel asset was removed in v0.1.7a+ -- content now uses the full
-- 400x240 viewport with a 4-pixel margin.
--
-- Usage:
--   local menu = static_terminal_menu.new({
--       title = "MAIN MENU",
--       menu_items = { { label = "STORY MODE", number = 1 }, ... },
--       stats = { handle = "Op3r4t0r", level = "newb", ... },
--       footer_hints = "[A] Select   [up/dn] Navigate   [B] Back",
--   })
--   In scene update: menu.cursor mirrors scene.cursor; call menu:draw()
--   from scene draw.

local gfx <const> = playdate.graphics

local M = {}

-- Full-screen content rectangle with a 4-pixel margin all around.
local INNER_X, INNER_Y = 4, 4
local INNER_W, INNER_H = 392, 232

function M.new(config)
    local instance = {
        config = config or {},
        cursor = 1,
        blink_phase = 0,
    }
    return setmetatable(instance, { __index = M })
end

function M:set_cursor(i)
    self.cursor = i or 1
end

function M:move_cursor(direction)
    local n = #(self.config.menu_items or {})
    if n == 0 then return end
    self.cursor = self.cursor + direction
    if self.cursor < 1 then self.cursor = n end
    if self.cursor > n then self.cursor = 1 end
end

function M:get_selected()
    return (self.config.menu_items or {})[self.cursor]
end

function M:update()
    self.blink_phase = (self.blink_phase + 1) % 60
end

function M:draw()
    gfx.clear(gfx.kColorBlack)

    gfx.setImageDrawMode(gfx.kDrawModeFillWhite)
    gfx.setFont(gfx.getSystemFont(gfx.font.kVariantBold))

    -- Title row + underline.
    if self.config.title then
        gfx.drawText(self.config.title, INNER_X + 4, INNER_Y + 4)
    end
    gfx.setColor(gfx.kColorWhite)
    gfx.drawLine(INNER_X + 4, INNER_Y + 20, INNER_X + INNER_W - 4, INNER_Y + 20)

    -- Menu items (left column).
    gfx.setFont(gfx.getSystemFont())
    local items = self.config.menu_items or {}
    -- Right panel (portrait + stats) is OPT-IN via config.show_stats_panel.
    -- The prior default-on rendered the portrait+stats column on every
    -- menu scene that loaded the asset, cramping the menu items down to
    -- 55% of the inner width even on screens that don't need stats.
    local has_right_panel = self.config.show_stats_panel == true
    local left_col_w = has_right_panel and math.floor(INNER_W * 0.55) or (INNER_W - 8)
    local y = INNER_Y + 28
    -- Use the actual font line height instead of a magic number. The
    -- Playdate system font is ~17px tall; the prior hardcoded
    -- `item_h = 14` was smaller than the glyph height and caused
    -- adjacent rows to vertically collide. +2 px breathing gap.
    local body_font = gfx.getFont() or gfx.getSystemFont()
    local font_h = body_font:getHeight()
    local item_h = font_h + 2

    -- Clamp visible window so cursor stays on screen if the list is long.
    local max_visible = math.max(1, math.floor((INNER_H - 48) / item_h))
    local first = 1
    if #items > max_visible then
        first = math.max(1, math.min(#items - max_visible + 1,
            self.cursor - math.floor(max_visible / 2)))
    end
    local last = math.min(#items, first + max_visible - 1)

    for i = first, last do
        local item = items[i]
        local prefix = string.format(" [%s] ", tostring(item.number or i))
        local label  = prefix .. tostring(item.label or "?")
        if item.suffix then
            label = label .. " " .. tostring(item.suffix)
        end
        if i == self.cursor then
            gfx.setColor(gfx.kColorWhite)
            gfx.fillRect(INNER_X + 2, y - 1, left_col_w, item_h)
            gfx.setImageDrawMode(gfx.kDrawModeFillBlack)
            -- Static cursor glyph (no blink swap). The prior blink toggled
            -- between '>' and ' ', which shifted the entire label left/
            -- right by one char-width every 30 frames and made the
            -- selected row hard to read.
            gfx.drawText("> " .. label, INNER_X + 4, y)
            gfx.setImageDrawMode(gfx.kDrawModeFillWhite)
        else
            gfx.drawText("  " .. label, INNER_X + 4, y)
        end
        y = y + item_h
    end

    -- Right stats panel: opt-in via config.show_stats_panel. Portrait
    -- was killed in this build per user request; only the text column
    -- remains when a scene explicitly asks for it. Text starts at the
    -- top of the inner rect since there's no portrait above it.
    if has_right_panel then
        local right_x = INNER_X + left_col_w + 4
        local stats = self.config.stats or {}
        local sy = INNER_Y + 28
        -- Stat-line stride matches the body font's real height (+2 px),
        -- same as menu items. The prior hardcoded 11px stride was
        -- smaller than the ~17px system-font glyph height, causing
        -- adjacent stat rows to vertically collide.
        local stat_stride = font_h + 2
        local function stat_line(key, label)
            local v = stats[key]
            if v == nil then return end
            gfx.drawText(string.format("%-7s %s", label .. ":", tostring(v)),
                right_x, sy)
            sy = sy + stat_stride
        end
        stat_line("handle", "HANDLE")
        stat_line("level",  "LEVEL")
        stat_line("reputation", "REP")
        stat_line("coins", "COINS")
        stat_line("last_save", "SAVED")
        -- Free-form extra lines: stats.extra = { "ACT 1", "v0.1.6", ... }
        if type(stats.extra) == "table" then
            for _, line in ipairs(stats.extra) do
                gfx.drawText(tostring(line), right_x, sy)
                sy = sy + stat_stride
            end
        end
    end

    -- Optional status / banner line above the footer hint (e.g. options
    -- toast messages).
    if self.config.status_line and self.config.status_line ~= "" then
        gfx.drawText(self.config.status_line,
            INNER_X + 4, INNER_Y + INNER_H - 26)
    end

    -- Footer hint strip.
    if self.config.footer_hints then
        gfx.setColor(gfx.kColorWhite)
        gfx.drawLine(INNER_X + 2, INNER_Y + INNER_H - 14,
                     INNER_X + INNER_W - 2, INNER_Y + INNER_H - 14)
        gfx.drawText(self.config.footer_hints,
            INNER_X + 4, INNER_Y + INNER_H - 12)
    end

    gfx.setImageDrawMode(gfx.kDrawModeCopy)
    gfx.setColor(gfx.kColorBlack)
end

_G.static_terminal_menu = M
return M
