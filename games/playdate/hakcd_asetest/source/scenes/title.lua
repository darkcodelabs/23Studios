-- scenes/title — clean terminal-style title (no chunky asset). Self-binds _G.scene_title.
local gfx <const> = playdate.graphics
local S = {}
function S:enter() self.tick = 0; self.blink = true; audio.music("calm") end
function S:resume() audio.music("calm") end
function S:update()
    self.tick += 1
    if self.tick % 22 == 0 then self.blink = not self.blink end
    if playdate.buttonJustPressed(playdate.kButtonA) then audio.ok(); scene_manager.replace(scene_bedroom) end
    self:draw()
end
function S:draw()
    gfx.clear(gfx.kColorBlack)
    gfx.setImageDrawMode(gfx.kDrawModeFillWhite)
    local big = gfx.getSystemFont(gfx.font.kVariantBold)
    if big then gfx.setFont(big) end
    gfx.drawTextAligned("H A K C D", 200, 74, kTextAlignment.center)
    gfx.setFont(gfx.getSystemFont())
    gfx.drawTextAligned("a phreaker noir", 200, 100, kTextAlignment.center)
    gfx.drawTextAligned('"and my crime is curiosity"', 200, 124, kTextAlignment.center)
    gfx.setColor(gfx.kColorWhite); gfx.setLineWidth(1); gfx.drawRect(70, 54, 260, 96)
    if self.blink then hud.tag("PRESS A", 200, 188) end
    gfx.setImageDrawMode(gfx.kDrawModeCopy)
end
_G.scene_title = S
return S
