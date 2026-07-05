-- HAKCD AseTest — PWNGLOVE playground, v0.2.0 expansion.
-- Every PNG in images/ + launcher/ was authored by the prompt→Aseprite
-- pipeline: an LLM wrote an Aseprite Lua script, aseprite -b ran it headless
-- in a bwrap jail, machine validators enforced 1-bit + dims. The .aseprite
-- sources and generating scripts live in ../aseprite_src/.
--
-- Controls: d-pad walk · A interact/confirm · B back/hang-up · crank where noted.
-- Six stations ring the den: LOCKPICK, RFID, SUBGHZ, PAYPHONE, COIN VAULT,
-- and the PWNGLOVE pedestal. Clear a station to bank quarters.

import "CoreLibs/object"
import "CoreLibs/graphics"
import "CoreLibs/sprites"
import "CoreLibs/timer"
import "CoreLibs/crank"

local gfx <const> = playdate.graphics
local snd <const> = playdate.sound

local SCREEN_W, SCREEN_H = 400, 240
local BOUNDS = { x1 = 12, y1 = 116, x2 = 388, y2 = 222 }
local SPEED = 2.5

-- ================= AUDIO (synth only; no audio assets) =================

local sfx = {}
do
    sfx.step = snd.synth.new(snd.kWaveSquare);    sfx.step:setADSR(0.001, 0.03, 0, 0.01);    sfx.step:setVolume(0.10)
    sfx.coin = snd.synth.new(snd.kWaveTriangle);  sfx.coin:setADSR(0.001, 0.09, 0.3, 0.12);  sfx.coin:setVolume(0.40)
    sfx.dial = snd.synth.new(snd.kWaveSine);      sfx.dial:setADSR(0.001, 0.02, 0.6, 0.03);  sfx.dial:setVolume(0.25)
    sfx.ok   = snd.synth.new(snd.kWaveSquare);    sfx.ok:setADSR(0.002, 0.05, 0.4, 0.15);    sfx.ok:setVolume(0.32)
    sfx.err  = snd.synth.new(snd.kWaveSawtooth);  sfx.err:setADSR(0.002, 0.08, 0.2, 0.10);   sfx.err:setVolume(0.30)
    sfx.tick = snd.synth.new(snd.kWaveSquare);    sfx.tick:setADSR(0.001, 0.01, 0, 0.005);   sfx.tick:setVolume(0.14)
end

local function playStep()     sfx.step:playNote(120 + math.random(0, 30), 1, 0.03) end
local function playTick()     sfx.tick:playNote(1600, 1, 0.01) end
local function playDial(f)    sfx.dial:playNote(f, 1, 0.05) end
local function playErr()      sfx.err:playNote(160, 1, 0.14) end
local function playCoin()
    sfx.coin:playNote(880, 1, 0.06)
    playdate.timer.performAfterDelay(70, function() sfx.coin:playNote(1318, 1, 0.09) end)
end
local function playOk()
    sfx.ok:playNote(523, 1, 0.08)
    playdate.timer.performAfterDelay(90, function() sfx.ok:playNote(784, 1, 0.12) end)
end

-- ---- background music: 8-step bassline + arp, tracker-style loop ----

local music = { bass = nil, arp = nil, seq = nil }
do
    music.bass = snd.synth.new(snd.kWaveSawtooth); music.bass:setADSR(0.01, 0.2, 0.1, 0.2); music.bass:setVolume(0.09)
    music.arp  = snd.synth.new(snd.kWaveSquare);   music.arp:setADSR(0.005, 0.05, 0, 0.05); music.arp:setVolume(0.05)
    -- A-minor-ish phreak loop. bass notes (Hz) per 8 steps; arp sprinkled.
    local BASS = { 55, 55, 82, 55, 49, 49, 73, 82 }
    local ARP  = { 220, 0, 330, 262, 0, 440, 330, 262 }
    local step = 1
    music.seq = playdate.timer.new(220, function() end)
    music.seq.repeats = true
    music.seq.timerEndedCallback = function()
        local b = BASS[step]; if b > 0 then music.bass:playNote(b, 1, 0.18) end
        local a = ARP[step];  if a > 0 then music.arp:playNote(a, 1, 0.06) end
        step = (step % 8) + 1
    end
end

-- ================= ASSETS (all pipeline-authored) =================

local img = {
    title    = gfx.image.new("images/title_card"),
    bg       = gfx.image.new("images/bg_playground"),
    newb     = gfx.imagetable.new("images/newb"),
    glove    = gfx.imagetable.new("images/pwnglove"),
    payphone = gfx.imagetable.new("images/payphone"),
    coin     = gfx.imagetable.new("images/coin"),
    lockpick = gfx.imagetable.new("images/lockpick"),
    rfid     = gfx.imagetable.new("images/rfid"),
    subghz   = gfx.imagetable.new("images/subghz"),
    vault    = gfx.imagetable.new("images/vault"),
}

-- ================= STATE =================

local scene = "title"      -- "title" | "playground"
local frameTick = 0
local quarters = 0
local cleared = {}          -- station id -> true

-- title blink
local titleBlink = true
local tBlink = playdate.timer.new(600, function() end); tBlink.repeats = true
tBlink.timerEndedCallback = function() titleBlink = not titleBlink end

-- player
local player = { x = 200, y = 190, frame = 1, moving = false, flip = gfx.kImageUnflipped, stepc = 0 }

-- stations: pos + sprite table + frame size + which minigame
local STATIONS = {
    { id = "lockpick", label = "LOCKPICK",   x = 24,  y = 62, it = "lockpick", fw = 32, fh = 32, game = "lockpick" },
    { id = "rfid",     label = "RFID",       x = 96,  y = 62, it = "rfid",     fw = 32, fh = 32, game = "rfid" },
    { id = "subghz",   label = "SUBGHZ",     x = 168, y = 62, it = "subghz",   fw = 32, fh = 32, game = "subghz" },
    { id = "payphone", label = "PAYPHONE",   x = 300, y = 60, it = "payphone", fw = 32, fh = 32, game = "payphone" },
    { id = "vault",    label = "COIN VAULT", x = 240, y = 58, it = "vault",    fw = 48, fh = 48, game = "vault" },
    { id = "pwnglove", label = "PWNGLOVE",   x = 344, y = 60, it = "glove",    fw = 80, fh = 40, game = "glove" },
}
local nearStation = nil
local mg = nil   -- active minigame table

-- coins on the floor
local coins = {}
local function spawnCoin(x, y) coins[#coins + 1] = { x = x, y = y } end

-- ================= HELPERS =================

local function overlap(px, py, s)
    return px > s.x - 22 and px < s.x + s.fw + 22 and py > s.y - 12 and py < s.y + s.fh + 46
end

local function label(text, x, y)
    local w = gfx.getTextSize(text)
    gfx.setColor(gfx.kColorBlack); gfx.fillRect(x - w / 2 - 4, y - 2, w + 8, 18)
    gfx.setImageDrawMode(gfx.kDrawModeFillWhite)
    gfx.drawTextAligned(text, x, y, kTextAlignment.center)
    gfx.setImageDrawMode(gfx.kDrawModeCopy)
end

local function panel(title)
    gfx.setColor(gfx.kColorBlack); gfx.fillRoundRect(60, 44, 280, 152, 6)
    gfx.setColor(gfx.kColorWhite); gfx.drawRoundRect(60, 44, 280, 152, 6)
    gfx.setImageDrawMode(gfx.kDrawModeFillWhite)
    gfx.drawTextAligned(title, 200, 54, kTextAlignment.center)
    gfx.setImageDrawMode(gfx.kDrawModeCopy)
end

local function award(n, id)
    if not cleared[id] then cleared[id] = true end
    for _ = 1, n do
        spawnCoin(math.random(BOUNDS.x1 + 20, BOUNDS.x2 - 20), math.random(BOUNDS.y1 + 8, BOUNDS.y2 - 8))
    end
    playOk()
end

-- ================= MINIGAMES =================
-- each returns a table with :update() drawing into the open panel and
-- handling input; sets self.done = true to close.

local function startLockpick()
    -- crank to hold tension in the sweet zone until the bar fills
    return { kind = "lockpick", angle = 0, fill = 0, done = false, ok = false,
        update = function(self)
            panel("LOCKPICK — hold the sweet spot")
            local change = playdate.getCrankChange()
            self.angle = math.max(0, math.min(100, self.angle + change * 0.4))
            local inZone = self.angle > 42 and self.angle < 62
            if inZone then self.fill = math.min(100, self.fill + 1.6); if frameTick % 4 == 0 then playTick() end
            else self.fill = math.max(0, self.fill - 1.2) end
            -- tension dial
            gfx.setColor(gfx.kColorWhite)
            gfx.drawRect(90, 92, 220, 14)
            gfx.fillRect(90 + 220 * 0.42, 90, 2, 18)   -- zone edges
            gfx.fillRect(90 + 220 * 0.62, 90, 2, 18)
            gfx.fillRect(88 + self.angle / 100 * 220, 90, 4, 18)
            -- progress
            gfx.drawRect(90, 130, 220, 16)
            gfx.fillRect(92, 132, 216 * self.fill / 100, 12)
            gfx.setImageDrawMode(gfx.kDrawModeFillWhite)
            gfx.drawTextAligned("crank to " .. (inZone and "HOLD" or "find zone") .. "  ·  B quit", 200, 168, kTextAlignment.center)
            gfx.setImageDrawMode(gfx.kDrawModeCopy)
            if self.fill >= 100 then self.ok = true; self.done = true end
        end }
end

local function startRfid()
    -- watch a 3-pulse pattern, then repeat it with A on the right beat
    return { kind = "rfid", phase = "watch", seq = { 1, 3, 2 }, idx = 1, t = 0, blink = 0, done = false, ok = false,
        update = function(self)
            panel("RFID CLONE — match the pulses")
            self.t += 1
            local slots = { 130, 200, 270 }
            for i = 1, 3 do
                gfx.setColor(gfx.kColorWhite); gfx.drawCircleAtPoint(slots[i], 110, 16)
            end
            if self.phase == "watch" then
                local cur = self.seq[self.idx]
                if (self.t // 24) % 2 == 0 then gfx.fillCircleAtPoint(slots[cur], 110, 14) end
                if self.t % 48 == 0 then
                    playDial(500 + cur * 120)
                    self.idx += 1
                    if self.idx > #self.seq then self.idx = 1; self.phase = "input" end
                end
                gfx.setImageDrawMode(gfx.kDrawModeFillWhite)
                gfx.drawTextAligned("watch...", 200, 160, kTextAlignment.center)
                gfx.setImageDrawMode(gfx.kDrawModeCopy)
            else
                gfx.setImageDrawMode(gfx.kDrawModeFillWhite)
                gfx.drawTextAligned("press A on lit ·  D-pad picks slot " .. self.idx .. "/3", 200, 160, kTextAlignment.center)
                gfx.setImageDrawMode(gfx.kDrawModeCopy)
                -- cycle the "lit" target for the player to hit with A
                local want = self.seq[self.idx]
                if (self.t // 20) % 3 + 1 == want then gfx.fillCircleAtPoint(slots[want], 110, 14) end
                if playdate.buttonJustPressed(playdate.kButtonA) then
                    if (self.t // 20) % 3 + 1 == want then
                        playDial(700); self.idx += 1
                        if self.idx > #self.seq then self.ok = true; self.done = true end
                    else playErr(); self.done = true end
                end
            end
        end }
end

local function startSubghz()
    -- crank to tune toward a hidden target freq; lock with A when strength peaks
    return { kind = "subghz", freq = 10, target = math.random(20, 80), done = false, ok = false,
        update = function(self)
            panel("SUBGHZ — tune the signal, A to lock")
            self.freq = math.max(0, math.min(100, self.freq + playdate.getCrankChange() * 0.5))
            local dist = math.abs(self.freq - self.target)
            local strength = math.max(0, 100 - dist * 2.2)
            gfx.setColor(gfx.kColorWhite)
            gfx.drawRect(90, 96, 220, 14); gfx.fillRect(88 + self.freq / 100 * 220, 94, 4, 18)
            -- strength meter as dither bars
            local bars = math.floor(strength / 10)
            for i = 1, bars do gfx.fillRect(96 + (i - 1) * 20, 150 - i * 4, 14, 4 + i * 4) end
            if frameTick % math.max(4, 24 - bars * 2) == 0 then playDial(300 + strength * 6) end
            gfx.setImageDrawMode(gfx.kDrawModeFillWhite)
            gfx.drawTextAligned("crank tune  ·  A lock  ·  B quit", 200, 176, kTextAlignment.center)
            gfx.setImageDrawMode(gfx.kDrawModeCopy)
            if playdate.buttonJustPressed(playdate.kButtonA) then
                self.ok = strength > 82; self.done = true
                if not self.ok then playErr() end
            end
        end }
end

local function startPayphone()
    return { kind = "payphone", digits = {}, target = "2600", cur = 0, accum = 0, done = false, ok = false,
        update = function(self)
            panel("PAYPHONE — dial 2600")
            self.accum += playdate.getCrankChange()
            if math.abs(self.accum) >= 30 then
                self.cur = (self.cur + (self.accum > 0 and 1 or -1)) % 10; self.accum = 0
                playDial(400 + self.cur * 60)
            end
            gfx.setImageDrawMode(gfx.kDrawModeFillWhite)
            gfx.drawTextAligned(table.concat(self.digits) .. "[" .. self.cur .. "]", 200, 104, kTextAlignment.center)
            gfx.drawTextAligned("crank digit ·  A commit ·  B hang up", 200, 150, kTextAlignment.center)
            gfx.setImageDrawMode(gfx.kDrawModeCopy)
            if playdate.buttonJustPressed(playdate.kButtonA) then
                self.digits[#self.digits + 1] = tostring(self.cur); playDial(700)
                if #self.digits >= 4 then
                    self.ok = table.concat(self.digits) == self.target
                    if not self.ok then playErr() end
                    self.done = true
                end
            end
        end }
end

local function startVault()
    -- crank the wheel a full turn without overshoot: reach 100 then A
    return { kind = "vault", turn = 0, done = false, ok = false, primed = false,
        update = function(self)
            panel("COIN VAULT — crank a full turn")
            self.turn = math.max(0, math.min(120, self.turn + playdate.getCrankChange() * 0.3))
            self.primed = self.turn >= 100 and self.turn <= 112
            gfx.setColor(gfx.kColorWhite)
            gfx.drawCircleAtPoint(200, 110, 40)
            local a = self.turn / 120 * (2 * math.pi) - math.pi / 2
            gfx.drawLine(200, 110, 200 + math.cos(a) * 38, 110 + math.sin(a) * 38)
            gfx.drawRect(90, 160, 220, 10); gfx.fillRect(92, 162, 216 * math.min(self.turn, 120) / 120, 6)
            if frameTick % 6 == 0 and self.turn < 112 then playTick() end
            gfx.setImageDrawMode(gfx.kDrawModeFillWhite)
            gfx.drawTextAligned(self.primed and "NOW press A" or "crank...", 200, 182, kTextAlignment.center)
            gfx.setImageDrawMode(gfx.kDrawModeCopy)
            if playdate.buttonJustPressed(playdate.kButtonA) then
                self.ok = self.primed; self.done = true
                if not self.ok then playErr() end
            end
        end }
end

local function startGlove()
    -- lore beat: equipping the glove. simple hold-A charge.
    return { kind = "glove", charge = 0, done = false, ok = false,
        update = function(self)
            panel("PWNGLOVE — hold A to equip")
            if playdate.buttonIsPressed(playdate.kButtonA) then self.charge = math.min(100, self.charge + 2)
                if frameTick % 3 == 0 then playDial(200 + self.charge * 8) end
            else self.charge = math.max(0, self.charge - 3) end
            gfx.setColor(gfx.kColorWhite); gfx.drawRect(90, 120, 220, 18); gfx.fillRect(92, 122, 216 * self.charge / 100, 14)
            gfx.setImageDrawMode(gfx.kDrawModeFillWhite)
            gfx.drawTextAligned("hold A  ·  B cancel", 200, 160, kTextAlignment.center)
            gfx.setImageDrawMode(gfx.kDrawModeCopy)
            if self.charge >= 100 then self.ok = true; self.done = true end
        end }
end

local STARTERS = {
    lockpick = startLockpick, rfid = startRfid, subghz = startSubghz,
    payphone = startPayphone, vault = startVault, glove = startGlove,
}
local PAYOUT = { lockpick = 3, rfid = 4, subghz = 3, payphone = 6, vault = 8, glove = 5 }

-- ================= SCENES =================

local function updateTitle()
    img.title:draw(0, 0)
    if titleBlink then label("PRESS A", 200, 202) end
    if playdate.buttonJustPressed(playdate.kButtonA) then playOk(); scene = "playground" end
end

local function drawStation(s)
    local n = (frameTick // 7) % 4 + 1
    img[s.it]:drawImage(n, s.x, s.y)
    if cleared[s.id] then label("DONE", s.x + s.fw / 2, s.y - 16) end
end

local function updatePlayground()
    frameTick += 1

    -- movement (frozen during a minigame)
    local dx, dy = 0, 0
    if not mg then
        if playdate.buttonIsPressed(playdate.kButtonLeft)  then dx = -SPEED; player.flip = gfx.kImageFlippedX end
        if playdate.buttonIsPressed(playdate.kButtonRight) then dx =  SPEED; player.flip = gfx.kImageUnflipped end
        if playdate.buttonIsPressed(playdate.kButtonUp)    then dy = -SPEED end
        if playdate.buttonIsPressed(playdate.kButtonDown)  then dy =  SPEED end
    end
    player.moving = (dx ~= 0 or dy ~= 0)
    player.x = math.max(BOUNDS.x1, math.min(BOUNDS.x2, player.x + dx))
    player.y = math.max(BOUNDS.y1, math.min(BOUNDS.y2, player.y + dy))
    if player.moving then
        if frameTick % 6 == 0 then
            player.frame = (player.frame % 4) + 1
            player.stepc += 1; if player.stepc % 2 == 0 then playStep() end
        end
    else player.frame = 1 end

    -- world
    img.bg:draw(0, 0)
    for _, s in ipairs(STATIONS) do drawStation(s) end

    -- coins
    for i = #coins, 1, -1 do
        local c = coins[i]
        img.coin:drawImage((frameTick // 6 + i) % 4 + 1, c.x, c.y)
        if math.abs(player.x + 16 - c.x - 8) < 18 and math.abs(player.y + 16 - c.y - 8) < 18 then
            table.remove(coins, i); quarters += 1; playCoin()
        end
    end

    img.newb:drawImage(player.frame, player.x, player.y, player.flip)

    -- proximity + interact
    if not mg then
        nearStation = nil
        for _, s in ipairs(STATIONS) do
            if overlap(player.x + 16, player.y + 16, s) then
                nearStation = s
                label(s.label .. " — A", s.x + s.fw / 2, s.y - 16)
            end
        end
        if playdate.buttonJustPressed(playdate.kButtonA) and nearStation then
            playOk(); mg = STARTERS[nearStation.game]()
            mg._station = nearStation
        end
    end

    -- HUD
    local n = 0; for _ in pairs(cleared) do n += 1 end
    label("QUARTERS " .. quarters, 62, 8)
    label(n .. "/6 STATIONS", 330, 8)

    -- active minigame overlay
    if mg then
        mg:update()
        if playdate.buttonJustPressed(playdate.kButtonB) then mg = nil
        elseif mg.done then
            if mg.ok then award(PAYOUT[mg._station.game], mg._station.id) end
            mg = nil
            if n + 1 >= 6 then
                -- all cleared: shower of quarters
                for _ = 1, 10 do spawnCoin(math.random(BOUNDS.x1 + 20, BOUNDS.x2 - 20), math.random(BOUNDS.y1 + 8, BOUNDS.y2 - 8)) end
            end
        end
    end
end

-- ================= MAIN LOOP =================

function playdate.update()
    playdate.timer.updateTimers()
    gfx.clear(gfx.kColorBlack)
    if scene == "title" then updateTitle() else updatePlayground() end
end
