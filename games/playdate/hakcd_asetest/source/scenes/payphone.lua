-- scenes/payphone — Greyhound station payphone bank (SC15). Walk to the lit
-- phone, A to start the red-box minigame. On success, k0nsole calls back.
-- Self-binds _G.scene_payphone.
local S = {}

local function usePhone(room)
    if quest.is("goto_payphone") then quest.complete("goto_payphone") end
    if quest.is("redbox") then
        scene_manager.push(mg_redbox.new())
    else
        dialogue.start({
            { who = "NEWB", port = "portrait_newb", text = "Line's dead until I trick it into thinking I paid." },
        })
    end
end

S.room = nil
function S:enter()
    self.pendingCall = false
    self.room = isoroom.new({
        bg = "scene_payphone", mood = "night", title = "GREYHOUND STATION -- 1:12 AM",
        floor = { x1 = 40, y1 = 170, x2 = 360, y2 = 214 },
        spawn = { x = 200, y = 200 },
        hotspots = {
            { x = 120, y = 150, r = 60, label = "PAYPHONE", onInteract = usePhone },
        },
        onEnter = function() if quest.is("goto_payphone") then
            dialogue.start({
                { who = "NEWB", port = "portrait_newb", text = "k0nsole's number's a payphone. Phone-to-phone. No records." },
                { who = "NEWB", port = "portrait_newb", text = "First I need a free line. Time to red-box." },
            })
        end end,
    })
    self.room:enter()
end
function S:resume(result)
    self.room:resume()
    -- returning from a successful red box: k0nsole calls
    if quest.is("goto_pedestal") and not self.pendingCall then
        self.pendingCall = true
        dialogue.start({
            { who = "K0NSOLE", port = "portrait_konsole", text = "...You actually boxed it. The Mentor picked right." },
            { who = "K0NSOLE", port = "portrait_konsole", text = "Listen fast. There's a Bell pedestal, Maple St, the yard with the dead porch light." },
            { who = "K0NSOLE", port = "portrait_konsole", text = "Inside it a fax runs Aegis memos at 2AM. Pick the lock, tap the line." },
            { who = "K0NSOLE", port = "portrait_konsole", text = "Then blue-box the trunk before they notice. That's the whole ballgame.", choices = {
                { label = "Who are you?", done = true },
                { label = "On it.", done = true },
            } },
        })
    end
end
function S:update() self.room:update() end

_G.scene_payphone = S
return S
