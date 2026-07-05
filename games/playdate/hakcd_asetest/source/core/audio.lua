-- core/audio — synth SFX + tracker music. Self-binds to _G.audio.
-- No audio assets: everything is playdate.sound synth (44.1kHz engine).
local snd <const> = playdate.sound
local A = {}

local function mk(wave, a, d, s, r, vol)
    local sy = snd.synth.new(wave)
    sy:setADSR(a, d, s, r); sy:setVolume(vol)
    return sy
end

local v = {
    step  = mk(snd.kWaveSquare,   0.001, 0.03, 0,   0.01, 0.09),
    coin  = mk(snd.kWaveTriangle, 0.001, 0.09, 0.3, 0.12, 0.38),
    ok    = mk(snd.kWaveSquare,   0.002, 0.05, 0.4, 0.15, 0.30),
    err   = mk(snd.kWaveSawtooth, 0.002, 0.08, 0.2, 0.10, 0.28),
    tick  = mk(snd.kWaveSquare,   0.001, 0.01, 0,   0.005,0.13),
    blip  = mk(snd.kWaveSquare,   0.001, 0.02, 0,   0.02, 0.10),
    tone  = mk(snd.kWaveSine,     0.005, 0.10, 0.8, 0.05, 0.30),
    carrier = mk(snd.kWaveNoise,  0.02,  0.2,  0.6, 0.2,  0.10),
}

function A.step()   v.step:playNote(120 + math.random(0,30), 1, 0.03) end
function A.tick()   v.tick:playNote(1600, 1, 0.01) end
function A.blip(f)  v.blip:playNote(f or 900, 1, 0.02) end
function A.tone(f, len) v.tone:playNote(f or 2600, 1, len or 0.15) end
function A.err()    v.err:playNote(160, 1, 0.14) end
function A.carrier(len) v.carrier:playNote(200, 1, len or 0.6) end
function A.coin()
    v.coin:playNote(880, 1, 0.06)
    playdate.timer.performAfterDelay(70, function() v.coin:playNote(1318, 1, 0.09) end)
end
function A.ok()
    v.ok:playNote(523, 1, 0.08)
    playdate.timer.performAfterDelay(90, function() v.ok:playNote(784, 1, 0.12) end)
end
function A.chime()
    v.ok:playNote(659, 1, 0.08)
    playdate.timer.performAfterDelay(90,  function() v.ok:playNote(880, 1, 0.08) end)
    playdate.timer.performAfterDelay(180, function() v.ok:playNote(1175, 1, 0.16) end)
end

-- background music: 8-step bass + arp loop, toggleable per scene mood.
local bass = mk(snd.kWaveSawtooth, 0.01, 0.2, 0.1, 0.2, 0.08)
local arp  = mk(snd.kWaveSquare,   0.005,0.05,0,   0.05, 0.045)
local PATTERNS = {
    -- mood -> { bass[8], arp[8], stepMs }
    calm  = { {55,0,82,0,49,0,73,0}, {220,0,0,330,0,0,262,0}, 300 },
    tense = { {55,55,82,55,49,49,73,82}, {220,0,330,262,0,440,330,262}, 200 },
    night = { {41,0,49,0,55,0,49,0}, {0,220,0,165,0,196,0,0}, 260 },
}
local seqTimer, step, cur = nil, 1, nil
function A.music(mood)
    if cur == mood then return end
    cur = mood
    if seqTimer then seqTimer:remove(); seqTimer = nil end
    if not mood or not PATTERNS[mood] then return end
    local P = PATTERNS[mood]; step = 1
    seqTimer = playdate.timer.new(P[3], function() end)
    seqTimer.repeats = true
    seqTimer.timerEndedCallback = function()
        local b = P[1][step]; if b > 0 then bass:playNote(b, 1, P[3]/1000*0.8) end
        local a = P[2][step]; if a > 0 then arp:playNote(a, 1, 0.06) end
        step = (step % 8) + 1
    end
end
function A.musicOff() A.music(nil) end

_G.audio = A
return A
