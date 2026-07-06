-- room_bedroom: 1998 hacker bedroom, 3/4 iso, HAKCD clean 1-bit
-- palette: 0=transparent 1=black 2=white
local sprite = Sprite(400, 240, ColorMode.INDEXED)
sprite.transparentColor = 0
local pal = Palette(3)
pal:setColor(0, Color{r=0, g=0, b=0, a=0})
pal:setColor(1, Color{r=0, g=0, b=0, a=255})
pal:setColor(2, Color{r=255, g=255, b=255, a=255})
sprite:setPalette(pal)

local cel = sprite.cels[1] or sprite:newCel(sprite.layers[1], 1)
local img = cel.image
local B, W = 1, 2

local function px(x, y, c)
  if x >= 0 and x < 400 and y >= 0 and y < 240 then img:putPixel(x, y, c) end
end
local function rect(x0, y0, x1, y1, c)
  for y = y0, y1 do for x = x0, x1 do px(x, y, c) end end
end
local function frameRect(x0, y0, x1, y1, c, t)
  rect(x0, y0, x1, y0 + t - 1, c); rect(x0, y1 - t + 1, x1, y1, c)
  rect(x0, y0, x0 + t - 1, y1, c); rect(x1 - t + 1, y0, x1, y1, c)
end
local function hline(x0, x1, y, c) for x = x0, x1 do px(x, y, c) end end
local function disc(cx, cy, r, c)
  for y = cy - r, cy + r do for x = cx - r, cx + r do
    local dx, dy = x - cx, y - cy
    if dx * dx + dy * dy <= r * r then px(x, y, c) end
  end end
end

-- iso geometry: left wall face left of diagonal (105,0)->(56,70)->(0,150)
local function wallBound(y) return math.floor((150 - y) * 0.7) end

-- moonbeam quad from window base spreading down-left onto floor
local function beamL(y) return 274 - (y - 72) * 0.6875 end
local function beamR(y) return 326 - (y - 72) * 0.53125 end
local function inBeam(x, y)
  if y < 72 or y > 136 then return false end
  return x >= beamL(y) and x <= beamR(y)
end

-- CRT glow ellipse (screen halo on wall + floor pool)
local function glowE(x, y)
  local dx, dy = (x - 77) / 48, (y - 90) / 40
  return dx * dx + dy * dy
end

-- ============ PASS 1: base walls + floor (fills entire canvas) ============
for y = 0, 239 do
  local xb = wallBound(y)
  for x = 0, 399 do
    local c = W
    local isLeftWall = (y < 150) and (x < xb)
    if isLeftWall then
      -- darker side wall: 50% checker = depth
      if (x + y) % 2 == 0 then c = B end
    elseif y < 70 then
      -- back wall: calm 25% stagger
      if (x + (y % 2) * 2) % 4 == 0 then c = B end
    else
      -- floor: white, sparing depth dither near walls only
      if y >= 232 then
        if (x + (y % 2) * 2) % 4 == 0 then c = B end -- foreground shade band
      elseif y <= 81 and (x + (y % 2) * 4) % 8 == 0 then c = B
      elseif y <= 95 and (x % 8 == 4 and y % 4 == 2) then c = B
      elseif y < 150 and (x - xb) < 10 and (x + (y % 2) * 4) % 8 == 0 then c = B
      end
      if c == B and inBeam(x, y) then c = W end -- moonlight clears floor dither
    end
    if c == B then
      local e = glowE(x, y)
      if e < 1.0 then c = W -- screen glow core: pure light
      elseif e < 1.9 and (x + (y % 2) * 4) % 8 ~= 0 then c = W end -- soft falloff ring
    end
    img:putPixel(x, y, c)
  end
end

-- baseboards + wall corner seam (strong silhouette lines)
for y = 70, 71 do hline(math.max(0, wallBound(y)), 399, y, B) end
for y = 70, 149 do
  local xb = wallBound(y)
  px(xb, y, B); px(xb + 1, y, B); px(xb + 2, y, B)
end
for y = 0, 69 do
  local xb = wallBound(y)
  px(xb, y, B); px(xb + 1, y, B)
end

-- ============ moonbeam edges + blind-slat shadows ============
for y = 72, 126 do
  if y <= 100 or y % 3 < 2 then -- dashed fade toward room
    px(math.floor(beamL(y) + 0.5), y, B)
    px(math.floor(beamR(y) + 0.5), y, B)
  end
end
for _, sy in ipairs({92, 106, 120}) do
  local lx = math.floor(beamL(sy)) + 4
  local rx = math.floor(beamR(sy)) - 4
  for x = lx, rx do if x % 4 < 3 then px(x, sy, B) end end
end

-- ============ window: blinds glowing, moon in slat gaps ============
rect(266, 4, 334, 62, B)   -- outer frame
rect(268, 6, 332, 60, W)   -- inner frame
rect(274, 12, 326, 54, B)  -- night
disc(312, 22, 7, W)        -- moon
for i = 0, 5 do
  local sy = 14 + i * 7
  rect(276, sy, 324, sy + 2, W) -- slats; moon glows through gaps
end

-- ============ poster: glider emblem ============
rect(152, 12, 190, 52, W)
frameRect(152, 12, 190, 52, B, 2)
for _, g in ipairs({{1,0},{2,1},{0,2},{1,2},{2,2}}) do
  rect(160 + g[1] * 8, 20 + g[2] * 8, 165 + g[1] * 8, 25 + g[2] * 8, B)
end

-- ============ FOCAL: desk against left wall ============
rect(40, 94, 114, 168, W)          -- desktop
frameRect(40, 94, 114, 168, B, 2)
rect(114, 98, 119, 172, B)         -- side thickness
rect(40, 168, 114, 174, B)         -- front edge
rect(42, 174, 48, 184, B)          -- legs
rect(106, 174, 113, 184, B)
for y = 176, 190 do for x = 46, 118 do
  if (x + y) % 2 == 0 then px(x, y, B) end -- under-desk shadow
end end

-- CRT monitor, glowing screen
rect(52, 84, 102, 130, B)
px(52, 84, W); px(102, 84, W); px(52, 130, W); px(102, 130, W) -- round corners
rect(60, 92, 94, 120, W)   -- screen
px(60, 92, B); px(94, 92, B); px(60, 120, B); px(94, 120, B)
hline(64, 86, 96, B);  hline(64, 86, 97, B)   -- terminal text
hline(64, 78, 101, B); hline(64, 78, 102, B)
hline(64, 90, 106, B); hline(64, 90, 107, B)
hline(64, 72, 111, B); hline(64, 72, 112, B)
rect(76, 110, 79, 114, B)                     -- cursor block
rect(96, 123, 97, 124, W)                     -- power LED
rect(70, 130, 84, 136, B)                     -- stand
rect(64, 134, 90, 137, B)

-- keyboard + mouse
rect(56, 140, 98, 152, W)
frameRect(56, 140, 98, 152, B, 1)
for ky = 143, 149, 3 do for kx = 59, 95, 3 do px(kx, ky, B) end end
rect(103, 141, 108, 148, W)
frameRect(103, 141, 108, 148, B, 1)

-- tower PC on floor beside desk
rect(46, 194, 78, 234, B)
hline(48, 76, 197, W)              -- top bevel
rect(52, 202, 72, 204, W)          -- CD bay
rect(52, 208, 72, 210, W)          -- floppy bay
rect(58, 220, 65, 223, W)          -- power button
rect(50, 227, 51, 228, W)          -- LED
for y = 200, 236 do for x = 79, 84 do
  if (x + y) % 2 == 0 then px(x, y, B) end
end end

-- ============ bed at right, bleeding off canvas ============
for y = 126, 228 do for x = 308, 317 do
  if (x + y) % 2 == 0 then px(x, y, B) end -- floor shadow
end end
rect(314, 102, 399, 118, B)        -- headboard
rect(318, 118, 399, 228, W)        -- mattress
rect(318, 118, 319, 228, B)        -- left outline
rect(328, 126, 390, 146, W)        -- pillow
frameRect(328, 126, 390, 146, B, 1)
px(328, 126, W); px(390, 126, W); px(328, 146, W); px(390, 146, W)
rect(320, 158, 399, 160, B)        -- blanket fold edge
for y = 164, 216 do for x = 324, 399 do
  if x % 9 == 3 and y % 9 == 5 then px(x, y, B) end -- sparse fabric
end end
rect(314, 222, 399, 232, B)        -- footboard

-- ============ save ============
sprite:flatten()
local out = os.getenv("ASE_OUT_DIR")
sprite:saveAs(app.fs.joinPath(out, "room_bedroom.aseprite"))
sprite:saveAs(app.fs.joinPath(out, "room_bedroom.png"))
print("ASE_GEN_OK")