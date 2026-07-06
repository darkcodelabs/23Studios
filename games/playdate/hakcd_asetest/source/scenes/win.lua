-- scenes/win — run cleared. Self-binds _G.scene_win.
local gfx <const> = playdate.graphics
local S = {}
function S:enter() self.tick = 0; audio.music("calm") end
function S:resume() end
function S:update()
    self.tick += 1
    if self.tick > 30 and playdate.buttonJustPressed(playdate.kButtonA) then scene_manager.replace(scene_title) end
    self:draw()
end
function S:draw()
    gfx.clear(gfx.kColorBlack)
    gfx.setImageDrawMode(gfx.kDrawModeFillWhite)
    local big = gfx.getSystemFont(gfx.font.kVariantBold); if big then gfx.setFont(big) end
    gfx.drawTextAligned("WIRE SECURED", 200, 88, kTextAlignment.center)
    gfx.setFont(gfx.getSystemFont())
    gfx.drawTextAligned("Every sector purged. HOLLOWPOINT is exposed.", 200, 118, kTextAlignment.center)
    if (self.tick // 20) % 2 == 0 then gfx.drawTextAligned("press A", 200, 158, kTextAlignment.center) end
    gfx.setImageDrawMode(gfx.kDrawModeCopy)
end
_G.scene_win = S
return S
