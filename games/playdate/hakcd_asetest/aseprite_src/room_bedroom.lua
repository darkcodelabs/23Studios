-- room_bedroom.lua : 1998 teenage-hacker bedroom, 400x240, 1-bit HAKCD style
local spr = Sprite(400, 240, ColorMode.INDEXED)
spr.transparentColor = 0
local pal = Palette(3)
pal:setColor(0, Color{r=0, g=0, b=0, a=0})
pal:setColor(1, Color{r=0, g=0, b=0, a=255})
pal:setColor(2, Color{r=255, g=255, b=255, a=255})
spr:setPalette(pal)

local cel = spr.cels[1]
if not cel then cel = spr:newCel(spr.layers[1], 1) end
local img = cel.image

local W, H = 400, 240
local floor = math.floor
local sin = math.sin
local abs = math.abs

-- 4x4 Bayer matrix: the shading engine
local B = {
  {0, 8, 2, 10},
  {12, 4, 14, 6},
  {3, 11, 1, 9},
  {15, 7, 13, 5},
}

local function put(x, y, c)
  x = floor(x); y = floor(y)
  if x >= 0 and x < W and y >= 0 and y < H then
    img:putPixel(x, y, c)
  end
end

local function bay(x, y)
  return B[(floor(y) % 4) + 1][(floor(x) % 4) + 1]
end

-- shade pixel with dither level 0(black)..16(white)
local function sh(x, y, lvl)
  if lvl < 0 then lvl = 0 end
  if lvl > 16 then lvl = 16 end
  if bay(x, y) < lvl then put(x, y, 2) else put(x, y, 1) end
end

local function rectSh(x0, y0, x1, y1, lvl)
  for y = y0, y1 do for x = x0, x1 do sh(x, y, lvl) end end
end

local function rectC(x0, y0, x1, y1, c)
  for y = y0, y1 do for x = x0, x1 do put(x, y, c) end end
end

local function box(x0, y0, x1, y1, c)
  for x = x0, x1 do put(x, y0, c); put(x, y1, c) end
  for y = y0, y1 do put(x0, y, c); put(x1, y, c) end
end

-- stamp black dither over existing pixels (shadow overlay)
local function darken(x0, y0, x1, y1, k)
  for y = y0, y1 do for x = x0, x1 do
    if bay(x, y) >= 16 - k then put(x, y, 1) end
  end end
end

local function line(x0, y0, x1, y1, c)
  x0 = floor(x0); y0 = floor(y0); x1 = floor(x1); y1 = floor(y1)
  local dx = abs(x1 - x0)
  local dy = -abs(y1 - y0)
  local sx = x0 < x1 and 1 or -1
  local sy = y0 < y1 and 1 or -1
  local err = dx + dy
  while true do
    put(x0, y0, c)
    if x0 == x1 and y0 == y1 then break end
    local e2 = 2 * err
    if e2 >= dy then err = err + dy; x0 = x0 + sx end
    if e2 <= dx then err = err + dx; y0 = y0 + sy end
  end
end

-- tiny 3x5 font, rows as 3-bit values
local FONT = {
  H = {5, 5, 7, 5, 5},
  A = {2, 5, 7, 5, 5},
  C = {3, 4, 4, 4, 3},
  K = {5, 5, 6, 5, 5},
  E = {7, 4, 6, 4, 7},
  R = {6, 5, 6, 5, 5},
  S = {3, 4, 2, 1, 6},
  P = {6, 5, 6, 4, 4},
  ["0"] = {2, 5, 5, 5, 2},
  ["2"] = {6, 1, 2, 4, 7},
  ["6"] = {3, 4, 6, 5, 2},
}

local function text(str, tx, ty, c)
  for ci = 1, #str do
    local g = FONT[str:sub(ci, ci)]
    if g then
      for r = 1, 5 do
        local bits = g[r]
        for b = 0, 2 do
          if floor(bits / 2 ^ (2 - b)) % 2 == 1 then
            put(tx + (ci - 1) * 4 + b, ty + r - 1, c)
          end
        end
      end
    end
  end
end

-- room geometry: corner where walls meet
local CX, CY = 190, 86
local function wbase(x)
  if x < CX then return CY + (CX - x) * 0.27
  else return CY + (x - CX) * 0.28 end
end

-- ================= 0. safety fill =================
rectC(0, 0, W - 1, H - 1, 1)

-- ================= 1. wood-panel walls =================
for x = 0, W - 1 do
  local wb = floor(wbase(x))
  local left = x < CX
  local seam
  if left then seam = (x % 16 == 7) else seam = ((x - CX) % 18 == 9) end
  local grain = (x * x * 13 + x * 7) % 11
  local ry = wb - 40
  for y = 0, wb - 1 do
    local lvl = left and 4 or 6
    if not left and x > 270 then lvl = lvl + 2 end
    if abs(x - CX) < 16 then lvl = lvl - 1 end
    if y < 10 then lvl = lvl - floor((10 - y) / 4) end
    if wb - y < 12 then lvl = lvl - 1 end
    if grain < 2 then lvl = lvl - 1 elseif grain > 8 then lvl = lvl + 1 end
    if y > ry + 1 then
      lvl = lvl - 2
      if left then
        if x % 8 == 3 then lvl = lvl - 2 end
      else
        if (x - CX) % 8 == 3 then lvl = lvl - 2 end
      end
    end
    if (x * 31 + y * 17) % 211 < 2 then lvl = -1 end
    if wb - y <= 5 then
      sh(x, y, 2)
    elseif wb - y == 6 then
      sh(x, y, 9)
    elseif seam then
      put(x, y, 1)
    elseif y == ry or y == ry + 1 then
      put(x, y, 1)
    else
      sh(x, y, lvl)
    end
  end
end
-- corner post
rectC(CX - 2, 0, CX + 1, CY, 1)

-- ================= 2. floorboards =================
for x = 0, W - 1 do
  local wb = floor(wbase(x))
  for y = wb, H - 1 do
    local lvl = 7
    if y > 200 then lvl = 5 elseif y > 170 then lvl = 6 end
    local v = y - 0.28 * x
    local seam = (v % 11) < 1.0
    local pl = floor(v / 11)
    local joint = (x + pl * 23) % 61 < 1
    if (x * 29 + y * 61) % 173 < 2 then lvl = lvl - 4 end
    if (x * 17 + y * 43) % 191 < 2 then lvl = lvl + 3 end
    if y - wb < 3 then lvl = lvl - 3 end
    if seam or joint then put(x, y, 1) else sh(x, y, lvl) end
  end
end

-- ================= 3. left wall decor =================
-- HACKERS movie poster
rectC(16, 10, 58, 68, 1)
rectSh(19, 13, 55, 65, 3)
for x = 19, 55 do
  if (x * 5) % 13 < 1 then
    for y = 13, 53 do sh(x, y, 6) end
  end
end
for y = 22, 37 do
  for x = 30, 44 do
    if x == 30 or x == 44 or y == 22 or y == 37 then put(x, y, 1)
    else sh(x, y, 12) end
  end
end
rectC(28, 27, 46, 30, 1)                       -- mirrored shades
put(33, 28, 2); put(34, 28, 2); put(41, 28, 2); put(42, 28, 2)
for x = 29, 45 do put(x, 20 + (x % 3), 1); put(x, 21 + (x % 3), 1) end
for y = 38, 53 do
  local w = 8 + floor((y - 38) * 0.6)
  for x = 37 - w, 37 + w do
    if x >= 20 and x <= 54 then sh(x, y, 2) end
  end
end
for y = 40, 52, 2 do put(37, y, 2) end
rectSh(20, 55, 54, 64, 15)
text("HACKERS", 24, 57, 1)

-- periodic table chart
rectSh(66, 12, 134, 54, 14)
box(66, 12, 134, 54, 1)
rectC(88, 14, 112, 14, 1)
local function cell(r, c)
  local x0 = 61 + c * 6
  local y0 = 11 + r * 6
  box(x0, y0, x0 + 5, y0 + 5, 1)
  if (r * 7 + c * 3) % 5 == 0 then
    rectSh(x0 + 1, y0 + 1, x0 + 4, y0 + 4, 6)
  else
    put(x0 + 2, y0 + 2, 1)
  end
end
for r = 1, 5 do
  for c = 1, 11 do
    local present
    if r == 1 then present = (c == 1 or c == 11)
    elseif r <= 3 then present = (c <= 2 or c >= 8)
    else present = true end
    if present then cell(r, c) end
  end
end
for c = 3, 10 do cell(6, c) end

-- pinned 2600 note (slight tilt)
for y = 22, 46 do
  local xo = floor((y - 22) / 8)
  for x = 140 + xo, 162 + xo do
    if x == 140 + xo or x == 162 + xo or y == 22 or y == 46 then put(x, y, 1)
    else sh(x, y, 15) end
  end
end
rectC(150, 20, 152, 22, 1); put(151, 21, 2)
text("2600", 145, 26, 1)
line(144, 35, 158, 36, 1)
line(145, 39, 156, 40, 1)
line(145, 43, 152, 43, 1)

-- phone/modem wall jack
rectC(8, 78, 14, 86, 1)
rectSh(9, 79, 13, 85, 8)
put(11, 81, 1); put(11, 83, 1)

-- ================= 4. right wall: shelf + outlet =================
local function shelfY(x) return floor(34 + (x - 212) * 0.28) end
for i = 0, 7 do
  local bx = 215 + i * 8
  local bh = 13 + ((i * 7) % 9)
  local by = shelfY(bx + 3)
  local lvl = (i % 2 == 0) and 3 or 7
  for y = by - bh, by - 1 do
    for x = bx, bx + 5 do
      if x == bx or x == bx + 5 or y == by - bh then put(x, y, 1)
      else sh(x, y, lvl) end
    end
  end
  put(bx + 2, by - floor(bh / 2), 2)
  put(bx + 3, by - floor(bh / 2), 2)
end
for x = 212, 282 do
  local sy = shelfY(x)
  sh(x, sy, 11); sh(x, sy + 1, 11)
  put(x, sy + 2, 1); put(x, sy + 3, 1)
end
rectC(220, shelfY(220) + 4, 221, shelfY(220) + 9, 1)
rectC(272, shelfY(272) + 4, 273, shelfY(272) + 9, 1)
-- wall outlet
rectC(200, 74, 207, 84, 1)
rectSh(201, 75, 206, 83, 9)
put(203, 77, 1); put(203, 78, 1); put(203, 81, 1)

-- ================= 5. window + venetian blinds + moon =================
for x = 296, 384 do
  local wb = wbase(x)
  local top = floor(wb - 104)
  local bot = floor(wb - 30)
  for y = top, bot do
    local h = wb - y
    if x <= 297 or x >= 383 or y <= top + 1 or y >= bot - 1 then
      put(x, y, 1)
    else
      local m = floor(h) % 7
      if floor(h / 7) == 8 and x > 340 then m = floor(h + 3) % 7 end
      if m < 2 then
        sh(x, y, 2)
      elseif m == 2 then
        sh(x, y, 13)
      else
        local lvl = 11 - floor((y - top) / 34)
        local my = wbase(356) - 84
        local d2 = (x - 356) * (x - 356) + (y - my) * (y - my)
        if d2 < 64 then put(x, y, 2)
        elseif d2 < 110 then sh(x, y, 14)
        else sh(x, y, lvl) end
        if x == 374 then put(x, y, 1) end
      end
    end
  end
  for y = bot + 1, bot + 3 do sh(x, y, 10) end
  put(x, bot + 4, 1)
end

-- ================= 6. moonlight pool on floor (blind stripes) =================
for y = 120, 226 do
  local xL = 296 - (y - 120) * 0.85
  local xR = 386 - (y - 120) * 0.5
  for x = floor(xL), floor(xR) do
    if x >= 0 and x < W and y >= floor(wbase(x)) then
      local slat = ((y + floor((386 - x) * 0.2)) % 9) < 2
      if not slat then
        local lvl = 11 - floor((y - 120) / 45)
        if x - xL < 3 or xR - x < 3 then lvl = lvl - 3 end
        local v = y - 0.28 * x
        if (v % 11) < 1.0 then put(x, y, 1) else sh(x, y, lvl) end
      end
    end
  end
end

-- ================= 7. power strip + cords near corner =================
box(196, 118, 224, 126, 1)
rectSh(197, 119, 223, 125, 5)
for x = 200, 220, 5 do put(x, 121, 1); put(x, 123, 1) end
put(222, 121, 2)
line(203, 85, 200, 100, 1)
line(200, 100, 198, 118, 1)
line(196, 124, 190, 134, 1)
line(190, 134, 187, 150, 1)

-- ================= 8. unmade bed (right) =================
-- headboard
for x = 376, 399 do
  local t = floor(118 + (x - 286) * 0.29)
  local htop = t - 30
  for y = htop, t + 6 do
    if y == htop or y == htop + 1 or x == 376 or x == 399 then put(x, y, 1)
    elseif (x - 376) % 6 == 0 then put(x, y, 1)
    else sh(x, y, 4) end
  end
end
-- mattress + lumpy blanket
for x = 286, 399 do
  local t = floor(118 + (x - 286) * 0.29)
  local b = t + 72 + floor(3 * sin(x * 0.15))
  if b > 230 then b = 230 end
  local wb = floor(wbase(x))
  if x < 376 then
    for y = wb, t - 1 do sh(x, y, 2) end
  end
  local f1 = t + 26 + floor(3 * sin(x * 0.11))
  local f2 = t + 46 + floor(4 * sin(x * 0.13 + 2))
  for y = t, b do
    local d = y - t
    if y <= t + 1 or y >= b - 1 then
      put(x, y, 1)
    elseif y == f1 or y == f2 then
      put(x, y, 1)
    elseif x >= 336 and x <= 360 and d < 14 then
      if x == 336 or x == 360 or d == 13 then put(x, y, 1)
      else sh(x, y, 14) end
    else
      local lvl = 8 + floor(2 * sin(x * 0.09 + y * 0.07))
      if y > f1 and y - f1 <= 4 then lvl = lvl - 3 end
      if f1 > y and f1 - y <= 3 then lvl = lvl + 2 end
      if y > f2 and y - f2 <= 4 then lvl = lvl - 3 end
      if f2 > y and f2 - y <= 3 then lvl = lvl + 2 end
      sh(x, y, lvl)
    end
  end
  local drop = b + 14 + floor(2 * sin(x * 0.2))
  if drop > 236 then drop = 236 end
  for y = b + 1, drop do
    if y == drop then put(x, y, 1)
    elseif x % 6 == 0 then sh(x, y, 2)
    else sh(x, y, 4) end
  end
  for y = drop + 1, drop + 3 do sh(x, y, 1) end
end
for y = 118, 218 do put(286, y, 1); put(287, y, 1) end
-- pillow
for x = 356, 392 do
  local t = floor(118 + (x - 286) * 0.29)
  local e = 0
  if x < 359 or x > 389 then e = 2 end
  local p0, p1 = t + 4 + e, t + 19 - e
  for y = p0, p1 do
    if y == p0 or y == p1 or x == 356 or x == 392 then put(x, y, 1)
    else sh(x, y, 13) end
  end
end
for x = 364, 384, 2 do
  put(x, floor(118 + (x - 286) * 0.29) + 11, 1)
end

-- ================= 9. desk along left wall =================
for x = 6, 158 do
  local wb = wbase(x)
  local t1 = floor(wb - 36)
  local t2 = floor(wb - 16)
  local fb = floor(wb + 8)
  for y = t1, t2 do
    if y == t1 or y == t2 then put(x, y, 1)
    elseif y == t2 - 1 then sh(x, y, 13)
    else
      local lvl = 10
      if (x * 3 + y * 7) % 19 < 1 then lvl = 7 end
      if x < 9 or x > 155 then lvl = lvl - 2 end
      sh(x, y, lvl)
    end
  end
  for y = t2 + 1, fb do
    local lvl = 4
    if x >= 64 and x <= 146 then lvl = 1 end
    if x % 9 == 0 then lvl = lvl - 2 end
    if y == fb or x == 6 or x == 158 then put(x, y, 1)
    else sh(x, y, lvl) end
  end
  for y = fb + 1, fb + 3 do sh(x, y, 2) end
end
-- drawer fronts on left pedestal
for d = 0, 1 do
  for x = 12, 60 do
    local wb = wbase(x)
    local y0 = floor(wb - 12 + d * 11)
    local y1 = y0 + 8
    for y = y0, y1 do
      if y == y0 or y == y1 or x == 12 or x == 60 then put(x, y, 1) end
    end
    if x >= 30 and x <= 42 then put(x, y0 + 4, 2) end
  end
end

-- ================= 10. beige tower PC in corner =================
for y = 88, 92 do for x = 160, 186 do
  if y == 88 or x == 160 or x == 186 then put(x, y, 1) else sh(x, y, 12) end
end end
for y = 93, 158 do for x = 160, 183 do
  if x == 160 or x == 183 or y == 158 then put(x, y, 1) else sh(x, y, 9) end
end end
for y = 93, 158 do for x = 184, 186 do
  if x == 186 or y == 158 then put(x, y, 1) else sh(x, y, 4) end
end end
box(163, 98, 181, 104, 1); rectSh(164, 99, 180, 103, 6); rectC(166, 101, 178, 101, 1)
box(163, 107, 181, 111, 1); rectSh(164, 108, 180, 110, 6); rectC(166, 109, 176, 109, 1)
box(163, 114, 181, 118, 1); rectC(165, 116, 177, 116, 1); put(179, 116, 2)
rectC(170, 126, 174, 130, 1); rectSh(171, 127, 173, 129, 11)
put(165, 128, 2); put(165, 132, 2)
for y = 142, 154, 3 do for x = 164, 180, 3 do put(x, y, 1); put(x + 1, y, 1) end end
for y = 159, 162 do for x = 160, 188 do sh(x, y, 1) end end

-- ================= 11. CRT monitor with glowing screen =================
for y = 44, 90 do
  for x = 52, 112 do
    local cut = ((x < 54 or x > 110) and (y < 46 or y > 88))
    if not cut then
      if x <= 53 or x >= 111 or y <= 45 or y >= 89 then put(x, y, 1)
      else sh(x, y, 9) end
    end
  end
end
for x = 58, 106, 4 do put(x, 47, 1); put(x + 1, 47, 1) end
rectSh(57, 50, 107, 84, 6)
box(57, 50, 107, 84, 1)
for y = 53, 81 do
  for x = 60, 104 do
    if x == 60 or x == 104 or y == 53 or y == 81 then put(x, y, 1)
    else
      local d2 = (x - 82) * (x - 82) * 0.8 + (y - 67) * (y - 67) * 2.2
      local lvl = 16 - floor(d2 / 90)
      if lvl < 6 then lvl = 6 end
      if y % 3 == 0 then lvl = lvl - 3 end
      sh(x, y, lvl)
    end
  end
end
-- terminal text rows (dark on glow)
for r = 0, 5 do
  local ty = 56 + r * 4
  local len = 12 + ((r * 29) % 26)
  for i = 0, len do
    local tx = 63 + i
    if tx < 102 and ((tx + r * 3) % 5) < 3 and (i % 7) ~= 3 then
      put(tx, ty, 1)
    end
  end
end
rectC(92, 75, 94, 79, 1)                       -- cursor block
line(63, 58, 68, 55, 2)                        -- glass glint
line(63, 59, 69, 55, 2)
put(101, 87, 2); put(102, 87, 2)               -- power LED
rectSh(105, 60, 111, 68, 15)                   -- post-it on bezel
box(105, 60, 111, 68, 1)
rectC(106, 63, 109, 63, 1); rectC(106, 65, 108, 65, 1)
-- stand + desk shadow
for y = 91, 96 do
  local w = 10 - floor((y - 91) * 0.5)
  for x = 82 - w, 82 + w do
    if x == 82 - w or x == 82 + w or y == 96 then put(x, y, 1)
    else sh(x, y, 5) end
  end
end
for y = 97, 99 do for x = 66, 98 do sh(x, y, 3) end end

-- ================= 12. mousepad, keyboard, mouse =================
for x = 115, 134 do
  local wb = wbase(x)
  local p0 = floor(wb - 13)
  for y = p0, p0 + 10 do
    if y == p0 or y == p0 + 10 or x == 115 or x == 134 then put(x, y, 1)
    else sh(x, y, 6) end
  end
end
for x = 56, 114 do
  local wb = wbase(x)
  local k0 = floor(wb - 17)
  local k1 = k0 + 9
  for y = k0, k1 do
    if y == k0 or y == k1 or x == 56 or x == 114 then put(x, y, 1)
    elseif (x % 3 == 1) and ((y - k0) % 3 == 2) then put(x, y, 1)
    else sh(x, y, 11) end
  end
  sh(x, k1 + 1, 3)
end
for x = 72, 98 do
  sh(x, floor(wbase(x) - 17) + 7, 14)          -- spacebar
end
for y = 92, 99 do
  for x = 119, 130 do
    local dx = (x - 124.5) / 6
    local dy = (y - 95.5) / 4
    local r = dx * dx + dy * dy
    if r <= 1 then
      if r > 0.72 then put(x, y, 1) else sh(x, y, 13) end
    end
  end
end
rectC(124, 92, 124, 94, 1)
line(122, 91, 114, 85, 1)
line(114, 85, 108, 83, 1)

-- ================= 13. external modem with LEDs =================
for x = 14, 46 do
  local wb = wbase(x)
  local y1 = floor(wb - 20)
  local y0 = y1 - 10
  for y = y0, y1 do
    if y == y0 or y == y1 or x == 14 or x == 46 then put(x, y, 1)
    elseif y > y1 - 4 then
      if (x == 18 or x == 23 or x == 28 or x == 33) and y == y1 - 2 then put(x, y, 2)
      else sh(x, y, 3) end
    else
      sh(x, y, 8)
    end
  end
end
line(16, floor(wbase(16)) - 30, 11, 86, 1)     -- modem line to wall jack

-- ================= 14. corded phone =================
for x = 126, 152 do
  local py = floor(wbase(x) - 24)
  local y0 = py - 8
  local y1 = py + 2
  for y = y0, y1 do
    if y == y0 or y == y1 or x == 126 or x == 152 then put(x, y, 1)
    elseif x >= 138 and x <= 148 and (y - y0) % 3 == 1 and x % 3 == 0 then put(x, y, 1)
    else sh(x, y, 9) end
  end
end
for x = 124, 152 do
  local py = floor(wbase(x) - 24)
  local hy = py - 12
  local y0h, y1h = hy, hy + 4
  if x < 127 or x > 149 then y0h = hy + 1; y1h = hy + 3 end
  for y = y0h, y1h do
    if y == y0h or y == y1h or x == 124 or x == 152 then put(x, y, 1)
    else sh(x, y, 11) end
  end
end
line(152, 70, 156, 78, 1)                      -- coiled cord down desk side
line(156, 78, 153, 86, 1)
line(153, 86, 157, 94, 1)
line(157, 94, 154, 102, 1)

-- ================= 15. desk chair (foreground, left of open zone) =================
for y = 138, 170 do
  for x = 100, 136 do
    local cut = ((x < 104 or x > 132) and (y < 143 or y > 166))
    if not cut then
      if x <= 101 or x >= 135 or y <= 139 or y >= 169 then put(x, y, 1)
      else
        local lvl = 5
        if y == 149 or y == 158 then lvl = 2 end
        if abs(x - 118) > 12 then lvl = lvl + 2 end
        sh(x, y, lvl)
      end
    end
  end
end
for y = 171, 187 do
  local sp = floor((y - 171) * 0.4)
  local x0 = 98 - sp
  local x1 = 138 + sp
  if x0 < 94 then x0 = 94 end
  if x1 > 139 then x1 = 139 end
  for x = x0, x1 do
    if x == x0 or x == x1 or y == 171 or y == 187 then put(x, y, 1)
    elseif y > 183 then sh(x, y, 3)
    else sh(x, y, 6) end
  end
end
rectC(115, 188, 119, 201, 1)
for y = 189, 199, 2 do put(117, y, 2) end
line(117, 201, 100, 211, 1); line(117, 202, 100, 212, 1)
line(117, 201, 136, 211, 1); line(117, 202, 136, 212, 1)
line(117, 201, 106, 219, 1); line(118, 201, 107, 219, 1)
line(117, 201, 130, 219, 1); line(118, 201, 131, 219, 1)
line(117, 202, 117, 220, 1); line(118, 202, 118, 220, 1)
local casters = {{100, 212}, {136, 212}, {106, 219}, {130, 219}, {117, 220}}
for i = 1, 5 do
  local p = casters[i]
  rectC(p[1] - 1, p[2], p[1] + 1, p[2] + 2, 1)
  put(p[1], p[2] + 1, 2)
end
darken(98, 221, 138, 225, 4)

-- ================= 16. PHRACK zine stack =================
local offs = {0, 3, -2, 1}
for i = 0, 3 do
  local y1 = 234 - i * 5
  local y0 = y1 - 4
  local xo = offs[i + 1]
  for y = y0, y1 do
    for x = 46 + xo, 92 + xo do
      if y == y0 or y == y1 or x == 46 + xo or x == 92 + xo then put(x, y, 1)
      elseif y == y0 + 2 then sh(x, y, 13)
      else sh(x, y, 9) end
    end
  end
end
for y = 205, 214 do
  for x = 47, 93 do
    if y == 205 or y == 214 or x == 47 or x == 93 then put(x, y, 1)
    else sh(x, y, 13) end
  end
end
text("PHRACK", 58, 207, 1)
box(84, 207, 90, 212, 1)
rectSh(85, 208, 89, 211, 6)

-- ================= 17. scattered floppy disks =================
local function floppy(fx, fy, slant, lvl)
  for j = 0, 11 do
    local xo = floor(j * slant)
    for i = 0, 13 do
      local x = fx + i + xo
      local y = fy + j
      if j == 0 or j == 11 or i == 0 or i == 13 then put(x, y, 1)
      elseif j <= 4 then
        if i >= 4 and i <= 10 and j >= 1 and j <= 3 then
          if i == 7 then sh(x, y, 12) else sh(x, y, 5) end
        else sh(x, y, lvl) end
      elseif j >= 6 then
        if (j == 7 or j == 9) and i >= 2 and i <= 11 and (i % 4) ~= 0 then put(x, y, 1)
        else sh(x, y, 14) end
      else
        sh(x, y, lvl)
      end
    end
  end
end
floppy(16, 190, 0, 7)
floppy(114, 222, 0.3, 6)
floppy(148, 228, -0.2, 7)
floppy(258, 218, 0.25, 6)
floppy(304, 226, -0.3, 7)

-- ================= 18. soda can in the moonlight =================
for x = 273, 280 do sh(x, 188, 12) end
put(272, 189, 1); put(281, 189, 1)
for x = 272, 281 do put(x, 190, 1) end
put(276, 188, 1)
for y = 191, 207 do
  for x = 272, 281 do
    if x == 272 or x == 281 then put(x, y, 1)
    else
      local lvl = 9
      if x >= 274 and x <= 276 then lvl = 14 end
      if y >= 195 and y <= 200 then
        if x >= 274 and x <= 276 then lvl = 7
        elseif x % 3 == 0 then lvl = 2
        else lvl = 4 end
      end
      sh(x, y, lvl)
    end
  end
end
for x = 272, 281 do put(x, 208, 1) end
darken(270, 209, 284, 212, 5)

-- ================= 19. vignette =================
for y = 0, H - 1 do
  for x = 0, W - 1 do
    local k = 0
    if x < 54 then k = k + floor((54 - x) / 18) end
    if y > 214 then k = k + floor((y - 214) / 9) end
    if y < 10 then k = k + floor((10 - y) / 4) end
    if k > 0 then
      if k > 4 then k = 4 end
      if bay(x, y) >= 16 - k then put(x, y, 1) end
    end
  end
end

-- ================= save =================
pcall(function() spr:flatten() end)
local out = os.getenv("ASE_OUT_DIR")
spr:saveAs(app.fs.joinPath(out, "room_bedroom.aseprite"))
spr:saveAs(app.fs.joinPath(out, "room_bedroom.png"))
print("ASE_GEN_OK")