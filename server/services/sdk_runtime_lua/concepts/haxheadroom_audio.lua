-- systems/haxheadroom_audio.lua
-- Dynamic audio mix for the HaxHeadroom "Catch the Wav" mini-game.
--
-- The premise: when the player is far off-tune, we play loud white
-- noise (radio static). As they dial closer to the target parameters
-- and "quality" rises toward 1.0, the noise fades and a sustained
-- sine tone takes over. On a successful lock we play the existing
-- `kombo_hit` sample as the "signal acquired" chime so we reuse a
-- real game-audio asset rather than synthesizing one ourselves.
--
-- API:
--   haxheadroom_audio.start()
--   haxheadroom_audio.update(quality, dt)
--   haxheadroom_audio.stop()
--   haxheadroom_audio.play_acquired_chime()
--
-- Architectural notes:
--   * No `local X = import "systems/..."` (preflight enforces).
--   * `audio_manager` is referenced as a global (bound in main.lua).
--   * Module self-binds via _G.haxheadroom_audio = M before return M.
--
-- Synth strategy:
--   * Two module-scope `playdate.sound.synth` instances (singletons,
--     reused across mini-game sessions so we don't churn allocations
--     every time the scene reopens).
--   * Both are started with very long-duration MIDI notes and held
--     for the duration of the mini-game. We modulate `:setVolume()`
--     each frame to cross-fade between them. Holding a long note is
--     simpler than retriggering an envelope every update and gives a
--     glitch-free continuous bed of sound.

import "CoreLibs/graphics"

local M = {}

-- ---------------------------------------------------------------------
-- Tuning constants
-- ---------------------------------------------------------------------

-- Sine tone pitch. Roughly A4 area — pleasant, sits above the noise
-- floor, doesn't clash with the game's existing chip-music. MIDI 69 is
-- A4 (440Hz); we go slightly higher so it cuts through static.
local TONE_MIDI = 72         -- C5

-- Long but finite note durations. Long enough that one playNote covers
-- a full mini-game session without needing to retrigger; finite so a
-- crashed scene that forgets to stop() will eventually go quiet.
local LONG_DURATION_SEC = 600   -- 10 minutes

-- Master ceiling so the spectrogram audio never overpowers SFX. The
-- noise and tone volumes are further scaled by quality.
local NOISE_CEILING = 0.55
local TONE_CEILING  = 0.65

-- ---------------------------------------------------------------------
-- Module state
-- ---------------------------------------------------------------------

local noise_synth = nil
local tone_synth  = nil
local running     = false
local last_quality = 0   -- exposed via getter for diagnostics

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------

local function clamp01(v)
    if v == nil then return 0 end
    if v < 0 then return 0 end
    if v > 1 then return 1 end
    return v
end

-- Multiply the synth volumes by the user's master SFX volume so the
-- existing OPTIONS slider still controls overall loudness. We treat
-- the SFX volume scale (0..10) as a linear 0..1 attenuator.
local function sfx_scale()
    if audio_manager and audio_manager.get_sfx_volume then
        local v = audio_manager.get_sfx_volume() or 0
        if v <= 0 then return 0 end
        if v >= 10 then return 1 end
        return v / 10
    end
    return 1
end

local function ensure_synths()
    if noise_synth == nil then
        noise_synth = playdate.sound.synth.new(playdate.sound.kWaveNoise)
        if noise_synth ~= nil then
            -- Short attack so noise comes in immediately, long release
            -- so a stop() fades naturally. Sustain at full so the held
            -- note delivers steady-state volume we control via setVolume.
            noise_synth:setADSR(0.01, 0.0, 1.0, 0.05)
            noise_synth:setVolume(0)
        end
    end
    if tone_synth == nil then
        tone_synth = playdate.sound.synth.new(playdate.sound.kWaveSine)
        if tone_synth ~= nil then
            tone_synth:setADSR(0.02, 0.0, 1.0, 0.10)
            tone_synth:setVolume(0)
        end
    end
end

-- ---------------------------------------------------------------------
-- Public API
-- ---------------------------------------------------------------------

function M.start()
    ensure_synths()
    if running then return end

    -- Noise: pitch is irrelevant for kWaveNoise but the API still needs
    -- a note value. Use MIDI 60 (C4) as a neutral placeholder.
    if noise_synth ~= nil then
        noise_synth:setVolume(0)
        noise_synth:playMIDINote(60, LONG_DURATION_SEC)
    end

    -- Tone: hold a sustained pitch we'll fade up as quality rises.
    if tone_synth ~= nil then
        tone_synth:setVolume(0)
        tone_synth:playMIDINote(TONE_MIDI, LONG_DURATION_SEC)
    end

    running = true
    last_quality = 0
end

function M.update(quality, dt)
    if not running then return end
    quality = clamp01(quality)
    last_quality = quality

    local master = sfx_scale()

    -- Noise dominates when off-tune; fades as we lock in.
    local noise_vol = (1.0 - quality) * NOISE_CEILING * master
    if noise_vol < 0 then noise_vol = 0 end
    if noise_synth ~= nil then
        noise_synth:setVolume(noise_vol)
    end

    -- Tone rises as we lock in.
    local tone_vol = quality * TONE_CEILING * master
    if tone_vol < 0 then tone_vol = 0 end
    if tone_synth ~= nil then
        tone_synth:setVolume(tone_vol)
    end
    -- dt is currently unused for the mix (we drive directly from
    -- quality), but it's part of the API so callers can pass through
    -- their frame delta uniformly with other updaters.
    _ = dt
end

function M.stop()
    if noise_synth ~= nil then
        noise_synth:setVolume(0)
        noise_synth:stop()
    end
    if tone_synth ~= nil then
        tone_synth:setVolume(0)
        tone_synth:stop()
    end
    running = false
    last_quality = 0
end

-- "Signal acquired" sting. We prefer the existing kombo_hit sample
-- via audio_manager because (a) it's a real audio asset that fits the
-- game's voice and (b) it routes through the SFX volume control so
-- the user's settings are honored without us doing extra work.
--
-- Fallback path: if audio_manager isn't available (defensive — main.lua
-- always loads it before us), synthesize a quick 3-note arpeggio on
-- the existing tone_synth so the player still gets feedback.
function M.play_acquired_chime()
    if audio_manager and audio_manager.play_sfx then
        audio_manager.play_sfx("kombo_hit")
        return
    end

    ensure_synths()
    if tone_synth == nil then return end

    -- Three-note arpeggio: C5 -> E5 -> G5. We schedule them by setting
    -- short MIDI notes back-to-back; playdate.sound.synth.playMIDINote
    -- is non-blocking, so we use playdate.timer.performAfterDelay if
    -- available, otherwise fire them all immediately (the engine will
    -- queue them sample-accurately).
    local notes = { 72, 76, 79 }
    local step_ms = 90
    for i, n in ipairs(notes) do
        if i == 1 then
            tone_synth:playMIDINote(n, 0.15)
        else
            if playdate.timer and playdate.timer.performAfterDelay then
                local delay = (i - 1) * step_ms
                playdate.timer.performAfterDelay(delay, function()
                    if tone_synth ~= nil then
                        tone_synth:playMIDINote(n, 0.15)
                    end
                end)
            else
                tone_synth:playMIDINote(n, 0.15)
            end
        end
    end
end

-- Diagnostic getter — useful for the scene to print quality alongside
-- the dials for debugging without reaching into module internals.
function M.get_last_quality() return last_quality end
function M.is_running()       return running end

_G.haxheadroom_audio = M
return M
