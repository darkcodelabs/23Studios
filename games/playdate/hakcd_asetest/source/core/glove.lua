-- core/glove — the PWNGLOVE: the player's multitool and its selectable powers.
-- The glove is the whole game: you aim it (crank) and fire a power at a device.
-- Self-binds _G.glove.
local G = {}

G.powers = {
    { id = "lockpick", name = "LOCKPICK",  kind = "minigame", verb = "PICKING" },
    { id = "rfid",     name = "RFID CLONE", kind = "channel",  verb = "CLONING",  dur = 45 },
    { id = "subghz",   name = "SUB-GHZ",   kind = "channel",  verb = "TUNING",   dur = 60 },
    { id = "ir",       name = "IR BLASTER", kind = "channel",  verb = "BLASTING", dur = 30 },
}
G.cur = 1

function G.current() return G.powers[G.cur] end
function G.cycle() G.cur = (G.cur % #G.powers) + 1 end
function G.name() return G.powers[G.cur].name end

_G.glove = G
return G
