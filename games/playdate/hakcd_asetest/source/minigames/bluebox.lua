-- minigames/bluebox — the showpiece phreak. Two phases:
--  1) SEIZE: hold a 2600 Hz tone steady inside a tolerance window by keeping the
--     crank speed in a band. A jittering needle shows your tone; keep it centered
--     for a sustained hold to seize the trunk.
--  2) ROUTE: dial an MF sequence — a 6-key combo shown briefly, then reproduce
--     with the d-pad + A/B mapped to MF pairs, on a countdown.
-- Success opens the wire (final quest step). Self-binds _G.mg_bluebox.
local gfx <const> = playdate.graphics
local B = {}

local KEYS = { "U", "D", "L", "R", "A", "B" }   -- MF key faces

function B.new(onWin)
    local s = { onWin = onWin, tick = 0, phase = "seize",
        hold = 0, needle = 50, route = {}, routeShown = 0, showT = 0, inputIdx = 1, timer = 0 }
    for i = 1, 6 do s.route[i] = KEYS[math.random(1, #KEYS)] end

    function s:enter() audio.music(nil) end
    function s:resume() end

    local function keyPressed()
        if playdate.buttonJustPressed(playdate.kButtonUp) then return "U" end
        if playdate.buttonJustPressed(playdate.kButtonDown) then return "D" end
        if playdate.buttonJustPressed(playdate.kButtonLeft) then return "L" end
        if playdate.buttonJustPressed(playdate.kButtonRight) then return "R" end
        if playdate.buttonJustPressed(playdate.kButtonA) then return "A" end
        if playdate.buttonJustPressed(playdate.kButtonB) then return "B" end
        return nil
    end

    function s:update()
        self.tick += 1

        if self.phase == "seize" then
            -- crank speed maps to tone; want it near center. add drift/jitter.
            local spd = math.abs(playdate.getCrankChange())
            local target = 50
            local push = (spd - 8) * 1.5           -- crank ~8 deg/frame holds center
            self.needle = math.max(0, math.min(100, self.needle + push + (math.random() - 0.5) * 6))
            local centered = math.abs(self.needle - target) < 12
            if centered then
                self.hold += 1
                if self.tick % 4 == 0 then audio.tone(2600, 0.06) end
            else
                self.hold = math.max(0, self.hold - 2)
            end
            if self.hold >= 90 then
                audio.chime(); self.phase = "route"; self.showT = 0
            end
            if playdate.buttonJustPressed(playdate.kButtonB) then scene_manager.pop(); return end
            self:drawSeize(centered)
            return
        end

        -- ROUTE phase
        self.showT += 1
        if self.showT < 120 then
            -- show the sequence briefly
            self:drawRoute(true); return
        end
        self.timer += 1
        local k = keyPressed()
        if k then
            if k == self.route[self.inputIdx] then
                audio.blip(1400); self.inputIdx += 1
                if self.inputIdx > #self.route then
                    audio.chime()
                    inventory.add("trunk_route")
                    quest.complete("bluebox")
                    if self.onWin then self.onWin() end
                    scene_manager.pop({ win = true }); return
                end
            else
                audio.err(); self.inputIdx = 1; self.showT = 0   -- flub: re-show
            end
        end
        self:drawRoute(false)
    end

    function s:drawSeize(centered)
        gfx.clear(gfx.kColorBlack)
        gfx.setImageDrawMode(gfx.kDrawModeFillWhite)
        gfx.drawTextAligned("BLUE BOX -- seize trunk @ 2600 Hz", 200, 14, kTextAlignment.center)
        -- tolerance window
        gfx.drawRect(60, 70, 280, 40)
        gfx.fillRect(60 + 280*0.38, 66, 2, 48)
        gfx.fillRect(60 + 280*0.62, 66, 2, 48)
        -- needle
        local nx = 60 + self.needle / 100 * 280
        gfx.fillRect(nx - 2, 60, 5, 60)
        -- hold meter
        gfx.drawRect(60, 140, 280, 16); gfx.fillRect(62, 142, 276 * self.hold / 90, 12)
        gfx.drawTextAligned(centered and "HOLD IT -- tone locking" or "crank steady ~8 deg/frame", 200, 172, kTextAlignment.center)
        gfx.drawTextAligned("keep the needle between the marks  -  B abort", 200, 196, kTextAlignment.center)
        gfx.setImageDrawMode(gfx.kDrawModeCopy)
    end

    function s:drawRoute(showing)
        gfx.clear(gfx.kColorBlack)
        gfx.setImageDrawMode(gfx.kDrawModeFillWhite)
        gfx.drawTextAligned("TRUNK SEIZED -- dial MF route", 200, 16, kTextAlignment.center)
        for i, key in ipairs(self.route) do
            local x = 70 + (i-1) * 44
            gfx.drawRect(x, 90, 34, 34)
            local reveal = showing or i < self.inputIdx
            if reveal then
                gfx.drawTextAligned(key, x + 17, 100, kTextAlignment.center)
            else
                gfx.drawTextAligned("?", x + 17, 100, kTextAlignment.center)
            end
            if i == self.inputIdx and not showing then
                gfx.drawRect(x - 2, 88, 38, 38)
            end
        end
        if showing then
            gfx.drawTextAligned("MEMORIZE... " .. (2 - self.showT // 60), 200, 150, kTextAlignment.center)
        else
            gfx.drawTextAligned("enter: UP DN L R = U D L R,  A  B", 200, 150, kTextAlignment.center)
            gfx.drawTextAligned("slot " .. self.inputIdx .. "/6", 200, 170, kTextAlignment.center)
        end
        gfx.setImageDrawMode(gfx.kDrawModeCopy)
    end
    return s
end
_G.mg_bluebox = B
return B
