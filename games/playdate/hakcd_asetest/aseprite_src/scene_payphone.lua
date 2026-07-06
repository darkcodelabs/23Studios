-- scene_payphone: night exterior, Greyhound wall, 3 payphones, noir lamp cone
-- 400x240 indexed, palette: 0=transparent 1=black 2=white, dither-only shading

local spr = Sprite(400, 240, ColorMode.INDEXED)
spr.transparentColor = 0
local pal = Palette(3)
pal:setColor(0, Color{ r = 0, g = 0, b = 0, a = 0 })
pal:setColor(1, Color{ r = 0, g = 0, b = 0, a = 255 })
pal:setColor(2, Color{ r = 255, g = 255, b = 255, a = 255 })
spr:setPalette(pal)

local cel = spr.cels[1]
if cel == nil then cel = spr:newCel(spr.layers[1], 1) end
local img = cel.image

local W, H = 400, 240
local BLK, WHT = 1, 2

-- ---------- helpers ----------
local function px(x, y, c)
  if x >= 0 and x < W and y >= 0 and y < H then img:putPixel(x, y, c) end
end
local function hline(x0, x1, y, c) for x = x0, x1 do px(x, y, c) end end
local function vline(x, y0, y1, c) for y = y0, y1 do px(x, y, c) end end
local function rect(x0, y0, x1, y1, c)
  for y = y0, y1 do for x = x0, x1 do px(x, y, c) end end
end

local bay = {
  { 0, 8, 2, 10 },
  { 12, 4, 14, 6 },
  { 3, 11, 1, 9 },
  { 15, 7, 13, 5 },
}
local function cl(v) if v < 0 then return 0 elseif v > 16 then return 16 end return v end
local function dpx(x, y, lvl)
  if lvl > bay[(y % 4) + 1][(x % 4) + 1] then px(x, y, WHT) else px(x, y, BLK) end
end
local function drect(x0, y0, x1, y1, lvl)
  for y = y0, y1 do for x = x0, x1 do dpx(x, y, lvl) end end
end
local function dover(x, y, lvl) -- add white only (glow)
  if lvl > bay[(y % 4) + 1][(x % 4) + 1] then px(x, y, WHT) end
end
local function dunder(x, y, lvl) -- add black only (shadow)
  if lvl > bay[(y % 4) + 1][(x % 4) + 1] then px(x, y, BLK) end
end
local function hsh(x, y)
  return (x * 7349 + y * 9151 + (x % 17) * (y % 13) * 53) % 97
end
local function line(x0, y0, x1, y1, c, th)
  local dx, dy = x1 - x0, y1 - y0
  local steps = math.max(math.abs(dx), math.abs(dy), 1)
  for i = 0, steps do
    local x = math.floor(x0 + dx * i / steps + 0.5)
    local y = math.floor(y0 + dy * i / steps + 0.5)
    px(x, y, c)
    if th and th > 1 then px(x + 1, y, c); px(x, y + 1, c) end
  end
end

-- single lamp, conical throw, shade blocks up-light
local function wallLight(x, y)
  local dx = x - 200
  local dy = y - 24
  if dy < 0 then dy = dy * 3 end
  local d = math.sqrt(dx * dx + dy * dy * 0.55)
  local L = 15.5 - d * 0.105
  local spread = 14 + math.max(dy, 0) * 0.42
  local adx = math.abs(dx)
  if adx > spread then L = L - (adx - spread) * 0.3 end
  if L < 0 then L = 0 end
  return L
end

-- tiny 3x5 font (N is 4 wide)
local font = {
  P = { "###", "#.#", "###", "#..", "#.." },
  H = { "#.#", "#.#", "###", "#.#", "#.#" },
  O = { "###", "#.#", "#.#", "#.#", "###" },
  N = { "#..#", "##.#", "#.##", "#..#", "#..#" },
  E = { "###", "#..", "###", "#..", "###" },
  B = { "##.", "#.#", "##.", "#.#", "##." },
  U = { "#.#", "#.#", "#.#", "#.#", "###" },
  S = { "###", "#..", "###", "..#", "###" },
}
local function drawText(s, x, y, sc, c)
  local cx = x
  for i = 1, #s do
    local g = font[s:sub(i, i)]
    local gw = #g[1]
    for r = 1, 5 do
      local row = g[r]
      for cc = 1, gw do
        if row:sub(cc, cc) == "#" then
          rect(cx + (cc - 1) * sc, y + (r - 1) * sc, cx + cc * sc - 1, y + r * sc - 1, c)
        end
      end
    end
    cx = cx + (gw + 1) * sc
  end
end

-- ---------- 1. brick wall (y 0..169) ----------
for y = 0, 169 do
  local row = math.floor(y / 9)
  local off = (row % 2) * 11
  for x = 0, 399 do
    local L = wallLight(x, y)
    local bx = math.floor((x + off) / 22)
    L = L + (hsh(bx, row) % 4) * 0.45 - 0.65        -- per-brick tone
    local mortar = (y % 9 == 0) or ((x + off) % 22 == 0)
    if mortar then
      L = L * 0.45 - 0.8
    elseif y % 9 == 1 then
      L = L + 1.1                                   -- brick top catch-light
    end
    if hsh(x, 7) % 13 == 0 then L = L - 2.2 end     -- water stain streaks
    if y > 138 then L = L - (y - 138) * 0.05 end    -- ground grime
    L = L + (hsh(x, y) % 3 - 1) * 0.35
    dpx(x, y, cl(L))
  end
end

-- ---------- 2. wet concrete (y 170..239) ----------
for y = 170, 239 do
  local depth = y - 170
  for x = 0, 399 do
    local adx = math.abs(x - 200)
    local halfw = 30 + depth * 0.35
    local L = 2.2 - depth * 0.02 - adx * 0.008
    if L < 0 then L = 0 end
    if adx < halfw then
      local s = (11 - depth * 0.11) * (1 - adx / halfw)
      if y % 2 == 0 then s = s * 0.5 end            -- horizontal wet banding
      L = L + s
    end
    if depth < 16 and y % 2 == 1 then               -- phone-card side reflections
      if math.abs(x - 151) < 5 or math.abs(x - 255) < 5 then
        L = L + 3 - depth * 0.2
      end
    end
    L = L + (hsh(x, y) % 3 - 1) * 0.3
    if hsh(x * 3, y * 7) % 97 == 0 and L > 1.5 then L = 14 end -- wet glints
    dpx(x, y, cl(L))
  end
end

-- wall/ground junction + joints + cracks
hline(0, 399, 170, BLK)
for x = 0, 399 do
  if wallLight(x, 169) > 3.5 and x % 3 ~= 0 then px(x, 171, WHT) end
end
for _, jx in ipairs({ 60, 140, 260, 340 }) do
  vline(jx, 171, 239, BLK); vline(jx + 1, 171, 239, BLK)
end
for x = 0, 399 do
  if hsh(x, 5) % 11 > 0 then px(x, 204, BLK) end
  if x % 5 ~= 0 then px(x, 205, BLK) end
end
line(192, 186, 203, 209, BLK, 1)
line(203, 209, 197, 231, BLK, 1)
line(298, 188, 318, 203, BLK, 1)

-- ---------- 3. visible beam edges ----------
local function beam(x0, y0, x1, y1)
  local steps = math.max(math.abs(x1 - x0), math.abs(y1 - y0))
  for i = 0, steps do
    local x = math.floor(x0 + (x1 - x0) * i / steps + 0.5)
    local y = math.floor(y0 + (y1 - y0) * i / steps + 0.5)
    dover(x, y, 6)
  end
end
beam(186, 20, 128, 168)
beam(214, 20, 272, 168)

-- ---------- 4. vent grate + downspout ----------
rect(20, 28, 48, 46, BLK)
for y = 29, 45 do
  if (y - 29) % 4 < 2 then
    for x = 22, 46 do dpx(x, y, 2.5) end
  end
end
for x = 20, 48, 2 do px(x, 28, WHT) end

for y = 0, 159 do
  px(384, y, BLK); px(391, y, BLK)
  for x = 385, 390 do
    local lvl = 1.2
    if x == 386 then lvl = lvl + 2.2 end
    if x == 387 then lvl = lvl + 1 end
    dpx(x, y, lvl)
  end
end
hline(383, 392, 42, BLK); hline(383, 392, 43, BLK)
hline(383, 392, 108, BLK); hline(383, 392, 109, BLK)
rect(380, 160, 392, 169, BLK)
drect(381, 161, 391, 168, 2)
for x = 381, 391, 2 do px(x, 161, WHT) end

-- ---------- 5. graffiti ----------
local tag = { { 26, 124 }, { 40, 110 }, { 52, 126 }, { 66, 108 }, { 80, 126 }, { 94, 112 }, { 104, 122 } }
for i = 1, #tag - 1 do
  line(tag[i][1], tag[i][2], tag[i + 1][1], tag[i + 1][2], WHT, 2)
end
line(28, 132, 102, 128, WHT, 2)
for _, dr in ipairs({ { 40, 111, 7 }, { 66, 109, 9 }, { 80, 127, 6 } }) do
  for i = 0, dr[3] do
    if i < dr[3] - 3 or i % 2 == 0 then px(dr[1], dr[2] + i, WHT) end
  end
end
for k = 1, 60 do
  local gx = 26 + hsh(k, 11) % 80
  local gy = 106 + hsh(13, k) % 30
  if hsh(gx, gy) % 4 == 0 then px(gx, gy, WHT) end
end
-- circle-A right of bank
for a = 0, 63 do
  local t = a / 64 * 6.2832
  px(math.floor(290 + math.cos(t) * 7 + 0.5), math.floor(132 + math.sin(t) * 7 + 0.5), WHT)
end
line(285, 136, 290, 125, WHT, 1)
line(290, 125, 295, 136, WHT, 1)
line(284, 132, 296, 132, WHT, 1)

-- ---------- 6. taped flyers ----------
local function drawFlyer(x0, y0, w, h, s)
  local lv = math.max(6, cl(wallLight(x0 + w / 2, y0) * 0.8))
  for j = 0, h - 1 do
    local xs = x0 + math.floor(j * s + 0.5)
    px(xs - 1, y0 + j, BLK); px(xs + w, y0 + j, BLK)
    for x = xs, xs + w - 1 do
      if j == h - 1 and hsh(x, y0) % 3 == 0 then
        px(x, y0 + j, BLK)                          -- ragged torn bottom
      else
        dpx(x, y0 + j, lv)
      end
    end
    if j == 2 then hline(xs + 2, xs + w - 3, y0 + j, BLK) end  -- headline
    if j >= 6 and j <= h - 4 and j % 2 == 0 then
      hline(xs + 2, xs + w - 4 - (hsh(j, x0) % 3), y0 + j, BLK)
    end
  end
  rect(x0 - 1, y0 - 2, x0 + 2, y0 + 1, WHT)         -- tape corners
  rect(x0 + w - 3, y0 - 2, x0 + w, y0 + 1, WHT)
end
drawFlyer(46, 74, 15, 20, 0.12)
drawFlyer(66, 92, 13, 17, -0.1)
drawFlyer(98, 68, 12, 16, 0.06)
drawFlyer(288, 84, 15, 20, -0.08)
drawFlyer(306, 112, 12, 15, 0.1)

-- ---------- 7. phone bank: steel backboard + fins + PHONE sign ----------
for y = 58, 154 do
  for x = 120, 280 do dpx(x, y, cl(wallLight(x, y) * 0.7 + 1)) end
end
hline(120, 280, 58, BLK); hline(120, 280, 59, BLK)
hline(120, 280, 153, BLK); hline(120, 280, 154, BLK)
vline(120, 58, 154, BLK); vline(121, 58, 154, BLK)
vline(279, 58, 154, BLK); vline(280, 58, 154, BLK)
hline(122, 278, 60, WHT)
for y = 61, 152, 2 do px(122, y, WHT); px(278, y, WHT) end
rect(171, 60, 174, 152, BLK); vline(174, 62, 150, WHT)
rect(224, 60, 227, 152, BLK); vline(224, 62, 150, WHT)
for y = 155, 161 do
  for x = 118, 282 do dunder(x, y, 12 - (y - 155) * 2) end
end

-- backlit PHONE sign
rect(177, 40, 223, 54, BLK)
hline(177, 223, 40, WHT); hline(177, 223, 54, WHT)
vline(177, 40, 54, WHT); vline(223, 40, 54, WHT)
drawText("PHONE", 180, 43, 2, WHT)
for y = 32, 62 do
  for x = 168, 232 do
    if not (x >= 177 and x <= 223 and y >= 40 and y <= 54) then
      local ddx = math.max(177 - x, x - 223, 0)
      local ddy = math.max(40 - y, y - 54, 0)
      dover(x, y, 5 - math.sqrt(ddx * ddx + ddy * ddy) * 0.75)
    end
  end
end

-- dim BUS sign right side
rect(342, 58, 378, 74, BLK)
hline(342, 378, 58, WHT); hline(342, 378, 74, WHT)
vline(342, 58, 74, WHT); vline(378, 58, 74, WHT)
drawText("BUS", 349, 61, 2, WHT)
for y = 58, 74 do for x = 342, 378 do dunder(x, y, 6) end end

-- ---------- 8. the three payphones ----------
local function drawPhone(x0, y0, offHook)
  local x1, y1 = x0 + 29, y0 + 59
  local lv = cl(wallLight(x0 + 15, y0 + 20) * 0.55 + 2)
  rect(x0, y0, x1, y1, BLK)
  drect(x0 + 2, y0 + 2, x1 - 2, y1 - 2, lv)
  hline(x0 + 1, x1 - 1, y0 + 1, WHT)
  vline(x0 + 1, y0 + 2, y1 - 1, WHT)
  vline(x1 - 1, y0 + 2, y1 - 2, BLK)
  hline(x0 + 2, x1 - 1, y1 - 1, BLK)
  hline(x0 + 2, x1 - 2, y0 + 23, BLK)
  for x = x0 + 2, x1 - 2, 2 do px(x, y0 + 24, WHT) end
  -- instruction card
  rect(x0 + 12, y0 + 3, x0 + 26, y0 + 16, BLK)
  rect(x0 + 13, y0 + 4, x0 + 25, y0 + 15, WHT)
  for r = 0, 3 do
    hline(x0 + 15, x0 + 23 - (r % 2) * 2, y0 + 6 + r * 2, BLK)
  end
  -- coin slot
  rect(x0 + 20, y0 + 18, x0 + 25, y0 + 21, WHT)
  rect(x0 + 22, y0 + 19, x0 + 23, y0 + 20, BLK)
  -- keypad
  rect(x0 + 12, y0 + 27, x0 + 26, y0 + 43, BLK)
  for r = 0, 3 do
    for c = 0, 2 do
      local bx, by = x0 + 14 + c * 4, y0 + 29 + r * 4
      rect(bx, by, bx + 1, by + 1, WHT)
    end
  end
  -- cradle
  rect(x0 + 2, y0 + 3, x0 + 10, y0 + 47, BLK)
  if offHook then
    rect(x0 + 4, y0 + 8, x0 + 8, y0 + 10, WHT)     -- bare hooks
    rect(x0 + 4, y0 + 36, x0 + 8, y0 + 38, WHT)
  else
    rect(x0 + 3, y0 + 4, x0 + 9, y0 + 10, BLK)     -- ear cap
    hline(x0 + 3, x0 + 9, y0 + 4, WHT)
    vline(x0 + 3, y0 + 5, y0 + 10, WHT)
    rect(x0 + 5, y0 + 11, x0 + 7, y0 + 39, BLK)    -- handle
    vline(x0 + 5, y0 + 11, y0 + 39, WHT)
    rect(x0 + 3, y0 + 40, x0 + 9, y0 + 46, BLK)    -- mouth cap
    vline(x0 + 3, y0 + 40, y0 + 45, WHT)
    hline(x0 + 3, x0 + 9, y0 + 46, WHT)
    for i = 0, 9 do px(x0 + 5 + (i % 2), y0 + 47 + i, WHT) end
  end
  -- coin return
  rect(x0 + 4, y0 + 50, x0 + 12, y0 + 56, BLK)
  hline(x0 + 5, x0 + 11, y0 + 51, WHT)
  vline(x0 + 5, y0 + 52, y0 + 55, WHT)
  drect(x0 + 6, y0 + 52, x0 + 11, y0 + 55, 5)
  -- rate plaque
  drect(x0 + 16, y0 + 47, x0 + 24, y0 + 50, 11)
  px(x0 + 18, y0 + 48, BLK); px(x0 + 21, y0 + 49, BLK); px(x0 + 23, y0 + 48, BLK)
  -- drop shadow on backboard
  for x = x0, x1 do dunder(x, y1 + 1, 9); dunder(x, y1 + 2, 5) end
  vline(x1 + 1, y0 + 2, y1, BLK)
end

drawPhone(132, 78, false)
drawPhone(185, 78, false)
drawPhone(238, 78, true)

-- dangling handset + curly cord (phone 3)
for i = 0, 14 do
  px(243 + math.floor(math.sin(i * 1.1) * 1.8 + 0.5), 125 + i, WHT)
end
rect(240, 140, 246, 146, BLK)
vline(240, 140, 146, WHT); hline(241, 246, 140, WHT)
rect(242, 147, 244, 155, BLK)
vline(242, 147, 155, WHT)
rect(240, 156, 246, 162, BLK)
vline(240, 156, 162, WHT)

-- vandal scratches
line(146, 128, 152, 124, WHT, 1)
line(139, 132, 144, 129, WHT, 1)
line(252, 128, 258, 134, WHT, 1)
line(258, 128, 252, 134, WHT, 1)

-- ---------- 9. lamp fixture, bloom, moths ----------
rect(198, 0, 201, 7, BLK)
for r = 0, 8 do
  local half = 3 + math.floor(r * 1.5 + 0.5)
  hline(200 - half, 200 + half, 8 + r, BLK)
end
hline(185, 215, 17, WHT)
rect(197, 18, 203, 21, WHT)
for y = 18, 46 do
  for x = 172, 228 do
    local d = math.sqrt((x - 200) ^ 2 + ((y - 22) * 1.6) ^ 2)
    dover(x, y, 16 - d * 0.8)
  end
end
for _, m in ipairs({ { 186, 10 }, { 215, 12 }, { 191, 31 }, { 209, 4 }, { 180, 22 }, { 221, 26 }, { 196, 36 } }) do
  px(m[1], m[2], WHT); px(m[1] + 1, m[2], WHT)
end
-- buzz ticks
px(181, 7, WHT); px(180, 6, WHT); px(219, 7, WHT); px(220, 6, WHT)
px(177, 13, WHT); px(176, 13, WHT); px(223, 13, WHT); px(224, 13, WHT)

-- ---------- 10. bench (left, silhouette + rim light) ----------
for i = 0, 1 do
  local sy = 136 + i * 8
  rect(22, sy, 94, sy + 5, BLK)
  drect(23, sy + 1, 93, sy + 4, 2)
  for x = 23, 93 do if x % 2 == 0 or x > 82 then px(x, sy, WHT) end end
end
rect(18, 154, 98, 162, BLK)
drect(19, 155, 97, 157, 4)
drect(19, 158, 97, 161, 1)
for x = 19, 97 do if x % 2 == 0 or x > 84 then px(x, 154, WHT) end end
drect(60, 150, 74, 153, 9)                          -- abandoned newspaper
hline(61, 73, 151, BLK)
rect(24, 163, 28, 181, BLK)
rect(88, 163, 92, 181, BLK)
for y = 163, 181, 3 do px(28, y, WHT); px(92, y, WHT) end
rect(26, 173, 90, 175, BLK)
for x = 27, 89, 2 do px(x, 173, WHT) end
for y = 182, 191 do
  local sh = y - 182
  for x = 12 - sh, 100 - sh do dunder(x, y, 11 - sh * 1.3) end
end

-- ---------- 11. trash can (right, ribbed steel) ----------
for y = 146, 184 do
  for x = 314, 344 do
    local rel = x - 314
    local lv = 6.5 - rel * 0.18 - (y - 146) * 0.04
    if rel % 6 < 2 then lv = lv + 1.8 end
    dpx(x, y, cl(lv))
  end
end
vline(313, 146, 184, BLK); vline(345, 146, 184, BLK)
vline(314, 147, 183, WHT)
hline(314, 344, 184, BLK)
hline(314, 344, 144, BLK); hline(315, 343, 145, BLK)
hline(315, 343, 143, WHT); hline(317, 341, 142, BLK)
rect(318, 144, 340, 146, BLK)
-- overflowing trash
rect(320, 139, 324, 142, WHT); px(322, 140, BLK); px(321, 141, BLK)
rect(333, 138, 336, 141, WHT); px(334, 139, BLK); px(335, 140, BLK)
line(328, 137, 331, 143, WHT, 2)
-- dent
line(324, 158, 330, 170, BLK, 2)
line(323, 158, 329, 170, WHT, 1)
for y = 185, 193 do
  local sh = y - 185
  for x = 318 + sh, 352 + sh * 2 do dunder(x, y, 10 - sh * 1.3) end
end

-- ---------- 12. puddles, litter, butts ----------
local function puddle(cx, cy, rx, ry)
  for y = cy - ry, cy + ry do
    local t = (y - cy) / ry
    local half = math.floor(rx * math.sqrt(math.max(0, 1 - t * t)) + 0.5)
    for x = cx - half, cx + half do
      local lvl = 0.7
      if hsh(x * 5, y * 3) % 41 == 0 then lvl = 12 end
      dpx(x, y, lvl)
    end
  end
  for x = cx - rx, cx + rx do
    local t = (x - cx) / rx
    local yy = math.floor(ry * math.sqrt(math.max(0, 1 - t * t)) + 0.5)
    if x % 2 == 0 then px(x, cy - yy, WHT) end
    if x % 4 == 0 then px(x, cy + yy, WHT) end
  end
end
puddle(112, 207, 24, 6)
puddle(298, 215, 15, 4)

-- flattened flyer on ground near trash
for j = 0, 6 do
  local xs = 352 + math.floor(j * 0.8 + 0.5)
  for x = xs, xs + 13 do dpx(x, 178 + j, 8) end
end
hline(356, 364, 180, BLK)
hline(357, 362, 182, BLK)

-- cigarette butts at hero-zone edge
px(140, 190, WHT); px(141, 190, WHT)
px(147, 194, WHT); px(148, 194, WHT)
px(136, 197, WHT)

-- ---------- save ----------
spr:flatten()
local out = os.getenv("ASE_OUT_DIR")
spr:saveAs(app.fs.joinPath(out, "scene_payphone.aseprite"))
spr:saveAs(app.fs.joinPath(out, "scene_payphone.png"))
print("ASE_GEN_OK")