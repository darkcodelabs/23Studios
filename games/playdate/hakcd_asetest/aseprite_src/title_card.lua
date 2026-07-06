-- HAKCD title card — Mario64-style 1-bit, 400x240
local out = os.getenv("ASE_OUT_DIR")
local spr = Sprite(400, 240, ColorMode.INDEXED)
spr.transparentColor = 0

local pal = Palette(3)
pal:setColor(0, Color{r=0,   g=0,   b=0,   a=0})
pal:setColor(1, Color{r=0,   g=0,   b=0,   a=255})
pal:setColor(2, Color{r=255, g=255, b=255, a=255})
spr:setPalette(pal)

local cel = spr.cels[1]
if cel == nil then cel = spr:newCel(spr.layers[1], 1) end
local img = cel.image

local function pput(x, y, c)
  if x >= 0 and x < 400 and y >= 0 and y < 240 then img:putPixel(x, y, c) end
end

-- Bayer 4x4 for glow ramps
local B = {{0,8,2,10},{12,4,14,6},{3,11,1,9},{15,7,13,5}}
local function bay(x, y) return B[y % 4 + 1][x % 4 + 1] end

----------------------------------------------------------------
-- BACKGROUND: night sky, stars, horizon glow, quiet band, street
----------------------------------------------------------------
for y = 0, 239 do
  for x = 0, 399 do
    local c = 1
    if y < 96 and (x * 73 + y * 151 + x * y * 7) % 523 == 3 then c = 2 end
    if y >= 100 and y <= 195 then
      local g = math.floor((y - 100) * 7 / 95)  -- glow rises toward horizon
      if bay(x, y) < g then c = 2 end
    end
    if y == 217 or y == 218 then c = 2 end       -- street edge, 2px
    if y >= 220 and (x * 13 + y * 29) % 41 == 0 then c = 2 end
    img:putPixel(x, y, c)
  end
end
-- big twinkle stars (cross shape)
for y = 4, 90 do
  for x = 4, 395 do
    if (x * 29 + y * 97) % 1777 == 11 then
      pput(x, y, 2) pput(x-1, y, 2) pput(x+1, y, 2) pput(x, y-1, 2) pput(x, y+1, 2)
    end
  end
end

----------------------------------------------------------------
-- SKYLINE: black building silhouettes over the glow, lit windows
----------------------------------------------------------------
local blds = {
  {0,34,150},{30,28,132},{54,40,158},{90,26,124},{112,36,146},{144,30,128},
  {170,44,152},{210,30,120},{236,38,144},{270,28,132},{294,42,156},
  {332,30,126},{358,42,148}
}
for _, b in ipairs(blds) do
  local x0, w, top = b[1], b[2], b[3]
  local x1 = math.min(399, x0 + w - 1)
  for y = top, 195 do
    for x = x0, x1 do img:putPixel(x, y, 1) end
  end
  for wy = top + 6, 188, 8 do
    for wx = x0 + 4, x0 + w - 8, 7 do
      if (wx * 31 + wy * 17) % 5 < 2 then
        for j = 0, 1 do for i = 0, 2 do pput(wx + i, wy + j, 2) end end
      end
    end
  end
end
-- rooftop antennas with blinker lights
for _, i in ipairs({2, 5, 9, 12}) do
  local b = blds[i]
  local ax = b[1] + math.floor(b[2] / 2)
  for y = b[3] - 14, b[3] do pput(ax, y, 1) pput(ax + 1, y, 1) end
  for j = 0, 1 do for k = 0, 1 do pput(ax + k, b[3] - 16 + j, 2) end end
end

----------------------------------------------------------------
-- MASK TOOLKIT (rounded rects, thick diagonals, 3D composite)
----------------------------------------------------------------
local function mget(m, x, y) local r = m[y] return r and r[x] end
local function mset(m, x, y)
  local r = m[y]
  if not r then r = {} m[y] = r end
  r[x] = true
end
local function rrect(m, x0, y0, x1, y1, r, erase)
  for y = y0, y1 do
    local row = m[y]
    if not row and not erase then row = {} m[y] = row end
    if row then
      for x = x0, x1 do
        local dx, dy = 0, 0
        if x < x0 + r then dx = x0 + r - x elseif x > x1 - r then dx = x - (x1 - r) end
        if y < y0 + r then dy = y0 + r - y elseif y > y1 - r then dy = y - (y1 - r) end
        if dx == 0 or dy == 0 or dx * dx + dy * dy <= r * r then
          if erase then row[x] = nil else row[x] = true end
        end
      end
    end
  end
end
local function tline(m, x0, y0, x1, y1, w)
  local steps = math.max(math.abs(x1 - x0), math.abs(y1 - y0))
  local h = math.floor(w / 2)
  for t = 0, steps do
    local cx = x0 + math.floor((x1 - x0) * t / steps + 0.5)
    local cy = y0 + math.floor((y1 - y0) * t / steps + 0.5)
    rrect(m, cx - h, cy - h, cx + h, cy + h, 2)
  end
end

-- Extruded rounded solid: black rim, checker side wall,
-- white face with dither AO toward lower-right (key light upper-left)
local function drawSolid(F, lx, ly, depth)
  local E = {}
  for y, row in pairs(F) do
    for x in pairs(row) do
      for d = 0, depth do mset(E, x + d, y + d) end
    end
  end
  for y, row in pairs(E) do
    for x in pairs(row) do
      if not (mget(E,x-1,y) and mget(E,x+1,y) and mget(E,x,y-1) and mget(E,x,y+1)) then
        for j = -3, 3 do for i = -3, 3 do pput(lx+x+i, ly+y+j, 1) end end
      end
    end
  end
  for y, row in pairs(E) do
    for x in pairs(row) do
      local gx, gy = lx + x, ly + y
      pput(gx, gy, ((gx + gy) % 2 == 0) and 2 or 1)
    end
  end
  for y, row in pairs(F) do
    for x in pairs(row) do
      if not (mget(F,x-1,y) and mget(F,x+1,y) and mget(F,x,y-1) and mget(F,x,y+1)) then
        for j = -3, 3 do for i = -3, 3 do pput(lx+x+i, ly+y+j, 1) end end
      end
    end
  end
  for y, row in pairs(F) do
    for x in pairs(row) do
      local gx, gy = lx + x, ly + y
      local c = 2
      if not mget(F, x + 3, y + 3) then
        c = ((gx + gy) % 2 == 0) and 2 or 1          -- 50% AO band at edge
      elseif not mget(F, x + 6, y + 6) then
        c = ((gx % 2 == 0) and (gy % 2 == 0)) and 1 or 2  -- 25% falloff
      end
      pput(gx, gy, c)
    end
  end
end

----------------------------------------------------------------
-- "HAKCD" — 56x80 cells, 16px strokes, rounded, 7px extrusion
----------------------------------------------------------------
local function maskH()
  local m = {}
  rrect(m, 0, 0, 15, 79, 7)
  rrect(m, 40, 0, 55, 79, 7)
  rrect(m, 0, 32, 55, 47, 7)
  return m
end
local function maskA()
  local m = {}
  rrect(m, 0, 0, 55, 15, 12)
  rrect(m, 0, 4, 15, 79, 7)
  rrect(m, 40, 4, 55, 79, 7)
  rrect(m, 4, 38, 51, 52, 7)
  return m
end
local function maskK()
  local m = {}
  rrect(m, 0, 0, 15, 79, 7)
  tline(m, 10, 36, 44, 8, 14)
  tline(m, 10, 44, 44, 72, 14)
  return m
end
local function maskC()
  local m = {}
  rrect(m, 0, 0, 55, 79, 22)
  rrect(m, 16, 18, 55, 61, 10, true)
  rrect(m, 32, 18, 55, 61, 0, true)
  return m
end
local function maskD()
  local m = {}
  rrect(m, 0, 0, 55, 79, 26)
  rrect(m, 0, 0, 15, 79, 6)
  rrect(m, 18, 18, 39, 61, 11, true)
  return m
end

local letters = {maskH(), maskA(), maskK(), maskC(), maskD()}
for i, m in ipairs(letters) do
  drawSolid(m, 36 + (i - 1) * 68, 24, 7)
end

----------------------------------------------------------------
-- "PHREAKER NOIR" — 5x7 glyphs, scale 3, 2px black outline
----------------------------------------------------------------
local FONT = {
  P = {"11110","10001","10001","11110","10000","10000","10000"},
  H = {"10001","10001","10001","11111","10001","10001","10001"},
  R = {"11110","10001","10001","11110","10100","10010","10001"},
  E = {"11111","10000","10000","11110","10000","10000","11111"},
  A = {"01110","10001","10001","11111","10001","10001","10001"},
  K = {"10001","10010","10100","11000","10100","10010","10001"},
  N = {"10001","11001","10101","10011","10001","10001","10001"},
  O = {"01110","10001","10001","10001","10001","10001","01110"},
  I = {"11111","00100","00100","00100","00100","00100","11111"},
  [" "] = {"00000","00000","00000","00000","00000","00000","00000"},
}
local text = "PHREAKER NOIR"
local tx0, ty0 = 84, 146
for pass = 1, 2 do
  for ci = 1, #text do
    local g = FONT[text:sub(ci, ci)]
    for gy = 1, 7 do
      local rowstr = g[gy]
      for gx = 1, 5 do
        if rowstr:sub(gx, gx) == "1" then
          local X = tx0 + (ci - 1) * 18 + (gx - 1) * 3
          local Y = ty0 + (gy - 1) * 3
          if pass == 1 then
            for j = -2, 4 do for i = -2, 4 do pput(X + i, Y + j, 1) end end
          else
            for j = 0, 2 do for i = 0, 2 do pput(X + i, Y + j, 2) end end
          end
        end
      end
    end
  end
end

----------------------------------------------------------------
-- POWER GLOVE icon, lower-right (stays above y=196 quiet band)
----------------------------------------------------------------
local G = {}
rrect(G, 12, 8, 44, 40, 10)   -- fist
rrect(G, 36, 0, 46, 16, 4)    -- raised index finger
rrect(G, 4, 12, 16, 26, 5)    -- thumb
rrect(G, 0, 28, 18, 45, 5)    -- forearm cuff
local gvx, gvy = 344, 142
drawSolid(G, gvx, gvy, 3)
-- knuckle seams
for y = 14, 26 do
  for i = 0, 1 do
    pput(gvx + 26 + i, gvy + y, 1)
    pput(gvx + 33 + i, gvy + y, 1)
  end
end
-- cuff tech dither (50%)
for y = 29, 44 do
  for x = 1, 17 do
    if mget(G, x, y) and (gvx + x + gvy + y) % 2 == 1 then
      pput(gvx + x, gvy + y, 1)
    end
  end
end
-- forearm buttons: white pad, black key
for _, p in ipairs({{4, 32}, {10, 36}}) do
  for j = -1, 2 do for i = -1, 2 do pput(gvx + p[1] + i, gvy + p[2] + j, 2) end end
  for j = 0, 1 do for i = 0, 1 do pput(gvx + p[1] + i, gvy + p[2] + j, 1) end end
end

----------------------------------------------------------------
-- SAVE — flat single image, exact filename title_card.png
----------------------------------------------------------------
spr:flatten()
spr:saveAs(app.fs.joinPath(out, "title_card.aseprite"))
spr:saveAs(app.fs.joinPath(out, "title_card.png"))
print("ASE_GEN_OK")