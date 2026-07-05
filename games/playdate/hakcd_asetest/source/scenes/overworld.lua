-- scenes/overworld — top-down suburbia travel map (SC03-ish connective tissue).
-- The player is a blip that walks between fixed nodes along the roads. A at a
-- node enters that location. Self-binds _G.scene_overworld.
local gfx <const> = playdate.graphics
local S = {}

-- nodes positioned over the generated map art. Adjust to taste on hardware.
local NODES = {
    home     = { x = 96,  y = 70,  label = "HOME" },
    payphone = { x = 316, y = 96,  label = "GREYHOUND PAYPHONES" },
    yard     = { x = 210, y = 176, label = "BELL PEDESTAL YARD" },
}

function S:enter()
    self.bg = gfx.image.new("images/map_suburbia")
    self.blip = { x = NODES.home.x, y = NODES.home.y }
    self.tick = 0
    audio.music("night")
end
function S:resume() audio.music("night") end

local function nodeAt(x, y)
    for id, n in pairs(NODES) do
        if math.abs(x - n.x) + math.abs(y - n.y) < 22 then return id, n end
    end
    return nil
end

local function nodeUnlocked(id)
    if id == "home" then return true end
    if id == "payphone" then return quest.index() >= 3 end
    if id == "yard" then return quest.index() >= 5 end
    return false
end

function S:update()
    self.tick += 1
    local SP = 2.6
    local b = self.blip
    if playdate.buttonIsPressed(playdate.kButtonLeft)  then b.x -= SP end
    if playdate.buttonIsPressed(playdate.kButtonRight) then b.x += SP end
    if playdate.buttonIsPressed(playdate.kButtonUp)    then b.y -= SP end
    if playdate.buttonIsPressed(playdate.kButtonDown)  then b.y += SP end
    b.x = math.max(8, math.min(392, b.x)); b.y = math.max(8, math.min(232, b.y))
    if self.tick % 8 == 0 and (playdate.buttonIsPressed(playdate.kButtonLeft) or playdate.buttonIsPressed(playdate.kButtonRight) or playdate.buttonIsPressed(playdate.kButtonUp) or playdate.buttonIsPressed(playdate.kButtonDown)) then audio.tick() end

    local id, n = nodeAt(b.x, b.y)
    if id and playdate.buttonJustPressed(playdate.kButtonA) then
        if not nodeUnlocked(id) then
            audio.err()
        elseif id == "home" then
            audio.ok(); scene_manager.replace(scene_bedroom)
        elseif id == "payphone" then
            audio.ok(); scene_manager.push(scene_payphone)
        elseif id == "yard" then
            audio.ok(); scene_manager.push(scene_pedestal)
        end
    end
    if playdate.buttonJustPressed(playdate.kButtonB) then scene_manager.replace(scene_bedroom); return end
    self:draw(id)
end

function S:draw(hoverId)
    if self.bg then self.bg:draw(0, 0) else gfx.clear(gfx.kColorBlack) end
    -- node markers
    for id, n in pairs(NODES) do
        local unlocked = nodeUnlocked(id)
        gfx.setColor(gfx.kColorWhite)
        if unlocked then gfx.drawCircleAtPoint(n.x, n.y, 8 + (self.tick//6 % 2))
        else gfx.drawCircleAtPoint(n.x, n.y, 5) end
        if id == hoverId then
            local w = gfx.getTextSize(n.label)
            gfx.setColor(gfx.kColorBlack); gfx.fillRect(n.x - w/2 - 4, n.y - 30, w + 8, 16)
            gfx.setImageDrawMode(gfx.kDrawModeFillWhite)
            gfx.drawTextAligned(n.label .. (unlocked and "  A" or "  [locked]"), n.x, n.y - 29, kTextAlignment.center)
            gfx.setImageDrawMode(gfx.kDrawModeCopy)
        end
    end
    -- blip
    gfx.setColor(gfx.kColorBlack); gfx.fillCircleAtPoint(self.blip.x, self.blip.y, 5)
    gfx.setColor(gfx.kColorWhite); gfx.drawCircleAtPoint(self.blip.x, self.blip.y, 5)
    gfx.fillCircleAtPoint(self.blip.x, self.blip.y, 2)
    -- objective
    local q = quest.current()
    if q then
        gfx.setColor(gfx.kColorBlack); gfx.fillRect(0, 224, 400, 16)
        gfx.setImageDrawMode(gfx.kDrawModeFillWhite)
        gfx.drawText("> " .. q.line .. "   (B: home)", 6, 226)
        gfx.setImageDrawMode(gfx.kDrawModeCopy)
    end
end

_G.scene_overworld = S
return S
