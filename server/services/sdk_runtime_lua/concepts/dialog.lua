-- systems/dialog.lua
-- Loads dialog pools (list of lines) from data/dialog/*.lua. Provides
-- random picks and "unseen first" sampling driven by save_state.
--
-- HARDWARE BUG FIX (v0.1.2): static `import "systems/save_state"`
-- removed. The save_state reference is injected from main.lua via
-- M.inject_save_state. If never injected, pick_unseen falls back to
-- pick() — no crash.
--
-- Pool entry shape:
--   { id = "old_heads_01", text = "..." }
--
-- Voices and tone are constrained by DESIGN_RULES §7.

local M = {}

local _save_state = nil

function M.inject_save_state(ss)
    _save_state = ss
end

local function get_seen_set()
    if _save_state == nil then return {} end
    local s = _save_state.get()
    s._dialog_seen = s._dialog_seen or {}
    return s._dialog_seen
end

function M.load(pool_table)
    if type(pool_table) ~= "table" then return {} end
    return pool_table
end

function M.pick(pool)
    if type(pool) ~= "table" or #pool == 0 then return nil end
    return pool[math.random(1, #pool)]
end

function M.pick_unseen(pool)
    if type(pool) ~= "table" or #pool == 0 then return nil end
    local seen = get_seen_set()
    local candidates = {}
    for _, entry in ipairs(pool) do
        if entry.id and not seen[entry.id] then
            table.insert(candidates, entry)
        end
    end
    if #candidates == 0 then
        return M.pick(pool)
    end
    local choice = candidates[math.random(1, #candidates)]
    if choice.id then seen[choice.id] = true end
    return choice
end

function M.format(line, vars)
    if type(line) ~= "string" then return line end
    if type(vars) ~= "table" then return line end
    return (line:gsub("{(%w+)}", function(key) return tostring(vars[key] or "") end))
end

_G.dialog = M
return M
