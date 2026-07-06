-- scenes/bbs — DEADLINE BBS terminal (SC02) as a STATIC illustrated frame
-- (the handoff CRT terminal art). The Mentor speaks through the dialogue bar,
-- then hands the first task. Self-binds _G.scene_bbs.
local gfx <const> = playdate.graphics
local S = {}

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
        { who = "THE MENTOR", port = "portrait_mentor", text = "Everything you need is in the textfiles. Read more, ask less." },
        { who = "THE MENTOR", port = "portrait_mentor", text = "There's a corporate board -- PhoenixDown -- buried in the 913 prefix. Scan for it.", choices = {
            { label = "I'm in.", onPick = function() inventory.add("encrypted_cache"); quest.complete("read_bbs") end, done = true },
        } },
    }, function() scene_manager.pop() end)
end

function S:update()
    self.tick += 1
    if dialogue.active() then dialogue.update()
    elseif not self.started then
        if self.tick > 30 and (playdate.buttonJustPressed(playdate.kButtonA) or self.tick > 120) then
            self:startMentor()
        end
    end
    self:draw()
end

function S:draw()
    if self.bg then self.bg:draw(0, 0) else gfx.clear(gfx.kColorBlack) end
    if not self.started and self.tick > 30 and (self.tick // 20) % 2 == 0 then
        hud.tag("PRESS A TO READ", 200, 150)
    end
    if dialogue.active() then dialogue.draw() end
end

_G.scene_bbs = S
return S
