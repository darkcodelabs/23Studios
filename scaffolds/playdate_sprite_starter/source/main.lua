import "CoreLibs/object"
import "CoreLibs/graphics"
import "CoreLibs/sprites"
import "CoreLibs/timer"
import "CoreLibs/crank"

import "core/Animation"
import "core/Input"
import "entities/CyberGlove"

local gfx <const> = playdate.graphics

local glove

local function drawBackground()
    gfx.setBackgroundColor(gfx.kColorWhite)
    gfx.clear()
    gfx.setColor(gfx.kColorBlack)
    gfx.setLineWidth(1)
    for y = 0, 239, 8 do
        gfx.drawLine(0, y, 399, y)
    end
end

local function setup()
    gfx.sprite.setBackgroundDrawingCallback(drawBackground)
    glove = CyberGlove(200, 120)
    glove:add()
end

setup()

function playdate.update()
    Input.update()
    glove:handleInput()
    glove:handleCrank()

    playdate.timer.updateTimers()
    gfx.sprite.update()
end

function playdate.cranked(change, accelChange)
    glove:onCrank(change, accelChange)
end
