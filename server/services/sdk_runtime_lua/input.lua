Input = {}

local pressed = {}
local held = {}
local released = {}

local function snapshot(btn)
    pressed[btn]  = playdate.buttonJustPressed(btn)
    held[btn]     = playdate.buttonIsPressed(btn)
    released[btn] = playdate.buttonJustReleased(btn)
end

function Input.update()
    snapshot(playdate.kButtonA)
    snapshot(playdate.kButtonB)
    snapshot(playdate.kButtonUp)
    snapshot(playdate.kButtonDown)
    snapshot(playdate.kButtonLeft)
    snapshot(playdate.kButtonRight)
end

function Input.pressed(btn)  return pressed[btn]  == true end
function Input.held(btn)     return held[btn]     == true end
function Input.released(btn) return released[btn] == true end
