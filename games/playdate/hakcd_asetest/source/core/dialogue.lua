-- core/dialogue — reference-matched dialogue bar. Modeled 1:1 on the
-- design_handoff scenes: a full-width bar pinned to the bottom, thin white
-- rounded border, speaker NAME in bold top-left, monospace body text, and a
-- framed portrait headshot on the right. Typewriter reveal + branching choices.
-- Draws as a modal overlay; the calling scene keeps drawing behind it.
-- Self-binds _G.dialogue.
--
-- Usage:
--   dialogue.start({
--     { who="THE MENTOR", port="portrait_mentor",
--       text="Everything you need is in the textfiles." },
--     { who="newb", port="portrait_newb", text="Choose.", choices={
--         { label="Read more", jump=4 },
--         { label="Log off", done=true } } },
--   }, onDone)
local gfx <const> = playdate.graphics
local D = {}

-- bar geometry (matches handoff: bottom ~27% of a 240px screen)
local BAR_X, BAR_Y, BAR_W, BAR_H = 4, 176, 392, 60
local PORT = 52                       -- framed portrait side
local PORT_X = BAR_X + BAR_W - PORT - 6
local PORT_Y = BAR_Y + (BAR_H - PORT) // 2
local TEXT_X = BAR_X + 12
local TEXT_W = PORT_X - TEXT_X - 10
local CHARS_PER = 2

local portraits = {}
local nameFont, bodyFont

local state = nil

local function fonts()
    if not bodyFont then
        bodyFont = gfx.getSystemFont()
        nameFont = gfx.getSystemFont(gfx.font.kVariantBold) or bodyFont
    end
end

local function loadPort(name)
    if not name then return nil end
    if portraits[name] == nil then
        portraits[name] = gfx.image.new("images/" .. name) or false
    end
    return portraits[name] or nil
end

function D.active() return state ~= nil end

function D.start(nodes, onDone)
    fonts()
    state = { nodes = nodes, i = 1, shown = 0, sel = 1, onDone = onDone }
end

local function node() return state.nodes[state.i] end
local function advanceTo(n) state.i = n; state.shown = 0; state.sel = 1 end
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

    if nd.choices and not typing then
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
    if not nd then return end

    -- bar: solid black with thin white rounded border (handoff look)
    gfx.setColor(gfx.kColorBlack); gfx.fillRoundRect(BAR_X, BAR_Y, BAR_W, BAR_H, 4)
    gfx.setColor(gfx.kColorWhite); gfx.setLineWidth(1); gfx.drawRoundRect(BAR_X, BAR_Y, BAR_W, BAR_H, 4)

    -- framed portrait, right
    local port = loadPort(nd.port)
    if port then
        gfx.setColor(gfx.kColorWhite); gfx.drawRect(PORT_X - 1, PORT_Y - 1, PORT + 2, PORT + 2)
        port:drawScaled(PORT_X, PORT_Y, PORT / 64)   -- 64x64 portrait scaled into the 52 frame
    end

    gfx.setImageDrawMode(gfx.kDrawModeFillWhite)
    -- speaker name (bold)
    if nd.who then
        gfx.setFont(nameFont)
        gfx.drawText(nd.who, TEXT_X, BAR_Y + 5)
    end
    -- body text (typewriter), wrapped
    gfx.setFont(bodyFont)
    local shown = string.sub(nd.text or "", 1, state.shown)
    gfx.drawTextInRect(shown, TEXT_X, BAR_Y + 22, TEXT_W, BAR_H - 24)

    -- choices replace body once fully typed
    if nd.choices and state.shown >= #(nd.text or "") then
        for i, c in ipairs(nd.choices) do
            local y = BAR_Y + 22 + (i - 1) * 14
            gfx.drawText((i == state.sel and "> " or "  ") .. c.label, TEXT_X, y)
        end
    elseif not typing then
        -- blinking advance caret bottom-right of text area
        if (playdate.getCurrentTimeMilliseconds() // 300) % 2 == 0 then
            gfx.fillTriangle(TEXT_X + TEXT_W - 8, BAR_Y + BAR_H - 12,
                             TEXT_X + TEXT_W - 2, BAR_Y + BAR_H - 12,
                             TEXT_X + TEXT_W - 5, BAR_Y + BAR_H - 7)
        end
    end
    gfx.setImageDrawMode(gfx.kDrawModeCopy)
    gfx.setFont(bodyFont)
end

_G.dialogue = D
return D
