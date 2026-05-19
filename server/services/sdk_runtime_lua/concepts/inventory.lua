-- concepts/inventory.lua
-- Item inventory system backed by save_state.
--
-- Load-once pattern: imported once in main.lua after save_state,
-- self-binds to _G.inventory. All scenes access via the global.
-- NEVER: local inv = import "concepts/inventory" outside main.lua.
--
-- Storage key: 'inventory' inside save_state flags.
-- Shape: table of { [item_id] = qty } where qty >= 1.
--
-- API:
--   inventory.add(item_id, qty)        -- add qty (default 1) of item_id
--   inventory.remove(item_id, qty)     -- remove qty (default 1); clamped at 0
--   inventory.has(item_id)             -- bool: qty >= 1
--   inventory.count(item_id)           -- int: current qty (0 if absent)
--   inventory.list()                   -- table of {id, qty} sorted by id
--   inventory.clear()                  -- wipe all items

local M = {}

-- Internal: load raw bag from save_state, or empty table if not present yet.
local function load_bag()
    local raw = save_state.get('inventory')
    if type(raw) ~= 'table' then return {} end
    return raw
end

-- Internal: persist bag back through save_state (which calls flush).
local function save_bag(bag)
    save_state.set('inventory', bag)
end

--- Add qty of item_id to the inventory. qty defaults to 1.
--- Negative or zero qty is a no-op.
function M.add(item_id, qty)
    if type(item_id) ~= 'string' or item_id == '' then return end
    qty = math.max(0, math.floor(tonumber(qty) or 1))
    if qty == 0 then return end
    local bag = load_bag()
    bag[item_id] = (bag[item_id] or 0) + qty
    save_bag(bag)
end

--- Remove qty of item_id from the inventory. qty defaults to 1.
--- Count is clamped to 0; items at 0 are pruned from storage.
--- Returns the number of items actually removed.
function M.remove(item_id, qty)
    if type(item_id) ~= 'string' or item_id == '' then return 0 end
    qty = math.max(0, math.floor(tonumber(qty) or 1))
    if qty == 0 then return 0 end
    local bag = load_bag()
    local current = bag[item_id] or 0
    local removed = math.min(current, qty)
    local new_qty = current - removed
    if new_qty <= 0 then
        bag[item_id] = nil
    else
        bag[item_id] = new_qty
    end
    save_bag(bag)
    return removed
end

--- Returns true if the inventory contains at least 1 of item_id.
function M.has(item_id)
    if type(item_id) ~= 'string' then return false end
    return M.count(item_id) >= 1
end

--- Returns the current quantity of item_id (0 if absent).
function M.count(item_id)
    if type(item_id) ~= 'string' then return 0 end
    local bag = load_bag()
    return bag[item_id] or 0
end

--- Returns a table of {id, qty} pairs for every held item, sorted by id.
--- Callers should treat the list as read-only.
function M.list()
    local bag = load_bag()
    local result = {}
    for id, qty in pairs(bag) do
        if qty and qty > 0 then
            table.insert(result, { id = id, qty = qty })
        end
    end
    table.sort(result, function(a, b) return a.id < b.id end)
    return result
end

--- Remove all items from the inventory.
function M.clear()
    save_state.set('inventory', {})
end

_G.inventory = M
return M
