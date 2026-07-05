-- HAKCD launcher card 350x155 — Playdate 1-bit, phreaker-noir
-- Huge blocky HAKCD letters, Bayer-glow dithered black bg, fingerless glove icon right side.

local W, H = 350, 155
local spr = Sprite(W, H, ColorMode.INDEXED)
spr.transparentColor = 0

local pal = Palette(3)
pal:setColor(0, Color{r=0,   g=0,   b=0,   a=0})
pal:setColor(1, Color{r=0,   g=0,   b=0,   a=255})
pal:setColor(2, Color{r=255, g=255, b=255, a=255})
spr:setPalette(pal)

local cel = spr.cels[1]
if cel == nil then cel = spr:newCel(spr.layers[1], 1) end
local img = cel.image

local function rect(x, y, w, h, c)
  for yy = y, y + h - 1 do
    for xx = x, x + w - 1 do
      if xx >= 0 and yy >= 0 and xx < W and yy < H then
        img:putPixel(xx, yy, c)
      end
    end
  end
end

-- ============ background: solid black ============
rect(0, 0, W, H, 1)

-- ============ Bayer-dither CRT glow, denser toward top ============
local B = {
  {0, 8, 2, 10},
  {12, 4, 14, 6},
  {3, 11, 1, 9},
  {15, 7, 13, 5},
}
for y = 0, H - 1 do
  local thr = 1 + math.floor((H - 1 - y) / 70) -- 3/16 top -> 1/16 bottom
  for x = 0, W - 1 do
    if B[(y % 4) + 1][(x % 4) + 1] < thr then
      img:putPixel(x, y, 2)
    end
  end
end

-- ============ HAKCD block letters ============
-- 5x7 glyph grid, cell 11x16 -> each letter 55x112. Strokes 11px min.
local F = {
  H = {"10001","10001","10001","11111","10001","10001","10001"},
  A = {"01110","10001","10001","11111","10001","10001","10001"},
  K = {"10001","10010","10100","11000","10100","10010","10001"},
  C = {"01111","10000","10000","10000","10000","10000","01111"},
  D = {"11110","10001","10001","10001","10001","10001","11110"},
}
local word = {"H", "A", "K", "C", "D"}
local cellW, cellH = 11, 16
local letW, letH = cellW * 5, cellH * 7   -- 55 x 112
local gap = 6
local xStart, yStart = 6, 16

for i = 1, 5 do
  local x0 = xStart + (i - 1) * (letW + gap)
  -- black halo strip so dither never fuzzes letter edges
  rect(x0 - 3, yStart - 3, letW + 6, letH + 6, 1)
  local g = F[word[i]]
  for r = 1, 7 do
    local row = g[r]
    for c = 1, 5 do
      if row:sub(c, c) == "1" then
        rect(x0 + (c - 1) * cellW, yStart + (r - 1) * cellH, cellW, cellH, 2)
      end
    end
  end
end

-- ============ dashed underline accent below letters ============
for x = 6, 291, 22 do
  rect(x, 136, 14, 4, 2)
end

-- ============ corner brackets, noir terminal frame ============
rect(3, 3, 14, 2, 2);   rect(3, 3, 2, 14, 2)       -- TL
rect(333, 3, 14, 2, 2); rect(345, 3, 2, 14, 2)     -- TR
rect(3, 150, 14, 2, 2); rect(3, 138, 2, 14, 2)     -- BL
rect(333, 150, 14, 2, 2); rect(345, 138, 2, 14, 2) -- BR

-- ============ fingerless glove icon, right side ============
-- 16x20 grid, 2x scale -> 32x40 at (314,58). '.'=bg black, W=white, D=checker dither
local GL = {
  "..WW.WW.WW.WW...",
  "..WW.WW.WW.WW...",
  "..WW.WW.WW.WW...",
  "..WWWWWWWWWWW...",
  "..WWWWWWWWWWWWW.",
  "..WWWWWWWWWWWWW.",
  "..WWWWWWWWWWWW..",
  "..WWWWWWWWWWWW..",
  "..WWDWWWWDWWWW..",
  "..WWWDWWWWDWWW..",
  "..WWWWWWWWWWW...",
  "..WWWWWWWWWWW...",
  "...WWWWWWWWW....",
  "...W.......W....",
  "...WWWWWWWWW....",
  "...WWWWWWWWW....",
  "...WDWDWDWDW....",
  "...WWWWWWWWW....",
  "................",
  "................",
}
-- clean black halo behind glove
rect(310, 54, 40, 44, 1)
local gx, gy = 314, 58
for r = 1, #GL do
  local s = GL[r]
  for c = 1, 16 do
    local ch = s:sub(c, c)
    local px = gx + (c - 1) * 2
    local py = gy + (r - 1) * 2
    if ch == "W" then
      rect(px, py, 2, 2, 2)
    elseif ch == "D" then
      for dy = 0, 1 do
        for dx = 0, 1 do
          if ((px + dx) + (py + dy)) % 2 == 0 then
            img:putPixel(px + dx, py + dy, 2)
          end
        end
      end
    end
  end
end

-- ============ flatten + save ============
spr:flatten()
local out = os.getenv("ASE_OUT_DIR")
spr:saveAs(app.fs.joinPath(out, "card.aseprite"))
spr:saveAs(app.fs.joinPath(out, "card.png"))
print("ASE_GEN_OK")