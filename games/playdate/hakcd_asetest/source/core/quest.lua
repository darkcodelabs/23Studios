-- core/quest — linear objective tracker for the Act-1 slice. Self-binds
-- _G.quest. Objectives advance the story; the bedroom HUD shows the current one.
local Q = {}

-- ordered objective list. id + short HUD line + optional longer hint.
local STEPS = {
    { id = "read_bbs",    line = "Jack into DEADLINE BBS",        hint = "Sit at the computer in your room." },
    { id = "wardial",     line = "War-dial for the corp exchange", hint = "Use the War Dialer at the terminal." },
    { id = "goto_payphone", line = "Reach the Greyhound payphones", hint = "Leave the house; cross town." },
    { id = "redbox",      line = "Red-box a free call to k0nsole", hint = "Match the DTMF tones on the payphone." },
    { id = "goto_pedestal", line = "Find the Bell pedestal (2am)",  hint = "k0nsole marked a yard on the map." },
    { id = "lockpick",    line = "Crack the pedestal lock",        hint = "Crank the tension wrench, set 5 pins." },
    { id = "bluebox",     line = "Seize the trunk (blue box)",     hint = "Hold 2600 Hz, then dial the MF route." },
    { id = "done",        line = "Slice complete — the wire is open", hint = "" },
}

function Q.index()
    local raw = save_state.raw()
    return raw.quests.step or 1
end
function Q.current() return STEPS[Q.index()] end
function Q.is(id) local c = Q.current(); return c and c.id == id end

function Q.complete(id)
    if not Q.is(id) then return false end   -- only advance the active step
    local raw = save_state.raw()
    raw.quests.step = math.min(#STEPS, Q.index() + 1)
    save_state.save()
    audio.chime()
    return true
end

function Q.reset()
    local raw = save_state.raw(); raw.quests.step = 1; save_state.save()
end
function Q.steps() return STEPS end

_G.quest = Q
return Q
