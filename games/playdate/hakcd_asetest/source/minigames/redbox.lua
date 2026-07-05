-- minigames/redbox — DTMF red-boxing. The game plays a short tone sequence
-- (a "coin" cadence); the player must reproduce each tone by cranking a dial to
-- the matching frequency band and pressing A within a timing window. Three
-- tones, rising difficulty. Success seizes the line and calls k0nsole.
-- Self-binds _G.mg_redbox.
local gfx <const> = playdate.graphics
local R = {}

-- five frequency bands the dial can rest in; target is one of them per tone.
local BANDS = { 700, 900, 1100, 1300, 1700 }

function R.new(onWin)
    local s = { onWin = onWin, tick = 0,
        seq = { math.random(1,5), math.random(1,5), math.random(1,5) },
        step = 1, phase = "demo", demoT = 0, dial = 3, accum = 0, misses = 0 }

    function s:enter() audio.music(nil) end
    function s:resume() end

    local function playTone(band, len) audio.tone(BANDS[band] * 0, 0); audio.blip(BANDS[band]); audio.tone(BANDS[band], len or 0.18) end

    function s:update()
        self.tick += 1

        if self.phase == "demo" then
            self.demoT += 1
            -- play each target tone once, ~40 ticks apart
            local slot = self.demoT // 40 + 1
            if self.demoT % 40 == 1 and slot <= #self.seq then
                audio.tone(BANDS[self.seq[slot]], 0.2)
            end
            if self.demoT > #self.seq * 40 + 20 then self.phase = "input" end
            self:draw(); return
        end

        -- input phase: crank the dial across bands, A to fire the current tone
        self.accum += playdate.getCrankChange()
        if math.abs(self.accum) >= 24 then
            self.dial = math.max(1, math.min(#BANDS, self.dial + (self.accum > 0 and 1 or -1)))
            self.accum = 0; audio.tick()
        end

        if playdate.buttonJustPressed(playdate.kButtonA) then
            local want = self.seq[self.step]
            audio.tone(BANDS[self.dial], 0.18)
            if self.dial == want then
                audio.ok(); self.step += 1
                if self.step > #self.seq then
                    inventory.add("konsole_number")
                    quest.complete("redbox")
                    if self.onWin then self.onWin() end
                    scene_manager.pop(); return
                end
            else
                audio.err(); self.misses += 1
                if self.misses >= 3 then self.phase = "demo"; self.demoT = 0; self.step = 1; self.misses = 0 end
            end
        end
        if playdate.buttonJustPressed(playdate.kButtonB) then scene_manager.pop(); return end
        self:draw()
    end

    function s:draw()
        gfx.clear(gfx.kColorBlack)
        gfx.setImageDrawMode(gfx.kDrawModeFillWhite)
        gfx.drawTextAligned("RED BOX -- seize the line", 200, 14, kTextAlignment.center)

        -- band dial: 5 vertical bars, current highlighted
        for i, f in ipairs(BANDS) do
            local x = 60 + (i-1) * 60
            gfx.setColor(gfx.kColorWhite)
            local h = 20 + i * 8
            if self.phase == "input" and i == self.dial then
                gfx.fillRect(x, 150 - h, 40, h)
                gfx.setImageDrawMode(gfx.kDrawModeFillBlack); gfx.drawTextAligned(f.."", x+20, 155-h/2-6, kTextAlignment.center); gfx.setImageDrawMode(gfx.kDrawModeFillWhite)
            else
                gfx.drawRect(x, 150 - h, 40, h)
                gfx.drawTextAligned(f.."", x+20, 158, kTextAlignment.center)
            end
        end

        -- sequence pips
        for i = 1, #self.seq do
            local x = 150 + (i-1) * 34
            gfx.setColor(gfx.kColorWhite)
            if i < self.step then gfx.fillCircleAtPoint(x, 186, 8)
            elseif i == self.step and self.phase == "input" then gfx.drawCircleAtPoint(x, 186, 9); if (self.tick//6)%2==0 then gfx.fillCircleAtPoint(x,186,4) end
            else gfx.drawCircleAtPoint(x, 186, 8) end
        end

        if self.phase == "demo" then
            gfx.drawTextAligned("listen to the coin tones...", 200, 210, kTextAlignment.center)
        else
            gfx.drawTextAligned("crank to a band  -  A to send  -  B abort", 200, 210, kTextAlignment.center)
            if self.misses > 0 then gfx.drawTextAligned("misfires: " .. self.misses .. "/3", 200, 226, kTextAlignment.center) end
        end
        gfx.setImageDrawMode(gfx.kDrawModeCopy)
    end
    return s
end
_G.mg_redbox = R
return R
