-- core/save_state — tiny persisted key/value store. Self-binds _G.save_state.
local S = {}
local DATA = { flags = {}, items = {}, quests = {}, handle = "newb" }

function S.load()
    local d = playdate.datastore.read("hakcd_save")
    if d then
        DATA.flags  = d.flags  or {}
        DATA.items  = d.items  or {}
        DATA.quests = d.quests or {}
        DATA.handle = d.handle or "newb"
    end
end
function S.save() playdate.datastore.write(DATA, "hakcd_save") end

function S.get(k) return DATA.flags[k] end
function S.set(k, v) DATA.flags[k] = v; S.save() end
function S.handle() return DATA.handle end

function S.raw() return DATA end   -- inventory/quest modules share the table
_G.save_state = S
return S
