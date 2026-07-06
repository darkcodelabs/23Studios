-- scenes/title — title, then straight into the action. Self-binds _G.scene_title.
local gfx <const> = playdate.graphics
local S = {}
function S:enter()
    self.bg = gfx.image.new("images/title_card")
    self.tick = 0; self.blink = true
    audio.music("calm")
end
function S:resume() audio.music("calm") end
function S:update()
    self.tick += 1
    if self.tick % 22 == 0 then self.blink = not self.blink end
    if playdate.buttonJustPressed(playdate.kButtonA) then audio.ok(); scene_manager.replace(scene_lab) end
    self:draw()
end
function S:draw()
    if self.bg then self.bg:draw(0, 0) else
        gfx.clear(gfx.kColorBlack); gfx.setImageDrawMode(gfx.kDrawModeFillWhite)
        local big = gfx.getSystemFont(gfx.font.kVariantBold); if big then gfx.setFont(big) end
        gfx.drawTextAligned("H A K C D", 200, 78, kTextAlignment.center)
        gfx.setFont(gfx.getSystemFont())
        gfx.drawTextAligned("jack in. own the room.", 200, 106, kTextAlignment.center)
        gfx.setColor(gfx.kColorWhite); gfx.drawRect(70, 58, 260, 84)
        gfx.setImageDrawMode(gfx.kDrawModeCopy)
    end
    if self.blink then hud.tag("PRESS A", 200, 210) end
end
_G.scene_title = S
return S
