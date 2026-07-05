-- HAKCD phreaker-noir: isometric 1998 hacker-kid bedroom, 400x240, 1-bit
local OUT = os.getenv("ASE_OUT_DIR")
local sprite = Sprite(400, 240, ColorMode.INDEXED)
sprite.transparentColor = 0
local pal = Palette(3)
pal:setColor(0, Color{r=0,   g=0,   b=0,   a=0})
pal:setColor(1, Color{r=0,   g=0,   b=0,   a=255})
pal:setColor(2, Color{r=255, g=255, b=255, a=255})
sprite:setPalette(pal)

local ok, c = pcall(sprite.newCel, sprite, sprite.layers[1], 1)
local cel = (ok and c) or sprite.cels[1]
local img = cel.image

local K, W = 1, 2
local function px(x, y, v)
  if x >= 0 and x <= 399 and y >= 0 and y <= 239 then img:putPixel(x, y, v) end
end
local function hline(x1, x2, y, v) for x = x1, x2 do px(x, y, v) end end
local function vline(x, y1, y2, v) for y = y1, y2 do px(x, y, v) end end
local function rect(x1, y1, x2, y2, v) for y = y1, y2 do hline(x1, x2, y, v) end end

-- ===== room geometry: corner at x=200, walls 80px tall, 2:1 iso slope =====
local function lbase(x) return 190 - math.floor(x / 2) end
local function rbase(x) return 90 + math.floor((x - 200) / 2) end
local function base(x) if x < 200 then return lbase(x) else return rbase(x) end end
local function dsk(x) return 148 - math.floor((x - 25) / 2) end -- desk surface line

-- ===== background: black void + black walls =====
rect(0, 0, 399, 239, K)

-- ===== floor: white with iso dot-grid =====
for x = 0, 399 do
  local b = base(x)
  for y = b, 239 do px(x, y, W) end
end
for y = 96, 236, 4 do
  local xo = (2 * y) % 16
  for x = xo, 399, 16 do
    if y >= base(x) + 4 then px(x, y, K) end
  end
end

-- ===== wall texture: sparse white speckle on black =====
for x = 0, 399 do
  local b = base(x)
  for y = b - 77, b - 1 do
    if (x * 2 + y * 5) % 31 == 0 then px(x, y, W) end
  end
end

-- ===== wall top edge (2px white) + corner seam =====
for x = 0, 399 do
  local t = base(x) - 80
  px(x, t, W); px(x, t + 1, W)
end
vline(200, 12, 88, W)

-- ===== poster on left wall (skewed with wall) =====
for x = 34, 74 do
  local b = lbase(x)
  for y = b - 78, b - 46 do px(x, y, W) end
  px(x, b - 78, K); px(x, b - 46, K)
end
vline(34, lbase(34) - 78, lbase(34) - 46, K)
vline(74, lbase(74) - 78, lbase(74) - 46, K)
for x = 38, 70 do -- title band
  local b = lbase(x)
  for y = b - 75, b - 72 do px(x, y, K) end
end
for i = 0, 6 do -- lightning bolt, two offset strokes
  local x = 47 + i
  local b = lbase(x)
  rect(x, b - 68 + i * 2, x + 1, b - 65 + i * 2, K)
end
for i = 0, 6 do
  local x = 54 + i
  local b = lbase(x)
  rect(x, b - 62 + i * 2, x + 1, b - 59 + i * 2, K)
end
for x = 38, 70 do -- dithered footer band
  local b = lbase(x)
  for y = b - 52, b - 49 do
    if (x + y) % 2 == 0 then px(x, y, K) end
  end
end

-- ===== window on right wall: night sky, stars, moon =====
for x = 255, 310 do
  local b = rbase(x)
  for y = b - 70, b - 32 do px(x, y, K) end        -- sky
  px(x, b - 72, W); px(x, b - 71, W)               -- frame top
  px(x, b - 31, W); px(x, b - 30, W)               -- frame bottom / sill
end
for _, x in ipairs({255, 256, 309, 310}) do
  vline(x, rbase(x) - 72, rbase(x) - 30, W)
end
for x = 257, 308 do -- stars
  local b = rbase(x)
  for y = b - 70, b - 32 do
    if (x * 7 + y * 3) % 23 == 0 then px(x, y, W) end
  end
end
for dy = -9, 9 do -- moon + dithered halo
  for dx = -9, 9 do
    local d = dx * dx + dy * dy
    local x, y = 272 + dx, 66 + dy
    if x >= 257 and x <= 308 and y >= rbase(x) - 70 and y <= rbase(x) - 32 then
      if d <= 36 then px(x, y, W)
      elseif d <= 81 and (x + y) % 2 == 0 then px(x, y, W) end
    end
  end
end
px(270, 64, K); px(274, 67, K); px(271, 68, K)      -- craters
for _, x in ipairs({282, 283}) do                   -- crossbars
  vline(x, rbase(x) - 70, rbase(x) - 32, W)
end
for x = 257, 308 do
  local b = rbase(x)
  px(x, b - 51, W); px(x, b - 50, W)
end

-- ===== door lower-right =====
for x = 366, 398 do
  local b = rbase(x)
  for y = b - 70, b do px(x, y, K) end
  px(x, b - 70, W); px(x, b - 69, W)
end
for _, x in ipairs({366, 367, 397, 398}) do
  vline(x, rbase(x) - 70, rbase(x), W)
end
for x = 372, 392 do -- two recessed panels
  local b = rbase(x)
  px(x, b - 62, W); px(x, b - 42, W)
  px(x, b - 36, W); px(x, b - 10, W)
end
for _, x in ipairs({372, 392}) do
  local b = rbase(x)
  vline(x, b - 62, b - 42, W)
  vline(x, b - 36, b - 10, W)
end
rect(369, rbase(370) - 38, 370, rbase(370) - 36, W) -- knob

-- ===== desk along left wall =====
for x = 25, 165 do
  local s = dsk(x)
  px(x, s, K); px(x, s + 1, K)
  for y = s + 2, s + 11 do px(x, y, W) end
  px(x, s + 12, K); px(x, s + 13, K)
  for y = s + 14, lbase(x) + 6 do px(x, y, K) end   -- black front mass
end
for _, x in ipairs({25, 26, 164, 165}) do vline(x, dsk(x), dsk(x) + 13, K) end
vline(25, dsk(25) + 14, lbase(25) + 6, W)           -- silhouette trims
vline(165, dsk(165) + 14, lbase(165) + 6, W)
for x = 126, 156 do -- drawer outline on front panel
  local s = dsk(x)
  px(x, s + 18, W); px(x, s + 28, W)
end
vline(126, dsk(126) + 18, dsk(126) + 28, W)
vline(156, dsk(156) + 18, dsk(156) + 28, W)
px(140, dsk(140) + 23, W); px(141, dsk(141) + 23, W)

-- ===== CRT monitor (skewed with desk) =====
for x = 96, 148 do
  local s = dsk(x)
  for y = s - 46, s - 1 do px(x, y, W) end          -- bezel
  px(x, s - 46, K); px(x, s - 45, K)
  px(x, s - 2, K); px(x, s - 1, K)
end
for _, x in ipairs({96, 97, 147, 148}) do vline(x, dsk(x) - 46, dsk(x) - 1, K) end
for x = 104, 140 do -- screen: black w/ checker glow rim
  local s = dsk(x)
  for y = s - 40, s - 10 do px(x, y, K) end
  for y = s - 40, s - 10 do
    if ((y <= s - 39) or (y >= s - 11) or x <= 105 or x >= 139)
       and (x + y) % 2 == 0 then px(x, y, W) end
  end
end
local lines = {{34, 26}, {30, 18}, {26, 22}, {22, 10}, {18, 24}}
for _, ln in ipairs(lines) do -- terminal text dashes
  for x = 108, 108 + ln[2] do
    if x % 4 ~= 3 then px(x, dsk(x) - ln[1], W) end
  end
end
for x = 118, 120 do px(x, dsk(x) - 14, W); px(x, dsk(x) - 13, W) end -- cursor
for x = 106, 138, 2 do px(x, dsk(x) - 5, K) end     -- vents

-- CRT glow halo dithered onto the wall
for x = 84, 160 do
  local s = dsk(x)
  local dxv = 0
  if x < 96 then dxv = 96 - x elseif x > 148 then dxv = x - 148 end
  for y = s - 58, s - 2 do
    if y >= lbase(x) - 77 and y <= lbase(x) - 1 then
      local dyv = 0
      if y < s - 46 then dyv = (s - 46) - y end
      local d = dxv + dyv
      if d >= 1 and d <= 4 then
        if (x + y) % 2 == 0 then px(x, y, W) end
      elseif d >= 5 and d <= 9 then
        if (x + y) % 4 == 0 then px(x, y, W) end
      end
    end
  end
end

-- ===== keyboard =====
for x = 100, 142 do
  local s = dsk(x)
  px(x, s + 3, K)
  for y = s + 4, s + 9 do px(x, y, W) end
  px(x, s + 10, K)
  if x % 3 == 1 then px(x, s + 5, K); px(x, s + 8, K) end
  if x % 3 == 0 then px(x, s + 7, K) end
end
vline(100, dsk(100) + 3, dsk(100) + 10, K)
vline(142, dsk(142) + 3, dsk(142) + 10, K)

-- ===== external modem with LEDs =====
for x = 150, 164 do
  local s = dsk(x)
  px(x, s - 8, W)
  for y = s - 7, s - 1 do px(x, y, K) end
end
vline(150, dsk(150) - 8, dsk(150) - 1, W)
vline(164, dsk(164) - 8, dsk(164) - 1, W)
px(153, dsk(153) - 4, W); px(156, dsk(156) - 4, W); px(160, dsk(160) - 4, W)

-- ===== corded phone =====
for x = 28, 58 do -- handset silhouette
  local s = dsk(x)
  for y = s - 15, s - 9 do px(x, y, K) end
end
for x = 30, 36 do local s = dsk(x) for y = s - 14, s - 10 do px(x, y, W) end end
for x = 50, 56 do local s = dsk(x) for y = s - 14, s - 10 do px(x, y, W) end end
for x = 36, 50 do local s = dsk(x) px(x, s - 13, W); px(x, s - 12, W) end
for x = 32, 54 do -- base body
  local s = dsk(x)
  for y = s - 8, s - 1 do px(x, y, K) end
end
for x = 36, 48, 4 do -- keypad dots
  local s = dsk(x)
  px(x, s - 6, W); px(x, s - 4, W)
end
for i = 0, 10 do -- cord dropping down the desk front
  px(57 + (i % 2), dsk(57) + 15 + i * 2, W)
end

-- ===== unmade bed along right wall =====
local function bedT(x)
  if x < 272 then return 136 - math.floor((x - 244) / 2)
  else return 122 + math.floor((x - 272) / 2) end
end
local function bedB(x)
  if x <= 334 then return 136 + math.floor((x - 244) / 2)
  else return 181 - math.floor((x - 334) / 2) end
end
for x = 244, 362 do
  local t, b = bedT(x), bedB(x)
  for y = b + 1, b + 8 do px(x, y, K) end           -- frame shadow mass
  for y = t, b do px(x, y, W) end                    -- mattress
  px(x, t, K); px(x, math.min(t + 1, b), K)
  px(x, b, K); px(x, math.max(b - 1, t), K)
end
for x = 276, 300 do -- pillow
  local t = bedT(x)
  for y = t + 3, t + 13 do px(x, y, W) end
  px(x, t + 3, K); px(x, t + 13, K)
end
vline(276, bedT(276) + 3, bedT(276) + 13, K)
vline(300, bedT(300) + 3, bedT(300) + 13, K)
for x = 280, 296, 2 do px(x, bedT(x) + 8, K) end    -- pillow crease
for x = 306, 362 do -- dithered blanket + folds
  local t, b = bedT(x), bedB(x)
  for y = t + 2, b - 2 do
    if (x + y) % 2 == 0 then px(x, y, K) end
  end
  px(x, t + 6, K)
  if x <= 350 then px(x, b - 6, K) end
end
for y = bedT(305), bedB(305) do -- rumpled blanket edge
  px(304 + (math.floor(y / 4) % 3), y, K)
end
for x = 314, 350 do -- blanket draping over the near side
  local b = bedB(x)
  for y = b + 1, b + 7 do
    if (x + y) % 2 == 0 then px(x, y, W) end
  end
end

-- ===== save =====
sprite:saveAs(app.fs.joinPath(OUT, "room_bedroom.aseprite"))
sprite:flatten()
sprite:saveAs(app.fs.joinPath(OUT, "room_bedroom.png"))
print("ASE_GEN_OK")