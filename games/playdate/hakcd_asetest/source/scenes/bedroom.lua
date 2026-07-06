-- scenes/bedroom — the recurring hub (SC01). Isometric room. The computer
-- launches the BBS then the war dialer; the door leads to the overworld once
-- the player has a reason to leave. Self-binds _G.scene_bedroom.
local S = {}

local function computer(room)
    -- the rig: opens the war dialer / dive hub (the core loop)
    scene_manager.push(scene_dialer)
end

local function door(room)
    dialogue.start({
        { who = "newb", port = "portrait_newb", text = "Nowhere to be tonight. The action's on the wire." },
    })
end

local function bed(room)
    dialogue.start({
        { who = "MOM", port = "portrait_mom", text = "Are you STILL on that computer?! It's almost midnight!" },
        { who = "NEWB", port = "portrait_newb", text = "Five more minutes, Mom. Homework." },
        { who = "NEWB", port = "portrait_newb", text = "(Progress saved. The line goes quiet for a while.)", onEnter = nil },
    })
    save_state.save()
end

S.room = nil
function S:enter()
    self.room = isoroom.new({
        bg = "room_bedroom", mood = "calm", title = "YOUR ROOM -- 11:47 PM",
        floor = { x1 = 60, y1 = 150, x2 = 340, y2 = 214 },
        spawn = { x = 200, y = 190 },
        hotspots = {
            { x = 96,  y = 150, r = 46, label = "COMPUTER", onInteract = computer },
            { x = 300, y = 150, r = 44, label = "BED",      onInteract = bed },
            { x = 344, y = 196, r = 40, label = "DOOR",     onInteract = door },
        },
    })
    self.room:enter()
end
function S:resume() self.room:resume() end
function S:update() self.room:update() end

_G.scene_bedroom = S
return S
