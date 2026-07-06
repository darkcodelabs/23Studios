-- room_bedroom.png — MARIO-64 style isometric 1998 hacker-den bedroom hub
-- 400x240, strict 1-bit (0=transparent,1=black,2=white), Bayer-dither shading

local sprite = Sprite(400, 240, ColorMode.INDEXED)
sprite.transparentColor = 0
local pal = Palette(3)
pal:setColor(0, Color{r=0,   g=0,   b=0,   a=0})
pal:setColor(1, Color{r=0,   g=0,   b=0,   a=255})
pal:setColor(2, Color{r=255, g=255, b=255, a=255})
sprite:setPalette(pal)

local cel = sprite.cels[1] or sprite:newCel(sprite.layers[1], 1)
local img = cel.image

-- ---------- core helpers ----------
local B = {{0,8,2,10},{12,4,14,6},{3,11,1,9},{15,7,13,5}}
local function D(x, y, t)
  return ((B[y % 4 + 1][x % 4 + 1] + 0.5) / 16 < t) and 2 or 1
end
local function put(x, y, c)
  if x >= 0 and x < 400 and y >= 0 and y < 240 then img:putPixel(x, y, c) end
end
local function dput(x, y, t) put(x, y, D(x, y, t)) end

-- wall/floor boundary: corner at (148,85), left edge to (0,150), right to (399,168)
local function wallY(x)
  if x < 148 then return 150 - 0.4392 * x
  else return 85 + 0.3307 * (x - 148) end
end

-- floor shade: light far / dark near, darker to the right, AO at wall base,
-- baked-in light pools under window + door portal
local function floorT(x, y, wy)
  local f = (y - wy) / (240 - wy)
  local t = 0.72 - 0.45 * f - 0.08 * (x / 399)
  local a = y - wy
  if a < 7 then t = t - 0.15 * (1 - a / 7) end
  local ex, ey = (x - 316) / 30, (y - 152) / 9
  local e = ex * ex + ey * ey
  if e < 1 then t = t + 0.30 * (1 - e) end
  ex, ey = (x - 364) / 28, (y - 174) / 11
  e = ex * ex + ey * ey
  if e < 1 then t = t + 0.35 * (1 - e) end
  return t
end

-- rounded-rect inside test
local function inRR(x, y, x0, y0, x1, y1, r)
  if x < x0 or x > x1 or y < y0 or y > y1 then return false end
  local cx = x; if x < x0 + r then cx = x0 + r elseif x > x1 - r then cx = x1 - r end
  local cy = y; if y < y0 + r then cy = y0 + r elseif y > y1 - r then cy = y1 - r end
  local dx, dy = x - cx, y - cy
  return dx * dx + dy * dy <= r * r
end

-- rounded rect with bold black outline (bw px) and dithered fill tf(x,y)->t
local function drawRR(x0, y0, x1, y1, r, bw, tf)
  for y = y0, y1 do
    for x = x0, x1 do
      if inRR(x, y, x0, y0, x1, y1, r) then
        if inRR(x, y, x0 + bw, y0 + bw, x1 - bw, y1 - bw, math.max(1, r - bw)) then
          dput(x, y, tf(x, y))
        else
          put(x, y, 1)
        end
      end
    end
  end
end

-- soft blob shadow on floor (darker center, feathered rim)
local function shadow(cx, cy, rx, ry)
  for y = math.floor(cy - ry), math.ceil(cy + ry) do
    for x = math.floor(cx - rx), math.ceil(cx + rx) do
      local ex, ey = (x - cx) / rx, (y - cy) / ry
      local e = ex * ex + ey * ey
      if e <= 1 then
        local wy = wallY(x)
        if y > wy then
          dput(x, y, floorT(x, y, wy) * (0.25 + 0.5 * e))
        end
      end
    end
  end
end

-- ---------- 1. background: walls + floor, edge to edge ----------
for x = 0, 399 do
  local wy = wallY(x)
  for y = 0, 239 do
    local t
    if y < wy then
      if x < 148 then
        -- left wall: catches key light (upper-left), AO toward floor + corner
        t = 0.80 - 0.22 * (y / wy) - 0.10 * (x / 148)
        if x < 12 then t = t - 0.12 * (1 - x / 12) end -- rounded outer edge
        local ce = 148 - x
        if ce < 26 then t = t - 0.18 * (1 - ce / 26) end
      else
        -- right wall: shaded side, moon glow halo around window
        t = 0.42 - 0.18 * (y / wy) + 0.06 * ((x - 148) / 252)
        local ce = x - 148
        if ce < 26 then t = t - 0.15 * (1 - ce / 26) end
        if x > 250 and y < 106 then
          local dx, dy = x - 312, y - 44
          local d = math.sqrt(dx * dx + dy * dy)
          if d < 62 then t = t + 0.40 * (1 - d / 62) end
        end
      end
    else
      t = floorT(x, y, wy)
    end
    dput(x, y, t)
  end
end

-- bold contour along wall/floor edge + corner seam
for x = 0, 399 do
  local by = math.floor(wallY(x))
  put(x, by, 1); put(x, by - 1, 1)
end
for y = 0, 85 do put(147, y, 1); put(148, y, 1) end

-- ---------- 2. hero rug (flat floor decal, marks the open center) ----------
for y = 152, 204 do
  for x = 158, 262 do
    local ex, ey = (x - 210) / 52, (y - 178) / 26
    local e = ex * ex + ey * ey
    if e <= 1 then
      if e > 0.86 then put(x, y, 1)
      elseif e > 0.60 and e < 0.70 then put(x, y, 1)
      else dput(x, y, 0.78 - 0.35 * e) end
    end
  end
end

-- ---------- 3. skull poster on left wall ----------
drawRR(36, 46, 84, 104, 3, 2, function(x, y) return 0.15 end)
for y = 55, 77 do
  for x = 46, 74 do
    local ex, ey = (x - 60) / 14, (y - 66) / 11
    if ex * ex + ey * ey <= 1 then
      dput(x, y, 1.0 - 0.45 * ((ex + ey + 2) / 4)) -- round skull dome
    end
  end
end
for y = 78, 88 do for x = 52, 68 do dput(x, y, 0.85) end end -- jaw
for y = 60, 68 do
  for x = 49, 71 do
    local d1 = (x - 54) ^ 2 + (y - 64) ^ 2
    local d2 = (x - 66) ^ 2 + (y - 64) ^ 2
    if d1 <= 10 or d2 <= 10 then put(x, y, 1) end -- eye sockets
  end
end
put(59, 70, 1); put(60, 70, 1); put(59, 71, 1); put(60, 71, 1) -- nose
for _, tx in ipairs({54, 58, 62, 66}) do
  for y = 80, 86 do put(tx, y, 1) end -- teeth
end

-- ---------- 4. round window, dithered moon ----------
local wcx, wcy, wr = 312, 44, 27
for y = wcy - wr, wcy + wr do
  for x = wcx - wr, wcx + wr do
    local dx, dy = x - wcx, y - wcy
    local d = math.sqrt(dx * dx + dy * dy)
    if d <= wr then
      if d > wr - 3 then put(x, y, 1) -- 3px frame ring
      else
        local mdx, mdy = x - 306, y - 38
        local md = math.sqrt(mdx * mdx + mdy * mdy)
        local t
        if md <= 9 then t = 1.0
        else t = 0.08 + 0.80 * math.max(0, 1 - (md - 9) / 16) end
        dput(x, y, t)
      end
    end
  end
end
put(303, 36, 1); put(304, 36, 1); put(308, 41, 1); put(309, 41, 1); put(304, 41, 1) -- craters
put(322, 52, 2); put(300, 56, 2); put(324, 34, 2) -- stars
for x = wcx - wr + 3, wcx + wr - 3 do -- window cross, 2px
  local d = math.abs(x - wcx)
  if d * d + 1 <= (wr - 2) ^ 2 then put(x, wcy - 1, 1); put(x, wcy, 1) end
end
for y = wcy - wr + 3, wcy + wr - 3 do
  local d = math.abs(y - wcy)
  if d * d + 1 <= (wr - 2) ^ 2 then put(wcx - 1, y, 1); put(wcx, y, 1) end
end

-- ---------- 5. portal door, arched, glowing core ----------
for x = 338, 390 do
  local dx = x - 364
  local arch = 114 - math.sqrt(math.max(0, 26 * 26 - dx * dx))
  local by = math.floor(wallY(x)) + 1
  local ain = 1e9
  if math.abs(dx) <= 23 then ain = 114 - math.sqrt(23 * 23 - dx * dx) end
  for y = math.floor(arch), by do
    if math.abs(dx) <= 23 and y >= ain and y <= by - 2 then
      local gx, gy = x - 364, y - 132
      local gd = math.sqrt(gx * gx + gy * gy)
      local t = math.max(0.06, 0.95 - gd / 48)
      if math.floor(gd) % 9 < 2 then t = t + 0.20 end -- concentric portal rings
      dput(x, y, t)
    else
      put(x, y, 1) -- 3px black arch outline
    end
  end
end
-- sparkle at portal core
put(364, 132, 2); put(363, 132, 2); put(365, 132, 2); put(364, 131, 2); put(364, 133, 2)
put(362, 132, 2); put(366, 132, 2); put(364, 130, 2); put(364, 134, 2)

-- ---------- 6. puffy bed, lower-left ----------
shadow(70, 216, 68, 12)
drawRR(8, 136, 124, 170, 8, 2, function(x, y)
  return 0.78 - 0.35 * ((y - 136) / 34) - 0.12 * ((x - 8) / 116) -- headboard
end)
drawRR(6, 158, 130, 216, 12, 2, function(x, y)
  local u, v = (x - 6) / 124, (y - 158) / 58
  local t = 0.92 - 0.55 * (0.4 * u + 0.6 * v) -- puffy top-left highlight
  if y >= 190 and (y - 190) % 7 < 2 then t = t - 0.20 end -- blanket ribs
  return t
end)
for x = 10, 126 do put(x, 184, 1); put(x, 185, 1) end -- blanket fold
drawRR(16, 162, 62, 184, 9, 2, function(x, y)
  local u, v = (x - 16) / 46, (y - 162) / 22
  return 0.97 - 0.45 * (0.5 * u + 0.5 * v) -- pillow
end)

-- ---------- 7. desk + CRT + modem + keyboard ----------
shadow(245, 133, 66, 5)
local function legT(x, y) return 0.50 - 0.30 * ((y - 118) / 20) end
drawRR(188, 118, 206, 138, 3, 2, legT)
drawRR(284, 118, 302, 138, 3, 2, legT)
drawRR(180, 104, 310, 122, 7, 2, function(x, y)
  return 0.90 - 0.50 * ((y - 104) / 18) - 0.12 * ((x - 180) / 130) -- slab
end)
-- bulbous CRT body, volumetric radial ramp (light upper-left)
drawRR(194, 64, 250, 110, 13, 2, function(x, y)
  local nx, ny = (x - 212) / 32, (y - 80) / 28
  local d = math.sqrt(nx * nx + ny * ny)
  return 0.90 - 0.60 * math.min(1, d)
end)
for xx = 210, 240, 4 do put(xx, 103, 1); put(xx, 104, 1) end -- vents
-- glowing screen with scanlines
drawRR(202, 72, 242, 98, 5, 2, function(x, y)
  local nx, ny = (x - 215) / 24, (y - 83) / 14
  local d = math.sqrt(nx * nx + ny * ny)
  local t = 1.0 - 0.85 * math.min(1, d)
  if y % 3 == 0 then t = t - 0.15 end
  return t
end)
put(206, 78, 1); put(207, 79, 1); put(208, 80, 1); put(207, 81, 1); put(206, 82, 1) -- ">"
for y = 78, 82 do for x = 212, 215 do put(x, y, 1) end end -- block cursor
for xx = 206, 232, 4 do put(xx, 88, 1); put(xx + 1, 88, 1) end -- text row
drawRR(212, 108, 234, 116, 3, 2, function(x, y) return 0.40 - 0.20 * ((y - 108) / 8) end) -- neck
-- chunky modem
drawRR(256, 86, 304, 104, 4, 2, function(x, y)
  return 0.55 - 0.35 * ((y - 86) / 18) - 0.10 * ((x - 256) / 48)
end)
for y = 95, 98 do for x = 262, 266 do dput(x, y, 0.85) end end -- LED halo
put(263, 96, 2); put(264, 96, 2); put(265, 96, 2)
put(263, 97, 2); put(264, 97, 2); put(265, 97, 2) -- lit LED
for x = 286, 298 do put(x, 97, 1); put(x, 98, 1) end -- vent slot
-- keyboard
drawRR(248, 110, 302, 121, 3, 2, function(x, y) return 0.75 - 0.30 * ((y - 110) / 11) end)
for yy = 114, 118, 3 do
  for xx = 253, 296, 4 do put(xx, yy, 1) end
end
-- cable draping off desk to floor
for i = 0, 44 do
  local yy = 100 + i
  local xx = 304 + math.floor(16 * (i / 44) ^ 2 + 0.5)
  put(xx, yy, 1); put(xx + 1, yy, 1)
end
for y = 143, 145 do for x = 318, 321 do put(x, y, 1) end end -- plug blob

-- ---------- save ----------
local out = os.getenv("ASE_OUT_DIR")
sprite:flatten()
sprite:saveAs(app.fs.joinPath(out, "room_bedroom.aseprite"))
sprite:saveAs(app.fs.joinPath(out, "room_bedroom.png"))
print("ASE_GEN_OK")