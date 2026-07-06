-- scenes/shop — the RIG upgrade shop (the Under-the-Tree shop beat). Spend cred
-- on tools that open harder dives. Self-binds _G.scene_shop.
local gfx <const> = playdate.graphics
local S = {}

function S:enter() self.tick = 0; self.sel = 1; audio.music("calm") end
function S:resume() audio.music("calm") end

function S:buy(tool)
    if rig.hasTool(tool.id) then
        dialogue.start({ { who = "newb", port = "portrait_newb", text = "Already own the " .. tool.name .. "." } }); return
    end
    if rig.spend(tool.cost) then
        rig.unlockTool(tool.id); audio.chime()
        dialogue.start({ { who = "// RIG", text = tool.name .. " installed. New dives are in reach." } })
    else
        audio.err()
        dialogue.start({ { who = "newb", port = "portrait_newb", text = "Not enough cred. Pull more from the boards first." } })
    end
end

function S:update()
    self.tick += 1
    if dialogue.active() then dialogue.update(); self:draw(); return end
    local n = #targets.tools
    if playdate.buttonJustPressed(playdate.kButtonDown) then self.sel = (self.sel % n) + 1; audio.tick() end
    if playdate.buttonJustPressed(playdate.kButtonUp) then self.sel = (self.sel - 2) % n + 1; audio.tick() end
    if playdate.buttonJustPressed(playdate.kButtonA) then audio.ok(); self:buy(targets.tools[self.sel]) end
    if playdate.buttonJustPressed(playdate.kButtonB) then scene_manager.pop() end
    self:draw()
end

function S:draw()
    gfx.clear(gfx.kColorBlack)
    gfx.setImageDrawMode(gfx.kDrawModeFillWhite)
    gfx.setFont(gfx.getSystemFont(gfx.font.kVariantBold) or gfx.getSystemFont())
    gfx.drawText("THE RIG", 16, 12)
    gfx.setFont(gfx.getSystemFont())
    gfx.drawTextAligned("cred " .. rig.cred(), 384, 14, kTextAlignment.right)
    gfx.setColor(gfx.kColorWhite); gfx.drawLine(16, 32, 384, 32)

    for i, tool in ipairs(targets.tools) do
        local y = 48 + (i - 1) * 40
        local seld = (i == self.sel)
        if seld then gfx.setColor(gfx.kColorWhite); gfx.fillRect(12, y - 4, 376, 36); gfx.setImageDrawMode(gfx.kDrawModeFillBlack)
        else gfx.setImageDrawMode(gfx.kDrawModeFillWhite) end
        gfx.drawText(tool.name, 22, y)
        local right = rig.hasTool(tool.id) and "OWNED" or (tool.cost .. " cred")
        gfx.drawTextAligned(right, 380, y, kTextAlignment.right)
        gfx.drawText(tool.blurb, 22, y + 14)
        gfx.setImageDrawMode(gfx.kDrawModeFillWhite)
    end

    gfx.drawTextAligned("A buy     B back", 200, 224, kTextAlignment.center)
    gfx.setImageDrawMode(gfx.kDrawModeCopy)
    if dialogue.active() then dialogue.draw() end
end

_G.scene_shop = S
return S
