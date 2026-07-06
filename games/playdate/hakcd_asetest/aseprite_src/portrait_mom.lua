-- portrait_mom.png — MARIO-64 style 1-bit dialogue portrait, 64x64
-- Warm-but-tired suburban mom, permed hair, cordless phone, mid-yell.

local W, H = 64, 64
local sprite = Sprite(W, H, ColorMode.INDEXED)
sprite.transparentColor = 0

local pal = Palette(3)
pal:setColor(0, Color{r=0, g=0, b=0, a=0})       -- 0 transparent
pal:setColor(1, Color{r=0, g=0, b=0, a=255})     -- 1 black
pal:setColor(2, Color{r=255, g=255, b=255, a=255}) -- 2 white
sprite:setPalette(pal)

local cel = sprite.cels[1]
if cel == nil then cel = sprite:newCel(sprite.layers[1], 1) end
local img = cel.image

-- ---------- helpers ----------
local function px(x, y, c)
  if x >= 0 and x < W and y >= 0 and y < H then img:putPixel(x, y, c) end
end

local function rectf(x0, y0, x1, y1, c)
  for y = y0, y1 do for x = x0, x1 do px(x, y, c) end end
end

local function fillEllipse(cx, cy, rx, ry, c)
  for y = -ry, ry do
    local t = 1 - (y * y) / (ry * ry)
    if t >= 0 then
      local w = math.floor(rx * math.sqrt(t) + 0.5)
      for x = -w, w do px(cx + x, cy + y, c) end
    end
  end
end

local function fillCircle(cx, cy, r, c) fillEllipse(cx, cy, r, r, c) end

local function ring(cx, cy, r, c, thick, dyMin)
  thick = thick or 1.5
  dyMin = dyMin or -99
  for y = -r, r do
    for x = -r, r do
      local d = math.sqrt(x * x + y * y)
      if d <= r + 0.25 and d >= r - thick and y >= dyMin then
        px(cx + x, cy + y, c)
      end
    end
  end
end

local function lineT(x0, y0, x1, y1, c, th)
  th = th or 2
  local steps = math.max(math.abs(x1 - x0), math.abs(y1 - y0), 1)
  for i = 0, steps do
    local x = math.floor(x0 + (x1 - x0) * i / steps + 0.5)
    local y = math.floor(y0 + (y1 - y0) * i / steps + 0.5)
    for a = 0, th - 1 do px(x, y + a, c) end
  end
end

-- Bayer-ish dither levels: 1 sparse -> 3 checker -> 4 dense
local function dith(x, y, level)
  if level >= 4 then return not (x % 2 == 0 and y % 2 == 0)
  elseif level == 3 then return (x + y) % 2 == 0
  elseif level == 2 then return x % 2 == 0 and y % 2 == 0
  elseif level == 1 then return x % 4 == 0 and y % 4 == 2
  end
  return false
end

-- ---------- 1. background: soft diagonal dither vignette, edge to edge ----------
rectf(0, 0, 63, 63, 2)
for y = 0, 63 do
  for x = 0, 63 do
    local s = x + y
    local lv = 0
    if s >= 88 then lv = 3 elseif s >= 68 then lv = 2 elseif s >= 48 then lv = 1 end
    if lv > 0 and dith(x, y, lv) then px(x, y, 1) end
  end
end

-- ---------- 2. permed hair: union of round curl-blobs ----------
local HAIR = {
  {30,13,11},{22, 9, 8},{38, 9, 8},{17,17, 9},{43,17, 9},
  {10,27, 8},{50,27, 8},{ 8,37, 7},{52,37, 7},{12,46, 7},{48,46, 7},
}
local function inHair(x, y, shrink)
  for i = 1, #HAIR do
    local c = HAIR[i]
    local dx, dy = x - c[1], y - c[2]
    local r = c[3] - shrink
    if r > 0 and dx * dx + dy * dy <= r * r then return true end
  end
  return false
end

for i = 1, #HAIR do fillCircle(HAIR[i][1], HAIR[i][2], HAIR[i][3], 1) end     -- 3px union outline
for i = 1, #HAIR do fillCircle(HAIR[i][1], HAIR[i][2], HAIR[i][3] - 3, 2) end -- white body

-- hair volume ramp: light upper-left -> dark lower-right
for y = 0, 63 do
  for x = 0, 63 do
    if inHair(x, y, 3) then
      local s = x + y
      local lv = 0
      if s > 78 then lv = 3 elseif s > 64 then lv = 2 elseif s > 50 then lv = 1 end
      if lv > 0 and dith(x, y, lv) then px(x, y, 1) end
    end
  end
end

-- curl detail rings inside the perm
local CURLS = {{30,10,4},{23,7,3},{37,7,3},{18,16,3},{42,16,3},{10,27,3},{50,27,3},{12,45,3},{48,45,3}}
for i = 1, #CURLS do
  local c = CURLS[i]
  for y = -c[3], c[3] do
    for x = -c[3], c[3] do
      local d = math.sqrt(x * x + y * y)
      if d <= c[3] + 0.25 and d >= c[3] - 1.5 and inHair(c[1] + x, c[2] + y, 4) then
        px(c[1] + x, c[2] + y, 1)
      end
    end
  end
end

-- ---------- 3. neck ----------
rectf(24, 46, 38, 58, 1)
rectf(27, 46, 35, 58, 2)

-- ---------- 4. shoulders / robe ----------
local SCX, SCY, SRX, SRY = 31, 86, 40, 32
fillEllipse(SCX, SCY, SRX, SRY, 1)
fillEllipse(SCX, SCY, SRX - 3, SRY - 3, 2)
for y = 54, 63 do
  for x = 0, 63 do
    local nx, ny = (x - SCX) / (SRX - 3), (y - SCY) / (SRY - 3)
    if nx * nx + ny * ny <= 1 then
      -- rounded-shoulder shading, dark to the right
      local lv = 0
      if x > 50 then lv = 3 elseif x > 42 then lv = 2 end
      if lv > 0 and dith(x, y, lv) then px(x, y, 1) end
      -- mom-robe polka dots
      if lv == 0 and y % 4 == 2 and (x + (math.floor(y / 4) % 2) * 3) % 6 == 1 then
        px(x, y, 1)
      end
    end
  end
end
-- collar V
lineT(27, 57, 31, 62, 1, 2)
lineT(35, 57, 31, 62, 1, 2)

-- ---------- 5. chunky volumetric head ----------
local FCX, FCY, FRX, FRY = 30, 35, 14, 16
fillEllipse(FCX, FCY, FRX, FRY, 1)                  -- 3px contour
fillEllipse(FCX, FCY, FRX - 3, FRY - 3, 2)          -- face
for y = FCY - FRY, FCY + FRY do
  for x = FCX - FRX, FCX + FRX do
    local nx, ny = (x - FCX) / (FRX - 3), (y - FCY) / (FRY - 3)
    if nx * nx + ny * ny <= 1 then
      -- curved cheek falloff, key light upper-left
      if nx > 0.55 and dith(x, y, 2) then px(x, y, 1)
      elseif nx > 0.25 and dith(x, y, 1) then px(x, y, 1) end
    end
  end
end

-- ---------- 6. bang curls over the forehead ----------
fillCircle(22, 22, 4, 1); fillCircle(30, 20, 4, 1); fillCircle(38, 22, 4, 1)
fillCircle(22, 22, 2, 2); fillCircle(30, 20, 2, 2); fillCircle(38, 22, 2, 2)
-- AO shadow cast by bangs onto forehead
for x = 20, 40 do
  for y = 25, 26 do
    local nx, ny = (x - FCX) / (FRX - 3), (y - FCY) / (FRY - 3)
    if nx * nx + ny * ny <= 1 and (x + y) % 2 == 0 then px(x, y, 1) end
  end
end

-- ---------- 7. cordless phone pressed to ear ----------
rectf(51, 8, 52, 21, 1)          -- antenna
fillCircle(52, 6, 2, 1)          -- antenna nub
rectf(43, 22, 55, 46, 1)         -- body outline block
px(43, 22, 2); px(55, 22, 2); px(43, 46, 2); px(55, 46, 2) -- rounded corners
rectf(46, 25, 52, 43, 2)         -- plastic face
rectf(47, 27, 51, 28, 1)         -- speaker slit
for yy = 32, 41, 3 do            -- keypad dots
  for xx = 47, 51, 2 do px(xx, yy, 1) end
end
for y = 25, 43 do                -- curved-plastic shading
  for x = 50, 52 do if dith(x, y, 2) then px(x, y, 1) end end
end
-- chunky gripping hand: three knuckle bumps
fillCircle(45, 48, 4, 1); fillCircle(49, 49, 4, 1); fillCircle(53, 48, 4, 1)
fillCircle(45, 48, 2, 2); fillCircle(49, 49, 2, 2); fillCircle(53, 48, 2, 2)

-- ---------- 8. exasperated mid-yell face ----------
lineT(18, 27, 26, 31, 1, 2)      -- angry brow L (slams inward-down)
lineT(34, 31, 42, 27, 1, 2)      -- angry brow R
ring(22, 31, 4, 1, 2, 2)         -- squeezed-shut eye L (down arc)
ring(38, 31, 4, 1, 2, 2)         -- squeezed-shut eye R
lineT(18, 37, 23, 38, 1, 1)      -- tired eye bag L
lineT(37, 38, 42, 37, 1, 1)      -- tired eye bag R
ring(30, 34, 3, 1, 1.8, 1)       -- round little nose
lineT(19, 41, 21, 45, 1, 2)      -- yell crease by mouth

-- big open yelling mouth
fillEllipse(29, 45, 8, 5, 1)
rectf(25, 41, 33, 42, 2)         -- top teeth
px(28, 41, 1); px(28, 42, 1); px(31, 41, 1); px(31, 42, 1) -- tooth gaps
for y = 47, 49 do                -- dithered tongue glint
  for x = 22, 36 do
    local dx, dy = (x - 29) / 8, (y - 45) / 5
    if dx * dx + dy * dy <= 0.85 and (x + y) % 2 == 0 then px(x, y, 2) end
  end
end

-- ---------- 9. exasperation sweat drop ----------
px(57, 9, 1)
rectf(56, 10, 58, 12, 1)
fillCircle(57, 14, 3, 1)
px(56, 13, 2); px(57, 13, 2); px(56, 14, 2)

-- ---------- save ----------
local out = os.getenv("ASE_OUT_DIR")
sprite:saveAs(app.fs.joinPath(out, "portrait_mom.aseprite"))
sprite:saveAs(app.fs.joinPath(out, "portrait_mom.png"))

print("ASE_GEN_OK")