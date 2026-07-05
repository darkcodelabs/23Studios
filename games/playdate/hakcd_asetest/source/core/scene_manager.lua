-- core/scene_manager — stack-based scenes (HAKCD canon: push/pop/replace,
-- exit() runs before the new scene's enter()). Self-binds _G.scene_manager.
-- A scene is a table with optional :enter(args) :exit() :update() :draw().
local SM = {}
local stack = {}

local function top() return stack[#stack] end

function SM.push(scene, args)
    local t = top(); if t and t.pause then t:pause() end
    stack[#stack + 1] = scene
    if scene.enter then scene:enter(args or {}) end
end
function SM.pop(result)
    local t = top()
    if t then
        if t.exit then t:exit() end
        stack[#stack] = nil
    end
    local n = top()
    if n and n.resume then n:resume(result) end
end
function SM.replace(scene, args)
    local t = top()
    if t then if t.exit then t:exit() end; stack[#stack] = nil end
    SM.push(scene, args)
end
function SM.current() return top() end
function SM.depth() return #stack end

function SM.update()
    local t = top()
    if not t then return end
    if t.update then t:update() end
end
_G.scene_manager = SM
return SM
