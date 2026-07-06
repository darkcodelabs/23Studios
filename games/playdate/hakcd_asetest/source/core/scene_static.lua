-- core/scene_static — the reference game model: a full-screen 1-bit
-- illustration with interactive HOTSPOTS. The player moves a selection reticle
-- between hotspots with the d-pad (nearest-in-direction) and presses A to
-- interact; the persistent dialogue bar overlays when someone speaks. No
-- walking sprite — the character lives inside the illustration, exactly like
-- the design_handoff frames. Self-binds _G.scene_static as a constructor.
--
-- cfg = {
--   bg = "room_bedroom",
--   hotspots = { { x=, y=, label="COMPUTER", onInteract=fn }, ... },
--   onEnter = fn(self), onResume = fn(self, result), title = "YOUR ROOM",
--   topbar = fn(self)   -- optional custom top HUD strip
-- }
local gfx <const> = playdate.graphics
local S = {}

local function dist(ax, ay, bx, by) local dx,dy=ax-bx,ay-by return dx*dx+dy*dy end

function S.new(cfg)
    local sc = { cfg = cfg, bg = nil, sel = 1, tick = 0 }

    function sc:enter(args)
        self.bg = gfx.image.new("images/" .. cfg.bg)
        self.sel = 1
        self.tick = 0
        if cfg.mood then audio.music(cfg.mood) end
        if cfg.onEnter then cfg.onEnter(self, args) end
    end
    function sc:resume(result)
        if cfg.mood then audio.music(cfg.mood) end
        if cfg.onResume then cfg.onResume(self, result) end
    end

    -- move selection to the nearest hotspot in a d-pad direction
    function sc:moveSel(dx, dy)
        local hs = cfg.hotspots
        if #hs < 2 then return end
        local cur = hs[self.sel]
        local best, bestd = nil, 1/0
        for i, h in ipairs(hs) do
            if i ~= self.sel then
                local ok = (dx > 0 and h.x > cur.x) or (dx < 0 and h.x < cur.x)
                        or (dy > 0 and h.y > cur.y) or (dy < 0 and h.y < cur.y)
                if ok then
                    local d = dist(cur.x, cur.y, h.x, h.y)
                    if d < bestd then bestd = d; best = i end
                end
            end
        end
        if best then self.sel = best; audio.tick() end
    end

    function sc:update()
        self.tick += 1
        if dialogue.active() then dialogue.update(); self:draw(); return end

        if playdate.buttonJustPressed(playdate.kButtonLeft)  then self:moveSel(-1, 0) end
        if playdate.buttonJustPressed(playdate.kButtonRight) then self:moveSel( 1, 0) end
        if playdate.buttonJustPressed(playdate.kButtonUp)    then self:moveSel( 0,-1) end
        if playdate.buttonJustPressed(playdate.kButtonDown)  then self:moveSel( 0, 1) end
        if playdate.buttonJustPressed(playdate.kButtonA) then
            local h = cfg.hotspots[self.sel]
            if h then audio.ok(); h.onInteract(self) end
        end
        self:draw()
    end

    function sc:draw()
        if self.bg then self.bg:draw(0, 0) else gfx.clear(gfx.kColorBlack) end

        -- hotspots: a small reticle on each, the selected one boxed + labeled
        for i, h in ipairs(cfg.hotspots) do
            if not h.hidden then
                if i == self.sel then
                    local pulse = (self.tick // 5) % 3
                    gfx.setColor(gfx.kColorWhite); gfx.setLineWidth(2)
                    gfx.drawRect(h.x - 12 - pulse, h.y - 12 - pulse, 24 + pulse*2, 24 + pulse*2)
                    hud.tag(h.label .. "  [A]", h.x, h.y - 26)
                else
                    gfx.setColor(gfx.kColorWhite)
                    gfx.fillRect(h.x - 2, h.y - 2, 4, 4)
                    gfx.setColor(gfx.kColorBlack)
                    gfx.fillRect(h.x - 1, h.y - 1, 2, 2)
                end
            end
        end

        -- top objective strip (handoff-style thin bar)
        if cfg.showHud ~= false then hud.objective() end
        if cfg.topbar then cfg.topbar(self) end

        if cfg.title and self.tick < 100 then hud.title(cfg.title) end
        if dialogue.active() then dialogue.draw() end
    end

    return sc
end

_G.scene_static = S
return S
