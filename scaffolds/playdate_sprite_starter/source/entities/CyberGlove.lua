local gfx <const> = playdate.graphics

local STATES <const> = {
    idle      = { row = 0, count = 4, fps = 6,  loop = true  },
    activate  = { row = 1, count = 4, fps = 12, loop = false },
    scan      = { row = 2, count = 4, fps = 10, loop = true  },
    overload  = { row = 3, count = 4, fps = 16, loop = true  },
    damaged   = { row = 4, count = 3, fps = 4,  loop = true  },
}

local FRAME_W <const> = 80
local FRAME_H <const> = 40
local FRAMES_PER_ROW <const> = 4
local MOVE_SPEED <const> = 3
local SCAN_DEG_PER_FRAME <const> = 18

local _imagetable

local function loadImagetable()
    if _imagetable then return _imagetable end
    _imagetable = gfx.imagetable.new("images/cyber_glove")
    assert(_imagetable, "cyber_glove imagetable missing — expected images/cyber_glove-table-80-40.png")
    return _imagetable
end

local function framesForRow(row, count)
    local t = {}
    for i = 1, count do
        t[i] = row * FRAMES_PER_ROW + i
    end
    return t
end

class("CyberGlove").extends(gfx.sprite)

function CyberGlove:init(x, y)
    CyberGlove.super.init(self)

    local it = loadImagetable()
    self.imagetable = it
    self.anim = Animation(it, STATES.idle.fps, STATES.idle.loop, framesForRow(STATES.idle.row, STATES.idle.count))
    self.state = "idle"

    self:setImage(self.anim:image())
    self:setCenter(0.5, 0.5)
    self:moveTo(x, y)
    self:setZIndex(100)
    self:setCollideRect(12, 6, FRAME_W - 24, FRAME_H - 12)

    self._scanAccum = 0
    self._overloadTimer = nil
end

function CyberGlove:setState(name)
    if self.state == name then return end
    local cfg = STATES[name]
    if not cfg then return end
    self.state = name
    self.anim:setFps(cfg.fps)
    self.anim.loop = cfg.loop
    self.anim:setFrames(framesForRow(cfg.row, cfg.count))
end

function CyberGlove:handleInput()
    local dx, dy = 0, 0
    if Input.held(playdate.kButtonLeft)  then dx = dx - MOVE_SPEED end
    if Input.held(playdate.kButtonRight) then dx = dx + MOVE_SPEED end
    if Input.held(playdate.kButtonUp)    then dy = dy - MOVE_SPEED end
    if Input.held(playdate.kButtonDown)  then dy = dy + MOVE_SPEED end

    if dx ~= 0 or dy ~= 0 then
        local nx, ny = self.x + dx, self.y + dy
        nx = math.max(FRAME_W / 2, math.min(400 - FRAME_W / 2, nx))
        ny = math.max(FRAME_H / 2, math.min(240 - FRAME_H / 2, ny))
        self:moveTo(nx, ny)
    end

    if Input.pressed(playdate.kButtonA) then
        self:setState("activate")
        playdate.timer.performAfterDelay(450, function()
            if self.state == "activate" then self:setState("idle") end
        end)
    end

    if Input.pressed(playdate.kButtonB) then
        self:setState("overload")
        if self._overloadTimer then self._overloadTimer:remove() end
        self._overloadTimer = playdate.timer.performAfterDelay(900, function()
            if self.state == "overload" then self:setState("damaged") end
        end)
    end
end

function CyberGlove:handleCrank()
    self.anim:tick()
    self:setImage(self.anim:image())
end

function CyberGlove:onCrank(change, _accelChange)
    if self.state ~= "scan" and math.abs(change) > 2 then
        self:setState("scan")
    end

    self._scanAccum = self._scanAccum + change
    while math.abs(self._scanAccum) >= SCAN_DEG_PER_FRAME do
        local step = self._scanAccum > 0 and 1 or -1
        self.anim:advanceFrames(step)
        self._scanAccum = self._scanAccum - step * SCAN_DEG_PER_FRAME
    end

    if self.state == "scan" and math.abs(change) < 0.5 then
        playdate.timer.performAfterDelay(250, function()
            if self.state == "scan" then self:setState("idle") end
        end)
    end
end

function CyberGlove:collisionResponse(_other)
    return gfx.sprite.kCollisionTypeOverlap
end
