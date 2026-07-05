-- HAKCD AseTest — PWNGLOVE playground test build.
-- Purpose: hardware proof that the prompt→Aseprite pipeline produces
-- shippable 1-bit art. Every PNG in images/ + launcher/ was authored by an
-- LLM-written Aseprite Lua script, executed headless, machine-validated.
--
-- Controls: d-pad walk · A interact · crank dials the payphone · B backs out.

import "CoreLibs/object"
import "CoreLibs/graphics"
import "CoreLibs/sprites"
import "CoreLibs/timer"
import "CoreLibs/crank"

local gfx <const> = playdate.graphics
local snd <const> = playdate.sound

local SCREEN_W, SCREEN_H = 400, 240
local BOUNDS = { x1 = 16, y1 = 110, x2 = 384, y2 = 220 }
local SPEED = 2.5

-- ---------- audio (synth only, 44.1kHz engine — no assets needed) ----------

local sfx = {}
do
    sfx.step = snd.synth.new(snd.kWaveSquare)
    sfx.step:setADSR(0.001, 0.03, 0, 0.01)
    sfx.step:setVolume(0.12)

    sfx.coin = snd.synth.new(snd.kWaveTriangle)
    sfx.coin:setADSR(0.001, 0.09, 0.3, 0.12)
    sfx.coin:setVolume(0.4)

    sfx.dial = snd.synth.new(snd.kWaveSine)
    sfx.dial:setADSR(0.001, 0.02, 0.6, 0.03)
    sfx.dial:setVolume(0.25)

    sfx.confirm = snd.synth.new(snd.kWaveSquare)
    sfx.confirm:setADSR(0.002, 0.05, 0.4, 0.15)
    sfx.confirm:setVolume(0.35)
end

local function playStep()
    sfx.step:playNote(120 + math.random(0, 30), 1, 0.03)
end
local function playCoin()
    sfx.coin:playNote(880, 1, 0.06)
    playdate.timer.performAfterDelay(70, function() sfx.coin:playNote(1318, 1, 0.09) end)
end
local function playDialTone(freq)
    sfx.dial:playNote(freq, 1, 0.05)
end
local function playConfirm()
    sfx.confirm:playNote(523, 1, 0.08)
    playdate.timer.performAfterDelay(90, function() sfx.confirm:playNote(784, 1, 0.12) end)
end

-- ---------- ambient noir pulse (two-note bass loop) ----------

local amb = snd.synth.new(snd.kWaveSawtooth)
amb:setADSR(0.05, 0.3, 0.2, 0.4)
amb:setVolume(0.07)
local ambTimer = playdate.timer.new(2400, function() end)
ambTimer.repeats = true
local ambFlip = false
ambTimer.timerEndedCallback = function()
    ambFlip = not ambFlip
    amb:playNote(ambFlip and 55 or 41, 1, 0.5)
end

-- ---------- assets (all pipeline-authored) ----------

local img = {
    title    = gfx.image.new("images/title_card"),
    bg       = gfx.image.new("images/bg_playground"),
    newb     = gfx.imagetable.new("images/newb"),
    glove    = gfx.imagetable.new("images/pwnglove"),
    payphone = gfx.imagetable.new("images/payphone"),
    coin     = gfx.imagetable.new("images/coin"),
}

-- ---------- scene state ----------

local scene = "title"      -- "title" | "playground"
local frameTick = 0

-- title state
local titleBlink = true
local titleBlinkTimer = playdate.timer.new(600, function() end)
titleBlinkTimer.repeats = true
titleBlinkTimer.timerEndedCallback = function() titleBlink = not titleBlink end

-- player
local player = { x = 200, y = 190, frame = 1, moving = false, flip = gfx.kImageUnflipped, stepTick = 0 }

-- hotspots (playground)
local HOTSPOTS = {
    { id = "pwnglove", x = 40,  y = 60, w = 80, h = 40, label = "PWNGLOVE" },
    { id = "payphone", x = 300, y = 64, w = 32, h = 40, label = "PAYPHONE" },
}
local activeHotspot = nil

-- coins
local coins = {}
local coinsCollected = 0
local function spawnCoin(x, y)
    coins[#coins + 1] = { x = x, y = y, frame = math.random(1, 4) }
end
spawnCoin(120, 170); spawnCoin(260, 150); spawnCoin(340, 200)

-- payphone modal
local phone = nil -- { digits = {}, target = "2600", cranked = 0 }

-- ---------- helpers ----------

local function overlap(px, py, hs)
    return px > hs.x - 20 and px < hs.x + hs.w + 20
       and py > hs.y - 10 and py < hs.y + hs.h + 40
end

local function drawLabel(text, x, y)
    local w = gfx.getTextSize(text)
    gfx.setColor(gfx.kColorBlack)
    gfx.fillRect(x - w / 2 - 4, y - 2, w + 8, 18)
    gfx.setImageDrawMode(gfx.kDrawModeFillWhite)
    gfx.drawTextAligned(text, x, y, kTextAlignment.center)
    gfx.setImageDrawMode(gfx.kDrawModeCopy)
end

-- ---------- scenes ----------

local function updateTitle()
    img.title:draw(0, 0)
    if titleBlink then
        drawLabel("PRESS A", 200, 202)
    end
    if playdate.buttonJustPressed(playdate.kButtonA) then
        playConfirm()
        scene = "playground"
    end
end

local function updatePlayground()
    frameTick += 1

    -- input
    local dx, dy = 0, 0
    if playdate.buttonIsPressed(playdate.kButtonLeft)  then dx = -SPEED; player.flip = gfx.kImageFlippedX end
    if playdate.buttonIsPressed(playdate.kButtonRight) then dx =  SPEED; player.flip = gfx.kImageUnflipped end
    if playdate.buttonIsPressed(playdate.kButtonUp)    then dy = -SPEED end
    if playdate.buttonIsPressed(playdate.kButtonDown)  then dy =  SPEED end

    if phone then dx, dy = 0, 0 end
    player.moving = (dx ~= 0 or dy ~= 0)
    player.x = math.max(BOUNDS.x1, math.min(BOUNDS.x2, player.x + dx))
    player.y = math.max(BOUNDS.y1, math.min(BOUNDS.y2, player.y + dy))

    -- walk anim + footsteps
    if player.moving then
        if frameTick % 6 == 0 then
            player.frame = (player.frame % 4) + 1
            player.stepTick += 1
            if player.stepTick % 2 == 0 then playStep() end
        end
    else
        player.frame = 1
    end

    -- draw world
    img.bg:draw(0, 0)
    img.glove:drawImage((frameTick // 8) % 4 + 1, 40, 60)
    img.payphone:drawImage((frameTick // 7) % 4 + 1, 300, 64)

    -- coins
    for i = #coins, 1, -1 do
        local c = coins[i]
        c.frame = (frameTick // 6 + i) % 4 + 1
        img.coin:drawImage(c.frame, c.x, c.y)
        if math.abs(player.x + 16 - c.x - 8) < 18 and math.abs(player.y + 16 - c.y - 8) < 18 then
            table.remove(coins, i)
            coinsCollected += 1
            playCoin()
        end
    end

    -- player
    img.newb:drawImage(player.frame, player.x, player.y, player.flip)

    -- hotspot proximity
    activeHotspot = nil
    for _, hs in ipairs(HOTSPOTS) do
        if overlap(player.x + 16, player.y + 16, hs) then
            activeHotspot = hs
            drawLabel(hs.label .. " - A", hs.x + hs.w / 2, hs.y - 18)
        end
    end

    -- HUD
    drawLabel("QUARTERS " .. coinsCollected, 60, 8)

    -- interact
    if playdate.buttonJustPressed(playdate.kButtonA) and activeHotspot and not phone then
        playConfirm()
        if activeHotspot.id == "payphone" then
            phone = { digits = {}, target = "2600", crankAccum = 0, current = 0, done = false }
        elseif activeHotspot.id == "pwnglove" then
            spawnCoin(math.random(BOUNDS.x1 + 20, BOUNDS.x2 - 20), math.random(BOUNDS.y1 + 10, BOUNDS.y2 - 10))
        end
    end

    -- payphone modal: crank selects digit, A commits, dial 2600
    if phone then
        gfx.setColor(gfx.kColorBlack)
        gfx.fillRoundRect(80, 60, 240, 120, 6)
        gfx.setColor(gfx.kColorWhite)
        gfx.drawRoundRect(80, 60, 240, 120, 6)
        gfx.setImageDrawMode(gfx.kDrawModeFillWhite)
        gfx.drawTextAligned("DIAL 2600", 200, 72, kTextAlignment.center)
        local change = playdate.getCrankChange()
        phone.crankAccum += change
        if math.abs(phone.crankAccum) >= 30 then
            phone.current = (phone.current + (phone.crankAccum > 0 and 1 or -1)) % 10
            phone.crankAccum = 0
            playDialTone(400 + phone.current * 60)
        end
        gfx.drawTextAligned(table.concat(phone.digits) .. "[" .. phone.current .. "]", 200, 100, kTextAlignment.center)
        gfx.drawTextAligned("crank digit - A commit - B hang up", 200, 150, kTextAlignment.center)
        gfx.setImageDrawMode(gfx.kDrawModeCopy)

        if playdate.buttonJustPressed(playdate.kButtonA) then
            phone.digits[#phone.digits + 1] = tostring(phone.current)
            playDialTone(700)
            if #phone.digits >= 4 then
                if table.concat(phone.digits) == phone.target then
                    playConfirm()
                    for _ = 1, 4 do
                        spawnCoin(math.random(BOUNDS.x1 + 20, BOUNDS.x2 - 20), math.random(BOUNDS.y1 + 10, BOUNDS.y2 - 10))
                    end
                end
                phone = nil
            end
        end
        if playdate.buttonJustPressed(playdate.kButtonB) then
            phone = nil
        end
    end
end

-- ---------- main loop ----------

function playdate.update()
    playdate.timer.updateTimers()
    gfx.clear(gfx.kColorBlack)
    if scene == "title" then
        updateTitle()
    else
        updatePlayground()
    end
end
