-- pulp_runtime_lua/audio_manager.lua
-- Ported from HAKCD's source/systems/audio_manager.lua.
-- Centralized music + SFX routing so volume controls + per-scene swaps
-- share one source of truth.
--
-- API:
--   audio_manager.init()
--   audio_manager.set_music_enabled(bool)
--   audio_manager.set_music_volume(0..10)
--   audio_manager.set_sfx_volume(0..10)
--   audio_manager.play_music(path, { fade_ms = 250 })
--   audio_manager.stop_music({ fade_ms = 250 })
--   audio_manager.play_sfx(name)
--
-- Internals:
--   - Single playdate.sound.fileplayer reused for music; switching tracks
--     stops the previous instance and loads the new wav (looped via play(0))
--   - SFX cache: keyed by name, never re-decodes.
--   - Volume 0..10 (stored), exposed as 0..1.

local M = {}

local music_fp        = nil
local music_path      = nil
local sfx_cache       = {}
local music_enabled   = true
local music_volume_10 = 5
local sfx_volume_10   = 7

local function to_unit(v10)
    if v10 == nil then return 0 end
    if v10 < 0 then return 0 end
    if v10 > 10 then return 1 end
    return v10 / 10
end

local function apply_music_volume()
    if not music_fp then return end
    if not music_enabled then
        music_fp:setVolume(0)
    else
        music_fp:setVolume(to_unit(music_volume_10))
    end
end

function M.init()
    -- save_state hook left abstract — pulp games don't all have one.
    -- Callers can pre-set volumes via the setters before any play_music call.
end

function M.get_music_enabled() return music_enabled end
function M.get_music_volume()  return music_volume_10 end
function M.get_sfx_volume()    return sfx_volume_10 end

function M.set_music_enabled(v)
    music_enabled = v and true or false
    apply_music_volume()
end

function M.set_music_volume(v10)
    v10 = math.max(0, math.min(10, v10 or 0))
    music_volume_10 = v10
    apply_music_volume()
end

function M.set_sfx_volume(v10)
    v10 = math.max(0, math.min(10, v10 or 0))
    sfx_volume_10 = v10
end

function M.play_music(path, opts)
    opts = opts or {}
    if path == music_path and music_fp and music_fp:isPlaying() then
        return  -- already playing this track
    end
    if music_fp and music_fp:isPlaying() then
        if opts.fade_ms and opts.fade_ms > 0 then
            music_fp:setVolume(0, 0, opts.fade_ms / 1000)
            -- Schedule stop after fade.
            playdate.timer.performAfterDelay(opts.fade_ms, function()
                if music_fp then music_fp:stop() end
            end)
        else
            music_fp:stop()
        end
    end
    music_path = path
    music_fp = playdate.sound.fileplayer.new(path)
    if not music_fp then return end
    -- Fade-in.
    local fade_in = opts.fade_ms or 250
    if fade_in > 0 then
        music_fp:setVolume(0)
        music_fp:play(0)
        music_fp:setVolume(to_unit(music_volume_10), to_unit(music_volume_10), fade_in / 1000)
    else
        apply_music_volume()
        music_fp:play(0)
    end
end

function M.stop_music(opts)
    opts = opts or {}
    if not (music_fp and music_fp:isPlaying()) then return end
    local fade_ms = opts.fade_ms or 250
    if fade_ms > 0 then
        music_fp:setVolume(0, 0, fade_ms / 1000)
        playdate.timer.performAfterDelay(fade_ms, function()
            if music_fp then music_fp:stop() end
        end)
    else
        music_fp:stop()
    end
end

function M.is_music_playing()
    return music_fp ~= nil and music_fp:isPlaying()
end

function M.play_sfx(name)
    if sfx_volume_10 <= 0 then return end
    local sp = sfx_cache[name]
    if not sp then
        -- Search both common SFX dirs; HAKCD uses sounds/, our exporter
        -- emits to sounds/ as well, with sfx_baseline/ as the procedural set.
        sp = playdate.sound.sampleplayer.new("sounds/sfx/" .. name)
        if not sp then
            sp = playdate.sound.sampleplayer.new("sfx_baseline/" .. name)
        end
        if not sp then return end
        sfx_cache[name] = sp
    end
    sp:setVolume(to_unit(sfx_volume_10))
    sp:play(1)
end

_G.audio_manager = M
return M
