-- core/hud — shared HUD chrome matching the design_handoff: thin bordered
-- strips, monospace labels, control-hint bars, framed panels. Self-binds _G.hud.
local gfx <const> = playdate.graphics
local H = {}

-- small black tag with white text, centered at (cx, y)
function H.tag(text, cx, y)
    local w = gfx.getTextSize(text)
    gfx.setColor(gfx.kColorBlack); gfx.fillRect(cx - w//2 - 4, y - 2, w + 8, 16)
    gfx.setColor(gfx.kColorWhite); gfx.setLineWidth(1); gfx.drawRect(cx - w//2 - 4, y - 2, w + 8, 16)
    gfx.setImageDrawMode(gfx.kDrawModeFillWhite)
    gfx.drawTextAligned(text, cx, y, kTextAlignment.center)
    gfx.setImageDrawMode(gfx.kDrawModeCopy)
end

-- top-left objective + top-right star count (thin strips)
function H.objective()
    local q = quest and quest.current()
    if not q then return end
    local line = q.line
    local w = gfx.getTextSize(line)
    gfx.setColor(gfx.kColorBlack); gfx.fillRect(0, 0, w + 14, 15)
    gfx.setColor(gfx.kColorWhite); gfx.drawLine(0, 15, w + 14, 15)
    gfx.setImageDrawMode(gfx.kDrawModeFillWhite)
    gfx.drawText(line, 5, 1)
    gfx.setImageDrawMode(gfx.kDrawModeCopy)

    if quest.stars then
        local s = quest.stars() .. "/" .. quest.starTotal()
        local sw = gfx.getTextSize(s)
        gfx.setColor(gfx.kColorBlack); gfx.fillRect(400 - sw - 14, 0, sw + 14, 15)
        gfx.setColor(gfx.kColorWhite); gfx.drawLine(400 - sw - 14, 15, 400, 15)
        gfx.setImageDrawMode(gfx.kDrawModeFillWhite)
        gfx.drawText(s, 400 - sw - 6, 1)
        gfx.setImageDrawMode(gfx.kDrawModeCopy)
    end
end

-- centered title card (fades after a beat via caller gating)
function H.title(text)
    local w = gfx.getTextSize(text)
    gfx.setColor(gfx.kColorBlack); gfx.fillRect(200 - w//2 - 8, 150, w + 16, 20)
    gfx.setColor(gfx.kColorWhite); gfx.drawRect(200 - w//2 - 8, 150, w + 16, 20)
    gfx.setImageDrawMode(gfx.kDrawModeFillWhite)
    gfx.drawTextAligned(text, 200, 154, kTextAlignment.center)
    gfx.setImageDrawMode(gfx.kDrawModeCopy)
end

-- bottom control-hint bar, e.g. "[CRANK] AIM   [A] LOCK   [B] ABANDON"
function H.controls(hints)
    gfx.setColor(gfx.kColorBlack); gfx.fillRect(0, 224, 400, 16)
    gfx.setColor(gfx.kColorWhite); gfx.drawLine(0, 224, 400, 224)
    gfx.setImageDrawMode(gfx.kDrawModeFillWhite)
    gfx.drawTextAligned(hints, 200, 226, kTextAlignment.center)
    gfx.setImageDrawMode(gfx.kDrawModeCopy)
end

-- framed status panel (bordered box with a title)
function H.panel(x, y, w, h, title)
    gfx.setColor(gfx.kColorBlack); gfx.fillRect(x, y, w, h)
    gfx.setColor(gfx.kColorWhite); gfx.setLineWidth(1); gfx.drawRect(x, y, w, h)
    if title then
        gfx.setImageDrawMode(gfx.kDrawModeFillWhite)
        gfx.drawText(title, x + 4, y + 2)
        gfx.drawLine(x, y + 16, x + w, y + 16)
        gfx.setImageDrawMode(gfx.kDrawModeCopy)
    end
end

_G.hud = H
return H
