-- HAKCD title card 400x240, 1-bit Playdate, phreaker-noir
local spr = Sprite(400, 240, ColorMode.INDEXED)
spr.transparentColor = 0

local pal = Palette(3)
pal:setColor(0, Color{r=0, g=0, b=0, a=0})
pal:setColor(1, Color{r=0, g=0, b=0, a=255})
pal:setColor(2, Color{r=255, g=255, b=255, a=255})
spr:setPalette(pal)

local cel
if #spr.cels > 0 then cel = spr.cels[1] else cel = spr:newCel(spr.layers[1], 1) end
local img = cel.image

local W, H = 400, 240

local function rect(x, y, w, h, c)
  local x2, y2 = x + w - 1, y + h - 1
  if x < 0 then x = 0 end
  if y < 0 then y = 0 end
  if x2 > W - 1 then x2 = W - 1 end
  if y2 > H - 1 then y2 = H - 1 end
  for py = y, y2 do
    for px = x, x2 do
      img:putPixel(px, py, c)
    end
  end
end

-- ============ background: solid black ============
rect(0, 0, W, H, 1)

-- ============ sky: Bayer dither, denser toward horizon (CRT glow) ============
local bayer = {
  {0, 8, 2, 10},
  {12, 4, 14, 6},
  {3, 11, 1, 9},
  {15, 7, 13, 5},
}
for y = 0, 159 do
  local t
  if y < 50 then t = 1
  elseif y < 95 then t = 2
  elseif y < 130 then t = 3
  elseif y < 150 then t = 4
  else t = 6 end
  for x = 0, W - 1 do
    if bayer[(y % 4) + 1][(x % 4) + 1] < t then
      img:putPixel(x, y, 2)
    end
  end
end

-- a few 2x2 stars in the high sky
local stars = {
  {20, 12}, {58, 6}, {132, 16}, {210, 4}, {300, 10},
  {368, 16}, {88, 20}, {250, 18}, {340, 6},
}
for _, s in ipairs(stars) do
  rect(s[1], s[2], 2, 2, 2)
end

-- ============ city skyline: solid black masses, rim glow, sparse windows ============
local buildings = {
  {0, 36, 158}, {32, 28, 148}, {56, 42, 164}, {94, 30, 150},
  {120, 46, 168}, {162, 30, 146}, {188, 40, 160}, {224, 32, 152},
  {252, 44, 166}, {292, 28, 148}, {316, 42, 158}, {354, 30, 150},
  {380, 20, 162},
}
for bi, b in ipairs(buildings) do
  local bx, bw, bt = b[1], b[2], b[3]
  -- black mass down to bottom of screen
  rect(bx, bt, bw, H - bt, 1)
  -- antenna silhouettes on some rooftops (black against dithered sky)
  if bi % 3 == 2 then
    rect(bx + math.floor(bw / 2) - 1, bt - 16, 2, 16, 1)
    rect(bx + math.floor(bw / 2) - 3, bt - 8, 6, 2, 1)
  end
  -- checkerboard rim glow along rooftop, 2 rows
  for ry = bt, bt + 1 do
    for rx = bx, bx + bw - 1 do
      if rx >= 0 and rx < W and (rx + ry) % 2 == 0 then
        img:putPixel(rx, ry, 2)
      end
    end
  end
  -- lit windows: 2x2 white, pseudo-random skip; avoid quiet strip + glove zone
  local wx = bx + 4
  while wx + 2 <= bx + bw - 4 do
    local wy = bt + 6
    while wy + 2 <= H - 6 do
      local inQuiet = (wy >= 196 and wy <= 224 and wx >= 96 and wx <= 304)
      local inGlove = (wx > 344 and wy > 184)
      if not inQuiet and not inGlove and ((wx * 13 + wy * 7) % 10) < 4 then
        rect(wx, wy, 2, 2, 2)
      end
      wy = wy + 11
    end
    wx = wx + 7
  end
end

-- ============ HAKCD: 4x5 cell grid per letter, cell 14x16 -> 56x80 letters ============
-- stroke = 14px cells, white fill over 2px-expanded black outline
local big = {
  H = {"1001", "1001", "1111", "1001", "1001"},
  A = {"1111", "1001", "1111", "1001", "1001"},
  K = {"1001", "1010", "1100", "1010", "1001"},
  C = {"1111", "1000", "1000", "1000", "1111"},
  D = {"1110", "1001", "1001", "1001", "1110"},
}
local word = "HAKCD"
local cellW, cellH = 14, 16
local letterAdv = 4 * cellW + 12 -- 56 + 12 gap = 68
local lx, ly = 36, 30            -- total width 5*56+4*12=328, centered-ish
for pass = 1, 2 do
  local col, e
  if pass == 1 then col, e = 1, 2 else col, e = 2, 0 end
  for i = 1, #word do
    local g = big[word:sub(i, i)]
    local ox = lx + (i - 1) * letterAdv
    for r = 1, 5 do
      local row = g[r]
      for c = 1, 4 do
        if row:sub(c, c) == "1" then
          rect(ox + (c - 1) * cellW - e, ly + (r - 1) * cellH - e,
               cellW + 2 * e, cellH + 2 * e, col)
        end
      end
    end
  end
end

-- ============ subtitle: 3x5 blocky micro-font, 12px caps ============
local small = {
  A = {"111", "101", "111", "101", "101"},
  S = {"111", "100", "111", "001", "111"},
  E = {"111", "100", "111", "100", "111"},
  P = {"111", "101", "111", "100", "100"},
  R = {"111", "101", "111", "110", "101"},
  I = {"111", "010", "010", "010", "111"},
  T = {"111", "010", "010", "010", "010"},
  N = {"101", "111", "111", "101", "101"},
  L = {"100", "100", "100", "100", "111"},
}
-- row heights sum to 12px cap height
local rowY = {0, 2, 5, 7, 10}
local rowH = {2, 3, 2, 3, 2}
local text = "ASEPRITE PIPELINE TEST"
local adv = 8                       -- 6px glyph + 2px space
local textW = #text * adv - 2       -- 174
local sx = math.floor((W - textW) / 2)
local sy = 128
-- black backing plate so subtitle sits clean over dither
rect(sx - 6, sy - 4, textW + 12, 12 + 8, 1)
for i = 1, #text do
  local ch = text:sub(i, i)
  local g = small[ch]
  if g then
    local ox = sx + (i - 1) * adv
    for r = 1, 5 do
      local row = g[r]
      for c = 1, 3 do
        if row:sub(c, c) == "1" then
          rect(ox + (c - 1) * 2, sy + rowY[r], 2, rowH[r], 2)
        end
      end
    end
  end
end

-- ============ power glove silhouette, lower right ============
local gx, gy = 356, 192
local glove = {
  {4, 2, 5, 10},   -- finger 1
  {11, 0, 5, 12},  -- finger 2
  {18, 0, 5, 12},  -- finger 3
  {25, 2, 5, 10},  -- finger 4
  {4, 12, 26, 16}, -- palm / back of hand
  {-3, 16, 7, 9},  -- thumb
  {3, 29, 28, 13}, -- forearm cuff
}
for pass = 1, 2 do
  local col, e
  if pass == 1 then col, e = 1, 2 else col, e = 2, 0 end
  for _, s in ipairs(glove) do
    rect(gx + s[1] - e, gy + s[2] - e, s[3] + 2 * e, s[4] + 2 * e, col)
  end
end
-- cuff button pad + knuckle seam, black on white
rect(gx + 7, gy + 32, 4, 4, 1)
rect(gx + 14, gy + 32, 4, 4, 1)
rect(gx + 21, gy + 32, 4, 4, 1)
rect(gx + 6, gy + 16, 22, 2, 1)

-- ============ quiet strip for runtime "PRESS A" prompt ============
rect(100, 200, 200, 20, 1)

-- ============ save ============
spr:flatten()
local out = os.getenv("ASE_OUT_DIR")
spr:saveAs(app.fs.joinPath(out, "title_card.aseprite"))
spr:saveAs(app.fs.joinPath(out, "title_card.png"))
print("ASE_GEN_OK")