-- bg_playground: PWNGLOVE playground — indoor hacker den at night, 400x240, 1-bit
local out = os.getenv("ASE_OUT_DIR")

local spr = Sprite(400, 240, ColorMode.INDEXED)
spr.transparentColor = 0

local pal = Palette(3)
pal:setColor(0, Color{r = 0, g = 0, b = 0, a = 0})
pal:setColor(1, Color{r = 0, g = 0, b = 0, a = 255})
pal:setColor(2, Color{r = 255, g = 255, b = 255, a = 255})
spr:setPalette(pal)

local cel = spr.cels[1]
if cel == nil then cel = spr:newCel(spr.layers[1], 1) end
local img = cel.image

local W, H = 400, 240
local K, WHT = 1, 2

local function put(x, y, c)
  if x >= 0 and x < W and y >= 0 and y < H then img:putPixel(x, y, c) end
end

-- 4x4 Bayer matrix; shade(x,y,lv): lv/16 of pixels come back black
local BAYER = {
  {0, 8, 2, 10},
  {12, 4, 14, 6},
  {3, 11, 1, 9},
  {15, 7, 13, 5},
}
local function shade(x, y, lv)
  if BAYER[(y % 4) + 1][(x % 4) + 1] < lv then return K else return WHT end
end

local function line(x0, y0, x1, y1, c, t)
  local dx = math.abs(x1 - x0)
  local dy = math.abs(y1 - y0)
  local sx = (x0 < x1) and 1 or -1
  local sy = (y0 < y1) and 1 or -1
  local err = dx - dy
  while true do
    for oy = 0, t - 1 do
      for ox = 0, t - 1 do put(x0 + ox, y0 + oy, c) end
    end
    if x0 == x1 and y0 == y1 then break end
    local e2 = 2 * err
    if e2 > -dy then err = err - dy; x0 = x0 + sx end
    if e2 < dx then err = err + dx; y0 = y0 + sy end
  end
end

------------------------------------------------------------------
-- BACK WALL: dithered brick, dark ceiling band, gradient
------------------------------------------------------------------
for y = 0, 117 do
  for x = 0, W - 1 do
    local c
    if y < 6 then
      c = K -- solid ceiling shadow band
    elseif y < 10 then
      c = shade(x, y, 13) -- heavy dither transition under ceiling
    else
      local lv = 11 - math.floor(y / 36) -- wall lightens slightly toward floor
      local by = (y - 10) % 11
      local row = math.floor((y - 10) / 11)
      local off = (row % 2) * 13
      if by == 10 or ((x + off) % 26) == 0 then
        c = K -- mortar lines
      elseif by == 0 and shade(x, y, 4) == K then
        c = WHT -- sparse highlight along top edge of each brick course
      else
        c = shade(x, y, lv)
      end
    end
    put(x, y, c)
  end
end

------------------------------------------------------------------
-- STATION ALCOVES (three, empty for sprite compositing)
------------------------------------------------------------------
local function alcove(x0, y0, x1, y1)
  for y = y0 - 2, y1 + 2 do
    for x = x0 - 2, x1 + 2 do put(x, y, K) end -- chunky black surround
  end
  for y = y0, y1 do
    for x = x0, x1 do
      if x <= x0 + 1 or x >= x1 - 1 or y <= y0 + 1 or y >= y1 - 1 then
        put(x, y, WHT) -- 2px white frame
      else
        put(x, y, K) -- pure black interior, stations composited later
      end
    end
  end
  for x = x0 + 2, x1 - 2 do
    put(x, y1 - 7, WHT) -- desk shelf edge
    for y = y1 - 6, y1 - 2 do
      if shade(x, y, 8) == WHT then put(x, y, WHT) end -- dithered desk top
    end
  end
end

alcove(24, 38, 96, 110)
alcove(152, 38, 224, 110)
alcove(254, 38, 326, 110)

------------------------------------------------------------------
-- POSTER between alcoves 1 and 2 (lightning bolt glyph)
------------------------------------------------------------------
for y = 47, 97 do
  for x = 109, 141 do put(x, y, K) end
end
for y = 48, 96 do
  for x = 110, 140 do
    if x <= 111 or x >= 139 or y <= 49 or y >= 95 then put(x, y, WHT) end
  end
end
line(129, 55, 119, 72, WHT, 2)
line(119, 72, 128, 72, WHT, 2)
line(128, 72, 116, 90, WHT, 2)

------------------------------------------------------------------
-- VENT between alcoves 2 and 3
------------------------------------------------------------------
for y = 52, 84 do
  for x = 230, 248 do put(x, y, K) end
end
for x = 231, 247 do put(x, 53, WHT); put(x, 83, WHT) end
for y = 53, 83 do put(231, y, WHT); put(247, y, WHT) end
for y = 57, 79, 4 do
  for x = 234, 244 do put(x, y, WHT) end
end

------------------------------------------------------------------
-- WINDOW upper right: skyline, moon with dithered glow
------------------------------------------------------------------
local wx0, wy0, wx1, wy1 = 336, 12, 394, 74
for y = wy0 - 2, wy1 + 2 do
  for x = wx0 - 2, wx1 + 2 do put(x, y, K) end
end
for y = wy0, wy1 do
  for x = wx0, wx1 do
    if x <= wx0 + 1 or x >= wx1 - 1 or y <= wy0 + 1 or y >= wy1 - 1 then
      put(x, y, WHT)
    end
  end
end
local sx0, sy0, sx1, sy1 = wx0 + 2, wy0 + 2, wx1 - 2, wy1 - 2
local mx, my = 376, 28
-- night sky, moon disc, two dither glow rings, hashed stars
for y = sy0, sy1 do
  for x = sx0, sx1 do
    local ddx, ddy = x - mx, y - my
    local d2 = ddx * ddx + ddy * ddy
    local c = K
    if d2 <= 64 then
      c = WHT -- moon disc r=8
    elseif d2 <= 121 then
      c = (((x + y) % 2) == 0) and WHT or K -- 50% checker glow
    elseif d2 <= 196 then
      c = (shade(x, y, 12) == WHT) and WHT or K -- 25% outer glow
    elseif ((x * 17 + y * 29) % 97) < 3 then
      c = WHT -- stars
    end
    put(x, y, c)
  end
end
put(374, 26, K); put(378, 31, K); put(373, 30, K) -- moon craters
-- city skyline silhouettes with lit windows
local bh = {16, 26, 12, 30, 20, 24, 15}
local bw = {8, 10, 7, 9, 8, 10, 9}
local bx = sx0
for i = 1, #bh do
  local x1b = bx + bw[i] - 1
  if x1b > sx1 then x1b = sx1 end
  local ytop = sy1 - bh[i]
  for x = bx, x1b do
    for y = ytop, sy1 do put(x, y, K) end
    put(x, ytop, WHT) -- roofline catch-light
  end
  for x = bx + 1, x1b - 1 do
    for y = ytop + 2, sy1 - 1 do
      if x % 3 == 1 and y % 4 == 1 and ((x * 13 + y * 7) % 11) < 4 then
        put(x, y, WHT) -- lit office windows
      end
    end
  end
  bx = bx + bw[i]
  if bx > sx1 then break end
end
-- vertical muntin in front of skyline
for y = sy0, sy1 do put(362, y, WHT); put(363, y, WHT) end

------------------------------------------------------------------
-- FLOOR: perspective checkerboard, quiet center (y 120-220)
------------------------------------------------------------------
for y = 120, 239 do
  local dyv = y - 104 -- vanishing point above wall base
  local depth = 2600 / dyv
  for x = 0, W - 1 do
    local c
    if y < 132 then
      c = shade(x, y, 9) -- shadow band where tiny far tiles would moire
    else
      local wxx = (x - 200) * depth / 110
      local cxi = math.floor(wxx / 26)
      local czi = math.floor(depth / 26)
      if (cxi + czi) % 2 == 0 then
        c = WHT
      else
        c = (((x + y) % 2) == 0) and K or WHT -- checker-dithered dark tiles
      end
    end
    -- vignette only at edges: center stays clean for player sprite
    if (x < 12 or x > 387 or y > 232) and shade(x, y, 9) == K then c = K end
    put(x, y, c)
  end
end
-- wall/floor seam
for x = 0, W - 1 do put(x, 118, K); put(x, 119, K) end

------------------------------------------------------------------
-- CABLES: wall base run, left/right edge runs, bottom run
------------------------------------------------------------------
for x = 0, W - 1 do
  local yc = 113 + math.floor(2.4 * math.sin(x / 13) + 0.5)
  for t = 0, 2 do put(x, yc + t, K) end
end
for y = 120, 239 do
  local xl = 10 + math.floor(5 * math.sin(y / 11) + 0.5)
  local xr = 389 - math.floor(5 * math.sin(y / 13 + 2) + 0.5)
  for t = -1, 1 do put(xl + t, y, K); put(xr + t, y, K) end
end
for x = 0, W - 1 do
  local yc = 233 + math.floor(2 * math.sin(x / 19 + 1) + 0.5)
  for t = 0, 2 do put(x, yc + t, K) end
end
-- junction boxes anchoring cable runs
local function jbox(x0, y0)
  for y = y0, y0 + 8 do
    for x = x0, x0 + 12 do put(x, y, K) end
  end
  for x = x0 + 1, x0 + 11 do put(x, y0 + 1, WHT); put(x, y0 + 7, WHT) end
  for y = y0 + 1, y0 + 7 do put(x0 + 1, y, WHT); put(x0 + 11, y, WHT) end
  put(x0 + 4, y0 + 4, WHT); put(x0 + 8, y0 + 4, WHT)
end
jbox(22, 222)
jbox(358, 222)

------------------------------------------------------------------
-- SAVE (kind=image: no spritesheet export)
------------------------------------------------------------------
spr:flatten()
spr:saveAs(app.fs.joinPath(out, "bg_playground.aseprite"))
spr:saveAs(app.fs.joinPath(out, "bg_playground.png"))
print("ASE_GEN_OK")