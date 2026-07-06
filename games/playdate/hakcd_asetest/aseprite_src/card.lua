-- HAKCD launcher card 350x155 — 1-bit noir hacker collage
-- CRT glow / phone handset / floppies / skull / wires, heavy Bayer dithering

local W, H = 350, 155

local spr = Sprite(W, H, ColorMode.INDEXED)
spr.transparentColor = 0

local pal = Palette(3)
pal:setColor(0, Color{r = 0,   g = 0,   b = 0,   a = 0})
pal:setColor(1, Color{r = 0,   g = 0,   b = 0,   a = 255})
pal:setColor(2, Color{r = 255, g = 255, b = 255, a = 255})
spr:setPalette(pal)

local cel
if #spr.cels > 0 then cel = spr.cels[1] else cel = spr:newCel(spr.layers[1], 1) end
local img = cel.image

---------------------------------------------------------------- helpers
local function px(x, y, c)
  if x >= 0 and x < W and y >= 0 and y < H then img:putPixel(x, y, c) end
end

local function rect(x, y, w, h, c)
  for j = y, y + h - 1 do
    for i = x, x + w - 1 do px(i, j, c) end
  end
end

-- 4x4 ordered Bayer matrix; threshold t in 0..16
local B = {
  {0, 8, 2, 10},
  {12, 4, 14, 6},
  {3, 11, 1, 9},
  {15, 7, 13, 5},
}
local function bay(x, y) return B[(y % 4) + 1][(x % 4) + 1] end

local function dith(x, y, w, h, t) -- opaque dithered fill
  for j = y, y + h - 1 do
    for i = x, x + w - 1 do
      if bay(i, j) < t then px(i, j, 2) else px(i, j, 1) end
    end
  end
end

local function dithW(x, y, w, h, t) -- additive white speckle only
  for j = y, y + h - 1 do
    for i = x, x + w - 1 do
      if bay(i, j) < t then px(i, j, 2) end
    end
  end
end

local function disc(cx, cy, r, c)
  for j = -r, r do
    for i = -r, r do
      if i * i + j * j <= r * r then px(cx + i, cy + j, c) end
    end
  end
end

local function ring(cx, cy, r, w, c)
  local r2, rin2 = r * r, (r - w) * (r - w)
  for j = -r, r do
    for i = -r, r do
      local d = i * i + j * j
      if d <= r2 and d >= rin2 then px(cx + i, cy + j, c) end
    end
  end
end

local function line(x0, y0, x1, y1, c, th)
  th = th or 1
  local dx = math.abs(x1 - x0); local sx = x0 < x1 and 1 or -1
  local dy = -math.abs(y1 - y0); local sy = y0 < y1 and 1 or -1
  local err = dx + dy
  while true do
    for oy = 0, th - 1 do
      for ox = 0, th - 1 do px(x0 + ox, y0 + oy, c) end
    end
    if x0 == x1 and y0 == y1 then break end
    local e2 = 2 * err
    if e2 >= dy then err = err + dy; x0 = x0 + sx end
    if e2 <= dx then err = err + dx; y0 = y0 + sy end
  end
end

---------------------------------------------------------------- 1. base
rect(0, 0, W, H, 1)

-- faint diagonal light shaft (film grain band)
for y2 = 0, H - 1 do
  local rowbase = 2 * y2
  for x2 = 0, W - 1 do
    local band = x2 + rowbase
    if band > 150 and band < 320 and bay(x2, y2) < 2 then px(x2, y2, 2) end
  end
end

-- floor speckle strip, grounds the props
dithW(0, 146, W, 9, 3)

---------------------------------------------------------------- 2. wires
local function wire(y0, amp, phase, th)
  local prevy
  for x2 = 0, W - 1 do
    local yy = math.floor(y0 + amp * math.sin((x2 + phase) * 0.02) + 0.5)
    for k = 0, th - 1 do px(x2, yy + k, 2) end
    if prevy then
      local lo, hi = math.min(prevy, yy), math.max(prevy, yy)
      for ym = lo, hi do px(x2, ym, 2) end
    end
    prevy = yy
  end
end
wire(5, 3, 0, 2)
wire(12, 4, 60, 1)
wire(18, 2, 130, 1)

-- dangling cable + RJ plug, top right
for y2 = 0, 24 do
  local xx = math.floor(336 + 3 * math.sin(y2 * 0.25))
  px(xx, y2, 2); px(xx + 1, y2, 2)
end
rect(333, 24, 8, 6, 2)
rect(335, 25, 4, 3, 1)
rect(335, 30, 4, 2, 2)

---------------------------------------------------------------- 3. CRT monitor
-- body x6..119 y26..123
rect(6, 26, 114, 98, 1)
dith(8, 28, 110, 94, 4)
rect(6, 26, 114, 2, 2); rect(6, 122, 114, 2, 2)
rect(6, 26, 2, 98, 2);  rect(118, 26, 2, 98, 2)

-- screen frame + inner black
rect(16, 34, 93, 1, 2); rect(16, 106, 93, 1, 2)
rect(16, 34, 1, 73, 2); rect(108, 34, 1, 73, 2)
rect(17, 35, 91, 71, 1)

-- screen ambient radial glow (dim, elliptical)
local scx, scy = 62, 70
for y2 = 36, 104 do
  for x2 = 18, 106 do
    local dxx = (x2 - scx) / 48
    local dyy = (y2 - scy) / 38
    local d = math.sqrt(dxx * dxx + dyy * dyy)
    local t = 7 * (1 - d)
    if t < 0 then t = 0 end
    if bay(x2, y2) < t then px(x2, y2, 2) else px(x2, y2, 1) end
  end
end

-- terminal text: dark bands with bright dash "code"
local rowlens = {70, 54, 62, 34, 58, 66, 28, 48, 40}
for r = 1, 9 do
  local ty = 40 + (r - 1) * 6
  rect(20, ty - 1, 86, 4, 1)
  local maxx = 22 + rowlens[r]
  local x2 = 22
  while x2 < maxx do
    local seg = 2 + ((x2 * 7 + r * 13) % 4)
    local gap = 2 + ((x2 * 5 + r * 3) % 3)
    for k = 0, seg - 1 do
      if x2 + k < maxx then px(x2 + k, ty, 2); px(x2 + k, ty + 1, 2) end
    end
    x2 = x2 + seg + gap
  end
end
rect(64, 87, 5, 4, 2) -- block cursor

-- CRT scanlines
for y2 = 37, 103, 4 do
  for x2 = 19, 105 do
    if x2 % 2 == 0 then px(x2, y2, 1) end
  end
end

-- bezel details: sticky note, nameplate dashes, vents, power LED
rect(19, 108, 16, 12, 2)
rect(21, 111, 11, 1, 1); rect(21, 114, 8, 1, 1); rect(21, 117, 12, 1, 1)
rect(48, 113, 8, 2, 2); rect(58, 113, 5, 2, 2); rect(66, 113, 9, 2, 2)
rect(86, 109, 16, 1, 2); rect(86, 112, 16, 1, 2); rect(86, 115, 16, 1, 2)
rect(108, 114, 3, 3, 2)

-- stand
rect(42, 124, 40, 8, 1)
dith(44, 125, 36, 6, 4)
rect(42, 130, 40, 2, 2)

-- phosphor spill onto bezel and wall around screen
for j = -78, 78 do
  for i = -78, 78 do
    local x2, y2 = scx + i, scy + j
    local inScreen = x2 >= 18 and x2 <= 106 and y2 >= 36 and y2 <= 104
    if not inScreen then
      local d = math.sqrt(i * i + j * j) / 78
      local t = 6 * (1 - d) - 1.5
      if t > 0 and bay(x2, y2) < t then px(x2, y2, 2) end
    end
  end
end

---------------------------------------------------------------- 4. mid cables
for x2 = 108, 292 do
  local yy = math.floor(104 + 7 * math.sin((x2 - 108) * 0.035))
  px(x2, yy, 2); px(x2, yy + 1, 2)
end
for x2 = 112, 262 do
  local yy = math.floor(112 + 5 * math.sin((x2 - 112) * 0.05 + 1.5))
  px(x2, yy, 2)
end

-- crossed cables behind skull (crossbones motif)
line(250, 132, 348, 36, 2, 2)
line(256, 32, 348, 124, 2, 2)

---------------------------------------------------------------- 5. skull
local kx, ky, kr = 300, 72, 30
ring(kx, ky, kr, 3, 2) -- 3px white silhouette
for j = -(kr - 3), kr - 3 do
  for i = -(kr - 3), kr - 3 do
    if i * i + j * j <= (kr - 3) * (kr - 3) then
      local t = 9 - 6 * (i / kr) - 3 * (j / kr) -- lit from upper-left
      if t < 0 then t = 0 elseif t > 16 then t = 16 end
      px(kx + i, ky + j, (bay(kx + i, ky + j) < t) and 2 or 1)
    end
  end
end
-- forehead crack
local crack = {{297, 46}, {300, 50}, {296, 54}, {300, 58}, {297, 62}}
for c = 1, #crack - 1 do
  line(crack[c][1], crack[c][2], crack[c + 1][1], crack[c + 1][2], 1, 1)
end
-- angry brows
line(280, 62, 295, 66, 1, 2)
line(305, 66, 320, 62, 1, 2)
-- eye sockets + glints
disc(288, 70, 8, 1); disc(312, 70, 8, 1)
px(291, 73, 2); px(315, 73, 2)
-- nasal cavity
for k = 0, 11 do
  local wdt = math.floor(k * 0.5) + 1
  for m = -wdt, wdt do px(kx + m, 80 + k, 1) end
end
-- cheek notches carve the silhouette
disc(281, 91, 5, 1); disc(319, 91, 5, 1)
-- maxilla + teeth
dith(287, 94, 27, 9, 8)
rect(286, 102, 29, 1, 1)
local tx = 288
for tnum = 1, 5 do
  if tnum == 4 then
    rect(tx, 103, 4, 5, 2) -- broken tooth
  else
    local th2 = 12 - (tnum % 2) * 2
    rect(tx, 103, 4, th2, 2)
  end
  tx = tx + 5
end

---------------------------------------------------------------- 6. floppies
local function floppy(x, y, w, h, shade, seed)
  rect(x - 1, y - 1, w + 2, h + 2, 1)
  dith(x + 2, y + 2, w - 4, h - 4, shade)
  rect(x, y, w, 2, 2); rect(x, y + h - 2, w, 2, 2)
  rect(x, y, 2, h, 2); rect(x + w - 2, y, 2, h, 2)
  for k = 0, 4 do -- beveled corner
    for m = 0, 4 - k do px(x + w - 2 - m, y + 1 + k, 1) end
  end
  local sx = x + 10
  rect(sx, y + 3, 25, 10, 1)                 -- shutter
  dith(sx + 1, y + 4, 23, 8, 12)
  rect(sx + 15, y + 5, 6, 6, 1)              -- shutter window
  local lx, ly = x + 5, y + h - 14           -- label
  rect(lx, ly, w - 10, 12, 2)
  rect(lx + 3, ly + 2, 22 + (seed % 5), 2, 1)
  rect(lx + 3, ly + 6, 14 + (seed * 3 % 7), 2, 1)
  rect(x + 2, y + h - 6, 3, 3, 1)            -- write-protect notch
end
floppy(10, 120, 46, 30, 6, 1)
floppy(50, 125, 46, 30, 4, 2)
floppy(272, 124, 46, 30, 5, 3)

-- loose screws
disc(252, 142, 3, 2); rect(249, 142, 7, 1, 1); rect(252, 139, 1, 7, 1)
disc(261, 150, 2, 2); rect(259, 150, 5, 1, 1)

---------------------------------------------------------------- 7. phone handset
local function cup(cx, cy)
  disc(cx, cy, 16, 1)
  for j = -14, 14 do
    for i = -14, 14 do
      if i * i + j * j <= 196 then
        local t = 8 - 4 * (i / 14) - 3 * (j / 14)
        if t < 0 then t = 0 end
        px(cx + i, cy + j, (bay(cx + i, cy + j) < t) and 2 or 1)
      end
    end
  end
  ring(cx, cy, 16, 2, 2)
end
cup(143, 138)
cup(225, 138)
-- handle bar bridging cups
rect(150, 120, 68, 16, 1)
dith(152, 122, 64, 12, 6)
rect(150, 120, 68, 2, 2)
rect(150, 134, 68, 2, 2)
-- speaker / mic hole grids
for gy = 0, 2 do
  for gx = 0, 2 do
    disc(139 + gx * 4, 138 + gy * 4, 1, 1)
    disc(221 + gx * 4, 138 + gy * 4, 1, 1)
  end
end
-- coiled cord snaking left over the floppies
for k = 0, 4 do
  ring(122 - k * 8, 147 - (k % 2) * 4, 4, 2, 2)
end
line(86, 145, 70, 150, 2, 1)

---------------------------------------------------------------- 8. title HAKCD
local FONT = {
  H = {"10001","10001","10001","11111","10001","10001","10001"},
  A = {"01110","10001","10001","11111","10001","10001","10001"},
  K = {"10001","10010","10100","11000","10100","10010","10001"},
  C = {"01111","10000","10000","10000","10000","10000","01111"},
  D = {"11110","10001","10001","10001","10001","10001","11110"},
}
local word = "HAKCD"
local S, ox, oy = 8, 59, 24 -- 40x56 letters, 8px tracking, centered

dithW(53, 18, 246, 68, 2) -- faint glow field behind title

local function eachCell(fn)
  for li = 1, #word do
    local g = FONT[word:sub(li, li)]
    local lx = ox + (li - 1) * 48
    for row = 1, 7 do
      local bits = g[row]
      for col = 1, 5 do
        if bits:sub(col, col) == "1" then
          fn(lx + (col - 1) * S, oy + (row - 1) * S)
        end
      end
    end
  end
end
eachCell(function(x, y) rect(x + 4, y + 4, S, S, 1) end)         -- drop shadow
eachCell(function(x, y) rect(x - 3, y - 3, S + 6, S + 6, 1) end) -- 3px outline
eachCell(function(x, y) rect(x, y, S, S, 2) end)                 -- solid white fill

---------------------------------------------------------------- 9. save
spr:flatten()
local out = os.getenv("ASE_OUT_DIR")
spr:saveAs(app.fs.joinPath(out, "card.aseprite"))
spr:saveAs(app.fs.joinPath(out, "card.png"))
print("ASE_GEN_OK")