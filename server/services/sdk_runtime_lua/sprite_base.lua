-- sdk_runtime_lua/sprite_base.lua
-- Conventional base class for any animated entity loaded from an
-- imagetable. Wraps gfx.sprite + animation.lua + standard collide rect.
--
-- Subclass example (autopilot emits these):
--   class("Newb").extends(SpriteBase)
--   function Newb:init(x, y)
--     SpriteBase.init(self, {
--       imagetable = "characters/newb",   -- expects newb-table-32-32.pdt
--       frame_w = 32, frame_h = 32,
--       states = {
--         idle = { row = 0, count = 4, fps = 6, loop = true },
--         walk = { row = 1, count = 6, fps = 12, loop = true },
--       },
--       initial_state = "idle",
--       collide_inset = { x = 4, y = 2, w = 24, h = 28 },
--       z = 100,
--     })
--     self:moveTo(x, y)
--   end

local gfx <const> = playdate.graphics

class("SpriteBase").extends(gfx.sprite)

function SpriteBase:init(cfg)
    SpriteBase.super.init(self)
    cfg = cfg or {}
    self._cfg = cfg
    self._states = cfg.states or {}
    self._state_name = nil

    self._imagetable = nil
    if cfg.imagetable then
        self._imagetable = gfx.imagetable.new(cfg.imagetable)
        assert(self._imagetable,
            "SpriteBase: imagetable missing at " .. tostring(cfg.imagetable))
    end

    self._anim = nil
    if self._imagetable and cfg.initial_state then
        self:set_state(cfg.initial_state)
    elseif self._imagetable then
        -- single-frame fallback
        self:setImage(self._imagetable:getImage(1))
    end

    self:setZIndex(cfg.z or 100)
    self:setCenter(0.5, 0.5)
    if cfg.collide_inset then
        local c = cfg.collide_inset
        self:setCollideRect(c.x, c.y, c.w, c.h)
    end
end

function SpriteBase:set_state(name)
    local s = self._states[name]
    if not s then return end
    if self._state_name == name then return end
    self._state_name = name
    local frames = {}
    for i = 1, s.count do
        frames[i] = s.row * (self._cfg.frames_per_row or s.count) + i
    end
    if not self._anim then
        self._anim = Animation(self._imagetable, s.fps or 6, s.loop ~= false, frames)
    else
        self._anim:setFps(s.fps or 6)
        self._anim.loop = s.loop ~= false
        self._anim:setFrames(frames)
    end
    self:setImage(self._anim:image())
end

function SpriteBase:state() return self._state_name end

function SpriteBase:update()
    if self._anim then
        self._anim:tick()
        self:setImage(self._anim:image())
    end
end
