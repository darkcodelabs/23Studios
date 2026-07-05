-- scenes/title — title card + press A. Self-binds _G.scene_title.
local gfx <const> = playdate.graphics
local S = {}

function S:enter()
    self.bg = gfx.image.new("images/title_card")
    self.tick = 0
    self.blink = true
    audio.music("calm")
end
function S:resume() audio.music("calm") end

function S:update()
    self.tick += 1
    if self.tick % 22 == 0 then self.blink = not self.blink end
    if playdate.buttonJustPressed(playdate.kButtonA) then
        audio.ok()
        scene_manager.replace(scene_bedroom)
    end
    self:draw()
end

function S:draw()
    if self.bg then self.bg:draw(0, 0) else gfx.clear(gfx.kColorBlack) end
    if self.blink then
        local t = "PRESS A"
        local w = gfx.getTextSize(t)
        gfx.setColor(gfx.kColorBlack); gfx.fillRect(200 - w/2 - 6, 198, w + 12, 18)
        gfx.setImageDrawMode(gfx.kDrawModeFillWhite)
        gfx.drawTextAligned(t, 200, 201, kTextAlignment.center)
        gfx.setImageDrawMode(gfx.kDrawModeCopy)
    end
end
_G.scene_title = S
return S
