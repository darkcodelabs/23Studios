-- HAKCD title card — 400x240 1-bit noir title screen for Playdate
-- Night suburb, dithered sky gradient, phone wires, one lit window.

local sprite = Sprite(400, 240, ColorMode.INDEXED)
sprite.transparentColor = 0

local pal = Palette(3)
pal:setColor(0, Color{r=0,   g=0,   b=0,   a=0})
pal:setColor(1, Color{r=0,   g=0,   b=0,   a=255})
pal:setColor(2, Color{r=255, g=255, b=255, a=255})
sprite:setPalette(pal)

local cel = sprite.cels[1]
if cel == nil then cel = sprite:newCel(sprite.layers[1], 1) end
local img = cel.image

local W, H = 400, 240
local GY = 170                      -- horizon / ground line

local function px(x, y, c)
  if x >= 0 and x < W and y >= 0 and y < H then img:putPixel(x, y, c) end
end

local function rect(x0, y0, w, h, c)
  for y = y0, y0 + h - 1 do
    for x = x0, x0 + w - 1 do px(x, y, c) end
  end
end

-- 4x4 Bayer matrix, the shading engine for every gradient
local B = {
  {  0,  8,  2, 10 },
  { 12,  4, 14,  6 },
  {  3, 11,  1,  9 },
  { 15,  7, 13,  5 },
}

------------------------------------------------------------------
-- 1. SKY: black at zenith -> bright dither glow at the horizon
------------------------------------------------------------------
for y = 0, GY - 1 do
  local t = y / GY
  local lvl = t * t * 14
  local row = B[y % 4 + 1]
  for x = 0, W - 1 do
    if row[x % 4 + 1] < lvl then px(x, y, 2) else px(x, y, 1) end
  end
end

------------------------------------------------------------------
-- 2. STARS (deterministic LCG scatter, upper sky only)
------------------------------------------------------------------
local seed = 19980705
local function rnd(m)
  seed = (seed * 1103515245 + 12345) % 2147483648
  return seed % m
end
for i = 1, 90 do
  local sx, sy = rnd(400), rnd(95)
  if not (sx > 350 and sx < 388 and sy < 50) then   -- keep moon zone clean
    px(sx, sy, 2)
    if i % 9 == 0 then                              -- a few bright plus-stars
      px(sx + 1, sy, 2); px(sx - 1, sy, 2); px(sx, sy + 1, 2); px(sx, sy - 1, 2)
    end
  end
end

------------------------------------------------------------------
-- 3. MOON with Bayer glow halo (top right)
------------------------------------------------------------------
local mx, my, mr = 368, 30, 12
for y = my - mr - 9, my + mr + 9 do
  for x = mx - mr - 9, mx + mr + 9 do
    local dx, dy = x - mx, y - my
    local d = math.sqrt(dx * dx + dy * dy)
    if d <= mr then
      px(x, y, 2)
    else
      local lvl = (mr + 9 - d) / 9 * 10
      if lvl > 0 and B[y % 4 + 1][x % 4 + 1] < lvl then px(x, y, 2) end
    end
  end
end
rect(mx - 4, my - 3, 2, 2, 1)   -- craters
rect(mx + 2, my + 3, 3, 2, 1)
rect(mx - 1, my + 6, 2, 1, 1)

------------------------------------------------------------------
-- 4. GROUND: solid black; sparse lawn texture; QUIET y=196..216
------------------------------------------------------------------
rect(0, GY, W, H - GY, 1)
for x = 0, W - 1 do
  if x % 3 == 0 then px(x, GY, 2) end               -- lit street edge
end
for y = GY + 1, 192 do                              -- grass sparkle, stops at 192
  for x = 0, W - 1 do
    if (x * 13 + y * 7 + (x % 5) * (y % 3)) % 61 == 0 then px(x, y, 2) end
  end
end
for y = 222, H - 1 do                               -- faint asphalt dots below quiet band
  for x = 0, W - 1 do
    if (x * 31 + y * 17) % 97 == 0 then px(x, y, 2) end
  end
end

------------------------------------------------------------------
-- 5. SKYLINE silhouettes (solid black on the bright horizon dither)
------------------------------------------------------------------
local function house(x, w, wallTop, peak)
  local mid = x + math.floor(w / 2)
  for y = peak, wallTop do
    local frac = (y - peak) / (wallTop - peak)
    local half = math.floor(frac * (w / 2 + 3))
    rect(mid - half, y, half * 2 + 1, 1, 1)
  end
  rect(x, wallTop, w, GY - wallTop, 1)
end

local function disc(cx, cy, r, c)                    -- fuzzy-edged canopy blob
  for y = -r - 2, r + 2 do
    for x = -r - 2, r + 2 do
      local d2 = x * x + y * y
      if d2 <= r * r then px(cx + x, cy + y, c)
      elseif d2 <= (r + 2) * (r + 2) and (cx + x + cy + y) % 2 == 0 then
        px(cx + x, cy + y, c)
      end
    end
  end
end

local function antenna(x, ytop, ybase)               -- period TV aerial
  rect(x, ytop, 1, ybase - ytop + 1, 1)
  rect(x - 6, ytop + 2, 13, 1, 1)
  rect(x - 4, ytop + 6, 9, 1, 1)
end

house(6,   74, 140, 120)                             -- house A
house(118, 70, 132, 112)                             -- house B
house(226, 76, 136, 114)                             -- house C (lit window)
house(318, 78, 142, 124)                             -- house D

antenna(43, 104, 120)
antenna(153, 96, 112)
antenna(357, 108, 124)

rect(56, 116, 9, 16, 1);  rect(54, 114, 13, 3, 1)    -- chimney A + cap
rect(126, 112, 9, 15, 1); rect(124, 110, 13, 3, 1)   -- chimney B + cap
rect(274, 110, 10, 14, 1); rect(272, 108, 14, 3, 1)  -- chimney C + cap

-- chimney smoke, drifting right (white dither on dark sky)
for i = 0, 10 do
  local yy = 104 - i * 3
  local xx = 278 + i + (i % 2) * 2
  px(xx, yy, 2); px(xx + 1, yy, 2)
  if i % 2 == 0 then px(xx - 1, yy + 1, 2) end
end

disc(98, 132, 15, 1); disc(88, 142, 10, 1); disc(108, 141, 10, 1)  -- big tree
rect(94, 150, 6, 20, 1)                                            -- trunk
disc(220, 162, 6, 1)                                               -- bushes
disc(397, 162, 7, 1)

------------------------------------------------------------------
-- 6. TELEPHONE WIRES (sagging catenaries) then POLES in front
------------------------------------------------------------------
local function wire(x0, y0, x1, y1, sag)
  local steps = x1 - x0
  if steps < 1 then return end
  for i = 0, steps do
    local t = i / steps
    local y = y0 + (y1 - y0) * t + sag * 4 * t * (1 - t)
    px(x0 + i, math.floor(y + 0.5), 1)
  end
end

wire(0, 88, 183, 92, 7)                              -- upper line, 3 spans
wire(216, 92, 291, 92, 7)
wire(324, 92, 399, 88, 6)
wire(0, 97, 183, 100, 8)                             -- lower line, 3 spans
wire(216, 100, 291, 100, 8)
wire(324, 100, 399, 95, 6)
wire(216, 101, 240, 130, 3)                          -- service drop to house C
wire(262, 136, 291, 101, 4)

rect(137, 93, 5, 3, 1); rect(139, 91, 2, 2, 1)       -- bird on wire 1
rect(252, 96, 5, 3, 1); rect(254, 94, 2, 2, 1)       -- bird on wire 2

local function pole(x)
  rect(x, 84, 4, GY - 84, 1)
  rect(x - 15, 91, 34, 3, 1)
  rect(x - 15, 99, 34, 3, 1)
  for _, ix in ipairs({ x - 14, x - 6, x + 10, x + 16 }) do
    rect(ix, 88, 2, 3, 1); rect(ix, 96, 2, 3, 1)
  end
end
pole(198)
pole(306)

------------------------------------------------------------------
-- 7. THE LIT BEDROOM WINDOW + dithered glow + light spill
------------------------------------------------------------------
local wx, wy, ww, wh = 250, 146, 12, 14
for y = wy - 9, wy + wh + 8 do
  for x = wx - 10, wx + ww + 9 do
    local dx = (x < wx) and (wx - x) or ((x >= wx + ww) and (x - (wx + ww - 1)) or 0)
    local dy = (y < wy) and (wy - y) or ((y >= wy + wh) and (y - (wy + wh - 1)) or 0)
    local d = (dx > dy) and dx or dy
    if d > 0 then
      if d <= 3 then
        if (x + y) % 2 == 0 then px(x, y, 2) end
      elseif d <= 6 then
        if x % 2 == 0 and y % 2 == 0 then px(x, y, 2) end
      elseif d <= 9 then
        if x % 3 == 0 and y % 3 == 0 then px(x, y, 2) end
      end
    end
  end
end
rect(wx, wy, ww, wh, 2)
rect(wx, wy + 6, ww, 1, 1)                           -- mullions
rect(wx + 5, wy, 2, wh, 1)
for y = 171, 181 do                                  -- light spill on lawn (ends y=181)
  local s = y - 170
  for x = wx - s, wx + ww + s - 1 do
    if (x + y) % 2 == 0 and (x * 3 + y * 5) % 7 < 3 then px(x, y, 2) end
  end
end

------------------------------------------------------------------
-- 8. TITLE "HAKCD" — solid rect glyphs, black rim, neon dither glow
------------------------------------------------------------------
local TX, TY = 52, 22
local function glyphs(x0, y0, R)
  local T = 12
  local adv = 62
  local bx = x0                                      -- H
  R(bx, y0, T, 56); R(bx + 36, y0, T, 56); R(bx + T, y0 + 22, 24, T)
  bx = x0 + adv                                      -- A (flat top)
  R(bx, y0, 48, T); R(bx, y0, T, 56); R(bx + 36, y0, T, 56); R(bx + T, y0 + 28, 24, T)
  bx = x0 + 2 * adv                                  -- K (stepped diagonals)
  R(bx, y0, T, 56)
  for i = 0, 3 do
    R(bx + 10 + i * 8, y0 + 21 - i * 7, 12, 13)
    R(bx + 10 + i * 8, y0 + 23 + i * 7, 12, 12)
  end
  bx = x0 + 3 * adv                                  -- C
  R(bx, y0, 48, T); R(bx, y0, T, 56); R(bx, y0 + 44, 48, T)
  bx = x0 + 4 * adv                                  -- D
  R(bx, y0, T, 56); R(bx, y0, 42, T); R(bx, y0 + 44, 42, T); R(bx + 34, y0 + 8, T, 40)
end

glyphs(TX, TY, function(x, y, w, h)                  -- outer soft glow
  for yy = y - 7, y + h + 6 do
    for xx = x - 7, x + w + 6 do
      if xx % 2 == 0 and yy % 2 == 0 then px(xx, yy, 2) end
    end
  end
end)
glyphs(TX, TY, function(x, y, w, h)                  -- inner dense glow
  for yy = y - 4, y + h + 3 do
    for xx = x - 4, x + w + 3 do
      if (xx + yy) % 2 == 0 then px(xx, yy, 2) end
    end
  end
end)
glyphs(TX, TY, function(x, y, w, h)                  -- black rim
  rect(x - 2, y - 2, w + 4, h + 4, 1)
end)
glyphs(TX, TY, function(x, y, w, h)                  -- solid white faces
  rect(x, y, w, h, 2)
end)

------------------------------------------------------------------
-- 9. SUBTITLE "a phreaker noir" (5x7 caps, x2, black outline)
------------------------------------------------------------------
local F = {
  A = {"01110","10001","10001","11111","10001","10001","10001"},
  P = {"11110","10001","10001","11110","10000","10000","10000"},
  H = {"10001","10001","10001","11111","10001","10001","10001"},
  R = {"11110","10001","10001","11110","10100","10010","10001"},
  E = {"11111","10000","10000","11110","10000","10000","11111"},
  K = {"10001","10010","10100","11000","10100","10010","10001"},
  N = {"10001","11001","11001","10101","10011","10011","10001"},
  O = {"01110","10001","10001","10001","10001","10001","01110"},
  I = {"11111","00100","00100","00100","00100","00100","11111"},
}
local function text(s, x0, y0, sc, c)
  local x = x0
  for i = 1, #s do
    local ch = s:sub(i, i)
    if ch == " " then
      x = x + 4 * sc
    else
      local g = F[ch]
      for r = 1, 7 do
        local row = g[r]
        for col = 1, 5 do
          if row:sub(col, col) == "1" then
            rect(x + (col - 1) * sc, y0 + (r - 1) * sc, sc, sc, c)
          end
        end
      end
      x = x + 6 * sc
    end
  end
end

local SUB = "A PHREAKER NOIR"
for dy = -1, 1 do
  for dx = -1, 1 do text(SUB, 115 + dx, 94 + dy, 2, 1) end
end
text(SUB, 115, 94, 2, 2)
rect(78, 99, 30, 4, 1);  rect(80, 100, 26, 2, 2)     -- flanking rules
rect(292, 99, 30, 4, 1); rect(294, 100, 26, 2, 2)

------------------------------------------------------------------
-- 10. SAVE (single flat image — no sprite sheet). y=196..216 left quiet.
------------------------------------------------------------------
sprite:flatten()
local out = os.getenv("ASE_OUT_DIR")
sprite:saveAs(app.fs.joinPath(out, "title_card.aseprite"))
sprite:saveAs(app.fs.joinPath(out, "title_card.png"))

print("ASE_GEN_OK")