-- core/isoroom — walkable room. Background image + axis-aligned walkable floor
-- rect + hotspots {x,y,r,label,onInteract}. The 48x64 hero (newb_hero, 4 rows =
-- down/up/left/right) walks with the d-pad; A interacts with the nearest hotspot.
-- UI is deliberately minimal (Under-the-Tree restraint): the ONLY chrome is a
-- quiet chevron over the nearest interactable + a single label at screen top.
-- No objective bar, no counters, no per-object markers. Self-binds _G.isoroom.
local gfx <const> = playdate.graphics
local IR = {}

local DIR_DOWN, DIR_UP, DIR_LEFT, DIR_RIGHT = 1, 2, 3, 4

function IR.new(cfg)
    local room = {}
    room.cfg = cfg
    room.bg = nil
    room.sheet = nil
    room.p = { x = cfg.spawn.x, y = cfg.spawn.y, dir = DIR_DOWN, frame = 1, moving = false, step = 0 }
    room.near = nil
    room.tick = 0

    function room:enter()
        self.bg = gfx.image.new("images/" .. cfg.bg)
        self.sheet = gfx.imagetable.new("images/newb_hero")
        if cfg.mood then audio.music(cfg.mood) end
        if cfg.onEnter then cfg.onEnter(self) end
    end
    function room:resume() if cfg.mood then audio.music(cfg.mood) end end

    local function moveDir(p, dx, dy)
        if dy > 0 then p.dir = DIR_DOWN elseif dy < 0 then p.dir = DIR_UP
        elseif dx < 0 then p.dir = DIR_LEFT elseif dx > 0 then p.dir = DIR_RIGHT end
    end

    function room:update()
        self.tick += 1
        if dialogue.active() then dialogue.update(); self:draw(); return end

        local p = self.p
        local SP = 2.4
        local dx, dy = 0, 0
        if playdate.buttonIsPressed(playdate.kButtonLeft)  then dx = -SP end
        if playdate.buttonIsPressed(playdate.kButtonRight) then dx =  SP end
        if playdate.buttonIsPressed(playdate.kButtonUp)    then dy = -SP end
        if playdate.buttonIsPressed(playdate.kButtonDown)  then dy =  SP end
        p.moving = (dx ~= 0 or dy ~= 0)
        if p.moving then
            moveDir(p, dx, dy)
            local f = cfg.floor
            p.x = math.max(f.x1, math.min(f.x2, p.x + dx))
            p.y = math.max(f.y1, math.min(f.y2, p.y + dy))
            if self.tick % 6 == 0 then
                p.frame = (p.frame % 4) + 1
                p.step += 1; if p.step % 2 == 0 then audio.step() end
            end
        else p.frame = 1 end

        -- nearest hotspot
        self.near = nil
        local best = 9999
        for _, h in ipairs(cfg.hotspots) do
            local d = math.abs(p.x - h.x) + math.abs(p.y - h.y)
            if d < (h.r or 40) and d < best then best = d; self.near = h end
        end

        if self.near and playdate.buttonJustPressed(playdate.kButtonA) then
            audio.ok(); self.near.onInteract(self)
        end

        self:draw()
    end

    function room:drawPlayer()
        local p = self.p
        gfx.setColor(gfx.kColorBlack)
        gfx.fillEllipseInRect(p.x - 16, p.y - 5, 32, 11)   -- soft grounding shadow
        local idx = (p.dir - 1) * 4 + p.frame
        local imgobj = self.sheet:getImage(idx) or self.sheet:getImage(1)
        if imgobj then imgobj:draw(p.x - 24, p.y - 58) end  -- feet at p.y, centered on p.x
    end

    -- the one and only piece of chrome: point at what you can touch, name it up top
    function room:drawPrompt()
        local h = self.near
        if not h then return end
        local bob = (self.tick // 10) % 2
        local my = h.y - 30 - bob
        -- bobbing chevron over the object (white, black-edged so it reads on any bg)
        gfx.setColor(gfx.kColorBlack); gfx.fillTriangle(h.x - 7, my - 1, h.x + 7, my - 1, h.x, my + 9)
        gfx.setColor(gfx.kColorWhite); gfx.fillTriangle(h.x - 5, my + 1, h.x + 5, my + 1, h.x, my + 6)
        -- clean label at the top of the screen
        local w = gfx.getTextSize(h.label)
        gfx.setColor(gfx.kColorBlack); gfx.fillRoundRect(200 - w/2 - 12, 4, w + 24, 18, 3)
        gfx.setColor(gfx.kColorWhite); gfx.setLineWidth(1); gfx.drawRoundRect(200 - w/2 - 12, 4, w + 24, 18, 3)
        gfx.setImageDrawMode(gfx.kDrawModeFillWhite)
        gfx.drawTextAligned(h.label, 200, 7, kTextAlignment.center)
        gfx.setImageDrawMode(gfx.kDrawModeCopy)
    end

    function room:draw()
        if self.bg then self.bg:draw(0, 0) else gfx.clear(gfx.kColorBlack) end
        self:drawPlayer()
        if not dialogue.active() then self:drawPrompt() end
        if dialogue.active() then dialogue.draw() end
    end

    return room
end

_G.isoroom = IR
return IR
