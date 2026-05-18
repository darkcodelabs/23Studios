-- sdk_runtime_lua/save_state.lua
-- Minimal save-state backed by playdate.datastore. Mirrors HAKCD's
-- save_state public surface but slimmed for autopilot-generated games
-- (no per-game custom flags up front; callers extend at runtime).
--
-- API:
--   save_state.init()                       — load from datastore (or defaults)
--   save_state.flush()                      — write to datastore
--   save_state.get(key)                     — read a flag
--   save_state.set(key, value)              — set + flush
--   save_state.get_music_enabled()          — defaults true
--   save_state.set_music_enabled(bool)
--   save_state.get_music_volume()           — defaults 5
--   save_state.set_music_volume(0..10)
--   save_state.get_sfx_volume()             — defaults 7
--   save_state.set_sfx_volume(0..10)

local M = {}
local SLOT = "savestate"
local DEFAULTS = {
    music_enabled = true,
    music_volume  = 5,
    sfx_volume    = 7,
    flags         = {}
}

local data = nil

local function clone_defaults()
    return {
        music_enabled = DEFAULTS.music_enabled,
        music_volume  = DEFAULTS.music_volume,
        sfx_volume    = DEFAULTS.sfx_volume,
        flags         = {}
    }
end

function M.init()
    local loaded = playdate.datastore.read(SLOT)
    if type(loaded) == "table" then
        data = {
            music_enabled = (loaded.music_enabled ~= false),
            music_volume  = tonumber(loaded.music_volume) or DEFAULTS.music_volume,
            sfx_volume    = tonumber(loaded.sfx_volume)   or DEFAULTS.sfx_volume,
            flags         = (type(loaded.flags) == "table") and loaded.flags or {}
        }
    else
        data = clone_defaults()
    end
end

function M.flush()
    if data == nil then return end
    playdate.datastore.write(data, SLOT)
end

local function ensure()
    if data == nil then data = clone_defaults() end
end

function M.get(key)        ensure(); return data.flags[key] end
function M.set(key, value) ensure(); data.flags[key] = value; M.flush() end

function M.get_music_enabled() ensure(); return data.music_enabled end
function M.set_music_enabled(v) ensure(); data.music_enabled = v and true or false; M.flush() end

function M.get_music_volume() ensure(); return data.music_volume end
function M.set_music_volume(v10) ensure(); data.music_volume = math.max(0, math.min(10, v10 or 0)); M.flush() end

function M.get_sfx_volume() ensure(); return data.sfx_volume end
function M.set_sfx_volume(v10) ensure(); data.sfx_volume = math.max(0, math.min(10, v10 or 0)); M.flush() end

_G.save_state = M
return M
