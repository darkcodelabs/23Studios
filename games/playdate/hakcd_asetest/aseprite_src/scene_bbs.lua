-- scene_bbs: head-on CRT monitor, 400x240, 1-bit HAKCD phreaker-noir
-- palette: 0=transparent, 1=black, 2=white

local W, H = 400, 240
local spr = Sprite(W, H, ColorMode.INDEXED)
spr.transparentColor = 0

local pal = Palette(3)
pal:setColor(0, Color{r=0,   g=0,   b=0,   a=0})
pal:setColor(1, Color{r=0,   g=0,   b=0,   a=255})
pal:setColor(2, Color{r=255, g=255, b=255, a=255})
spr:setPalette(pal)

local cel = spr.cels[1]
if cel == nil then cel = spr:newCel(spr.layers[1], 1) end
local img = cel.image

local function P(x, y, c)
  if x >= 0 and x < W and y >= 0 and y < H then
    img:putPixel(x, y, c)
  end
end

local function rectFill(x0, y0, x1, y1, c)
  for y = y0, y1 do
    for x = x0, x1 do P(x, y, c) end
  end
end

-- inner screen frame (glass mass), chamfered corners
local FX0, FY0, FX1, FY1, FC = 33, 23, 366, 216, 8

local function inFrame(x, y)
  if x < FX0 or x > FX1 or y < FY0 or y > FY1 then return false end
  local dl, dr = x - FX0, FX1 - x
  local dt, db = y - FY0, FY1 - y
  if dl + dt < FC or dr + dt < FC or dl + db < FC or dr + db < FC then
    return false
  end
  return true
end

------------------------------------------------------------------
-- PASS 1: full-canvas base — bezel, shading, frame, case outline
------------------------------------------------------------------
for y = 0, H - 1 do
  for x = 0, W - 1 do
    local dl, dr, dt, db = x, (W - 1) - x, y, (H - 1) - y
    local c = 2 -- beige bezel base = white

    -- bezel stipple texture (sparse dot grid = beige plastic)
    if (x % 6 == 0 and y % 6 == 0) or (x % 6 == 3 and y % 6 == 3) then
      c = 1
    end

    -- form shadow: 50% checker on right edge and lower bezel
    if dr >= 3 and dr <= 12 and (x + y) % 2 == 0 then c = 1 end
    if db >= 3 and db <= 8  and (x + y) % 2 == 0 then c = 1 end

    -- recess shadow ring hugging the screen frame
    if x >= FX0 - 4 and x <= FX1 + 4 and y >= FY0 - 4 and y <= FY1 + 4
       and (x + y) % 2 == 0 then
      c = 1
    end

    -- screen frame + dark glass mass
    if inFrame(x, y) then c = 1 end

    -- heavy outer case outline with rounded (chamfered) corners
    if dl < 3 or dr < 3 or dt < 3 or db < 3
       or dl + dt < 12 or dr + dt < 12 or dl + db < 12 or dr + db < 12 then
      c = 1
    end

    img:putPixel(x, y, c)
  end
end

------------------------------------------------------------------
-- PASS 2: glass edge highlight (top/left solid, bottom/right dotted)
------------------------------------------------------------------
local gx0, gy0, gx1, gy1 = FX0 + 2, FY0 + 2, FX1 - 2, FY1 - 2
for x = gx0, gx1 do
  if inFrame(x, gy0) then P(x, gy0, 2) end
end
for y = gy0, gy1 do
  if inFrame(gx0, y) then P(gx0, y, 2) end
end
for x = gx0, gx1, 2 do
  if inFrame(x, gy1) then P(x, gy1, 2) end
end
for y = gy0, gy1, 2 do
  if inFrame(gx1, y) then P(gx1, y, 2) end
end

------------------------------------------------------------------
-- PASS 3: faint horizontal scanlines across the dark screen
-- staggered sparse dots; screen stays mostly empty for terminal text
------------------------------------------------------------------
for y = 29, 211 do
  if y % 4 == 1 then
    local off = (math.floor(y / 4) * 3) % 6
    for x = 40, 360 do
      if (x + off) % 6 == 0 then P(x, y, 2) end
    end
  end
end

------------------------------------------------------------------
-- PASS 4: prompt hint upper-left: ">" chevron + block cursor
------------------------------------------------------------------
local chev = {
  {1,0,0},
  {0,1,0},
  {0,0,1},
  {0,1,0},
  {1,0,0},
}
for ry = 1, 5 do
  for rx = 1, 3 do
    if chev[ry][rx] == 1 then
      local px, py = 46 + (rx - 1) * 2, 37 + (ry - 1) * 2
      rectFill(px, py, px + 1, py + 1, 2)
    end
  end
end
rectFill(56, 36, 63, 47, 2) -- block cursor

------------------------------------------------------------------
-- PASS 5: bezel hardware details
------------------------------------------------------------------
-- corner screws: 3x3 black with white slot
local screws = {{14,13},{385,13},{14,224},{385,224}}
for i = 1, #screws do
  local sx, sy = screws[i][1], screws[i][2]
  rectFill(sx - 1, sy - 1, sx + 1, sy + 1, 1)
  P(sx - 1, sy, 2); P(sx, sy, 2); P(sx + 1, sy, 2)
end

-- vent slots, bottom-left bezel (2px strokes)
for i = 0, 3 do
  local vx = 20 + i * 5
  rectFill(vx, 221, vx + 1, 230, 1)
end

-- degauss indicator dots, top-right bezel
rectFill(372, 11, 373, 12, 1)
rectFill(378, 11, 379, 12, 1)

-- power button with power-symbol glyph
rectFill(340, 218, 360, 231, 1)
rectFill(342, 220, 358, 229, 2)
rectFill(349, 221, 350, 225, 1)
local arc = {{346,223},{345,225},{346,227},{348,228},
             {352,228},{354,227},{355,225},{354,223}}
for i = 1, #arc do P(arc[i][1], arc[i][2], 1) end

-- power LED, lit (solid white core in black well)
rectFill(366, 220, 377, 229, 1)
rectFill(368, 222, 375, 227, 2)

-- brand plate "HAKCD", 3x5 font at 2x, bottom-center bezel
local font = {
  H = {"101","101","111","101","101"},
  A = {"010","101","111","101","101"},
  K = {"101","110","100","110","101"},
  C = {"011","100","100","100","011"},
  D = {"110","101","101","101","110"},
}
local label, tx, ty = "HAKCD", 181, 222
for ci = 1, #label do
  local glyph = font[string.sub(label, ci, ci)]
  for ry = 1, 5 do
    local row = glyph[ry]
    for rx = 1, 3 do
      if string.sub(row, rx, rx) == "1" then
        local px = tx + (ci - 1) * 8 + (rx - 1) * 2
        local py = ty + (ry - 1) * 2
        rectFill(px, py, px + 1, py + 1, 1)
      end
    end
  end
end

------------------------------------------------------------------
-- flatten + save (image asset: PNG + .aseprite source, no sheet)
------------------------------------------------------------------
spr:flatten()
local out = os.getenv("ASE_OUT_DIR")
spr:saveAs(app.fs.joinPath(out, "scene_bbs.aseprite"))
spr:saveAs(app.fs.joinPath(out, "scene_bbs.png"))
print("ASE_GEN_OK")