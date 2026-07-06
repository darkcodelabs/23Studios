-- scenes/bedroom — the hub (SC01), now a STATIC illustrated frame matching the
-- design_handoff. The kid lives in the art; the player cursors between
-- hotspots (COMPUTER, PHONE, POSTER) and interacts. Self-binds _G.scene_bedroom.
local S = {}

local function computer(sc)
    if quest.is("read_bbs") then
        scene_manager.push(scene_bbs)
    elseif quest.is("wardial") then
        scene_manager.push(mg_wardialer.new())
    elseif quest.index() >= 3 then
        dialogue.start({
            { who = "THE MENTOR", port = "portrait_mentor", text = "Good hunt. PhoenixDown's carrier is logged." },
            { who = "THE MENTOR", port = "portrait_mentor", text = "That's the end of this slice, kid. More boards come online soon." },
        })
    else
        dialogue.start({
            { who = "newb", port = "portrait_newb", text = "Modem's cooling off. Nothing to dial right now." },
        })
    end
end

local function poster(sc)
    dialogue.start({
        { who = "newb", port = "portrait_newb", text = "HACKERS. 'Their crime is curiosity.' Damn right." },
    })
end

local function phone(sc)
    dialogue.start({
        { who = "MOM", port = "portrait_newb", text = "(from down the hall) Off the phone! I'm expecting a call!" },
        { who = "newb", port = "portrait_newb", text = "It's the modem, Mom. Five more minutes." },
    })
    save_state.save()
end

function S:enter()
    self.sc = scene_static.new({
        bg = "room_bedroom", mood = "calm", title = "YOUR ROOM -- 11:47 PM",
        hotspots = {
            { x = 250, y = 110, label = "COMPUTER", onInteract = computer },
            { x = 92,  y = 70,  label = "POSTER",   onInteract = poster },
            { x = 330, y = 150, label = "PHONE",    onInteract = phone },
        },
    })
    self.sc:enter()
end
function S:resume(r) self.sc:resume(r) end
function S:update() self.sc:update() end

_G.scene_bedroom = S
return S
