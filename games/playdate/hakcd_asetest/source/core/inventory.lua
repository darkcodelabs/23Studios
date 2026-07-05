-- core/inventory — item bag backed by save_state. Self-binds _G.inventory.
local I = {}
local NAMES = {
    encrypted_cache = "Mentor's encrypted cache",
    corp_number     = "PhoenixDown dial-up #",
    konsole_number  = "k0nsole's payphone #",
    telco_memo      = "Aegis telco memo (fax)",
    trunk_route     = "MF trunk route",
}
function I.add(id)
    local raw = save_state.raw(); raw.items[id] = true; save_state.save()
    audio.coin()
end
function I.has(id) return save_state.raw().items[id] == true end
function I.list()
    local out = {}
    for id in pairs(save_state.raw().items) do out[#out+1] = NAMES[id] or id end
    table.sort(out); return out
end
_G.inventory = I
return I
