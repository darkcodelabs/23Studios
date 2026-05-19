-- concepts/interaction.lua
-- Verb-based interaction dispatcher.
--
-- Load-once pattern: imported once in main.lua, self-binds to _G.interaction.
-- NEVER: local inter = import "concepts/interaction" outside main.lua.
--
-- Callers register handlers for (object_id, verb) pairs. When the player
-- triggers a verb on an object, dispatch() looks up the handler and calls it
-- with a context table supplied by the scene.
--
-- Supported verbs: 'use', 'inspect', 'take', 'talk', 'give'.
-- Additional verbs may be registered but the canonical 5 are the ones the
-- AI pipeline generates interactions for.
--
-- API:
--   interaction.register(object_id, verb, handler)
--       handler signature: function(ctx) where ctx is any table/value
--       the scene passes in (usually {scene=self, target=sprite, ...}).
--
--   interaction.dispatch(object_id, verb, ctx)
--       Calls the registered handler if one exists.
--       Returns true if a handler was found, false otherwise.
--
--   interaction.verbsFor(object_id)
--       Returns a list (sorted) of verb strings registered for object_id.

local M = {}

-- Canonical supported verbs (informational; not enforced so scenes can extend).
M.VERBS = { 'use', 'inspect', 'take', 'talk', 'give' }

-- Registry: _registry[object_id][verb] = handler
local _registry = {}

--- Register handler for (object_id, verb).
--- Subsequent calls for the same pair overwrite the previous handler.
--- object_id and verb must be non-empty strings.
--- handler must be a function.
function M.register(object_id, verb, handler)
    if type(object_id) ~= 'string' or object_id == '' then
        print('interaction.register: object_id must be a non-empty string')
        return
    end
    if type(verb) ~= 'string' or verb == '' then
        print('interaction.register: verb must be a non-empty string')
        return
    end
    if type(handler) ~= 'function' then
        print('interaction.register: handler must be a function')
        return
    end
    if _registry[object_id] == nil then
        _registry[object_id] = {}
    end
    _registry[object_id][verb] = handler
end

--- Dispatch verb on object_id with optional context ctx.
--- Returns true if a handler was found and called, false otherwise.
--- Errors inside the handler are caught and printed; dispatch returns false.
function M.dispatch(object_id, verb, ctx)
    if type(object_id) ~= 'string' or type(verb) ~= 'string' then return false end
    local obj_handlers = _registry[object_id]
    if obj_handlers == nil then return false end
    local handler = obj_handlers[verb]
    if handler == nil then return false end
    local ok, err = pcall(handler, ctx)
    if not ok then
        print('interaction.dispatch error ('..object_id..'/'..verb..'): '..tostring(err))
        return false
    end
    return true
end

--- Returns a sorted list of verb strings registered for object_id.
--- Returns an empty table if object_id has no registrations.
function M.verbsFor(object_id)
    if type(object_id) ~= 'string' then return {} end
    local obj_handlers = _registry[object_id]
    if obj_handlers == nil then return {} end
    local verbs = {}
    for v in pairs(obj_handlers) do
        table.insert(verbs, v)
    end
    table.sort(verbs)
    return verbs
end

--- Clear all registrations. Called by scene:exit() to prevent stale handlers
--- surviving into the next scene. Scenes that share persistent objects should
--- re-register on scene:enter().
function M.clearAll()
    _registry = {}
end

--- Clear all registrations for a single object_id.
function M.clearObject(object_id)
    if type(object_id) == 'string' then
        _registry[object_id] = nil
    end
end

_G.interaction = M
return M
