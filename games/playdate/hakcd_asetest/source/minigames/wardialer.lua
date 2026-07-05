-- minigames/wardialer — crank-scan an exchange for a carrier.
-- The player cranks to sweep the last 4 digits of a phone number. Hidden
-- targets (carriers) sit at certain numbers; a signal-strength meter + rising
-- carrier hiss guide the player. Land on a carrier and press A to log it.
-- Completing logs the corp number and advances the quest. Self-binds _G.mg_wardialer.
local gfx <const> = playdate.graphics
local W = {}

function W.new(onWin)
    local s = { num = 0, accum = 0, targets = { 2600, 5551, 8080 }, found = {}, need = 1, done = false, onWin = onWin, tick = 0 }
    s.prefix = "913-555-"

    function s:enter() audio.music("tense") end
    function s:resume() audio.music("tense") end

    local function nearestDist(n)
        local best = 9999
        for _, t in ipairs(self and self.targets or s.targets) do best = math.min(best, math.abs(n - t)) end
        return best
    end

    function s:update()
        self.tick += 1
        self.accum += playdate.getCrankChange()
        if math.abs(self.accum) >= 8 then
            self.num = (self.num + (self.accum > 0 and 1 or -1)) % 10000
            self.accum = 0
            audio.blip(400 + (self.num % 20) * 30)
        end

        local dist, hit = 9999, nil
        for _, t in ipairs(self.targets) do
            local d = math.abs(self.num - t)
            if d < dist then dist = d; hit = t end
        end
        local onCarrier = dist == 0 and not self.found[hit]
        -- carrier hiss grows as you approach
        if dist < 40 and self.tick % math.max(3, dist) == 0 then audio.carrier(0.05) end

        if onCarrier and playdate.buttonJustPressed(playdate.kButtonA) then
            self.found[hit] = true; audio.chime()
            local c = 0; for _ in pairs(self.found) do c += 1 end
            if c >= self.need then
                self.done = true
                inventory.add("corp_number")
                quest.complete("wardial")
                if self.onWin then self.onWin() end
                scene_manager.pop()
                return
            end
        end
        if playdate.buttonJustPressed(playdate.kButtonB) then scene_manager.pop(); return end

        self:draw(dist, onCarrier)
    end

    function s:draw(dist, onCarrier)
        gfx.clear(gfx.kColorBlack)
        gfx.setImageDrawMode(gfx.kDrawModeFillWhite)
        gfx.drawTextAligned("*** WAR DIALER v2.3 ***", 200, 16, kTextAlignment.center)
        gfx.drawTextAligned("scanning exchange 913-555-xxxx", 200, 34, kTextAlignment.center)

        -- big number readout
        local disp = string.format("%s%04d", self.prefix, self.num)
        gfx.drawTextAligned("[ " .. disp .. " ]", 200, 78, kTextAlignment.center)

        -- signal strength bar
        local strength = math.max(0, 100 - dist * 2.5)
        gfx.setColor(gfx.kColorWhite); gfx.drawRect(80, 110, 240, 18)
        gfx.fillRect(82, 112, 236 * strength / 100, 14)
        gfx.drawTextAligned("SIGNAL", 200, 134, kTextAlignment.center)

        if onCarrier then
            if (self.tick // 6) % 2 == 0 then
                gfx.drawTextAligned(">> CARRIER DETECTED -- press A to LOG <<", 200, 160, kTextAlignment.center)
            end
        else
            gfx.drawTextAligned("crank to scan  -  B to abort", 200, 160, kTextAlignment.center)
        end

        -- logged list
        local logged = {}
        for t in pairs(self.found) do logged[#logged+1] = "913-555-" .. string.format("%04d", t) end
        table.sort(logged)
        for i, l in ipairs(logged) do gfx.drawText("LOGGED " .. l, 90, 180 + (i-1)*14) end
        gfx.setImageDrawMode(gfx.kDrawModeCopy)
    end

    return s
end
_G.mg_wardialer = W
return W
