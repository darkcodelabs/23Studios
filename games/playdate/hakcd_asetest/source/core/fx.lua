-- core/fx — screen-space flourishes overlaid above everything. Currently the
-- Mario-64 "STAR GET!" celebration fired on each objective. Self-binds _G.fx.
local gfx <const> = playdate.graphics
local F = {}
local star, t, active = nil, 0, false

function F.star()
    active = true; t = 0
    if not star then star = gfx.imagetable.new("images/star") end
    audio.chime()
end

function F.update()
    if not active then return end
    t += 1
    if t > 110 then active = false end
end

function F.draw()
    if not active then return end
    local pop = math.min(1.0, t / 8)
    local w = math.floor(180 * pop)
    local x = 200 - w // 2
    gfx.setColor(gfx.kColorBlack); gfx.fillRoundRect(x, 66, w, 64, 8)
    gfx.setColor(gfx.kColorWhite); gfx.drawRoundRect(x, 66, w, 64, 8)
    if pop >= 1 then
        if star then
            local f = (t // 5) % 4 + 1
            local img = star:getImage(f)
            if img then img:draw(x + 18, 86) end
        end
        gfx.setImageDrawMode(gfx.kDrawModeFillWhite)
        gfx.drawText("STAR GET!", x + 58, 84)
        gfx.drawText("objective cleared", x + 58, 104)
        gfx.setImageDrawMode(gfx.kDrawModeCopy)
    end
end
_G.fx = F
return F
