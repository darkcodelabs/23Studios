-- sdk_runtime_lua/scene_manager.lua
-- Ported from HAKCD source/systems/scene_manager.lua.
-- Stack-based scene manager. push / pop / replace.
--
-- Scene lifecycle (all optional):
--   :init(args)   one-time when constructed
--   :enter()      becomes top of stack
--   :exit()       leaves top of stack
--   :update(dt)   every frame while on top
--   :draw()       every frame while on top, after :update()
--   :input(evt)   optional input handler

local M = {}

local stack = {}

local function top()
    return stack[#stack]
end

local function callIf(scene, name, ...)
    if scene and type(scene[name]) == "function" then
        scene[name](scene, ...)
    end
end

function M.push(scene, args)
    if scene == nil then return end
    local cur = top()
    callIf(cur, "exit")
    callIf(scene, "init", args)
    callIf(scene, "enter")
    table.insert(stack, scene)
end

function M.replace(scene, args)
    local cur = top()
    callIf(cur, "exit")
    if cur ~= nil then table.remove(stack, #stack) end
    callIf(scene, "init", args)
    callIf(scene, "enter")
    table.insert(stack, scene)
end

function M.pop()
    local cur = top()
    if cur == nil then return end
    callIf(cur, "exit")
    table.remove(stack, #stack)
    callIf(top(), "enter")
end

function M.current() return top() end
function M.depth()   return #stack end

function M.update(dt) callIf(top(), "update", dt) end
function M.draw()     callIf(top(), "draw")        end
function M.input(evt) callIf(top(), "input", evt)  end

_G.scene_manager = M
return M
