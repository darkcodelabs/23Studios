-- core/targets — the dive targets + purchasable tools (data only). Self-binds
-- _G.targets. A target: id, name, number, blurb, tool (required to dive, or nil),
-- hack (which challenge), reward {cred, data}, unlocks (targets opened on clear).
local T = {}

T.list = {
    { id = "deadline", name = "DEADLINE BBS",     number = "555-0142",
      blurb = "A dead board that still answers.",
      tool = nil, hack = "mentor",
      reward = { cred = 20, data = "The Mentor died in '96. Something is still running his board." },
      unlocks = { "phoenix" } },

    { id = "phoenix",  name = "PhoenixDown Corp", number = "913-555-2600",
      blurb = "Corporate board. Locked to new users.",
      tool = nil, hack = "lockpick",
      reward = { cred = 60, data = "PhoenixDown hides an encrypted cache stamped HOLLOWPOINT." },
      unlocks = { "aegis" } },

    { id = "aegis",    name = "Aegis Datalink VPN", number = "913-555-8080",
      blurb = "Dev VPN. You'll need a cracker.",
      tool = "cracker", hack = "bluebox",
      reward = { cred = 140, data = "Aegis is staging HOLLOWPOINT at Tier-1 peering points. Mid-'99." },
      unlocks = {} },
}

T.tools = {
    { id = "cracker", name = "Password Cracker", cost = 40,
      blurb = "Brute-forces dev logins. Opens Aegis." },
}

function T.get(id) for _, t in ipairs(T.list) do if t.id == id then return t end end end
function T.tool(id) for _, t in ipairs(T.tools) do if t.id == id then return t end end end

_G.targets = T
return T
