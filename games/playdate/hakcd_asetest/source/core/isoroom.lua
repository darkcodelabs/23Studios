-- core/isoroom — reusable isometric room. A scene supplies a background image,
-- a walkable polygon (as an axis-aligned floor rect for simplicity), and a set
-- of hotspots {x,y,r,label,onInteract}. The player sprite (newb_iso, 4 rows =
-- down/up/left/right) walks with the d-pad; A interacts with the nearest hotspot.
-- Self-binds _G.isoroom as a constructor: isoroom.new(cfg) -> scene table.
local gfx <const> = playdate.graphics
local IR = {}

local DIR_DOWN, DIR_UP, DIR_LEFT, DIR_RIGHT = 1, 2, 3, 4

function IR.new(cfg)
    local room = {}
    -- cfg: bg (imageName), floor={x1,y1,x2,y2}, spawn={x,y}, hotspots={}, mood,
    --      onEnter(fn), title
    room.cfg = cfg
    room.bg = nil
    room.sheet = nil
    room.p = { x = cfg.spawn.x, y = cfg.spawn.y, dir = DIR_DOWN, frame = 1, moving = false, anim = 0, step = 0 }
    room.near = nil
    room.tick = 0

    function room:enter()
        self.bg = gfx.image.new("images/" .. cfg.bg)
        self.sheet = gfx.imagetable.new("images/newb_iso")
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
        local idx = (p.dir - 1) * 4 + p.frame
        local imgobj = self.sheet:getImage(idx) or self.sheet:getImage(1)
        if imgobj then imgobj:draw(p.x - 12, p.y - 28) end
    end

    function room:draw()
        if self.bg then self.bg:draw(0, 0) else gfx.clear(gfx.kColorBlack) end

        -- hotspot markers + prompt
        for _, h in ipairs(cfg.hotspots) do
            if not h.hidden then
                gfx.setColor(gfx.kColorWhite)
                if self.near == h then
                    -- pulsing ring + label
                    local r = 8 + (self.tick // 4 % 3)
                    gfx.drawCircleAtPoint(h.x, h.y, r)
                    local w = gfx.getTextSize(h.label)
                    gfx.setColor(gfx.kColorBlack); gfx.fillRect(h.x - w/2 - 4, h.y - 34, w + 8, 16)
                    gfx.setImageDrawMode(gfx.kDrawModeFillWhite)
                    gfx.drawTextAligned(h.label .. "  A", h.x, h.y - 33, kTextAlignment.center)
                    gfx.setImageDrawMode(gfx.kDrawModeCopy)
                else
                    gfx.fillRect(h.x - 1, h.y - 1, 3, 3)
                end
            end
        end

        self:drawPlayer()

        -- objective HUD
        local q = quest.current()
        if q and cfg.showHud ~= false then
            local line = "> " .. q.line
            local w = gfx.getTextSize(line)
            gfx.setColor(gfx.kColorBlack); gfx.fillRect(0, 0, w + 12, 16)
            gfx.setImageDrawMode(gfx.kDrawModeFillWhite)
            gfx.drawText(line, 6, 2)
            gfx.setImageDrawMode(gfx.kDrawModeCopy)
        end

        if cfg.title and self.tick < 90 then
            local w = gfx.getTextSize(cfg.title)
            gfx.setColor(gfx.kColorBlack); gfx.fillRect(200 - w/2 - 6, 110, w + 12, 20)
            gfx.setImageDrawMode(gfx.kDrawModeFillWhite)
            gfx.drawTextAligned(cfg.title, 200, 113, kTextAlignment.center)
            gfx.setImageDrawMode(gfx.kDrawModeCopy)
        end

        if dialogue.active() then dialogue.draw() end
    end

    return room
end

_G.isoroom = IR
return IR
