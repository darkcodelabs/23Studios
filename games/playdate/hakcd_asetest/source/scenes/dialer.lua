-- scenes/dialer — the loop hub UI. A clean list of dive targets you can dial,
-- your cred, and a way into the RIG (upgrade shop). Dialing a target runs its
-- one hack; clearing it pays cred + intel and opens the next target.
-- Self-binds _G.scene_dialer.
local gfx <const> = playdate.graphics
local S = {}

local function openTargets()
    local out = {}
    for _, t in ipairs(targets.list) do if rig.isOpen(t.id) then out[#out + 1] = t end end
    return out
end

function S:enter()
    self.tick = 0
    self.sel = 1
    self.pendingAward = nil
    audio.music("calm")
end

function S:rows()
    local r = openTargets()
    r[#r + 1] = { rigrow = true }
    return r
end

function S:award(t)
    if not rig.isCleared(t.id) then
        rig.addCred(t.reward.cred or 0)
        if t.reward.data then rig.addData(t.reward.data) end
        rig.clear(t.id)
        for _, u in ipairs(t.unlocks or {}) do rig.open(u) end
        dialogue.start({
            { who = "// ACCESS GRANTED", text = "+" .. (t.reward.cred or 0) .. " cred." },
            { who = "// INTEL", text = t.reward.data or "Nothing new." },
        })
    end
end

function S:dive(t)
    if rig.isCleared(t.id) then
        dialogue.start({ { who = "newb", port = "portrait_newb", text = "Already cracked " .. t.name .. ". Nothing new to pull." } })
        return
    end
    if t.tool and not rig.hasTool(t.tool) then
        local tl = targets.tool(t.tool)
        dialogue.start({ { who = "newb", port = "portrait_newb", text = "Locked. I need the " .. (tl and tl.name or t.tool) .. " first. Check the RIG." } })
        audio.err(); return
    end
    if t.hack == "mentor" then
        dialogue.start({
            { who = "THE MENTOR", port = "portrait_mentor", text = "You dialed a dead board, kid. Most people hang up. You didn't." },
            { who = "THE MENTOR", port = "portrait_mentor", text = "Curiosity is the whole job. There's a corporate board -- PhoenixDown. Go pull its secret." },
        }, function() self:award(t) end)
    elseif t.hack == "lockpick" then
        scene_manager.push(mg_lockpick.new(function() self.pendingAward = t end))
    elseif t.hack == "bluebox" then
        scene_manager.push(mg_bluebox.new(function() self.pendingAward = t end))
    else
        scene_manager.push(mg_wardialer.new(function() self.pendingAward = t end))
    end
end

function S:resume()
    audio.music("calm")
    if self.pendingAward then local t = self.pendingAward; self.pendingAward = nil; self:award(t) end
end

function S:update()
    self.tick += 1
    if dialogue.active() then dialogue.update(); self:draw(); return end
    local rows = self:rows()
    if playdate.buttonJustPressed(playdate.kButtonDown) then self.sel = (self.sel % #rows) + 1; audio.tick() end
    if playdate.buttonJustPressed(playdate.kButtonUp) then self.sel = (self.sel - 2) % #rows + 1; audio.tick() end
    if playdate.buttonJustPressed(playdate.kButtonA) then
        local row = rows[self.sel]
        if row.rigrow then audio.ok(); scene_manager.push(scene_shop)
        else audio.ok(); self:dive(row) end
    end
    if playdate.buttonJustPressed(playdate.kButtonB) then scene_manager.pop() end
    self:draw()
end

function S:draw()
    gfx.clear(gfx.kColorBlack)
    gfx.setImageDrawMode(gfx.kDrawModeFillWhite)
    -- header
    gfx.setFont(gfx.getSystemFont(gfx.font.kVariantBold) or gfx.getSystemFont())
    gfx.drawText("WAR DIALER", 16, 12)
    gfx.setFont(gfx.getSystemFont())
    local cred = "cred " .. rig.cred()
    gfx.drawTextAligned(cred, 384, 14, kTextAlignment.right)
    gfx.setColor(gfx.kColorWhite); gfx.drawLine(16, 32, 384, 32)

    local rows = self:rows()
    for i, row in ipairs(rows) do
        local y = 44 + (i - 1) * 30
        local seld = (i == self.sel)
        if seld then
            gfx.setColor(gfx.kColorWhite); gfx.fillRect(12, y - 2, 376, 26)
            gfx.setImageDrawMode(gfx.kDrawModeFillBlack)
        else
            gfx.setImageDrawMode(gfx.kDrawModeFillWhite)
        end
        if row.rigrow then
            gfx.drawText("RIG   upgrade your kit", 22, y + 4)
        else
            gfx.drawText(row.name .. "   " .. row.number, 22, y)
            local status
            if rig.isCleared(row.id) then status = "CRACKED"
            elseif row.tool and not rig.hasTool(row.tool) then status = "LOCKED"
            else status = "DIAL" end
            gfx.drawTextAligned(status, 380, y, kTextAlignment.right)
            gfx.drawText(row.blurb, 22, y + 12)
        end
        gfx.setImageDrawMode(gfx.kDrawModeFillWhite)
    end

    gfx.drawTextAligned("A dial     B back", 200, 224, kTextAlignment.center)
    gfx.setImageDrawMode(gfx.kDrawModeCopy)
    if dialogue.active() then dialogue.draw() end
end

_G.scene_dialer = S
return S
