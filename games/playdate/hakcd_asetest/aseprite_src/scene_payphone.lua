-- HAKCD phreaker-noir: night payphone bank, 400x240 1-bit scene
local OUT = os.getenv("ASE_OUT_DIR")
local W, H = 400, 240
local sprite = Sprite(W, H, ColorMode.INDEXED)
sprite.transparentColor = 0

local pal = Palette(3)
pal:setColor(0, Color{r=0,   g=0,   b=0,   a=0})
pal:setColor(1, Color{r=0,   g=0,   b=0,   a=255})
pal:setColor(2, Color{r=255, g=255, b=255, a=255})
sprite:setPalette(pal)

local cel = sprite.cels[1]
if cel == nil then cel = sprite:newCel(sprite.layers[1], 1) end
local img = cel.image

-- ---------- helpers ----------
local function px(x, y, c)
  if x >= 0 and x < W and y >= 0 and y < H then img:putPixel(x, y, c) end
end

local function rect(x0, y0, x1, y1, c)
  for y = y0, y1 do for x = x0, x1 do px(x, y, c) end end
end

local function box(x0, y0, x1, y1, c)
  rect(x0, y0, x1, y0, c); rect(x0, y1, x1, y1, c)
  rect(x0, y0, x0, y1, c); rect(x1, y0, x1, y1, c)
end

-- Bayer 4x4 ordered dither: intensity 0 (black) .. 16 (white)
local B = {{0,8,2,10},{12,4,14,6},{3,11,1,9},{15,7,13,5}}
local function dpx(x, y, inten)
  if inten < 0 then inten = 0 end
  if inten > 16 then inten = 16 end
  if B[(y % 4) + 1][(x % 4) + 1] < inten then px(x, y, 2) else px(x, y, 1) end
end

local function line(ax, ay, bx, by, c, th)
  local x0, y0, x1, y1 = ax, ay, bx, by
  local dx = math.abs(x1 - x0); local dy = math.abs(y1 - y0)
  local sx = x0 < x1 and 1 or -1; local sy = y0 < y1 and 1 or -1
  local err = dx - dy
  while true do
    for oy = 0, th - 1 do for ox = 0, th - 1 do px(x0 + ox, y0 + oy, c) end end
    if x0 == x1 and y0 == y1 then break end
    local e2 = 2 * err
    if e2 > -dy then err = err - dy; x0 = x0 + sx end
    if e2 <  dx then err = err + dx; y0 = y0 + sy end
  end
end

-- lamp light model (single buzzing fixture over center phone)
local LX, LY = 200, 52
local function wallInten(x, y)
  local dx, dy = x - LX, y - LY
  if dy < -6 then return 0 end
  local cone = 30 + dy * 1.05
  local d = math.sqrt(dx * dx + dy * dy * 0.55)
  local i = 15 - d / 9.5
  local adx = math.abs(dx)
  if adx > cone then i = i - (adx - cone) * 0.35 end
  if i < 0 then i = 0 end
  return i
end

-- ---------- 1. night sky sliver (y 0..27) ----------
rect(0, 0, W - 1, 27, 1)
for i = 0, 55 do
  local sx = (i * 97 + 31) % W
  local sy = (i * 61 + 11) % 26
  px(sx, sy, 2)
  if i % 9 == 0 then
    px(sx + 1, sy, 2); px(sx - 1, sy, 2); px(sx, sy + 1, 2); px(sx, sy - 1, 2)
  end
end
-- sagging phone wire across the sky (phreaker canon)
line(0, 7, 120, 13, 2, 1)
line(120, 13, 280, 10, 2, 1)
line(280, 10, 399, 15, 2, 1)

-- ---------- 2. concrete roof ledge (y 28..35) ----------
rect(0, 28, W - 1, 29, 1)
for y = 30, 33 do
  for x = 0, W - 1 do
    local i = 13 - math.abs(x - 200) / 14
    if i < 1 then i = 1 end
    dpx(x, y, i)
  end
end
rect(0, 34, W - 1, 35, 1)

-- ---------- 3. brick station wall (y 36..185) ----------
for y = 36, 185 do
  for x = 0, W - 1 do
    local ry = y - 36
    local row = math.floor(ry / 10)
    local off = (row % 2) * 13
    local bid = row * 31 + math.floor((x + off) / 26)
    local mortar = (ry % 10 == 9) or (((x + off) % 26) == 25)
    local i = wallInten(x, y)
    if mortar then
      dpx(x, y, i - 9)
    else
      if (bid * 13) % 29 == 0 then i = i * 0.25 end        -- scorched brick
      local v = ((bid * 7) % 5 - 2) * 0.5                  -- per-brick tone
      dpx(x, y, i + v)
    end
  end
end

-- ---------- 4. graffiti tag "2600" (dark left wall) ----------
local function d2(bx, by)
  line(bx, by, bx + 10, by - 1, 2, 2)
  line(bx + 10, by - 1, bx + 11, by + 7, 2, 2)
  line(bx + 11, by + 7, bx, by + 16, 2, 2)
  line(bx, by + 16, bx + 12, by + 15, 2, 2)
end
local function d6(bx, by)
  line(bx + 10, by - 1, bx + 3, by + 1, 2, 2)
  line(bx + 3, by + 1, bx, by + 10, 2, 2)
  line(bx, by + 10, bx + 2, by + 16, 2, 2)
  line(bx + 2, by + 16, bx + 9, by + 16, 2, 2)
  line(bx + 9, by + 16, bx + 11, by + 10, 2, 2)
  line(bx + 11, by + 10, bx + 1, by + 8, 2, 2)
end
local function d0(bx, by)
  line(bx + 3, by, bx + 9, by - 1, 2, 2)
  line(bx + 9, by - 1, bx + 12, by + 8, 2, 2)
  line(bx + 12, by + 8, bx + 9, by + 16, 2, 2)
  line(bx + 9, by + 16, bx + 2, by + 16, 2, 2)
  line(bx + 2, by + 16, bx, by + 7, 2, 2)
  line(bx, by + 7, bx + 3, by, 2, 2)
end
d2(24, 101); d6(40, 99); d0(56, 97); d0(72, 95)
line(20, 124, 86, 118, 2, 2)                 -- underline swash
line(30, 119, 30, 128, 2, 1)                 -- paint drips
line(62, 115, 62, 124, 2, 1)
line(78, 113, 78, 119, 2, 1)

-- ---------- 5. drainpipe, right edge ----------
rect(368, 36, 375, 187, 1)
for y = 36, 187, 2 do px(367, y, 2); px(376, y + 1, 2) end
rect(366, 70, 377, 71, 1); rect(366, 140, 377, 141, 1)

-- ---------- 6. buzzing lamp fixture ----------
rect(198, 36, 202, 42, 1)                    -- mount arm
for y = 42, 50 do                            -- shade trapezoid
  local hw = math.floor(3 + (y - 42) * 1.8)
  rect(200 - hw, y, 200 + hw, y, 1)
end
rect(187, 51, 213, 52, 2)                    -- glowing tube
-- buzz specks / flicker
local specks = {{216,40},{221,37},{225,42},{179,39},{175,44},{183,35},{212,33},{190,32}}
for _, s in ipairs(specks) do px(s[1], s[2], 2) end

-- ---------- 7. wall base + concrete ground ----------
rect(0, 186, W - 1, 187, 1)
for y = 188, 239 do
  for x = 0, W - 1 do
    local dx = x - 200
    local dy = y - 212
    local d = math.sqrt(dx * dx * 0.30 + dy * dy * 2.0)
    dpx(x, y, 13 - d / 6.5)
  end
end
-- expansion joints + cracks (read only inside the light pool)
rect(110, 188, 111, 239, 1)
rect(288, 188, 289, 239, 1)
rect(0, 222, W - 1, 222, 1)
line(150, 226, 168, 233, 1, 1)
line(168, 233, 181, 231, 1, 1)
line(232, 216, 246, 227, 1, 1)
-- pebbles + crushed can
rect(188, 206, 189, 207, 1); rect(214, 224, 215, 225, 1); rect(172, 230, 173, 231, 1)
rect(236, 225, 243, 229, 1); px(238, 226, 2); px(241, 227, 2)

-- ---------- 8. cast shadows on ground ----------
local function groundShadow(bx0, bx1, skew, len)
  for y = 188, 188 + len do
    local t = y - 188
    local xs, xe
    if skew < 0 then
      xs = math.floor(bx0 + skew * t); xe = math.floor(bx1 + skew * t * 0.55)
    elseif skew > 0 then
      xs = math.floor(bx0 + skew * t * 0.55); xe = math.floor(bx1 + skew * t)
    else
      xs, xe = bx0, bx1
    end
    for x = xs, xe do dpx(x, y, 1.5) end
  end
end
groundShadow(88, 143, -1.7, 16)
groundShadow(172, 227, 0, 7)
groundShadow(256, 311, 1.7, 16)

-- ---------- 9. payphone bank (three kiosks) ----------
local function drawPhone(x0, offhook, wallskew)
  local y0, y1 = 78, 170
  local x1 = x0 + 55
  -- drop shadow on wall below kiosk
  for y = y1 + 1, y1 + 4 do
    for x = x0 + 2 + wallskew, x1 + 2 + wallskew do dpx(x, y, 1) end
  end
  -- kiosk face, lit by the lamp
  for y = y0, y1 do
    for x = x0, x1 do dpx(x, y, wallInten(x, y) + 3.5) end
  end
  -- 2px silhouette frame + hood overhang
  rect(x0, y0, x1, y0 + 1, 1); rect(x0, y1 - 1, x1, y1, 1)
  rect(x0, y0, x0 + 1, y1, 1); rect(x1 - 1, y0, x1, y1, 1)
  rect(x0 - 2, y0 - 3, x1 + 2, y0 + 1, 1)
  -- header band with PHONE label dashes
  rect(x0 + 2, y0 + 2, x1 - 2, y0 + 10, 1)
  for i = 0, 4 do rect(x0 + 10 + i * 8, y0 + 5, x0 + 13 + i * 8, y0 + 7, 2) end
  -- corner bolts
  px(x0 + 4, y0 + 13, 2); px(x1 - 4, y0 + 13, 2)
  px(x0 + 4, y1 - 4, 2);  px(x1 - 4, y1 - 4, 2)
  -- phone unit body
  local ux0, uy0, ux1, uy1 = x0 + 18, y0 + 16, x0 + 50, y0 + 76
  box(ux0 - 1, uy0 - 1, ux1 + 1, uy1 + 1, 2)
  rect(ux0, uy0, ux1, uy1, 1)
  -- instruction card
  rect(ux0 + 3, uy0 + 3, ux0 + 13, uy0 + 11, 2)
  rect(ux0 + 5, uy0 + 5, ux0 + 11, uy0 + 5, 1)
  rect(ux0 + 5, uy0 + 7, ux0 + 11, uy0 + 7, 1)
  rect(ux0 + 5, uy0 + 9, ux0 + 11, uy0 + 9, 1)
  -- coin slot
  rect(ux1 - 9, uy0 + 4, ux1 - 5, uy0 + 10, 2)
  rect(ux1 - 8, uy0 + 5, ux1 - 6, uy0 + 9, 1)
  -- keypad plate + 3x4 keys
  rect(ux0 + 5, uy0 + 16, ux1 - 5, uy0 + 40, 2)
  for r = 0, 3 do
    for c = 0, 2 do
      rect(ux0 + 7 + c * 7, uy0 + 18 + r * 6, ux0 + 10 + c * 7, uy0 + 21 + r * 6, 1)
    end
  end
  -- coin return
  rect(ux0 + 8, uy1 - 12, ux0 + 22, uy1 - 4, 2)
  rect(ux0 + 10, uy1 - 10, ux0 + 20, uy1 - 6, 1)
  -- cradle bracket
  rect(x0 + 2, y0 + 30, x0 + 17, y0 + 33, 2)
  local function capsule(a, b, c2, d2c)
    rect(a - 1, b - 1, c2 + 1, d2c + 1, 2)
    rect(a, b, c2, d2c, 1)
  end
  if not offhook then
    -- handset resting on hook
    capsule(x0 + 7, y0 + 26, x0 + 11, y0 + 54)
    capsule(x0 + 4, y0 + 18, x0 + 14, y0 + 26)
    capsule(x0 + 4, y0 + 54, x0 + 14, y0 + 62)
    -- coiled cord to body
    line(x0 + 9,  y0 + 63, x0 + 13, y0 + 67, 1, 1)
    line(x0 + 13, y0 + 67, x0 + 9,  y0 + 71, 1, 1)
    line(x0 + 9,  y0 + 71, x0 + 14, y0 + 75, 1, 1)
    line(x0 + 14, y0 + 75, ux0 + 2, uy1,     1, 1)
  else
    -- empty hook, cord dangling out of the kiosk
    rect(x0 + 6, y0 + 31, x0 + 13, y0 + 32, 1)
    line(x0 + 8,  y0 + 30, x0 + 5,  y0 + 44, 2, 1)
    line(x0 + 5,  y0 + 44, x0 + 12, y0 + 58, 2, 1)
    line(x0 + 12, y0 + 58, x0 + 6,  y0 + 72, 2, 1)
    line(x0 + 6,  y0 + 72, x0 + 13, y0 + 84, 2, 1)
    line(x0 + 13, y0 + 84, x0 + 8,  y0 + 92, 2, 1)
    line(x0 + 8,  y0 + 92, x0 + 16, y0 + 96, 2, 1)
    line(x0 + 16, y0 + 96, x0 + 23, y0 + 95, 2, 1)
    -- shadow blob under the dangling handset
    for yy = -3, 3 do
      for xx = -8, 8 do
        if xx * xx * 9 + yy * yy * 64 <= 576 then dpx(x0 + 21 + xx, 213 + yy, 1) end
      end
    end
    -- handset hanging upside-down by its cord
    capsule(x0 + 21, 181, x0 + 27, 201)
    capsule(x0 + 18, 173, x0 + 30, 181)
    capsule(x0 + 18, 201, x0 + 30, 209)
  end
end

drawPhone(88,  false, -3)
drawPhone(172, false,  0)
drawPhone(256, true,   3)

-- ---------- save ----------
sprite:flatten()
sprite:saveAs(app.fs.joinPath(OUT, "scene_payphone.aseprite"))
sprite:saveAs(app.fs.joinPath(OUT, "scene_payphone.png"))
print("ASE_GEN_OK")