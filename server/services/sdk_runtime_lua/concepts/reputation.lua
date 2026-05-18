-- systems/reputation.lua
-- Pure compute over save_state. No state of its own.
--
-- HARDWARE BUG FIX (v0.1.2): same dependency-injection refactor as
-- chrome_theme.lua. Static `import "systems/save_state"` removed; the
-- save_state reference is injected from main.lua after both modules
-- are loaded. All functions defensively handle a nil save_state.
--
-- score = owned_systems*2 + kombos*1 + floor(nfo/5) + beats_completed + coins*5
-- tiers: l4m3r 0-4, newb 5-14, phr34k 15-34, elite 35-74, 0g 75+,
--        2ʒ at score>=200 OR 23 coins minted.

local M = {}

local TIERS = {
    { min = 200, name = "2\xCA\x92" },
    { min = 75,  name = "0g"     },
    { min = 35,  name = "elite"  },
    { min = 15,  name = "phr34k" },
    { min = 5,   name = "newb"   },
    { min = 0,   name = "l4m3r"  },
}

local _save_state = nil

function M.inject_save_state(ss)
    _save_state = ss
end

local function count_kombos(learned)
    local n = 0
    if type(learned) ~= "table" then return 0 end
    for _, v in pairs(learned) do
        if v == true then n = n + 1 end
    end
    return n
end

local function coin_count()
    if _save_state == nil or _save_state.coin_solve_count == nil then return 0 end
    return _save_state.coin_solve_count()
end

-- HaxHeadroom mini-game contribution. Each intercepted signal nudges rep
-- by 2 (additive — does not displace existing tier thresholds; designed so
-- a player who maxes the mini-game at 5 intercepts gets +10, comparable to
-- two minted coins but spread across the whole arc).
local function haxheadroom_intercepts()
    if _save_state == nil
        or _save_state.get_haxheadroom_intercept_count == nil then
        return 0
    end
    return _save_state.get_haxheadroom_intercept_count()
end

local function safe_state(s)
    if s ~= nil then return s end
    if _save_state == nil then
        return {
            owned_systems = {},
            learned_kombos = {},
            nfo_collected = {},
            beats_completed = 0,
        }
    end
    return _save_state.get()
end

function M.score(s)
    s = safe_state(s)
    local owned  = #(s.owned_systems or {})
    local kombos = count_kombos(s.learned_kombos)
    local nfo    = math.floor(#(s.nfo_collected or {}) / 5)
    local beats  = s.beats_completed or 0
    local coins  = coin_count()
    local intercepts = haxheadroom_intercepts()
    return owned * 2 + kombos + nfo + beats + coins * 5 + intercepts * 2
end

function M.tier(score)
    score = score or M.score()
    if coin_count() >= 23 then return TIERS[1].name end
    for _, t in ipairs(TIERS) do
        if score >= t.min then return t.name end
    end
    return TIERS[#TIERS].name
end

function M.owned_count()
    return #(safe_state(nil).owned_systems or {})
end

function M.summary()
    local s = safe_state(nil)
    local sc = M.score(s)
    return {
        score      = sc,
        tier       = M.tier(sc),
        owned      = #(s.owned_systems or {}),
        kombos     = count_kombos(s.learned_kombos),
        nfo        = #(s.nfo_collected or {}),
        coins      = coin_count(),
        intercepts = haxheadroom_intercepts(),
    }
end

_G.reputation = M
return M
