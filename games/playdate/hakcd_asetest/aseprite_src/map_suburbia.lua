-- map_suburbia.lua — MARIO-64 style suburban hub map, 1-bit Playdate, 400x240
-- Dither-gradient volumetric shading, key light upper-left.

local W, H = 400, 240

local sp = Sprite(W, H, ColorMode.INDEXED)
sp.transparentColor = 0
local pal = Palette(3)
pal:setColor(0, Color{r=0,   g=0,   b=0,   a=0})
pal:setColor(1, Color{r=0,   g=0,   b=0,   a=255})
pal:setColor(2, Color{r=255, g=255, b=255, a=255})
sp:setPalette(pal)

local cel = sp.cels[1]
if cel == nil then cel = sp:newCel(sp.layers[1], 1) end
local img = cel.image

-- ---------------------------------------------------------------- primitives
local BAYER = {
  {0, 8, 2, 10},
  {12, 4, 14, 6},
  {3, 11, 1, 9},
  {15, 7, 13, 5},
}

local function px(x, y, c)
  x = math.floor(x); y = math.floor(y)
  if x >= 0 and x < W and y >= 0 and y < H then img:putPixel(x, y, c) end
end

-- level 0 = pure white .. 16 = pure black, ordered-dithered
local function dpx(x, y, level)
  if level <= 0 then px(x, y, 2) return end
  if level >= 16 then px(x, y, 1) return end
  local xi, yi = math.floor(x), math.floor(y)
  if BAYER[(yi % 4) + 1][(xi % 4) + 1] < level then px(xi, yi, 1) else px(xi, yi, 2) end
end

local function rect(x0, y0, x1, y1, c)
  for y = y0, y1 do for x = x0, x1 do px(x, y, c) end end
end

local function drect(x0, y0, x1, y1, level)
  for y = y0, y1 do for x = x0, x1 do dpx(x, y, level) end end
end

local function disc(cx, cy, r, mode) -- mode 1=black, 2=road dither
  for y = math.floor(cy - r), math.ceil(cy + r) do
    for x = math.floor(cx - r), math.ceil(cx + r) do
      local dx, dy = x - cx, y - cy
      if dx*dx + dy*dy <= r*r then
        if mode == 1 then px(x, y, 1) else dpx(x, y, 1) end
      end
    end
  end
end

-- volumetric shaded ellipse "ball": light upper-left, dark lower-right rim
local function ball(cx, cy, rx, ry, lo, hi, outline)
  for y = math.floor(cy - ry - 3), math.ceil(cy + ry + 3) do
    for x = math.floor(cx - rx - 3), math.ceil(cx + rx + 3) do
      local dx, dy = (x - cx) / rx, (y - cy) / ry
      local d = dx*dx + dy*dy
      if d <= 1 then
        local t = (dx + dy) * 0.45 + d * 0.45 + 0.32
        if t < 0 then t = 0 elseif t > 1 then t = 1 end
        dpx(x, y, math.floor(lo + (hi - lo) * t + 0.5))
      elseif outline then
        local ox, oy = (x - cx) / (rx + 2.4), (y - cy) / (ry + 2.4)
        if ox*ox + oy*oy <= 1 then px(x, y, 1) end
      end
    end
  end
end

-- rounded rect, 2px black outline, diagonal dither gradient (UL light)
local function rrect(x0, y0, x1, y1, r, lo, hi)
  local function inside(x, y, ins)
    local a, b, c, d = x0 + ins, y0 + ins, x1 - ins, y1 - ins
    if x < a or x > c or y < b or y > d then return false end
    local rr = r - ins; if rr < 0 then rr = 0 end
    local qx = x; if x < a + rr then qx = a + rr elseif x > c - rr then qx = c - rr end
    local qy = y; if y < b + rr then qy = b + rr elseif y > d - rr then qy = d - rr end
    local ddx, ddy = x - qx, y - qy
    return ddx*ddx + ddy*ddy <= rr*rr
  end
  for y = y0, y1 do
    for x = x0, x1 do
      if inside(x, y, 0) then
        if inside(x, y, 2) then
          local t = ((x - x0) / (x1 - x0) + (y - y0) / (y1 - y0)) * 0.5
          dpx(x, y, math.floor(lo + (hi - lo) * t + 0.5))
        else
          px(x, y, 1)
        end
      end
    end
  end
end

local function shadowBlob(cx, cy, rx, ry, level)
  for y = math.floor(cy - ry), math.ceil(cy + ry) do
    for x = math.floor(cx - rx), math.ceil(cx + rx) do
      local dx, dy = (x - cx) / rx, (y - cy) / ry
      local d = dx*dx + dy*dy
      if d <= 1 then dpx(x, y, math.floor(level - d * 4)) end
    end
  end
end

-- tiny 3x5 pixel font
local GLY = {
  B = {"##.", "#.#", "##.", "#.#", "##."},
  U = {"#.#", "#.#", "#.#", "#.#", "###"},
  S = {".##", "#..", ".#.", "..#", "##."},
  T = {"###", ".#.", ".#.", ".#.", ".#."},
  E = {"###", "#..", "##.", "#..", "###"},
  L = {"#..", "#..", "#..", "#..", "###"},
}
local function text(s, x, y, sc)
  for i = 1, #s do
    local g = GLY[s:sub(i, i)]
    for r = 1, 5 do
      local row = g[r]
      for c = 1, 3 do
        if row:sub(c, c) == "#" then
          rect(x + (c - 1) * sc, y + (r - 1) * sc, x + c * sc - 1, y + r * sc - 1, 1)
        end
      end
    end
    x = x + 4 * sc
  end
end

-- ---------------------------------------------------- 1. floating island + space
-- superellipse island: rounder corners than plain ellipse (n=4)
local CX, CY, RX, RY = 200, 126, 184, 100
local function islandD(x, y)
  local dx, dy = (x - CX) / RX, (y - CY) / RY
  local dx2, dy2 = dx * dx, dy * dy
  return dx2 * dx2 + dy2 * dy2, dy, dx
end

for y = 0, H - 1 do
  for x = 0, W - 1 do
    local d, dy, dx = islandD(x, y)
    if d <= 1 then
      -- grass top: gentle UL-lit gradient + dark under-rim AO (heavier at bottom = round underside)
      local lvl = 2.2 + dy * 1.6 + dx * 0.8
      if d > 0.5 then
        local rim = (d - 0.5) * 2
        lvl = lvl + rim * rim * ((dy > 0) and 13 or 3)
      end
      dpx(x, y, math.floor(math.max(0, math.min(16, lvl)) + 0.5))
    else
      local ox, oy = (x - CX) / (RX + 3), (y - CY) / (RY + 3)
      local o2x, o2y = ox * ox, oy * oy
      if o2x * o2x + o2y * o2y <= 1 then
        px(x, y, 1)                        -- bold island contour
      else
        -- soft dither space: white halo hugging island, dots thicken outward
        local lvl = math.min(6, (d - 1) * 4)
        dpx(x, y, math.floor(math.max(0, lvl)))
      end
    end
  end
end

-- sparkle stars floating in space
local STARS = {{18,14},{44,24},{10,64},{382,18},{394,52},{368,34},{12,196},{28,220},
               {386,208},{372,226},{204,6},{120,8},{298,8},{56,232},{344,230}}
for _, s in ipairs(STARS) do
  local x, y = s[1], s[2]
  rect(x - 2, y, x + 2, y, 1)
  rect(x, y - 2, x, y + 2, 1)
end

-- grass tufts (deterministic scatter, only on flat inner grass)
for gy = 36, 214, 13 do
  for gx = 24, 384, 17 do
    local x = gx + (gx * 7 + gy * 13) % 9
    local y = gy + (gx * 5 + gy * 3) % 7
    local d = islandD(x, y)
    if d < 0.42 then
      px(x, y, 1); px(x + 1, y, 1); px(x + 2, y - 1, 1)
    end
  end
end

-- ------------------------------------------------------------- 2. grassy mounds
ball(145, 98, 38, 20, 0, 8, true)
ball(258, 90, 30, 16, 0, 8, true)
ball(75, 182, 26, 14, 0, 9, true)
ball(300, 198, 32, 15, 0, 9, true)

-- ------------------------------------------------------- 3. fat winding road
local RP = {{148,222},{165,196},{195,172},{230,156},{268,146},{305,143},{338,149}}
local pts = {}
for i = 1, #RP - 1 do
  local a, b = RP[i], RP[i + 1]
  for s = 0, 23 do
    local t = s / 24
    pts[#pts + 1] = {a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t}
  end
end
for _, p in ipairs(pts) do disc(p[1], p[2], 15, 1) end   -- 3px black edging
for _, p in ipairs(pts) do disc(p[1], p[2], 12, 2) end   -- pale asphalt fill
for i, p in ipairs(pts) do                               -- dashed centerline
  if i % 16 < 7 then
    rect(math.floor(p[1]) - 1, math.floor(p[2]) - 1, math.floor(p[1]) + 1, math.floor(p[2]) + 1, 1)
  end
end

-- ------------------------------------------------- 4. glowing travel node pads
local function node(cx, cy)
  for y = cy - 17, cy + 17 do
    for x = cx - 17, cx + 17 do
      local dx, dy = x - cx, y - cy
      local r = math.sqrt(dx * dx + dy * dy)
      if r <= 16 then
        if r > 13 then dpx(x, y, math.floor((16 - r) * 1.6))  -- energy fizz fading out
        elseif r > 11 then px(x, y, 2)                        -- bright halo
        elseif r > 9 then px(x, y, 1)                         -- bold ring
        elseif r > 7 then px(x, y, 2)
        elseif r > 5 then dpx(x, y, 5)                        -- inner shimmer
        else px(x, y, 2) end
      end
    end
  end
  for a = -3, 3 do                                            -- center diamond
    local w = 3 - math.abs(a)
    rect(cx - w, cy + a, cx + w, cy + a, 1)
  end
end
node(168, 194)
node(240, 153)
node(322, 146)

-- ---------------------------------------------- 5. bulbous two-story house (UL)
shadowBlob(84, 130, 52, 7, 8)
-- stepping stones from door toward road
ball(100, 136, 5, 3, 0, 2, true)
ball(113, 150, 5, 3, 0, 2, true)
ball(126, 164, 5, 3, 0, 2, true)
ball(138, 178, 5, 3, 0, 2, true)
rrect(96, 24, 108, 44, 3, 2, 7)          -- chimney (pokes above roof)
ball(82, 52, 42, 17, 1, 10, true)        -- big mushroom-cap dome roof
rrect(48, 56, 114, 92, 10, 0, 6)         -- upper story
rrect(40, 86, 124, 128, 10, 0, 7)        -- fatter lower story
local function windowSq(x, y)
  rrect(x, y, x + 14, y + 14, 3, 0, 1)
  rect(x + 7, y + 2, x + 8, y + 12, 1)
  rect(x + 2, y + 7, x + 12, y + 8, 1)
end
windowSq(58, 62); windowSq(88, 62)       -- upper windows
windowSq(46, 94); windowSq(100, 94)      -- lower windows
rrect(72, 102, 92, 128, 8, 9, 13)        -- rounded dark doorway
rect(87, 114, 88, 115, 2)                -- knob

-- --------------------------------------- 6. Greyhound depot + payphone (right)
shadowBlob(326, 152, 54, 7, 8)
ball(326, 94, 50, 13, 2, 10, true)       -- rounded awning dome
rrect(280, 96, 372, 150, 12, 0, 6)       -- depot body
rrect(302, 114, 342, 150, 10, 11, 14)    -- dark bus bay opening
ball(291, 105, 5, 4, 0, 2, true)         -- porthole windows
ball(361, 105, 5, 4, 0, 2, true)
rect(312, 78, 315, 96, 1)                -- sign posts
rect(337, 78, 340, 96, 1)
rrect(302, 60, 350, 82, 11, 0, 1)        -- BUS capsule sign
text("BUS", 315, 66, 2)
-- payphone sign out front
rect(352, 146, 355, 178, 1)              -- pole
shadowBlob(354, 179, 8, 3, 9)
rrect(340, 120, 368, 146, 6, 0, 1)       -- sign board
rect(348, 128, 361, 131, 1)              -- handset bar
disc(348, 132, 3, 1)
disc(361, 132, 3, 1)
text("TEL", 349, 137, 1)

-- ----------------------------------------------------------- 7. puffy trees
local function tree(cx, cy)
  shadowBlob(cx + 3, cy + 3, 15, 5, 9)
  rect(cx - 2, cy - 12, cx + 1, cy, 1)             -- trunk
  ball(cx + 7, cy - 19, 9, 8, 3, 11, true)         -- back puff (darker)
  ball(cx - 1, cy - 23, 14, 12, 1, 9, true)        -- main puff
  ball(cx - 6, cy - 27, 6, 5, 0, 2, false)         -- UL highlight puff
end
tree(152, 96)      -- on mound A
tree(262, 84)      -- on mound B
tree(52, 155)
tree(215, 210)
tree(296, 196)     -- on mound D

-- ----------------------------------------------------------- 8. stubby cars
local function car(cx, cy)
  shadowBlob(cx + 2, cy + 10, 17, 4, 9)
  rrect(cx - 8, cy - 12, cx + 7, cy - 1, 5, 0, 4)  -- cabin
  drect(cx - 5, cy - 9, cx + 3, cy - 5, 9)         -- glass
  rrect(cx - 14, cy - 4, cx + 14, cy + 7, 5, 0, 7) -- rounded body
  rect(cx + 11, cy - 1, cx + 12, cy, 2)            -- headlight
  disc(cx - 8, cy + 7, 3.4, 1)
  disc(cx + 8, cy + 7, 3.4, 1)
  px(cx - 8, cy + 6, 2)                            -- hub glints
  px(cx + 8, cy + 6, 2)
end
car(206, 165)
car(287, 143)

-- ------------------------------------------------------------------- export
sp:flatten()
local out = os.getenv("ASE_OUT_DIR")
sp:saveAs(app.fs.joinPath(out, "map_suburbia.aseprite"))
sp:saveAs(app.fs.joinPath(out, "map_suburbia.png"))
print("ASE_GEN_OK")