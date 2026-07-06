-- core/rig — the progression backbone (Under-the-Tree loop): your cred wallet,
-- the tools you own, which targets are open, which are cleared, and the intel
-- (data clues) you've pulled. Persisted via save_state. Self-binds _G.rig.
local R = {}

local function st()
    local r = save_state.raw()
    if not r.rig then
        r.rig = { cred = 0, tools = {}, open = { deadline = true }, cleared = {}, data = {} }
    end
    return r.rig
end

function R.cred() return st().cred end
function R.addCred(n) st().cred = st().cred + n; save_state.save() end
function R.spend(n) local s = st(); if s.cred >= n then s.cred = s.cred - n; save_state.save(); return true end return false end

function R.hasTool(id) return st().tools[id] == true end
function R.unlockTool(id) st().tools[id] = true; save_state.save() end

function R.isOpen(id) return st().open[id] == true end
function R.open(id) st().open[id] = true; save_state.save() end

function R.isCleared(id) return st().cleared[id] == true end
function R.clear(id) st().cleared[id] = true; save_state.save() end

function R.addData(clue)
    local s = st()
    for _, c in ipairs(s.data) do if c == clue then return end end
    s.data[#s.data + 1] = clue; save_state.save()
end
function R.data() return st().data end

_G.rig = R
return R
