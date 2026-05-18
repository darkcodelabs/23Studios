-- systems/phrase_validator.lua
-- Pure validator. No state.
--
-- Normalization:
--   - lowercase both sides
--   - convert curly quotes to straight
--   - collapse internal whitespace to a single space
--   - strip leading/trailing whitespace
--   - strip terminal punctuation (.,!?)
--
-- Comparison:
--   - direct string equality after normalization
--   - optionally checks coin_data.valid_alternates if present
--
-- Per docs/COINS_RESEARCH.md, every coin currently ships with
-- phrase_that_pays = nil (path c). validate() will return false for any
-- user input until a coin's phrase is published in a content update;
-- the scene layer still calls record_coin_attempt() so the player can
-- review their submissions locally.

local M = {}

local CURLY = {
    ["\xE2\x80\x98"] = "'",  -- left single
    ["\xE2\x80\x99"] = "'",  -- right single
    ["\xE2\x80\x9C"] = '"',  -- left double
    ["\xE2\x80\x9D"] = '"',  -- right double
    ["\xE2\x80\x93"] = "-",  -- en dash
    ["\xE2\x80\x94"] = "-",  -- em dash
}

local function normalize(s)
    if type(s) ~= "string" then return "" end
    for from, to in pairs(CURLY) do
        s = s:gsub(from, to)
    end
    s = s:lower()
    s = s:gsub("[%.,!%?]+%s*$", "")
    s = s:gsub("%s+", " ")
    s = s:gsub("^%s+", ""):gsub("%s+$", "")
    return s
end

function M.normalize(s)
    return normalize(s)
end

function M.validate(coin_data, user_phrase)
    if type(coin_data) ~= "table" then return false end
    if coin_data.phrase_that_pays == nil then return false end
    local target = normalize(coin_data.phrase_that_pays)
    local entry  = normalize(user_phrase)
    if entry == "" or target == "" then return false end
    if entry == target then return true end
    if type(coin_data.valid_alternates) == "table" then
        for _, alt in ipairs(coin_data.valid_alternates) do
            if normalize(alt) == entry then return true end
        end
    end
    return false
end

_G.phrase_validator = M
return M
