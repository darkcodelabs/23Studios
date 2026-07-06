-- scene_bbs: bulbous MARIO-64-style CRT monitor, head-on, 400x240 1-bit
local spr = Sprite(400, 240, ColorMode.INDEXED)
spr.transparentColor = 0

local pal = Palette(3)
pal:setColor(0, Color{r=0,   g=0,   b=0,   a=0})
pal:setColor(1, Color{r=0,   g=0,   b=0,   a=255})
pal:setColor(2, Color{r=255, g=255, b=255, a=255})
spr:setPalette(pal)

local cel = spr.cels[1] or spr:newCel(spr.layers[1], 1)
local img = cel.image

-- Bayer 4x4 dither matrix
local B = {
  {0, 8, 2, 10},
  {12, 4, 14, 6},
  {3, 11, 1, 9},
  {15, 7, 13, 5},
}

local abs, sqrt, floor = math.abs, math.sqrt, math.floor

-- Outer body: superellipse (squircle) centered (200,120), radii 198x118, exp 4.
-- Inner (shrunk) superellipse defines the 2-3px black contour band.
-- Screen glass: rounded rect x40-360, y30-210, corner radius 14 (SDF).
local fxo, fxi, dxs = {}, {}, {}
for x = 0, 399 do
  local d = abs(x - 200)
  local o = d / 198; fxo[x] = o * o * o * o
  local i = d / 195; fxi[x] = i * i * i * i
  dxs[x] = d - 146 -- halfW 160 - radius 14
end

for y = 0, 239 do
  local brow = B[y % 4 + 1]
  local dy  = abs(y - 120)
  local o = dy / 118; local fyo = o * o * o * o
  local i = dy / 115; local fyi = i * i * i * i
  local dysv = dy - 76 -- halfH 90 - radius 14
  local ldy  = (120 - y) / 120
  local scan = (y % 3 == 2)
  local soff = (floor(y / 3) * 2) % 6
  for x = 0, 399 do
    local idx = 1
    local f = fxo[x] + fyo
    if f > 1 then
      -- background corners behind monitor: sparse dark dither for depth
      if 1.6 > brow[x % 4 + 1] + 0.5 then idx = 2 end
    elseif fxi[x] + fyi > 1 then
      idx = 1 -- bold outer silhouette contour
    else
      -- signed distance to screen rounded rect
      local dxv = dxs[x]
      local ax = dxv > 0 and dxv or 0
      local ay = dysv > 0 and dysv or 0
      local m = dxv > dysv and dxv or dysv
      if m > 0 then m = 0 end
      local sd = sqrt(ax * ax + ay * ay) + m - 14
      if sd < 0 then
        -- inner screen: dark glass, faint diagonal-shifted scanline dots
        if sd < -6 and scan and (x + soff) % 6 == 0 then idx = 2 end
      elseif sd < 3 then
        idx = 1 -- black groove where glass seats into bezel
      else
        -- bezel plastic: dither gradient volume, key light upper-left
        local ld = ((200 - x) / 200 + ldy) * 0.5
        local v = 0.56 + 0.36 * ld
        local din = sd - 3
        if din < 7 then v = v - (7 - din) * 0.05 end -- AO around screen recess
        local ridge = 1 - abs(f - 0.55) * 5          -- rounded ridge highlight
        if ridge > 0 and ld > 0 then v = v + 0.14 * ridge * ld end
        if f > 0.62 then                              -- curvature rolloff to edge
          v = v - (f - 0.62) * 1.6 * (0.55 - 0.45 * ld)
        end
        if v < 0.03 then v = 0.03 elseif v > 0.97 then v = 0.97 end
        if v * 16 > brow[x % 4 + 1] + 0.5 then idx = 2 end
      end
    end
    img:putPixel(x, y, idx)
  end
end

-- glass glints: two short checker diagonals, top-right corner of screen
for i = 0, 9 do
  local gx, gy = 336 + i, 38 + i
  for w = 0, 2 do
    if (gx + w + gy) % 2 == 0 then img:putPixel(gx + w, gy, 2) end
  end
end
for i = 0, 5 do
  local gx, gy = 350 + i, 36 + i
  for w = 0, 1 do
    if (gx + w + gy) % 2 == 0 then img:putPixel(gx + w, gy, 2) end
  end
end

-- blinking cursor block, upper-left of terminal area
for yy = 40, 53 do
  for xx = 52, 61 do img:putPixel(xx, yy, 2) end
end

-- vent slots, bottom-left bezel (white emboss edge + black slot)
for i = 0, 2 do
  local x0 = 62 + i * 10
  for yy = 218, 226 do
    img:putPixel(x0 - 1, yy, 2)
    img:putPixel(x0, yy, 1)
    img:putPixel(x0 + 1, yy, 1)
  end
end

-- recessed brand plate, bottom center
for xx = 178, 222 do
  img:putPixel(xx, 219, 1)
  img:putPixel(xx, 227, 1)
end
for yy = 219, 227 do
  img:putPixel(178, yy, 1)
  img:putPixel(222, yy, 1)
end
for yy = 220, 226 do
  for xx = 179, 221 do
    if (xx + yy * 2) % 4 == 0 then img:putPixel(xx, yy, 2)
    else img:putPixel(xx, yy, 1) end
  end
end
for xx = 186, 214, 4 do -- tiny logo glint row
  img:putPixel(xx, 223, 2)
  img:putPixel(xx + 1, 223, 2)
end

-- chunky domed power button, bottom-right bezel
for dyv = -5, 5 do
  for dxv = -5, 5 do
    local d2 = dxv * dxv + dyv * dyv
    if d2 <= 25 then
      local xx, yy = 340 + dxv, 222 + dyv
      if d2 >= 17 then
        img:putPixel(xx, yy, 1)
      else
        local v = 0.85 - 0.07 * (dxv + dyv) - d2 * 0.008
        if v * 16 > B[yy % 4 + 1][xx % 4 + 1] + 0.5 then
          img:putPixel(xx, yy, 2)
        else
          img:putPixel(xx, yy, 1)
        end
      end
    end
  end
end

-- power LED: black ring, white core
for dyv = -2, 2 do
  for dxv = -2, 2 do
    if dxv * dxv + dyv * dyv <= 5 then img:putPixel(318 + dxv, 222 + dyv, 1) end
  end
end
img:putPixel(317, 221, 2)
img:putPixel(318, 221, 2)
img:putPixel(317, 222, 2)
img:putPixel(318, 222, 2)

spr:flatten()
local out = os.getenv("ASE_OUT_DIR")
spr:saveAs(app.fs.joinPath(out, "scene_bbs.aseprite"))
spr:saveAs(app.fs.joinPath(out, "scene_bbs.png"))
print("ASE_GEN_OK")