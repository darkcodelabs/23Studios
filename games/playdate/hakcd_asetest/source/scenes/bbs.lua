-- scenes/bbs — DEADLINE BBS terminal (SC02). CRT background, the Mentor speaks
-- through dialogue, then hands the first task. Self-binds _G.scene_bbs.
local gfx <const> = playdate.graphics
local S = {}

local LOG = {
    "CONNECT 14400",
    "",
    "  DEADLINE BBS -- est. 1994",
    "  nodes: 2   users: 1",
    "",
    "  > new mail from SYSOP",
}

function S:enter()
    self.bg = gfx.image.new("images/scene_bbs")
    self.tick = 0
    self.started = false
    audio.carrier(0.8)
    audio.music("calm")
end
function S:resume() end

function S:startMentor()
    self.started = true
    dialogue.start({
        { who = "THE MENTOR", port = "portrait_mentor", text = "You war-dialed a dead board, kid. Most people hang up." },
        { who = "THE MENTOR", port = "portrait_mentor", text = "You didn't. Good. That curiosity is the whole job." },
        { who = "THE MENTOR", port = "portrait_mentor", text = "There's a corporate board -- PhoenixDown. Their exchange is buried in the 913 prefix." },
        { who = "THE MENTOR", port = "portrait_mentor", text = "Scan for it. Find the carrier. Then we talk about what they're hiding.", choices = {
            { label = "I'm in.", onPick = function() inventory.add("encrypted_cache"); quest.complete("read_bbs") end, done = true },
        } },
    }, function() scene_manager.pop() end)
end

function S:update()
    self.tick += 1
    if dialogue.active() then dialogue.update()
    elseif not self.started then
        if self.tick > 40 and (playdate.buttonJustPressed(playdate.kButtonA) or self.tick > 150) then
            self:startMentor()
        end
    end
    self:draw()
end

function S:draw()
    if self.bg then self.bg:draw(0, 0) else gfx.clear(gfx.kColorBlack) end
    gfx.setImageDrawMode(gfx.kDrawModeFillWhite)
    local n = math.min(#LOG, self.tick // 12)
    for i = 1, n do gfx.drawText(LOG[i], 52, 40 + (i-1) * 16) end
    if not self.started and self.tick > 40 and (self.tick // 20) % 2 == 0 then
        gfx.drawText("_", 52, 40 + n * 16)
    end
    gfx.setImageDrawMode(gfx.kDrawModeCopy)
    if dialogue.active() then dialogue.draw() end
end

_G.scene_bbs = S
return S
