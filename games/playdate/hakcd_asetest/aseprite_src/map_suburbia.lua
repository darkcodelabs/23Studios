-- map_suburbia: 1998 suburban night, top-down, 1-bit dithered, 400x240
local W, H = 400, 240
local spr = Sprite(W, H, ColorMode.INDEXED)
spr.transparentColor = 0

local pal = Palette(3)
pal:setColor(0, Color{r=0, g=0, b=0, a=0})
pal:setColor(1, Color{r=0, g=0, b=0, a=255})
pal:setColor(2, Color{r=255, g=255, b=255, a=255})
spr:setPalette(pal)

local img
local ok, cel = pcall(function() return spr:newCel(spr.layers[1], 1) end)
if ok and cel then img = cel.image else img = spr.cels[1].image end

-- ---------- helpers ----------
local function pset(x, y, c)
  x = math.floor(x); y = math.floor(y)
  if x >= 0 and x < W and y >= 0 and y < H then img:putPixel(x, y, c) end
end

local BAY = {
  {0, 8, 2, 10},
  {12, 4, 14, 6},
  {3, 11, 1, 9},
  {15, 7, 13, 5}
}
local function dith(x, y, d)
  x = math.floor(x); y = math.floor(y)
  return BAY[(y % 4) + 1][(x % 4) + 1] < d
end
local function dput(x, y, d)            -- overwrite: white or black by pattern
  pset(x, y, dith(x, y, d) and 2 or 1)
end
local function dwhite(x, y, d)          -- additive light: white only
  if dith(x, y, d) then pset(x, y, 2) end
end
local function rect(x0, y0, x1, y1, c)
  for y = y0, y1 do for x = x0, x1 do pset(x, y, c) end end
end
local function drect(x0, y0, x1, y1, d)
  for y = y0, y1 do for x = x0, x1 do dput(x, y, d) end end
end
local function hsh(x, y)
  x = math.floor(x); y = math.floor(y)
  return (x * 374761 + y * 668265 + ((x * y) % 1013) * 971) % 65536
end
local function blit(p, x, y)
  for r = 1, #p do
    local row = p[r]
    for i = 1, #row do
      if row:sub(i, i) == "X" then pset(x + i - 1, y + r - 1, 2) end
    end
  end
end
-- road spine: winding horizontal center line
local function RC(x)
  return math.floor(138 + 12 * math.sin((x - 40) / 70) + 0.5)
end

-- ---------- 1. lawn base, full bleed ----------
for y = 0, H - 1 do
  for x = 0, W - 1 do
    local h = hsh(x, y)
    local m = 24 + ((math.floor(x / 40) + math.floor(y / 40)) % 3) * 5
    pset(x, y, (h % m == 0) and 2 or 1)
  end
end
-- grass tufts
for y = 0, H - 1, 2 do
  for x = 0, W - 1, 2 do
    if hsh(x, y) % 251 == 0 then pset(x, y, 2); pset(x + 1, y, 2); pset(x, y - 1, 2) end
  end
end

-- ---------- 2. roads ----------
-- vertical road, top (to depot side)
for x = 196, 222 do
  local yc = RC(x)
  for y = 0, yc - 16 do
    if x <= 197 or x >= 221 then pset(x, y, 2) else dput(x, y, 4) end
  end
end
-- vertical road, bottom
for x = 66, 90 do
  local yc = RC(x)
  for y = yc + 16, H - 1 do
    if x <= 67 or x >= 89 then pset(x, y, 2) else dput(x, y, 4) end
  end
end
-- winding main road
for x = 0, W - 1 do
  local yc = RC(x)
  for y = yc - 15, yc + 15 do
    if y <= yc - 14 or y >= yc + 14 then pset(x, y, 2) else dput(x, y, 4) end
  end
end
-- open the junction curbs
for x = 198, 220 do
  local yc = RC(x)
  dput(x, yc - 15, 4); dput(x, yc - 14, 4)
end
for x = 68, 88 do
  local yc = RC(x)
  dput(x, yc + 14, 4); dput(x, yc + 15, 4)
end
-- dashed center lines
for x = 0, W - 1 do
  if x % 14 < 7 then local yc = RC(x); pset(x, yc, 2); pset(x, yc - 1, 2) end
end
for y = 0, RC(208) - 22 do
  if y % 14 < 7 then pset(208, y, 2); pset(209, y, 2) end
end
for y = RC(78) + 22, H - 1 do
  if y % 14 < 7 then pset(77, y, 2); pset(78, y, 2) end
end

-- ---------- 3. walkway, driveway, gate path ----------
for y = 96, RC(66) - 16 do
  for x = 62, 70 do
    if (y - 96) % 8 == 0 then pset(x, y, 1) else dput(x, y, 6) end
  end
  pset(61, y, 1); pset(71, y, 1)
end
for y = 96, RC(109) - 16 do
  for x = 96, 122 do dput(x, y, 3) end
  pset(95, y, 1); pset(123, y, 1)
end
for y = 162, 167 do for x = 202, 210 do dput(x, y, 5) end end

-- ---------- 4. travel-node clearings (3) ----------
local function clearing(cx, cy, rx, ry)
  for dy = -ry, ry do
    for dx = -rx, rx do
      local e = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry)
      if e <= 1 then
        if e >= 0.72 then dwhite(cx + dx, cy + dy, 8)
        else dput(cx + dx, cy + dy, 4) end
      end
    end
  end
  pset(cx - 3, cy + 1, 2); pset(cx - 2, cy + 1, 2); pset(cx - 1, cy + 2, 1)
  pset(cx + 2, cy - 2, 2); pset(cx + 3, cy - 2, 2); pset(cx + 4, cy - 1, 1)
  pset(cx + 4, cy + 2, 2); pset(cx + 5, cy + 2, 1)
end
clearing(40, 108, 13, 8)
clearing(285, 176, 13, 8)
clearing(350, 155, 12, 8)

-- ---------- 5. hedges ----------
local function blob(cx, cy, r)
  for dy = -r, r do
    for dx = -r, r do
      local d2 = dx * dx + dy * dy
      if d2 <= r * r then
        local dist = math.sqrt(d2)
        if dist > r - 1.2 then
          pset(cx + dx, cy + dy, 1)
          if dy < 0 and dith(cx + dx, cy + dy, 6) then pset(cx + dx, cy + dy, 2) end
        else
          local d = 7 - (d2 / (r * r)) * 5 - dy * 0.5
          if d < 1 then d = 1 end
          dput(cx + dx, cy + dy, d)
        end
      end
    end
  end
end
for cx = 140, 186, 11 do blob(cx, 11, 7) end       -- hedgerow, top west
for cx = 232, 284, 13 do blob(cx, 11, 7) end       -- hedgerow, top east
for cy = 24, 86, 10 do blob(12, cy, 5) end         -- hedge along house west
for cy = 44, 100, 12 do blob(394, cy, 6) end       -- hedge, east map edge

-- ---------- 6. fenced yard, lower-center ----------
for y = 169, 227 do
  for x = 151, 261 do dput(x, y, 1 + (math.floor(x / 8) % 2)) end  -- mow stripes
end
for x = 150, 262 do                                  -- rails, dashed pickets
  if x < 200 or x > 212 then
    if x % 3 ~= 0 then pset(x, 168, 2); pset(x, 228, 2) end
    if (x - 150) % 8 == 0 then
      rect(x, 167, x + 1, 169, 2); rect(x, 227, x + 1, 229, 2)
    end
  else
    if x % 3 ~= 0 then pset(x, 228, 2) end
    if (x - 150) % 8 == 0 then rect(x, 227, x + 1, 229, 2) end
  end
end
for y = 168, 228 do
  if y % 3 ~= 0 then pset(150, y, 2); pset(262, y, 2) end
  if (y - 168) % 8 == 0 then
    rect(150, y, 151, y + 1, 2); rect(261, y, 262, y + 1, 2)
  end
end
rect(198, 166, 199, 170, 2); rect(212, 166, 213, 170, 2)   -- gate posts
-- doghouse
rect(163, 179, 181, 197, 1)
for y = 180, 187 do for x = 164, 180 do dput(x, y, 6) end end
for x = 164, 180 do pset(x, 183, 2) end
for y = 188, 196 do for x = 164, 180 do dput(x, y, 2) end end
rect(169, 189, 175, 196, 1)
for x = 170, 174 do pset(x, 188, 2) end
for x = 164, 180 do pset(x, 179, 2); pset(x, 196, 2) end
for y = 179, 196 do pset(164, y, 2); pset(180, y, 2) end
-- yard tree
blob(238, 206, 12)
pset(238, 206, 1); pset(239, 206, 1); pset(238, 207, 1)

-- ---------- 7. two-story house, upper-left ----------
rect(21, 17, 121, 99, 1)                             -- drop shadow
for y = 14, 37 do                                    -- moonlit north slope
  for x = 18, 118 do
    local d = 7 - (y - 14) * 0.18
    if (y - 14) % 4 == 3 and (x + math.floor((y - 14) / 4) * 3) % 9 < 5 then
      pset(x, y, 1)
    else
      dput(x, y, d)
    end
  end
end
for y = 40, 65 do                                    -- dark south slope
  for x = 18, 118 do
    if (y - 40) % 4 == 2 and (x + math.floor((y - 40) / 4) * 3) % 9 < 4 then
      pset(x, y, 2)
    else
      dput(x, y, 3)
    end
  end
end
rect(18, 38, 118, 39, 2)                             -- ridge
rect(18, 14, 118, 15, 2); rect(18, 64, 118, 65, 2)   -- roof outline 2px
rect(18, 14, 19, 65, 2); rect(117, 14, 118, 65, 2)
rect(18, 66, 118, 67, 1)                             -- eave shadow
for y = 68, 96 do                                    -- siding wall
  for x = 22, 114 do dput(x, y, ((y - 68) % 3 == 0) and 3 or 1) end
  pset(21, y, 2); pset(22, y, 2); pset(114, y, 2); pset(115, y, 2)
end
local function litwin(x0, y0, x1, y1)
  rect(x0, y0, x1, y1, 2)
  for x = x0, x1 do pset(x, y0, 1); pset(x, y1, 1) end
  for y = y0, y1 do pset(x0, y, 1); pset(x1, y, 1) end
  local mx = math.floor((x0 + x1) / 2)
  local my = math.floor((y0 + y1) / 2)
  for y = y0, y1 do pset(mx, y, 1) end
  for x = x0, x1 do pset(x, my, 1) end
end
litwin(30, 70, 41, 77); litwin(50, 70, 61, 77); litwin(88, 70, 99, 77)
litwin(30, 82, 41, 90); litwin(88, 82, 99, 90)
rect(62, 78, 74, 95, 1)                              -- front door
for x = 62, 74 do pset(x, 78, 2); pset(x, 95, 2) end
for y = 78, 95 do pset(62, y, 2); pset(74, y, 2) end
rect(65, 80, 71, 82, 2); pset(72, 88, 2)
-- chimney + smoke
rect(98, 18, 108, 30, 2); drect(100, 20, 106, 28, 5); rect(101, 21, 105, 25, 1)
pset(107, 15, 2); pset(110, 12, 2); pset(114, 10, 2)
-- window glow spilling on lawn
local glows = {{30, 41}, {50, 61}, {88, 99}}
for _, g in ipairs(glows) do
  for gy = 97, 107 do
    local d = 8 - (gy - 96) * 0.8
    local s = math.floor((gy - 96) / 2)
    for gx = g[1] - s, g[2] + s do dwhite(gx, gy, d) end
  end
end

-- ---------- 8. Greyhound depot, right ----------
rect(295, 39, 395, 111, 1)                           -- drop shadow
for y = 36, 94 do                                    -- gravel flat roof
  for x = 292, 392 do
    local h = hsh(x, y)
    if h % 17 == 0 then pset(x, y, 2)
    elseif h % 19 == 0 then pset(x, y, 1)
    else dput(x, y, 4) end
  end
end
rect(292, 36, 392, 37, 2); rect(292, 93, 392, 94, 2) -- parapet 2px
rect(292, 36, 293, 94, 2); rect(391, 36, 392, 94, 2)
for x = 297, 387 do pset(x, 41, 1); pset(x, 89, 1) end
for y = 41, 89 do pset(297, y, 1); pset(387, y, 1) end
rect(302, 46, 318, 60, 2); drect(304, 48, 316, 58, 6)  -- rooftop AC
for dy = -3, 3 do for dx = -3, 3 do
  if dx * dx + dy * dy <= 9 then pset(310 + dx, 53 + dy, 1) end
end end
pset(310, 53, 2); pset(307, 53, 2); pset(313, 53, 2); pset(310, 50, 2); pset(310, 56, 2)
-- roof sign: leaping hound + BUS
rect(297, 62, 357, 81, 1)
blit({
".....XXXXXXXX...XX",
"...XXXXXXXXXXXXXX.",
".XX.XXXXXXXXXX....",
"XX...XX....XX.....",
".....X......X.....",
"....X........X....",
"...X..........X..."
}, 300, 68)
local FONT = {
  B = {"XX.", "X.X", "XX.", "X.X", "XX."},
  U = {"X.X", "X.X", "X.X", "X.X", "XXX"},
  S = {"XXX", "X..", "XXX", "..X", "XXX"}
}
local tx = 322
for ch in ("BUS"):gmatch(".") do
  local g = FONT[ch]
  for r = 1, 5 do
    for i = 1, 3 do
      if g[r]:sub(i, i) == "X" then
        rect(tx + (i - 1) * 3, 64 + (r - 1) * 3, tx + (i - 1) * 3 + 2, 64 + (r - 1) * 3 + 2, 2)
      end
    end
  end
  tx = tx + 12
end
-- depot street wall
for y = 96, 108 do
  for x = 296, 388 do dput(x, y, (y == 100) and 0 or 2) end
end
litwin(302, 99, 313, 106); litwin(322, 99, 333, 106); litwin(342, 99, 353, 106)
rect(362, 97, 376, 108, 1)
for x = 362, 376 do pset(x, 97, 2); pset(x, 108, 2) end
for y = 97, 108 do pset(362, y, 2); pset(376, y, 2) end
pset(364, 103, 2)
local dglow = {{302, 313}, {322, 333}, {342, 353}, {362, 376}}
for _, g in ipairs(dglow) do
  for gy = 109, 117 do
    local d = 9 - (gy - 108)
    local s = math.floor((gy - 108) / 2)
    for gx = g[1] - s, g[2] + s do dwhite(gx, gy, d) end
  end
end
-- payphone kiosk + sign
rect(272, 102, 280, 112, 2); drect(274, 104, 278, 110, 5); pset(276, 107, 1)
for y = 90, 101 do pset(276, y, 2) end
rect(268, 78, 285, 90, 1)
for x = 268, 285 do pset(x, 78, 2); pset(x, 90, 2) end
for y = 78, 90 do pset(268, y, 2); pset(285, y, 2) end
blit({
"..XXXXXXXXX..",
".XXXXXXXXXXX.",
"XXXX.....XXXX",
"XXX.......XXX",
"XXX.......XXX"
}, 270, 81)

-- ---------- 9. parked cars ----------
local function carH(x, y)
  rect(x + 1, y + 1, x + 20, y + 11, 1)
  for ix = x + 2, x + 17 do pset(ix, y, 2); pset(ix, y + 10, 2) end
  for iy = y + 2, y + 8 do pset(x, iy, 2); pset(x + 19, iy, 2) end
  pset(x + 1, y + 1, 2); pset(x + 18, y + 1, 2); pset(x + 1, y + 9, 2); pset(x + 18, y + 9, 2)
  for iy = y + 1, y + 9 do
    for ix = x + 1, x + 18 do
      local r = ix - x
      if r >= 6 and r <= 7 then pset(ix, iy, 1)
      elseif r >= 13 and r <= 14 then pset(ix, iy, 1)
      elseif r >= 8 and r <= 12 then dput(ix, iy, 8)
      else dput(ix, iy, 6) end
    end
  end
  pset(x + 6, y - 1, 2); pset(x + 6, y + 11, 2)
end
local function carV(x, y)
  rect(x + 1, y + 1, x + 11, y + 20, 1)
  for iy = y + 2, y + 17 do pset(x, iy, 2); pset(x + 10, iy, 2) end
  for ix = x + 2, x + 8 do pset(ix, y, 2); pset(ix, y + 19, 2) end
  pset(x + 1, y + 1, 2); pset(x + 9, y + 1, 2); pset(x + 1, y + 18, 2); pset(x + 9, y + 18, 2)
  for iy = y + 1, y + 18 do
    for ix = x + 1, x + 9 do
      local r = iy - y
      if r >= 6 and r <= 7 then pset(ix, iy, 1)
      elseif r >= 13 and r <= 14 then pset(ix, iy, 1)
      elseif r >= 8 and r <= 12 then dput(ix, iy, 8)
      else dput(ix, iy, 6) end
    end
  end
  pset(x - 1, y + 6, 2); pset(x + 11, y + 6, 2)
end
carV(102, 100)                    -- driveway
carH(238, RC(248) - 13)           -- north lane
carH(316, RC(326) + 3)            -- south lane, by depot

-- ---------- 10. street furniture on asphalt ----------
for dy = -3, 3 do for dx = -3, 3 do          -- manhole mid-junction
  local d2 = dx * dx + dy * dy
  if d2 <= 9 then
    if d2 >= 7 and (dx + dy) % 2 == 0 then pset(209 + dx, RC(209) + dy, 2)
    else pset(209 + dx, RC(209) + dy, 1) end
  end
end end
for x = 170, 182 do                          -- storm drain at north curb
  pset(x, RC(x) - 13, 1)
  pset(x, RC(x) - 12, (x % 3 == 0) and 2 or 1)
end
for t = 0, 24 do                             -- skid marks
  local sx = 214 + t
  local sy = RC(sx) + 5 - math.floor(t * t / 100)
  pset(sx, sy, 1); pset(sx, sy + 1, 1)
  pset(sx, sy + 5, 1); pset(sx, sy + 6, 1)
end

-- ---------- 11. streetlamps with dithered pools ----------
local function lamp(x, y)
  for dy = -16, 16 do
    for dx = -16, 16 do
      local d2 = dx * dx + dy * dy
      if d2 <= 256 then
        local d = 10 - math.sqrt(d2) * 0.65
        if d > 0 then dwhite(x + dx, y + dy, d) end
      end
    end
  end
  rect(x - 2, y - 2, x + 2, y + 2, 1)
  rect(x - 1, y - 1, x + 1, y + 1, 2)
end
lamp(46, RC(46) - 19)
lamp(150, RC(150) - 19)
lamp(258, RC(258) + 19)
lamp(352, RC(352) + 19)
lamp(226, 60)
lamp(94, 200)

-- ---------- 12. telephone poles + sagging wires ----------
local function wire(x1, y1, x2, y2, sag, dash)
  local steps = math.max(math.abs(x2 - x1), math.abs(y2 - y1))
  for t = 0, steps do
    local u = t / steps
    if (not dash) or t % 2 == 0 then
      pset(x1 + (x2 - x1) * u, y1 + (y2 - y1) * u + sag * math.sin(3.14159 * u), 2)
    end
  end
end
local poles = {}
for _, pxx in ipairs({30, 130, 230, 330, 385}) do
  poles[#poles + 1] = {pxx, RC(pxx) + 22}
end
for i = 1, #poles - 1 do
  local a, b = poles[i], poles[i + 1]
  wire(a[1], a[2] - 4, b[1], b[2] - 4, 3, false)
  wire(a[1], a[2] + 4, b[1], b[2] + 4, 3, false)
end
wire(130, RC(130) + 18, 114, 92, 2, true)     -- service drop to house
wire(330, RC(330) + 18, 350, 96, 2, true)     -- service drop to depot
for _, p in ipairs(poles) do
  local x, y = p[1], p[2]
  pset(x + 1, y + 1, 1)
  for yy = y - 4, y + 4 do pset(x, yy, 2) end
  pset(x - 1, y, 2); pset(x + 1, y, 2)
end

-- ---------- 13. mailboxes + trash can ----------
local function mailbox(x, y)
  for yy = y + 2, y + 6 do pset(x, yy, 2) end
  rect(x - 2, y - 2, x + 3, y + 1, 1)
  for xx = x - 2, x + 3 do pset(xx, y - 2, 2); pset(xx, y + 1, 2) end
  for yy = y - 2, y + 1 do pset(x - 2, yy, 2); pset(x + 3, yy, 2) end
  pset(x + 4, y - 3, 2); pset(x + 4, y - 2, 2)
end
mailbox(54, 118)
mailbox(214, 160)
mailbox(126, 114)
for dy = -3, 3 do for dx = -3, 3 do
  local d2 = dx * dx + dy * dy
  if d2 <= 9 then
    if d2 >= 7 then pset(126 + dx, 126 + dy, ((dx + dy) % 2 == 0) and 2 or 1)
    else dput(126 + dx, 126 + dy, 6) end
  end
end end
pset(126, 126, 2)

-- ---------- save ----------
spr:flatten()
local out = os.getenv("ASE_OUT_DIR")
spr:saveAs(app.fs.joinPath(out, "map_suburbia.aseprite"))
spr:saveAs(app.fs.joinPath(out, "map_suburbia.png"))
print("ASE_GEN_OK")