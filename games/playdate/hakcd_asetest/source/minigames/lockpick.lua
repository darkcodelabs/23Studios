-- minigames/lockpick — 5-pin pick with a crank tension wrench (canon spec).
-- Crank sets tension; each pin has a hidden "set point" in the crank range.
-- Nudge the current pin with UP; when the pin's height is in the sweet zone,
-- press A to set it. Overshoot resets that pin. 3 fails = alarm (porch light),
-- forced abort. Set all 5 before the 45s timer. Self-binds _G.mg_lockpick.
local gfx <const> = playdate.graphics
local L = {}

function L.new(onWin)
    local s = { onWin = onWin, tick = 0, pin = 1, set = {}, height = 0, accum = 0,
        fails = 0, timeLeft = 45 * 30, tension = 50, done = false }
    for i = 1, 5 do s.set[i] = false end
    s.zone = {}
    for i = 1, 5 do s.zone[i] = 30 + math.random(0, 40) end   -- sweet height per pin

    function s:enter() audio.music("night") end
    function s:resume() end

    function s:update()
        self.tick += 1
        self.timeLeft -= 1
        if self.timeLeft <= 0 then audio.err(); scene_manager.pop(); return end

        -- crank = tension. too much tension binds; ideal band lets pins move.
        self.tension = math.max(0, math.min(100, self.tension + playdate.getCrankChange() * 0.5))
        local goodTension = self.tension > 35 and self.tension < 70

        -- raise current pin with UP, gravity pulls it back down
        if playdate.buttonIsPressed(playdate.kButtonUp) and goodTension then
            self.height = math.min(100, self.height + 2.2)
        else
            self.height = math.max(0, self.height - 1.6)
        end

        local z = self.zone[self.pin]
        local inZone = goodTension and math.abs(self.height - z) < 7
        if inZone and self.tick % 5 == 0 then audio.tick() end

        if playdate.buttonJustPressed(playdate.kButtonA) then
            if inZone then
                self.set[self.pin] = true; audio.blip(1200)
                self.pin += 1; self.height = 0
                if self.pin > 5 then
                    audio.chime()
                    inventory.add("telco_memo")
                    quest.complete("lockpick")
                    if self.onWin then self.onWin() end
                    scene_manager.pop(); return
                end
            else
                audio.err(); self.fails += 1; self.height = 0
                if self.fails >= 3 then
                    -- alarm: bail
                    scene_manager.pop({ alarm = true }); return
                end
            end
        end
        if playdate.buttonJustPressed(playdate.kButtonB) then scene_manager.pop(); return end
        self:draw(inZone, goodTension)
    end

    function s:draw(inZone, goodTension)
        gfx.clear(gfx.kColorBlack)
        gfx.setImageDrawMode(gfx.kDrawModeFillWhite)
        gfx.drawTextAligned("LOCKPICK -- Bell pedestal", 200, 12, kTextAlignment.center)
        gfx.drawTextAligned(string.format("time %02d  fails %d/3", self.timeLeft // 30, self.fails), 200, 30, kTextAlignment.center)

        -- 5 pin columns
        for i = 1, 5 do
            local x = 90 + (i-1) * 48
            gfx.setColor(gfx.kColorWhite); gfx.drawRect(x, 60, 30, 110)
            -- sweet zone marker
            local zy = 60 + 110 - (self.zone[i] / 100 * 110)
            gfx.drawLine(x, zy, x + 30, zy)
            if self.set[i] then
                gfx.fillRect(x + 2, 62, 26, 106)
                gfx.setImageDrawMode(gfx.kDrawModeFillBlack); gfx.drawTextAligned("SET", x+15, 108, kTextAlignment.center); gfx.setImageDrawMode(gfx.kDrawModeFillWhite)
            elseif i == self.pin then
                local ph = self.height / 100 * 106
                gfx.fillRect(x + 6, 60 + 110 - ph, 18, ph)
            end
        end

        -- tension meter
        gfx.drawText("TENSION", 90, 182)
        gfx.drawRect(160, 182, 160, 12)
        gfx.fillRect(162, 184, 156 * self.tension / 100, 8)
        gfx.fillRect(160 + 156*0.35, 180, 2, 16)
        gfx.fillRect(160 + 156*0.70, 180, 2, 16)

        local hint = goodTension and (inZone and "NOW -- press A to set pin" or "hold UP to raise the pin")
                     or "crank tension into the notched band"
        gfx.drawTextAligned(hint, 200, 206, kTextAlignment.center)
        gfx.drawTextAligned("A set  -  UP raise  -  B abort", 200, 224, kTextAlignment.center)
        gfx.setImageDrawMode(gfx.kDrawModeCopy)
    end
    return s
end
_G.mg_lockpick = L
return L
