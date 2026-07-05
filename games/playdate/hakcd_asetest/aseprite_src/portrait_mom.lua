-- portrait_mom — 64x64 1-bit dialogue portrait
-- MOM: mid-40s, tired-but-warm, permed 90s hair, cordless phone, mid-yell.
-- HAKCD phreaker-noir: heavy black masses, 2px rim, checker dither, no gray.

local W, H = 64, 64

-- palette indices: 0 transparent, 1 black, 2 white
local buf = {}
for y = 0, H - 1 do
  buf[y] = {}
  for x = 0, W - 1 do buf[y][x] = 2 end
end

local function set(x, y, c)
  if x >= 0 and x < W and y >= 0 and y < H then buf[y][x] = c end
end
local function get(x, y)
  if x >= 0 and x < W and y >= 0 and y < H then return buf[y][x] end
  return 0
end
local function rnd(v) return math.floor(v + 0.5) end
local function fillRect(x0, y0, x1, y1, c)
  for y = y0, y1 do for x = x0, x1 do set(x, y, c) end end
end
local function fillCircle(cx, cy, r, c)
  for dy = -r, r do for dx = -r, r do
    if dx * dx + dy * dy <= r * r then set(cx + dx, cy + dy, c) end
  end end
end
local function fillEllipse(cx, cy, rx, ry, c)
  for dy = -ry, ry do for dx = -rx, rx do
    if (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1 then
      set(cx + dx, cy + dy, c)
    end
  end end
end
local function line(x0, y0, x1, y1, c)
  local dx = math.abs(x1 - x0)
  local sx = x0 < x1 and 1 or -1
  local dy = -math.abs(y1 - y0)
  local sy = y0 < y1 and 1 or -1
  local err = dx + dy
  while true do
    set(x0, y0, c)
    if x0 == x1 and y0 == y1 then break end
    local e2 = 2 * err
    if e2 >= dy then err = err + dy; x0 = x0 + sx end
    if e2 <= dx then err = err + dx; y0 = y0 + sy end
  end
end
local function thick(x0, y0, x1, y1, c)
  line(x0, y0, x1, y1, c)
  line(x0, y0 - 1, x1, y1 - 1, c)
end

---------------------------------------------------------------
-- 1. background: white with sparse black dot-grid, edge to edge
---------------------------------------------------------------
for y = 0, 63 do
  for x = 0, 63 do
    if x % 4 == 1 and y % 4 == 1 then set(x, y, 1) end
  end
end

---------------------------------------------------------------
-- 2. permed hair: cloud of overlapping black circles (bumpy perm)
---------------------------------------------------------------
fillCircle(31, 13, 9, 1)
fillCircle(21, 17, 8, 1)
fillCircle(41, 17, 8, 1)
fillCircle(17, 25, 7, 1)
fillCircle(45, 25, 7, 1)
fillCircle(15, 34, 6, 1)
fillCircle(47, 34, 6, 1)
fillCircle(16, 42, 5, 1)
fillCircle(46, 42, 5, 1)

-- white "C" curl highlights inside the black mass
local CURL = { {-2,-1},{-2,0},{-2,1},{-1,-2},{0,-2},{-1,2},{0,2} }
local function curl(cx, cy)
  for i = 1, #CURL do set(cx + CURL[i][1], cy + CURL[i][2], 2) end
end
curl(31, 8)
curl(24, 11)
curl(37, 11)
curl(44, 16)
curl(16, 22)
curl(13, 33)
curl(14, 42)

---------------------------------------------------------------
-- 3. neck (white, 2px black sides)
---------------------------------------------------------------
fillRect(25, 40, 37, 47, 2)
fillRect(25, 40, 26, 47, 1)
fillRect(36, 40, 37, 47, 1)

---------------------------------------------------------------
-- 4. face oval carved out of hair
---------------------------------------------------------------
fillEllipse(31, 29, 9, 11, 2)

-- jaw / chin outline, 2px (per-column + per-row so slope has no gaps)
for dx = -8, 8 do
  local dyv = 11 * math.sqrt(1 - (dx * dx) / 81.0)
  local by = 29 + rnd(dyv)
  if by >= 33 then
    set(31 + dx, by, 1)
    set(31 + dx, by - 1, 1)
  end
end
for dyy = 6, 11 do
  local xx = rnd(9 * math.sqrt(1 - (dyy * dyy) / 121.0))
  set(31 - xx, 29 + dyy, 1)
  set(31 - xx + 1, 29 + dyy, 1)
  set(31 + xx, 29 + dyy, 1)
  set(31 + xx - 1, 29 + dyy, 1)
end

-- checker shadow under the chin, on the neck
for y = 41, 43 do
  for x = 27, 35 do
    if get(x, y) == 2 and (x + y) % 2 == 0 then set(x, y, 1) end
  end
end

---------------------------------------------------------------
-- 5. bangs: scalloped perm fringe dipping onto forehead
---------------------------------------------------------------
fillCircle(24, 16, 4, 1)
fillCircle(31, 14, 4, 1)
fillCircle(38, 16, 4, 1)

---------------------------------------------------------------
-- 6. face features: tired + mid-yell
---------------------------------------------------------------
-- forehead worry creases
set(28, 21, 1); set(29, 21, 1); set(30, 21, 1)
set(32, 21, 1); set(33, 21, 1); set(34, 21, 1)

-- angry brows angled down toward center, 2px
thick(24, 23, 28, 26, 1)
thick(38, 23, 34, 26, 1)

-- eyes squeezed shut mid-yell (angled slits, 2px)
set(24, 28, 1); set(25, 28, 1); set(26, 29, 1); set(27, 29, 1)
set(24, 29, 1); set(25, 29, 1); set(26, 30, 1); set(27, 30, 1)
set(38, 28, 1); set(37, 28, 1); set(36, 29, 1); set(35, 29, 1)
set(38, 29, 1); set(37, 29, 1); set(36, 30, 1); set(35, 30, 1)

-- tired bags under eyes
set(24, 32, 1); set(25, 32, 1)
set(37, 32, 1); set(38, 32, 1)

-- nose bridge + nostrils
set(31, 28, 1); set(31, 29, 1); set(31, 30, 1)
set(29, 31, 1); set(33, 31, 1)

-- cheek dither (worn, tired shading)
for y = 30, 35 do
  for x = 23, 25 do
    if get(x, y) == 2 and (x + y) % 2 == 0 then set(x, y, 1) end
  end
  for x = 37, 39 do
    if get(x, y) == 2 and (x + y) % 2 == 0 then set(x, y, 1) end
  end
end

-- wide-open yelling mouth: black rim, white teeth strip, black cavity
fillRect(27, 33, 35, 37, 1)
fillRect(28, 32, 34, 32, 1)
fillRect(28, 38, 34, 38, 1)
fillRect(29, 33, 33, 34, 2)

---------------------------------------------------------------
-- 7. shoulders / blouse: big white ellipse clipped by canvas
---------------------------------------------------------------
fillEllipse(31, 66, 34, 20, 2)
-- 2px black arc along shoulder top
for dx = -33, 33 do
  local t = 1 - (dx * dx) / 1156.0
  if t > 0 then
    local ty = 66 - rnd(20 * math.sqrt(t))
    set(31 + dx, ty, 1)
    set(31 + dx, ty + 1, 1)
  end
end
-- V collar
line(28, 48, 31, 53, 1)
line(29, 48, 32, 53, 1)
line(34, 48, 31, 53, 1)
line(33, 48, 30, 53, 1)
-- side checker shading + 90s polka-dot blouse pattern (inside inner ellipse)
for y = 48, 61 do
  for x = 3, 60 do
    local ex = ((x - 31) * (x - 31)) / 1024.0 + ((y - 66) * (y - 66)) / 324.0
    if ex <= 1 and get(x, y) == 2 then
      if (x <= 12 or x >= 50) and (x + y) % 2 == 0 then
        set(x, y, 1)
      elseif y >= 50 and y % 3 == 2 and (x + math.floor(y / 3)) % 6 == 2 then
        set(x, y, 1)
      end
    end
  end
end

---------------------------------------------------------------
-- 8. cordless phone held to her ear (right side), drawn in front
---------------------------------------------------------------
-- antenna with white halo so it reads over black hair
fillRect(49, 4, 54, 20, 2)
fillRect(50, 4, 53, 5, 1)   -- antenna tip nub
fillRect(51, 6, 52, 19, 1)  -- antenna rod
-- chunky handset body, 2px black rim
fillRect(42, 20, 54, 46, 1)
fillRect(44, 22, 52, 44, 2)
-- earpiece speaker bar
fillRect(45, 23, 51, 24, 1)
-- keypad: 3x4 button grid
for _, ky in ipairs({29, 32, 35, 38}) do
  for _, kx in ipairs({44, 47, 50}) do
    fillRect(kx, ky, kx + 1, ky, 1)
  end
end

---------------------------------------------------------------
-- 9. hand gripping the phone
---------------------------------------------------------------
fillEllipse(48, 45, 6, 4, 2)
for dx = -6, 6 do
  local t = 1 - (dx * dx) / 36.0
  local dyv = 4 * math.sqrt(t)
  local ty = 45 - rnd(dyv)
  local by = 45 + rnd(dyv)
  set(48 + dx, ty, 1)
  set(48 + dx, ty + 1, 1)
  set(48 + dx, by, 1)
  set(48 + dx, by - 1, 1)
end
-- finger separation lines wrapping the handset
fillRect(44, 43, 52, 43, 1)
fillRect(44, 45, 52, 45, 1)
fillRect(44, 47, 51, 47, 1)

---------------------------------------------------------------
-- 10. heavy 2px black portrait rim, edge to edge
---------------------------------------------------------------
fillRect(0, 0, 63, 1, 1)
fillRect(0, 62, 63, 63, 1)
fillRect(0, 0, 1, 63, 1)
fillRect(62, 0, 63, 63, 1)

---------------------------------------------------------------
-- 11. build sprite, blit, save
---------------------------------------------------------------
local spr = Sprite(W, H, ColorMode.INDEXED)
spr.transparentColor = 0
local pal = Palette(3)
pal:setColor(0, Color{ r = 0, g = 0, b = 0, a = 0 })
pal:setColor(1, Color{ r = 0, g = 0, b = 0, a = 255 })
pal:setColor(2, Color{ r = 255, g = 255, b = 255, a = 255 })
spr:setPalette(pal)

local cel = spr.cels[1] or spr:newCel(spr.layers[1], 1)
local img = cel.image
for y = 0, H - 1 do
  for x = 0, W - 1 do
    img:putPixel(x, y, buf[y][x])
  end
end

local out = os.getenv("ASE_OUT_DIR")
spr:saveAs(app.fs.joinPath(out, "portrait_mom.aseprite"))
spr:saveAs(app.fs.joinPath(out, "portrait_mom.png"))

print("ASE_GEN_OK")