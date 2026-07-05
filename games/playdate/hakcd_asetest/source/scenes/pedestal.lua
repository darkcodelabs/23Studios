-- scenes/pedestal — Bell pedestal yard, 2AM (SC17/18). Lockpick to open, then
-- blue-box the trunk. Completing the blue box ends the slice. Self-binds
-- _G.scene_pedestal.
local S = {}

local function usePedestal(room)
    if quest.is("goto_pedestal") then quest.complete("goto_pedestal") end
    if quest.is("lockpick") then
        scene_manager.push(mg_lockpick.new())
    elseif quest.is("bluebox") then
        scene_manager.push(mg_bluebox.new())
    else
        dialogue.start({ { who = "NEWB", port = "portrait_newb", text = "It's open and tapped. One thing left." } })
    end
end

S.room = nil
function S:enter()
    self.didIntro = false
    self.didOutro = false
    self.room = isoroom.new({
        bg = "scene_pedestal", mood = "night", title = "MAPLE ST YARD -- 2:03 AM",
        floor = { x1 = 40, y1 = 172, x2 = 360, y2 = 216 },
        spawn = { x = 200, y = 205 },
        hotspots = {
            { x = 200, y = 150, r = 64, label = "BELL PEDESTAL", onInteract = usePedestal },
        },
        onEnter = function()
            dialogue.start({
                { who = "NEWB", port = "portrait_newb", text = "2AM. Dead porch light. This is the one." },
                { who = "NEWB", port = "portrait_newb", text = "Tension wrench, five pins. Quiet hands." },
            })
        end,
    })
    self.room:enter()
end
function S:resume(result)
    self.room:resume()
    if result and result.alarm then
        dialogue.start({
            { who = "NEWB", port = "portrait_newb", text = "(A porch light snaps on next door. Freeze... then walk away slow.)" },
        })
        return
    end
    if quest.is("done") and not self.didOutro then
        self.didOutro = true
        dialogue.start({
            { who = "K0NSOLE", port = "portrait_konsole", text = "Trunk's open. The wire is yours now, kid." },
            { who = "THE MENTOR", port = "portrait_mentor", text = "Told you. Curiosity is the whole job. This is where the real work starts." },
            { who = "NEWB", port = "portrait_newb", text = "(END OF SLICE -- every pixel authored by the prompt->Aseprite pipeline.)", choices = {
                { label = "Back to the map", onPick = function() scene_manager.replace(scene_overworld) end, done = true },
            } },
        })
    end
end
function S:update() self.room:update() end

_G.scene_pedestal = S
return S
