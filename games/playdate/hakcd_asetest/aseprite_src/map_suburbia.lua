-- HAKCD phreaker-noir: map_suburbia — 400x240 top-down suburban overworld
-- 1-bit indexed: 0 transparent, 1 black, 2 white. All shading = dither.

local W, H = 400, 240

local spr = Sprite(W, H, ColorMode.INDEXED)
spr.transparentColor = 0
local pal = Palette(3)
pal:setColor(0, Color{r=0, g=0, b=0, a=0})
pal:setColor(1, Color{r=0, g=0, b=0, a=255})
pal:setColor(2, Color{r=255, g=255, b=255, a=255})
spr:setPalette(pal)

local cel = spr.cels[1]
if not cel then cel = spr:newCel(spr.layers[1], 1) end
local img = cel.image

-- ---------- helpers ----------
local function px(x, y, c)
  if x >= 0 and x < W and y >= 0 and y < H then
    img:putPixel(x, y, c)
  end
end

local function rectf(x0, y0, x1, y1, c)
  for y = y0, y1 do
    for x = x0, x1 do
      px(x, y, c)
    end
  end
end

local function disc(cx, cy, r, c)
  local r2 = r * r
  for y = -r, r do
    for x = -r, r do
      if x * x + y * y <= r2 then
        px(cx + x, cy + y, c)
      end
    end
  end
end

local function discChecker(cx, cy, r)
  local r2 = r * r
  for y = -r, r do
    for x = -r, r do
      if x * x + y * y <= r2 then
        local ax, ay = cx + x, cy + y
        if (ax + ay) % 2 == 0 then
          px(ax, ay, 2)
        else
          px(ax, ay, 1)
        end
      end
    end
  end
end

-- ---------- road geometry ----------
local function mainYC(x)
  return 150 + 22 * math.sin(x / 400 * 4.7 + 0.5)
end

local function vertXC(y)
  return 205 + 12 * math.sin(y / 45)
end

local function inMain(x, y)
  return math.abs(y - mainYC(x)) <= 14
end

local function inVert(x, y)
  return math.abs(x - vertXC(y)) <= 13
end

-- ---------- pass 1: grass base + roads, full canvas ----------
for y = 0, H - 1 do
  for x = 0, W - 1 do
    local c = 2
    -- light grass dot-grid dither (offset lattice)
    if (x % 8 == 0 and y % 8 == 4) or (x % 8 == 4 and y % 8 == 0) then
      c = 1
    end
    if inMain(x, y) or inVert(x, y) then
      c = 1
      -- sparse asphalt speck dither
      if (x * 17 + y * 23) % 41 == 0 then
        c = 2
      end
    end
    px(x, y, c)
  end
end

-- grass tufts (little 3-px "w" marks), skip roads
for i = 0, 140 do
  local tx = (i * 97 + 31) % W
  local ty = (i * 61 + 13) % H
  if not inMain(tx, ty) and not inVert(tx, ty) then
    px(tx, ty - 1, 1)
    px(tx - 1, ty, 1)
    px(tx + 1, ty, 1)
  end
end

-- ---------- driveway (house -> main road), dithered concrete ----------
do
  local dx0, dx1 = 54, 68
  local dy1 = math.floor(mainYC(61)) - 12
  for y = 88, dy1 do
    for x = dx0, dx1 do
      if x == dx0 or x == dx1 then
        px(x, y, 1)
      elseif x % 2 == 0 and y % 2 == 0 then
        px(x, y, 1)
      else
        px(x, y, 2)
      end
    end
  end
  -- footpath pad from front door
  for y = 89, 96 do
    for x = 38, 56 do
      if (x + y) % 3 == 0 then px(x, y, 1) else px(x, y, 2) end
    end
  end
end

-- ---------- depot parking pad (asphalt, merges into main road) ----------
for x = 252, 348 do
  local ytop = (x <= 292) and 96 or 112
  local ybot = math.floor(mainYC(x)) - 12
  for y = ytop, ybot do
    if (x * 17 + y * 23) % 41 == 0 then
      px(x, y, 2)
    else
      px(x, y, 1)
    end
  end
end

-- ---------- dashed white center lines ----------
for x = 2, W - 3 do
  if math.floor(x / 9) % 2 == 0 then
    local yc = math.floor(mainYC(x) + 0.5)
    if not inVert(x, yc) then
      px(x, yc - 1, 2)
      px(x, yc, 2)
    end
  end
end
for y = 2, H - 3 do
  if math.floor(y / 9) % 2 == 0 then
    local xc = math.floor(vertXC(y) + 0.5)
    if math.abs(y - mainYC(xc)) > 16 then
      px(xc - 1, y, 2)
      px(xc, y, 2)
    end
  end
end

-- ---------- walkable node clearings (two, on roads) ----------
local function node(cx, cy)
  disc(cx, cy, 12, 2)
  local r2o, r2i = 12 * 12, 10 * 10
  for y = -12, 12 do
    for x = -12, 12 do
      local d2 = x * x + y * y
      if d2 <= r2o and d2 > r2i then
        px(cx + x, cy + y, 1)
      elseif d2 <= 9 * 9 then
        local ax, ay = cx + x, cy + y
        if ax % 4 == 0 and ay % 4 == 0 then px(ax, ay, 1) end
      end
    end
  end
  rectf(cx - 1, cy - 1, cx + 1, cy + 1, 1)
end

node(130, math.floor(mainYC(130) + 0.5))
node(336, math.floor(mainYC(336) + 0.5))

-- ---------- player house (two-story, upper-left, top-3/4) ----------
do
  -- roof mass with shingle dashes
  rectf(24, 18, 95, 45, 1)
  for ry = 22, 42, 4 do
    for x = 26, 93 do
      if (x + ry) % 6 < 3 then px(x, ry, 2) end
    end
  end
  -- ridge hint + eave overhang
  for x = 27, 92 do
    if x % 4 < 2 then px(x, 20, 2) end
  end
  rectf(22, 44, 97, 46, 1)
  -- chimney
  rectf(76, 6, 86, 20, 1)
  rectf(78, 8, 84, 17, 2)
  for y = 8, 17 do
    for x = 78, 84 do
      if (x + y) % 2 == 0 then px(x, y, 1) end
    end
  end
  rectf(74, 5, 88, 7, 1)
  -- front face, two stories
  rectf(26, 46, 93, 88, 1)
  rectf(28, 48, 91, 86, 2)
  rectf(28, 64, 91, 64, 1) -- floor line
  -- windows: 12x11 w/ cross panes
  local function win(wx, wy)
    rectf(wx, wy, wx + 11, wy + 10, 1)
    rectf(wx + 2, wy + 2, wx + 9, wy + 8, 2)
    rectf(wx + 5, wy + 2, wx + 6, wy + 8, 1)
    rectf(wx + 2, wy + 4, wx + 9, wy + 5, 1)
  end
  win(34, 51)
  win(66, 51)
  win(66, 68)
  -- door + knob
  rectf(36, 66, 48, 86, 1)
  rectf(45, 76, 46, 77, 2)
end

-- ---------- Greyhound bus depot (right side) ----------
do
  -- roof slab
  rectf(296, 56, 383, 68, 1)
  for x = 298, 381 do
    if (x * 11 + 57 * 7) % 23 == 0 then px(x, 58, 2) end
    if x % 5 < 2 then px(x, 57, 2) end
  end
  -- face
  rectf(296, 68, 383, 112, 1)
  rectf(298, 70, 381, 110, 2)
  -- bus bay rolling door (slatted)
  rectf(342, 76, 376, 110, 1)
  for yy = 79, 107, 4 do
    rectf(344, yy, 374, yy, 2)
  end
  -- entrance door
  rectf(304, 84, 318, 110, 1)
  px(314, 98, 2)
  px(315, 98, 2)
  -- window w/ cross
  rectf(322, 78, 340, 92, 1)
  rectf(324, 80, 338, 90, 2)
  rectf(330, 80, 331, 90, 1)
  rectf(324, 84, 338, 85, 1)
  -- roof signboard: "BUS" in 5x7 font, scale 2
  rectf(314, 40, 364, 60, 1)
  rectf(316, 42, 362, 58, 2)
  local F = {
    B = {"11110","10001","10001","11110","10001","10001","11110"},
    U = {"10001","10001","10001","10001","10001","10001","01110"},
    S = {"01111","10000","10000","01110","00001","00001","11110"},
  }
  local word = {"B", "U", "S"}
  local lx = 320
  for _, ch in ipairs(word) do
    local g = F[ch]
    for r = 1, 7 do
      local row = g[r]
      for c = 1, 5 do
        if row:sub(c, c) == "1" then
          rectf(lx + (c - 1) * 2, 43 + (r - 1) * 2, lx + (c - 1) * 2 + 1, 43 + (r - 1) * 2 + 1, 1)
        end
      end
    end
    lx = lx + 14
  end
end

-- ---------- payphone sign (by depot pad) ----------
do
  rectf(232, 80, 250, 98, 1)
  rectf(234, 82, 248, 96, 2)
  -- handset icon
  rectf(237, 87, 245, 89, 1)
  rectf(236, 88, 238, 92, 1)
  rectf(244, 88, 246, 92, 1)
  -- pole
  rectf(240, 98, 241, 124, 1)
end

-- ---------- round bushy trees ----------
local function tree(cx, cy)
  local lobes = {
    {0, -1, 10}, {-7, 3, 7}, {7, 3, 7},
    {-5, -6, 7}, {5, -6, 7}, {0, 6, 7},
  }
  for _, l in ipairs(lobes) do
    disc(cx + l[1], cy + l[2], l[3], 1)
  end
  for _, l in ipairs(lobes) do
    discChecker(cx + l[1], cy + l[2], l[3] - 2)
  end
  disc(cx - 4, cy - 5, 3, 2) -- highlight
  for x = cx - 6, cx + 6, 2 do -- ground shadow dashes
    px(x, cy + 15, 1)
  end
end

local trees = {
  {115, 34}, {162, 74}, {28, 116}, {368, 26},
  {300, 208}, {70, 206}, {255, 36}, {348, 186},
  {385, 200}, {178, 22},
}
for _, t in ipairs(trees) do
  tree(t[1], t[2])
end

-- ---------- parked cars ----------
local function carV(x0, y0) -- 14x26, vertical
  local x1, y1 = x0 + 13, y0 + 25
  rectf(x0, y0, x1, y1, 1)
  rectf(x0 + 2, y0 + 2, x1 - 2, y1 - 2, 2)
  rectf(x0 + 3, y0 + 7, x1 - 3, y0 + 9, 1)   -- windshield
  rectf(x0 + 3, y0 + 17, x1 - 3, y0 + 19, 1) -- rear glass
  for y = y0 + 3, y0 + 5 do -- hood dither
    for x = x0 + 3, x1 - 3 do
      if (x + y) % 2 == 0 then px(x, y, 1) end
    end
  end
end

local function carH(x0, y0) -- 26x14, horizontal
  local x1, y1 = x0 + 25, y0 + 13
  rectf(x0, y0, x1, y1, 1)
  rectf(x0 + 2, y0 + 2, x1 - 2, y1 - 2, 2)
  rectf(x0 + 7, y0 + 3, x0 + 9, y1 - 3, 1)   -- windshield
  rectf(x0 + 17, y0 + 3, x0 + 19, y1 - 3, 1) -- rear glass
  for x = x0 + 3, x0 + 5 do -- hood dither
    for y = y0 + 3, y1 - 3 do
      if (x + y) % 2 == 0 then px(x, y, 1) end
    end
  end
end

carV(54, 104)  -- on house driveway
carH(258, 100) -- on depot pad

-- ---------- flatten + save ----------
spr:flatten()
local out = os.getenv("ASE_OUT_DIR")
spr:saveAs(app.fs.joinPath(out, "map_suburbia.aseprite"))
spr:saveAs(app.fs.joinPath(out, "map_suburbia.png"))

print("ASE_GEN_OK")