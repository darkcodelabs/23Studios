local gfx <const> = playdate.graphics

class("Animation").extends()

function Animation:init(imagetable, framesPerSecond, loop, frames)
    Animation.super.init(self)
    self.imagetable = imagetable
    self.fps = framesPerSecond or 10
    self.loop = loop ~= false
    self.frames = frames or self:_defaultFrames()
    self.index = 1
    self._lastTick = playdate.getCurrentTimeMilliseconds()
    self.finished = false
end

function Animation:_defaultFrames()
    local n = self.imagetable:getLength()
    local t = {}
    for i = 1, n do t[i] = i end
    return t
end

function Animation:setFrames(frames)
    self.frames = frames
    self.index = 1
    self.finished = false
    self._lastTick = playdate.getCurrentTimeMilliseconds()
end

function Animation:setFps(fps)
    self.fps = fps
end

function Animation:reset()
    self.index = 1
    self.finished = false
    self._lastTick = playdate.getCurrentTimeMilliseconds()
end

function Animation:tick()
    if self.finished then return end
    local now = playdate.getCurrentTimeMilliseconds()
    local frameDurMs = 1000 / self.fps
    while now - self._lastTick >= frameDurMs do
        self._lastTick = self._lastTick + frameDurMs
        self.index = self.index + 1
        if self.index > #self.frames then
            if self.loop then
                self.index = 1
            else
                self.index = #self.frames
                self.finished = true
                break
            end
        end
    end
end

function Animation:image()
    local frameIdx = self.frames[self.index]
    return self.imagetable:getImage(frameIdx)
end

function Animation:advanceFrames(n)
    if #self.frames == 0 then return end
    self.index = ((self.index - 1 + n) % #self.frames) + 1
end
