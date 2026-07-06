-- scenes/lab — the PWNGLOVE sandbox. Walk a clean room, CRANK to aim the glove
-- reticle, B to cycle power, A to fire the current power at the locked device.
-- Match the right tool to a device to hack it; hack them all to win. No combat.
-- Self-binds _G.scene_lab.
local gfx <const> = playdate.graphics
local S = {}

local FLOOR = { x1 = 40, y1 = 150, x2 = 360, y2 = 214 }

-- devices: code-drawn so targeting always aligns. type drives the icon.
local function makeDevices()
    return {
        { id="door",   x=64,  y=96,  power="lockpick", name="MAG-LOCK DOOR", type="door",   hacked=false },
        { id="reader", x=200, y=80,  power="rfid",     name="BADGE READER",  type="reader", hacked=false },
        { id="gate",   x=336, y=96,  power="subghz",   name="SERVICE GATE",  type="gate",   hacked=false },
        { id="screen", x=200, y=132, power="ir",       name="CCTV SCREEN",   type="screen", hacked=false },
    }
end

function S:enter()
    self.tick = 0
    self.bg = gfx.image.new("images/room_lab")
    self.sheet = gfx.imagetable.new("images/newb_hero")
    self.p = { x=200, y=190, dir=1, frame=1, step=0 }
    self.devs = makeDevices()
    self.lock = nil        -- currently targeted device
    self.channel = nil     -- { dev, power, t, dur }
    self.pending = nil     -- device awaiting a returning minigame result
    self.won = false
    audio.music("calm")
end
function S:resume()
    audio.music("calm")
    if self.pending then local d = self.pending; self.pending = nil; self:hacked(d) end
end

function S:aimVec()
    if playdate.isCrankDocked() then return 0, -1 end
    local a = math.rad(playdate.getCrankPosition())
    return math.sin(a), -math.cos(a)
end

function S:hacked(d)
    d.hacked = true; audio.chime()
    local all = true; for _, x in ipairs(self.devs) do if not x.hacked then all = false end end
    if all then self.won = true end
end

function S:fire()
    local d = self.lock
    if not d or d.hacked then return end
    local pw = glove.current()
    if d.power ~= pw.id then audio.err(); self.flash = { t = 30, msg = "WRONG TOOL" }; return end
    if pw.kind == "minigame" then
        scene_manager.push(mg_lockpick.new(function() self.pending = d end))
    else
        self.channel = { dev = d, power = pw, t = 0, dur = pw.dur or 45 }
        audio.blip(600)
    end
end

function S:update()
    self.tick += 1
    if self.won then
        if playdate.buttonJustPressed(playdate.kButtonA) then scene_manager.replace(scene_title) end
        self:draw(); return
    end

    -- channeling (rfid/subghz/ir quick effect) locks input briefly
    if self.channel then
        self.channel.t += 1
        if self.channel.t % 6 == 0 then audio.blip(700 + self.channel.t * 8) end
        if self.channel.t >= self.channel.dur then local d = self.channel.dev; self.channel = nil; self:hacked(d) end
        self:draw(); return
    end

    -- move
    local p, SP = self.p, 2.4
    local dx, dy = 0, 0
    if playdate.buttonIsPressed(playdate.kButtonLeft)  then dx=-1 end
    if playdate.buttonIsPressed(playdate.kButtonRight) then dx= 1 end
    if playdate.buttonIsPressed(playdate.kButtonUp)    then dy=-1 end
    if playdate.buttonIsPressed(playdate.kButtonDown)  then dy= 1 end
    local moving = (dx~=0 or dy~=0)
    if moving then
        local n = math.sqrt(dx*dx+dy*dy)
        p.x = math.max(FLOOR.x1, math.min(FLOOR.x2, p.x + dx/n*SP))
        p.y = math.max(FLOOR.y1, math.min(FLOOR.y2, p.y + dy/n*SP))
        if dy>0 then p.dir=1 elseif dy<0 then p.dir=2 elseif dx<0 then p.dir=3 else p.dir=4 end
        if self.tick%6==0 then p.frame=(p.frame%4)+1; p.step+=1; if p.step%2==0 then audio.step() end end
    else p.frame=1 end

    -- glove aim -> reticle -> snap to nearest device
    local ax, ay = self:aimVec()
    self.rx = p.x + ax*64
    self.ry = (p.y-24) + ay*64
    self.lock = nil
    local best = 44
    for _, d in ipairs(self.devs) do
        local dd = math.sqrt((self.rx-d.x)^2 + (self.ry-d.y)^2)
        if dd < best then best = dd; self.lock = d end
    end

    if playdate.buttonJustPressed(playdate.kButtonB) then glove.cycle(); audio.tick() end
    if playdate.buttonJustPressed(playdate.kButtonA) then self:fire() end
    if self.flash then self.flash.t -= 1; if self.flash.t <= 0 then self.flash = nil end end

    self:draw()
end

-- ---- drawing ----
local function bracket(x, y, w, h)
    gfx.setColor(gfx.kColorWhite); gfx.setLineWidth(2)
    local c = 6
    gfx.drawLine(x, y, x+c, y); gfx.drawLine(x, y, x, y+c)
    gfx.drawLine(x+w, y, x+w-c, y); gfx.drawLine(x+w, y, x+w, y+c)
    gfx.drawLine(x, y+h, x+c, y+h); gfx.drawLine(x, y+h, x, y+h-c)
    gfx.drawLine(x+w, y+h, x+w-c, y+h); gfx.drawLine(x+w, y+h, x+w, y+h-c)
end

function S:drawDevice(d)
    gfx.setColor(gfx.kColorWhite); gfx.setLineWidth(2)
    gfx.setImageDrawMode(gfx.kDrawModeCopy)
    if d.type == "door" then
        gfx.setColor(gfx.kColorBlack); gfx.fillRect(d.x-14, d.y-24, 28, 48)
        gfx.setColor(gfx.kColorWhite); gfx.drawRect(d.x-14, d.y-24, 28, 48)
        if d.hacked then gfx.drawLine(d.x-14, d.y-24, d.x+6, d.y-16) -- ajar hint
        else gfx.fillCircleAtPoint(d.x, d.y, 4) end
    elseif d.type == "reader" then
        gfx.setColor(gfx.kColorBlack); gfx.fillRect(d.x-12, d.y-14, 24, 28)
        gfx.setColor(gfx.kColorWhite); gfx.drawRect(d.x-12, d.y-14, 24, 28)
        gfx.drawRect(d.x-7, d.y-9, 14, 4)  -- card slot
        if d.hacked then gfx.fillCircleAtPoint(d.x, d.y+6, 3) else gfx.drawCircleAtPoint(d.x, d.y+6, 3) end
    elseif d.type == "gate" then
        gfx.setColor(gfx.kColorBlack); gfx.fillRect(d.x-16, d.y-20, 32, 40)
        gfx.setColor(gfx.kColorWhite); gfx.drawRect(d.x-16, d.y-20, 32, 40)
        if not d.hacked then for i=0,3 do gfx.drawLine(d.x-16, d.y-14+i*10, d.x+16, d.y-14+i*10) end
        else gfx.drawRect(d.x-16, d.y-20, 32, 8) end
    elseif d.type == "screen" then
        gfx.setColor(gfx.kColorBlack); gfx.fillRect(d.x-16, d.y-12, 32, 24)
        gfx.setColor(gfx.kColorWhite); gfx.drawRect(d.x-16, d.y-12, 32, 24)
        if d.hacked then gfx.drawLine(d.x-16, d.y-12, d.x+16, d.y+12); gfx.drawLine(d.x+16, d.y-12, d.x-16, d.y+12)
        else for i=0,2 do gfx.drawLine(d.x-12, d.y-6+i*6, d.x+12, d.y-6+i*6) end end
    end
    if d.hacked then
        gfx.setImageDrawMode(gfx.kDrawModeFillWhite)
        gfx.drawTextAligned("HACKED", d.x, d.y-38, kTextAlignment.center)
        gfx.setImageDrawMode(gfx.kDrawModeCopy)
    end
end

function S:drawPlayer()
    local p = self.p
    gfx.setColor(gfx.kColorBlack); gfx.fillEllipseInRect(p.x-15, p.y-4, 30, 10)
    local idx = (p.dir-1)*4 + p.frame
    local img = self.sheet and (self.sheet:getImage(idx) or self.sheet:getImage(1))
    if img then img:draw(p.x-24, p.y-58) end
end

function S:drawReticle()
    if not (self.rx and self.ry) then return end
    -- dotted targeting guide from glove-hand height (reads as a laser sight, not a beam)
    local p = self.p
    local hx, hy = p.x + 8, p.y - 34
    local steps = 5
    for i = 2, steps do
        local t = i / (steps + 1)
        local gx, gy = hx + (self.rx - hx) * t, hy + (self.ry - hy) * t
        gfx.setColor(gfx.kColorWhite); gfx.fillRect(gx - 1, gy - 1, 2, 2)
    end
    -- crosshair reticle
    local r = self.rx and self.ry
    local locked = self.lock ~= nil
    gfx.setColor(gfx.kColorWhite); gfx.setLineWidth(1)
    if locked then
        local d = self.lock
        bracket(d.x-20, d.y-24, 40, 44)
    else
        gfx.drawLine(self.rx-6, self.ry, self.rx-2, self.ry); gfx.drawLine(self.rx+2, self.ry, self.rx+6, self.ry)
        gfx.drawLine(self.rx, self.ry-6, self.rx, self.ry-2); gfx.drawLine(self.rx, self.ry+2, self.rx, self.ry+6)
    end
end

function S:drawHUD()
    -- current power chip (bottom-left)
    local pw = glove.current()
    local label = "GLOVE: " .. pw.name
    local w = gfx.getTextSize(label)
    gfx.setColor(gfx.kColorBlack); gfx.fillRoundRect(6, 218, w + 20, 18, 3)
    gfx.setColor(gfx.kColorWhite); gfx.drawRoundRect(6, 218, w + 20, 18, 3)
    gfx.setImageDrawMode(gfx.kDrawModeFillWhite)
    gfx.drawText(label, 14, 221)
    gfx.setImageDrawMode(gfx.kDrawModeCopy)

    -- lock-on label + tool match (top, clean)
    if self.lock and not self.channel then
        local d = self.lock
        local match = (d.power == glove.current().id)
        local tag = d.name .. (d.hacked and "  [done]" or (match and "  A: HACK" or "  wrong tool"))
        local tw = gfx.getTextSize(tag)
        gfx.setColor(gfx.kColorBlack); gfx.fillRect(200 - tw/2 - 8, 4, tw + 16, 16)
        gfx.setImageDrawMode(gfx.kDrawModeFillWhite)
        gfx.drawTextAligned(tag, 200, 6, kTextAlignment.center)
        gfx.setImageDrawMode(gfx.kDrawModeCopy)
    end

    -- progress (top-right)
    local n = 0; for _, d in ipairs(self.devs) do if d.hacked then n += 1 end end
    gfx.setImageDrawMode(gfx.kDrawModeFillWhite)
    gfx.drawTextAligned(n .. "/" .. #self.devs, 392, 6, kTextAlignment.right)
    gfx.setImageDrawMode(gfx.kDrawModeCopy)
end

function S:draw()
    if self.bg then self.bg:draw(0,0) else gfx.clear(gfx.kColorBlack) end
    for _, d in ipairs(self.devs) do self:drawDevice(d) end
    self:drawPlayer()
    if not self.won then self:drawReticle() end
    self:drawHUD()

    if self.channel then
        local ch = self.channel
        gfx.setColor(gfx.kColorBlack); gfx.fillRect(90, 108, 220, 30)
        gfx.setColor(gfx.kColorWhite); gfx.drawRect(90, 108, 220, 30)
        gfx.fillRect(94, 124, 212 * ch.t / ch.dur, 8)
        gfx.setImageDrawMode(gfx.kDrawModeFillWhite)
        gfx.drawTextAligned(ch.power.verb .. "...", 200, 112, kTextAlignment.center)
        gfx.setImageDrawMode(gfx.kDrawModeCopy)
    end
    if self.flash then
        gfx.setImageDrawMode(gfx.kDrawModeFillWhite)
        gfx.drawTextAligned(self.flash.msg, 200, 200, kTextAlignment.center)
        gfx.setImageDrawMode(gfx.kDrawModeCopy)
    end
    if self.won then
        gfx.setColor(gfx.kColorBlack); gfx.fillRect(40, 96, 320, 56)
        gfx.setColor(gfx.kColorWhite); gfx.drawRect(40, 96, 320, 56)
        gfx.setImageDrawMode(gfx.kDrawModeFillWhite)
        gfx.setFont(gfx.getSystemFont(gfx.font.kVariantBold) or gfx.getSystemFont())
        gfx.drawTextAligned("MASTER HAKCER", 200, 108, kTextAlignment.center)
        gfx.setFont(gfx.getSystemFont())
        gfx.drawTextAligned("every device owned. press A", 200, 130, kTextAlignment.center)
        gfx.setImageDrawMode(gfx.kDrawModeCopy)
    end
end

_G.scene_lab = S
return S
