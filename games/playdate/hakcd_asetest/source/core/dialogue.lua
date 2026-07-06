-- core/dialogue — portrait dialogue with typewriter text + branching choices.
-- Modeled on the reference: name label, text bottom-left, portrait box
-- bottom-right. Self-binds _G.dialogue. Draws as a modal overlay; the calling
-- scene keeps drawing the world behind it.
--
-- Usage:
--   dialogue.start({
--     { who="MENTOR", port="portrait_mentor", text="You made it." },
--     { who="MENTOR", port="portrait_mentor", text="Choose.", choices={
--         { label="Ask who", jump=4 },
--         { label="Say nothing", done=true } } },
--     ... }, onDone)
local gfx <const> = playdate.graphics
local D = {}

local BOX_Y, BOX_H = 168, 72
local CHARS_PER = 2          -- typewriter chars per tick
local portraits = {}         -- cache

local state = nil

local function loadPort(name)
    if not name then return nil end
    if portraits[name] == nil then
        portraits[name] = gfx.image.new("images/" .. name) or false
    end
    return portraits[name] or nil
end

function D.active() return state ~= nil end

function D.start(nodes, onDone)
    state = { nodes = nodes, i = 1, shown = 0, sel = 1, onDone = onDone }
end

local function node() return state.nodes[state.i] end

local function advanceTo(n)
    state.i = n; state.shown = 0; state.sel = 1
end

local function finish()
    local cb = state.onDone; state = nil
    if cb then cb() end
end

function D.update()
    if not state then return end
    local nd = node()
    if not nd then finish(); return end

    local full = nd.text or ""
    local typing = state.shown < #full
    if typing then
        state.shown = math.min(#full, state.shown + CHARS_PER)
        if state.shown % 3 == 0 then audio.blip(720) end
    end

    local hasChoices = nd.choices and not typing
    if hasChoices then
        if playdate.buttonJustPressed(playdate.kButtonDown) then
            state.sel = (state.sel % #nd.choices) + 1; audio.tick()
        elseif playdate.buttonJustPressed(playdate.kButtonUp) then
            state.sel = (state.sel - 2) % #nd.choices + 1; audio.tick()
        elseif playdate.buttonJustPressed(playdate.kButtonA) then
            local c = nd.choices[state.sel]; audio.ok()
            if c.onPick then c.onPick() end
            if c.done then finish()
            elseif c.jump then advanceTo(c.jump)
            else local n = state.i + 1; if n > #state.nodes then finish() else advanceTo(n) end end
        end
        return
    end

    if playdate.buttonJustPressed(playdate.kButtonA) then
        if typing then state.shown = #full; audio.tick()
        else
            if nd.done then finish()
            elseif nd.jump then advanceTo(nd.jump)
            else local n = state.i + 1; if n > #state.nodes then finish() else advanceTo(n) end end
        end
    end
end

function D.draw()
    if not state then return end
    local nd = node()
    if not nd then return end   -- advanced past the last node this frame; finish() lands next update
    -- box
    gfx.setColor(gfx.kColorBlack); gfx.fillRoundRect(6, BOX_Y, 388, BOX_H, 5)
    gfx.setColor(gfx.kColorWhite); gfx.drawRoundRect(6, BOX_Y, 388, BOX_H, 5)

    -- portrait right
    local port = loadPort(nd.port)
    local textRight = 320
    if port then
        gfx.setColor(gfx.kColorWhite); gfx.drawRect(320, BOX_Y - 52, 68, 68)
        port:draw(322, BOX_Y - 50)
    end

    -- name tab
    if nd.who then
        gfx.setColor(gfx.kColorWhite); gfx.fillRect(14, BOX_Y - 14, gfx.getTextSize(nd.who) + 12, 16)
        gfx.setImageDrawMode(gfx.kDrawModeCopy)
        gfx.drawText(nd.who, 20, BOX_Y - 13)
    end

    -- text (typed)
    gfx.setImageDrawMode(gfx.kDrawModeFillWhite)
    local shown = string.sub(nd.text or "", 1, state.shown)
    gfx.drawTextInRect(shown, 16, BOX_Y + 8, 300, 56)

    -- choices or prompt
    if nd.choices and state.shown >= #(nd.text or "") then
        for i, c in ipairs(nd.choices) do
            local y = BOX_Y + 8 + (i - 1) * 15
            local pre = (i == state.sel) and "> " or "  "
            gfx.drawText(pre .. c.label, 20, y)
        end
    else
        gfx.drawText("A", 372, BOX_Y + BOX_H - 16)
    end
    gfx.setImageDrawMode(gfx.kDrawModeCopy)
end

_G.dialogue = D
return D
