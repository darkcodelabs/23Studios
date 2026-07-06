-- core/arena — isometric twin-stick shooter (Spooky-Squad-like). D-pad moves,
-- the CRANK aims the packet-blaster, hold A to fire. The blaster builds HEAT and
-- overheats if you hold it too long. Clear every ICE/WORM in the sector to win.
-- Minimal HUD: heat gauge + health + threats-left. Self-binds _G.arena as a
-- constructor: arena.new(levelIndex) -> scene.
local gfx <const> = playdate.graphics
local A = {}

-- ---- level table: which threats, how many, arena art ----
local LEVELS = {
    { name = "SECTOR 1: FRONT DOOR", bg = "arena_sector", ice = 4, worm = 0, spawnEvery = 55 },
    { name = "SECTOR 2: MAIL RELAY", bg = "arena_sector", ice = 4, worm = 3, spawnEvery = 48 },
    { name = "SECTOR 3: CORE",       bg = "arena_sector", ice = 6, worm = 5, spawnEvery = 40 },
}

local FLOOR = { x1 = 24, y1 = 40, x2 = 376, y2 = 216 }  -- playfield bounds (screen space)

local function clampF(x, lo, hi) return math.max(lo, math.min(hi, x)) end

function A.new(levelIdx)
    local s = {}
    s.levelIdx = levelIdx or 1
    s.L = LEVELS[s.levelIdx] or LEVELS[1]

    function s:enter()
        self.tick = 0
        self.bg = gfx.image.new("images/" .. self.L.bg)
        self.iceSheet = gfx.imagetable.new("images/enemy_ice")
        self.wormSheet = gfx.imagetable.new("images/enemy_worm")
        self.heroSheet = gfx.imagetable.new("images/newb_hero")
        self.chipSheet = gfx.imagetable.new("images/pickup_chip")
        self.p = { x = 200, y = 128, dir = 1, frame = 1, hp = 3, iframe = 0, step = 0,
                   heat = 0, overheat = false, dmg = 1, range = 130, rof = 5, lastMove = { x = 0, y = 1 } }
        self.shots = {}
        self.foes = {}
        self.chips = {}
        self.toSpawn = { ice = self.L.ice, worm = self.L.worm }
        self.spawned = 0
        self.state = "intro"   -- intro | fight | cleared | dead
        self.stateT = 0
        audio.music("tense")
    end
    function s:resume() audio.music("tense") end

    -- ---- spawning ----
    function s:spawnEdge(kind)
        local side = math.random(1, 4)
        local x, y
        if side == 1 then x = FLOOR.x1 + 4; y = math.random(FLOOR.y1, FLOOR.y2)
        elseif side == 2 then x = FLOOR.x2 - 4; y = math.random(FLOOR.y1, FLOOR.y2)
        elseif side == 3 then x = math.random(FLOOR.x1, FLOOR.x2); y = FLOOR.y1 + 4
        else x = math.random(FLOOR.x1, FLOOR.x2); y = FLOOR.y2 - 4 end
        local hp = (kind == "worm") and 2 or 3
        local spd = (kind == "worm") and 1.5 or 0.9
        self.foes[#self.foes + 1] = { x = x, y = y, hp = hp, kind = kind, spd = spd, frame = 1, hitT = 0 }
    end

    function s:remaining() return self.toSpawn.ice + self.toSpawn.worm + #self.foes end

    -- ---- firing ----
    function s:aimVec()
        if playdate.isCrankDocked() then
            local m = self.p.lastMove
            local n = math.sqrt(m.x*m.x + m.y*m.y); if n == 0 then return 0, -1 end
            return m.x/n, m.y/n
        end
        local a = math.rad(playdate.getCrankPosition())
        return math.sin(a), -math.cos(a)
    end

    function s:fire()
        local ax, ay = self:aimVec()
        self.shots[#self.shots + 1] = { x = self.p.x, y = self.p.y - 20, vx = ax * 6, vy = ay * 6, life = self.p.range / 6 }
        audio.blip(1400)
        self.p.heat = math.min(100, self.p.heat + 9)
        if self.p.heat >= 100 then self.p.overheat = true; audio.err() end
    end

    function s:update()
        self.tick += 1
        local p = self.p

        if self.state == "intro" then
            self.stateT += 1
            if self.stateT > 60 or playdate.buttonJustPressed(playdate.kButtonA) then self.state = "fight" end
            self:draw(); return
        end
        if self.state == "cleared" then
            self.stateT += 1
            if self.stateT > 40 and playdate.buttonJustPressed(playdate.kButtonA) then
                local nxt = LEVELS[self.levelIdx + 1]
                if nxt then scene_manager.replace(arena.new(self.levelIdx + 1))
                else scene_manager.replace(scene_win) end
                return
            end
            self:draw(); return
        end
        if self.state == "dead" then
            self.stateT += 1
            if self.stateT > 40 and playdate.buttonJustPressed(playdate.kButtonA) then
                scene_manager.replace(arena.new(self.levelIdx))
                return
            end
            self:draw(); return
        end

        -- FIGHT ------------------------------------------------------------
        -- movement (screen-space 8-dir)
        local dx, dy = 0, 0
        if playdate.buttonIsPressed(playdate.kButtonLeft)  then dx = -1 end
        if playdate.buttonIsPressed(playdate.kButtonRight) then dx =  1 end
        if playdate.buttonIsPressed(playdate.kButtonUp)    then dy = -1 end
        if playdate.buttonIsPressed(playdate.kButtonDown)  then dy =  1 end
        local moving = (dx ~= 0 or dy ~= 0)
        if moving then
            local n = math.sqrt(dx*dx + dy*dy); local SP = 2.6
            p.x = clampF(p.x + dx/n*SP, FLOOR.x1, FLOOR.x2)
            p.y = clampF(p.y + dy/n*SP, FLOOR.y1, FLOOR.y2)
            p.lastMove = { x = dx, y = dy }
            if self.tick % 6 == 0 then p.frame = (p.frame % 4) + 1; p.step += 1; if p.step % 2 == 0 then audio.step() end end
        else p.frame = 1 end
        -- face by aim
        local ax, ay = self:aimVec()
        if math.abs(ax) > math.abs(ay) then p.dir = (ax < 0) and 3 or 4 else p.dir = (ay < 0) and 2 or 1 end

        -- firing + heat
        if playdate.buttonIsPressed(playdate.kButtonA) and not p.overheat then
            if self.tick % p.rof == 0 then self:fire() end
        else
            p.heat = math.max(0, p.heat - 2)
        end
        if p.overheat and p.heat <= 12 then p.overheat = false end

        -- spawn
        if (self.toSpawn.ice > 0 or self.toSpawn.worm > 0) and self.tick % self.L.spawnEvery == 0 then
            if self.toSpawn.ice > 0 then self.toSpawn.ice -= 1; self:spawnEdge("ice")
            elseif self.toSpawn.worm > 0 then self.toSpawn.worm -= 1; self:spawnEdge("worm") end
        end

        -- shots
        for i = #self.shots, 1, -1 do
            local sh = self.shots[i]
            sh.x += sh.vx; sh.y += sh.vy; sh.life -= 1
            local hit = false
            for j = #self.foes, 1, -1 do
                local f = self.foes[j]
                if math.abs(sh.x - f.x) < 16 and math.abs(sh.y - f.y) < 16 then
                    f.hp -= p.dmg; f.hitT = 4; hit = true
                    if f.hp <= 0 then
                        if math.random() < 0.25 then self.chips[#self.chips+1] = { x = f.x, y = f.y, frame = 1, life = 300 } end
                        table.remove(self.foes, j); audio.coin()
                    else audio.tick() end
                    break
                end
            end
            if hit or sh.life <= 0 or sh.x < 0 or sh.x > 400 or sh.y < 0 or sh.y > 240 then table.remove(self.shots, i) end
        end

        -- foes chase + contact
        if p.iframe > 0 then p.iframe -= 1 end
        for _, f in ipairs(self.foes) do
            local ddx, ddy = p.x - f.x, (p.y - 14) - f.y
            local n = math.sqrt(ddx*ddx + ddy*ddy)
            if n > 1 then f.x += ddx/n*f.spd; f.y += ddy/n*f.spd end
            if self.tick % 8 == 0 then f.frame = (f.frame % 4) + 1 end
            if f.hitT > 0 then f.hitT -= 1 end
            if n < 16 and p.iframe <= 0 then
                p.hp -= 1; p.iframe = 45; audio.err()
                if p.hp <= 0 then self.state = "dead"; self.stateT = 0; audio.err() end
            end
        end

        -- chips
        for i = #self.chips, 1, -1 do
            local c = self.chips[i]; c.life -= 1; c.frame = (self.tick // 6) % 4 + 1
            if math.abs(p.x - c.x) < 16 and math.abs(p.y - 14 - c.y) < 18 then
                -- upgrade: alternate range / damage / rof
                local roll = math.random(1,3)
                if roll == 1 then p.range = math.min(200, p.range + 25)
                elseif roll == 2 then p.dmg = p.dmg + 1
                else p.rof = math.max(2, p.rof - 1) end
                table.remove(self.chips, i); audio.chime()
            elseif c.life <= 0 then table.remove(self.chips, i) end
        end

        -- win check
        if self:remaining() == 0 then self.state = "cleared"; self.stateT = 0; audio.chime() end

        self:draw()
    end

    -- ---- draw ----
    function s:drawFoe(f)
        local sheet = (f.kind == "worm") and self.wormSheet or self.iceSheet
        gfx.setColor(gfx.kColorBlack); gfx.fillEllipseInRect(f.x - 10, f.y + 6, 20, 7)
        local img = sheet and (sheet:getImage(f.frame) or sheet:getImage(1))
        if img then
            if f.hitT > 0 and (f.hitT % 2 == 0) then img:draw(f.x - 16, f.y - 16, gfx.kImageFlippedX)
            else img:draw(f.x - 16, f.y - 16) end
        else gfx.setColor(gfx.kColorWhite); gfx.fillRect(f.x - 8, f.y - 8, 16, 16) end
    end

    function s:drawPlayer()
        local p = self.p
        gfx.setColor(gfx.kColorBlack); gfx.fillEllipseInRect(p.x - 14, p.y - 4, 28, 9)
        if p.iframe > 0 and (p.iframe % 4 < 2) then return end  -- blink on hit
        local idx = (p.dir - 1) * 4 + p.frame
        local img = self.heroSheet and (self.heroSheet:getImage(idx) or self.heroSheet:getImage(1))
        if img then img:draw(p.x - 24, p.y - 58) end
        -- aim reticle
        local ax, ay = self:aimVec()
        local rx, ry = p.x + ax * 34, p.y - 20 + ay * 34
        gfx.setColor(gfx.kColorWhite); gfx.setLineWidth(1)
        gfx.drawLine(p.x, p.y - 20, rx, ry)
        gfx.drawCircleAtPoint(rx, ry, 4)
    end

    function s:drawHUD()
        local p = self.p
        -- health (top-left)
        for i = 1, 3 do
            gfx.setColor(gfx.kColorWhite)
            if i <= p.hp then gfx.fillRect(8 + (i-1)*14, 8, 10, 10) else gfx.drawRect(8 + (i-1)*14, 8, 10, 10) end
        end
        -- threats left (top-right)
        gfx.setImageDrawMode(gfx.kDrawModeFillWhite)
        gfx.drawTextAligned("ICE " .. self:remaining(), 392, 8, kTextAlignment.right)
        gfx.setImageDrawMode(gfx.kDrawModeCopy)
        -- heat gauge (bottom-center)
        local gw = 160
        gfx.setColor(gfx.kColorWhite); gfx.drawRect(200 - gw/2, 226, gw, 10)
        if p.overheat then
            if (self.tick // 4) % 2 == 0 then gfx.fillRect(202 - gw/2, 228, gw - 4, 6) end
            gfx.setImageDrawMode(gfx.kDrawModeFillWhite); gfx.drawTextAligned("OVERHEAT", 200, 210, kTextAlignment.center); gfx.setImageDrawMode(gfx.kDrawModeCopy)
        else
            gfx.fillRect(202 - gw/2, 228, (gw - 4) * p.heat / 100, 6)
        end
    end

    function s:banner(t1, t2)
        gfx.setColor(gfx.kColorBlack); gfx.fillRect(40, 96, 320, 56)
        gfx.setColor(gfx.kColorWhite); gfx.setLineWidth(1); gfx.drawRect(40, 96, 320, 56)
        gfx.setImageDrawMode(gfx.kDrawModeFillWhite)
        gfx.setFont(gfx.getSystemFont(gfx.font.kVariantBold) or gfx.getSystemFont())
        gfx.drawTextAligned(t1, 200, 106, kTextAlignment.center)
        gfx.setFont(gfx.getSystemFont())
        if t2 then gfx.drawTextAligned(t2, 200, 128, kTextAlignment.center) end
        gfx.setImageDrawMode(gfx.kDrawModeCopy)
    end

    function s:draw()
        if self.bg then self.bg:draw(0, 0) else gfx.clear(gfx.kColorBlack) end
        -- depth-ish: draw foes then player (player usually front)
        for _, f in ipairs(self.foes) do self:drawFoe(f) end
        for _, c in ipairs(self.chips) do
            local img = self.chipSheet and (self.chipSheet:getImage(c.frame) or self.chipSheet:getImage(1))
            if img then img:draw(c.x - 8, c.y - 8) end
        end
        self:drawPlayer()
        for _, sh in ipairs(self.shots) do
            gfx.setColor(gfx.kColorWhite); gfx.fillRect(sh.x - 1, sh.y - 1, 3, 3)
        end
        self:drawHUD()

        if self.state == "intro" then self:banner(self.L.name, "d-pad move  crank aim  A fire")
        elseif self.state == "cleared" then self:banner("SECTOR CLEARED", "press A")
        elseif self.state == "dead" then self:banner("FLATLINED", "press A to retry") end
    end

    return s
end

_G.arena = A
return A
