-- portrait_newb — 64x64 1-bit dialogue portrait, HAKCD house style
-- scrawny 17yo hacker, hood up, headphones round neck, wary smirk

local W, H = 64, 64
local BLACK, WHITE = 1, 2

local spr = Sprite(W, H, ColorMode.INDEXED)
spr.transparentColor = 0

local pal = Palette(3)
pal:setColor(0, Color{r=0,   g=0,   b=0,   a=0})
pal:setColor(1, Color{r=0,   g=0,   b=0,   a=255})
pal:setColor(2, Color{r=255, g=255, b=255, a=255})
spr:setPalette(pal)

-- frame 1 cel (fallback if the fresh sprite already owns one)
local ok, cel = pcall(function() return spr:newCel(spr.layers[1], 1) end)
if not ok or cel == nil then cel = spr.cels[1] end
local img = cel.image

-- 8x8 Bayer matrix: the shading engine. b in [0,1] -> white dot density.
local B8 = {
  { 0,32, 8,40, 2,34,10,42},
  {48,16,56,24,50,18,58,26},
  {12,44, 4,36,14,46, 6,38},
  {60,28,52,20,62,30,54,22},
  { 3,35,11,43, 1,33, 9,41},
  {51,19,59,27,49,17,57,25},
  {15,47, 7,39,13,45, 5,37},
  {63,31,55,23,61,29,53,21},
}

local function P(x, y, c)
  x = math.floor(x); y = math.floor(y)
  if x >= 0 and x < W and y >= 0 and y < H then img:putPixel(x, y, c) end
end

local function D(x, y, b)
  if b < 0 then b = 0 elseif b > 1 then b = 1 end
  local xi, yi = math.floor(x), math.floor(y)
  if b * 63.9 > B8[(yi % 8) + 1][(xi % 8) + 1] then P(xi, yi, WHITE)
  else P(xi, yi, BLACK) end
end

-- dashed quadratic bezier, for fold creases and seams
local function q(x0, y0, x1, y1, x2, y2, col, m)
  for i = 0, 28 do
    local t = i / 28
    local u = 1 - t
    local px = u*u*x0 + 2*u*t*x1 + t*t*x2
    local py = u*u*y0 + 2*u*t*y1 + t*t*y2
    if m == 0 or i % m ~= 0 then P(px, py, col) end
  end
end

------------------------------------------------------------------
-- PASS 1: full-canvas per-pixel regions (edge to edge, no index 0)
------------------------------------------------------------------
for y = 0, H - 1 do
  for x = 0, W - 1 do
    local b
    local fx, fy = (x - 32) / 6.5, (y - 25) / 9.5     -- face oval
    local face   = fx*fx + fy*fy <= 1
    local ox, oy = (x - 32) / 8.5, (y - 25) / 10.5    -- hood opening
    local open   = ox*ox + oy*oy <= 1
    local ddx, ddy = x - 32, y - 21                   -- hood dome
    local dome   = ddx*ddx + ddy*ddy <= 289
    local hw = -1
    if y >= 36 then
      hw = 9 + (y - 36) * 1.05
      if hw > 27 then hw = 27 end
    end
    local body = hw >= 0 and math.abs(x - 32) <= hw   -- draped shoulders
    local neck = y >= 35 and y <= 43 and x >= 29 and x <= 35

    if face then
      -- skin volume: sphere falloff, lit from viewer-left
      b = 0.95
      if x > 34 then b = b - (x - 34) * 0.16 end        -- core shadow right
      b = b - (fx*fx + fy*fy) * 0.22                    -- edge falloff
      if y < 20 then b = b - (20 - y) * 0.10 end        -- hood casts on brow
      if y > 32 then b = b - (y - 32) * 0.10 end        -- jaw shadow
      local c1 = (x-29)*(x-29) + (y-29)*(y-29)          -- gaunt cheek hollows
      local c2 = (x-36)*(x-36) + (y-29)*(y-29)
      if c1 <= 3 then b = b - 0.20 end
      if c2 <= 3 then b = b - 0.24 end
      if b < 0.08 then b = 0.08 end
      D(x, y, b)
    elseif neck then
      -- scrawny 7px neck, heavy shadow under chin
      if y <= 37 then b = 0.16 elseif y <= 39 then b = 0.38 else b = 0.55 end
      if x >= 34 then b = b - 0.18 end
      if x == 29 or x == 35 then b = b - 0.22 end       -- rounded sides
      if x == 32 and y == 39 then b = b - 0.30 end      -- adam's apple
      if b < 0.03 then b = 0.03 end
      D(x, y, b)
    elseif open then
      -- hood interior: near-solid shadow ring around the face
      b = 0.03
      if x < 25 then b = 0.10 end
      D(x, y, b)
    elseif dome then
      -- hood fabric: lambert dither, light upper-left
      local nx, ny = ddx / 17, ddy / 17
      local l = -nx * 0.55 - ny * 0.83
      if l < 0 then l = 0 end
      D(x, y, 0.04 + 0.26 * l)
    elseif body then
      -- hoodie chest/shoulders, lit left, near-black right
      b = 0.15 - (y - 40) * 0.004
      if x > 32 then b = b - (x - 32) * 0.006
      else b = b + (32 - x) * 0.002 end
      if b < 0.02 then b = 0.02 end
      if b > 0.30 then b = 0.30 end
      D(x, y, b)
    else
      -- background: CRT glow halo behind the head, scanline flicker
      local gx, gy = x - 32, y - 18
      local d = math.sqrt(gx*gx + gy*gy)
      b = 0.75 - d * 0.020
      if y % 2 == 0 then b = b * 1.15 else b = b * 0.85 end
      if b < 0.03 then b = 0.03 end
      D(x, y, b)
    end
  end
end

------------------------------------------------------------------
-- PASS 2: hood structure
------------------------------------------------------------------
-- apex bump
P(30,3,BLACK) P(31,3,BLACK) P(32,3,BLACK) P(33,3,BLACK)
P(31,2,BLACK) P(32,2,BLACK) P(30,2,WHITE)

-- 2px rim light along upper-left dome edge, tapering near apex
for t = 3.35, 5.0, 0.02 do
  local c, s = math.cos(t), math.sin(t)
  P(32 + 16.7*c, 21 + 16.7*s, WHITE)
  if t < 4.6 then P(32 + 15.7*c, 21 + 15.7*s, WHITE) end
end

-- lit fabric edge of the hood opening (left/top)
for t = 2.75, 4.85, 0.02 do
  local c, s = math.cos(t), math.sin(t)
  P(32 + 8.9*c, 25 + 10.9*s, WHITE)
  if t > 3.1 and t < 4.5 then P(32 + 9.7*c, 25 + 11.7*s, WHITE) end
end

-- fold creases: dashed highlights over the fabric dither
q(26, 7, 19, 14, 17, 26, WHITE, 3)   -- big left fold
q(38, 7, 45, 14, 46, 27, WHITE, 2)   -- shadow-side fold, sparser
q(24, 14, 22, 22, 24, 31, WHITE, 3)  -- inner fold echoing the opening
q(32, 3, 34, 8, 33, 13, WHITE, 2)    -- apex seam
q(19, 40, 14, 50, 12, 60, WHITE, 3)  -- left chest drape
q(45, 40, 50, 50, 52, 60, WHITE, 2)  -- right chest drape
q(13, 47, 10, 54, 9, 63, WHITE, 2)   -- left arm seam
q(51, 47, 54, 54, 55, 63, WHITE, 2)  -- right arm seam

-- shoulder rim light along silhouette
for yy = 37, 54 do
  local hw = 9 + (yy - 36) * 1.05
  if hw > 27 then hw = 27 end
  P(32 - hw, yy, WHITE)
  if yy % 2 == 0 then P(32 - hw + 1, yy, WHITE) end
  if yy % 2 == 1 then P(32 + hw, yy, WHITE) end
end

------------------------------------------------------------------
-- PASS 3: face features
------------------------------------------------------------------
-- stray hair wisps under the hood rim
P(30,16,BLACK) P(30,17,BLACK) P(29,18,BLACK) P(29,19,BLACK)
P(32,16,BLACK) P(32,17,BLACK) P(33,18,BLACK)
P(34,16,BLACK) P(34,17,BLACK) P(35,18,BLACK) P(35,19,BLACK)

-- brows: left flat, right raised (skeptical)
P(27,21,BLACK) P(28,21,BLACK) P(29,21,BLACK) P(30,21,BLACK)
P(34,21,BLACK) P(35,20,BLACK) P(36,20,BLACK) P(37,20,BLACK)
P(34,18,BLACK) P(36,18,BLACK)                 -- forehead crease over raised brow

-- half-lidded eyes, pupils flicked sideways = wary side-glance
P(27,23,BLACK) P(28,23,BLACK) P(29,23,BLACK) P(29,24,BLACK)
P(35,23,BLACK) P(36,23,BLACK) P(37,23,BLACK) P(37,24,BLACK)
P(28,25,BLACK) P(36,25,BLACK)                 -- tired under-eye bags

-- nose shadow
P(33,26,BLACK) P(33,27,BLACK) P(32,28,BLACK)

-- faint smirk: line rides up on the right
P(29,32,BLACK) P(30,32,BLACK) P(31,32,BLACK) P(32,32,BLACK) P(33,32,BLACK)
P(34,31,BLACK) P(35,31,BLACK) P(36,30,BLACK)
P(31,33,BLACK) P(33,33,BLACK)                 -- under-lip shading

------------------------------------------------------------------
-- PASS 4: headphones slung round the neck
------------------------------------------------------------------
-- band curves across the throat base, white-edged so it reads on black
for x = 20, 44 do
  local yb = 41 + 0.045 * (x - 32) * (x - 32)
  P(x, yb - 1, WHITE)
  P(x, yb,     BLACK)
  P(x, yb + 1, BLACK)
  P(x, yb + 2, BLACK)
  if x % 2 == 0 then P(x, yb + 3, WHITE) end
end

-- ear cups over the band ends
local function cup(cx)
  for yy = -5, 5 do
    for xx = -4, 4 do
      local ex, ey = xx / 3.4, yy / 4.3
      if ex*ex + ey*ey <= 1 then P(cx + xx, 48 + yy, BLACK) end
    end
  end
  for t = 0, 6.3, 0.09 do
    P(cx + 3.4 * math.cos(t), 48 + 4.3 * math.sin(t), WHITE)
  end
  P(cx - 2, 45, WHITE) P(cx - 1, 45, WHITE) P(cx - 2, 46, WHITE) -- glint
  for xx = -2, 2 do if xx % 2 == 0 then P(cx + xx, 48, WHITE) end end -- seam
end
cup(21)
cup(43)

------------------------------------------------------------------
-- PASS 5: hoodie drawstrings, uneven lengths
------------------------------------------------------------------
for yy = 45, 57 do
  P(29 - ((yy >= 53) and 1 or 0), yy, WHITE)
end
for yy = 45, 54 do
  P(35 + ((yy >= 51) and 1 or 0), yy, WHITE)
end
P(28,58,WHITE) P(29,58,WHITE) P(28,59,WHITE) P(29,59,WHITE)
P(28,60,WHITE) P(29,60,WHITE)                                  -- left aglet
P(36,55,WHITE) P(37,55,WHITE) P(36,56,WHITE) P(37,56,WHITE)
P(36,57,WHITE)                                                 -- right aglet

------------------------------------------------------------------
-- flatten + save (single flat image, no sheet export)
------------------------------------------------------------------
spr:flatten()
local out = os.getenv("ASE_OUT_DIR")
spr:saveAs(app.fs.joinPath(out, "portrait_newb.aseprite"))
spr:saveAs(app.fs.joinPath(out, "portrait_newb.png"))
print("ASE_GEN_OK")