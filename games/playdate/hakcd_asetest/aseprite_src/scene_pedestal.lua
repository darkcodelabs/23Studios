-- scene_pedestal.png — 400x240 1-bit night scene, HAKCD house style
-- suburban backyard 2am: Bell telco pedestal, moonlit dithered grass,
-- dark house w/ one lit window, chain-link fence, bushes, hose, big moon.

local W, H = 400, 240
local spr = Sprite(W, H, ColorMode.INDEXED)
spr.transparentColor = 0

local pal = Palette(3)
pal:setColor(0, Color{ r = 0, g = 0, b = 0, a = 0 })
pal:setColor(1, Color{ r = 0, g = 0, b = 0, a = 255 })
pal:setColor(2, Color{ r = 255, g = 255, b = 255, a = 255 })
spr:setPalette(pal)

local cel = spr.cels[1]
if cel == nil then cel = spr:newCel(spr.layers[1], 1) end
local img = cel.image

-- ---------- helpers ----------
local function px(x, y, c)
  if x >= 0 and x < W and y >= 0 and y < H then img:putPixel(x, y, c) end
end

local B4 = {
  { 0,  8,  2, 10},
  {12,  4, 14,  6},
  { 3, 11,  1,  9},
  {15,  7, 13,  5},
}
local function bay(x, y) return B4[(y % 4) + 1][(x % 4) + 1] end

local function rect(x0, y0, x1, y1, c)
  for y = y0, y1 do for x = x0, x1 do px(x, y, c) end end
end

-- level 0..16 = white density
local function dith(x, y, lv) px(x, y, (bay(x, y) < lv) and 2 or 1) end

local function line(x0, y0, x1, y1, c)
  local dx = math.abs(x1 - x0); local dy = -math.abs(y1 - y0)
  local sx = (x0 < x1) and 1 or -1; local sy = (y0 < y1) and 1 or -1
  local err = dx + dy
  while true do
    px(x0, y0, c)
    if x0 == x1 and y0 == y1 then break end
    local e2 = 2 * err
    if e2 >= dy then err = err + dy; x0 = x0 + sx end
    if e2 <= dx then err = err + dx; y0 = y0 + sy end
  end
end

local function qcurve(x0, y0, x1, y1, x2, y2, c, thick, glint)
  for i = 0, 80 do
    local u = i / 80
    local a, b = (1 - u) * (1 - u), 2 * (1 - u) * u
    local X = math.floor(a * x0 + b * x1 + u * u * x2 + 0.5)
    local Y = math.floor(a * y0 + b * y1 + u * u * y2 + 0.5)
    px(X, Y, c)
    if thick then px(X, Y + 1, c) end
    if glint and bay(X, Y - 1) < 5 then px(X, Y - 1, 2) end
  end
end

local function ellipseOutline(cx, cy, rx, ry, c, thick)
  for i = 0, 100 do
    local a = i / 100 * math.pi * 2
    local X = math.floor(cx + math.cos(a) * rx + 0.5)
    local Y = math.floor(cy + math.sin(a) * ry + 0.5)
    px(X, Y, c)
    if thick then px(X, Y + 1, c) end
  end
end

local function cloudBlob(cx, cy, rx, ry, core, edge)
  for y = -ry, ry do
    for x = -rx, rx do
      local nx, ny = x / rx, y / ry
      local d = nx * nx + ny * ny
      if d <= 1 then
        local X, Y = cx + x, cy + y
        local lv = (d < 0.55) and core or edge
        px(X, Y, (bay(X, Y) < lv) and 2 or 1)
      end
    end
  end
end

-- ---------- 1. base: solid black night ----------
rect(0, 0, W - 1, H - 1, 1)

-- ---------- 2. stars ----------
for i = 0, 110 do
  local sx = (i * 89 + 17) % 400
  local sy = (i * 53 + 11) % 112
  px(sx, sy, 2)
  if i % 9 == 0 then -- brighter star, plus shape
    px(sx - 1, sy, 2); px(sx + 1, sy, 2); px(sx, sy - 1, 2); px(sx, sy + 1, 2)
  end
end

-- ---------- 3. big dithered moon + glow halo ----------
local mcx, mcy, mr = 316, 50, 32
for y = -mr - 14, mr + 14 do
  for x = -mr - 14, mr + 14 do
    local d = math.sqrt(x * x + y * y)
    local X, Y = mcx + x, mcy + y
    if d <= mr then
      local dn = d / mr
      local lv = 16
      if dn > 0.70 then lv = 16 - math.floor((dn - 0.70) / 0.30 * 9) end
      px(X, Y, (bay(X, Y) < lv) and 2 or 1)
    elseif d <= mr + 13 then
      local g = (d - mr) / 13
      local lv = math.floor(3.5 * (1 - g))
      if bay(X, Y) < lv then px(X, Y, 2) end
    end
  end
end
-- craters punched in as darker dither
local craters = { {8,-6,7,9}, {-10,4,5,8}, {2,12,4,9}, {-4,-14,3,8}, {14,8,4,10} }
for _, c in ipairs(craters) do
  for y = -c[3], c[3] do
    for x = -c[3], c[3] do
      if x * x + y * y <= c[3] * c[3] then
        local X, Y = mcx + c[1] + x, mcy + c[2] + y
        if bay(X, Y) < c[4] then px(X, Y, 1) end
      end
    end
  end
end

-- ---------- 4. drifting clouds (replace-mode dither, one clips the moon) ----------
cloudBlob(70, 26, 42, 8, 6, 3)
cloudBlob(112, 22, 34, 9, 6, 3)
cloudBlob(145, 30, 30, 6, 5, 2)
cloudBlob(196, 58, 26, 5, 4, 2)
cloudBlob(222, 63, 20, 4, 4, 2)
cloudBlob(280, 82, 44, 9, 7, 4)  -- this bank drifts across the moon's lower limb
cloudBlob(330, 86, 38, 8, 7, 4)
cloudBlob(372, 79, 32, 7, 6, 3)

-- ---------- 5. bare tree branches, top-left frame ----------
line(0, 16, 70, 34, 1);  line(0, 17, 70, 35, 1)
line(20, 22, 36, 6, 1);  line(21, 22, 37, 7, 1)
line(40, 27, 58, 10, 1)
line(55, 31, 82, 24, 1)
line(70, 34, 96, 46, 1); line(70, 35, 96, 47, 1)
line(30, 12, 24, 2, 1)
line(48, 18, 52, 4, 1)

-- ---------- 6. distant treeline at horizon (left/right of house) ----------
for x = 0, 399 do
  if x < 38 or x > 248 then
    local topY = 130 + math.floor(3 * math.sin(x * 0.13) + 0.5) + ((x * 7) % 3)
    for y = topY, 152 do
      local lv = (y == topY) and 5 or 1
      dith(x, y, lv)
    end
  end
end

-- ---------- 7. dark house ----------
rect(38, 100, 248, 152, 1)                       -- wall silhouette
for y = 60, 100 do                               -- gable roof, moonlit right slope
  local f = (y - 60) / 40
  local xl = math.floor(143 - f * 113 + 0.5)
  local xr = math.floor(143 + f * 113 + 0.5)
  for x = xl, xr do
    dith(x, y, (x > 143) and 3 or 1)             -- shingle dither ramp
  end
  if y % 2 == 0 then px(xl, y, 2) end            -- sparse left edge
  px(xr, y, 2); px(xr - 1, y, 2)                 -- bright 2px fascia toward moon
end
px(142, 59, 2); px(143, 59, 2); px(144, 59, 2)   -- ridge cap glint
for x = 30, 256 do if bay(x, 101) < 5 then px(x, 101, 2) end end -- gutter glint
-- chimney (rises from right slope)
rect(196, 41, 212, 78, 1)
rect(194, 38, 214, 41, 1)
for x = 194, 214 do if bay(x, 38) < 10 then px(x, 38, 2) end end
for y = 42, 77 do if bay(212, y) < 6 then px(212, y, 2) end end
-- faint siding on moon-side wall
for y = 106, 148, 4 do
  for x = 176, 246 do if bay(x, y) < 2 then px(x, y, 2) end end
end
-- two dark windows w/ frames + faint glass glints
for _, wx in ipairs({56, 96}) do
  rect(wx, 112, wx + 20, 134, 1)
  for x = wx, wx + 20 do px(x, 112, 2); px(x, 134, 2) end
  for y = 112, 134 do px(wx, y, 2); px(wx + 20, y, 2) end
  for y = 113, 133 do
    for x = wx + 1, wx + 19 do
      if (x + y) % 9 == 0 and bay(x, y) < 4 then px(x, y, 2) end
    end
  end
end
-- back door
rect(218, 116, 238, 152, 1)
for x = 218, 238 do px(x, 116, 2) end
for y = 116, 152 do px(218, y, 2); px(238, y, 2) end
px(233, 134, 2); px(233, 135, 2)
-- THE lit window (the only warm thing awake)
for Y = 96, 150 do                                -- glow halo, chebyshev falloff
  for X = 132, 186 do
    local dx = 0
    if X < 146 then dx = 146 - X elseif X > 172 then dx = X - 172 end
    local dy = 0
    if Y < 110 then dy = 110 - Y elseif Y > 136 then dy = Y - 136 end
    local dd = math.max(dx, dy)
    if dd > 0 then
      local lv = 0
      if dd <= 3 then lv = 5 elseif dd <= 7 then lv = 3 elseif dd <= 12 then lv = 1 end
      if bay(X, Y) < lv then px(X, Y, 2) end
    end
  end
end
rect(145, 109, 173, 137, 1)                       -- frame
rect(146, 110, 172, 136, 2)                       -- light
rect(158, 110, 159, 136, 1)                       -- mullions
rect(146, 122, 172, 123, 1)
for _, by in ipairs({112, 115, 118}) do           -- half-drawn blind slats
  for x = 146, 172 do if x % 3 < 2 then px(x, by, 1) end end
end

-- ---------- 7b. utility pole + sagging drop wire (telco flavor) ----------
rect(386, 60, 389, 152, 1)
rect(377, 66, 398, 69, 1)
px(380, 65, 2); px(394, 65, 2)
for y = 61, 151 do if bay(386, y) < 6 then px(386, y, 2) end end
qcurve(381, 68, 312, 94, 252, 97, 1, false, true) -- wire silhouettes across moon glow

-- ---------- 8. moonlit grass field, y153..239 ----------
for y = 153, 239 do
  for x = 0, 399 do
    local lv = 5
    if (math.floor(y / 16) % 2) == 1 then lv = lv + 1 end     -- mow bands
    local dx = x - 310
    local dy = y - 186
    if dx * dx + dy * dy * 9 < 8100 then lv = lv + 2 end      -- moon sheen pool
    if x < 132 and y < 205 then lv = lv - 2 end               -- house shadow mass
    if y < 157 then lv = lv - 2 end                           -- fence-line shadow
    if y > 214 then lv = lv - 1 end                           -- foreground falloff
    if y > 230 then lv = lv - 1 end
    if x < 24 or x > 384 then lv = lv - 1 end                 -- corner vignette
    if ((x * 37 + y * 53) % 71) == 0 then lv = lv + 3 end     -- dew sparkle
    if ((x * 17 + y * 43) % 97) == 0 then lv = 0 end          -- dark clumps
    if lv < 0 then lv = 0 end
    dith(x, y, lv)
  end
end
-- scattered grass tufts (kept out of hero zone x140..260 / y>198)
for i = 0, 380 do
  local gx = (i * 173 + 41) % 400
  local gy = 156 + ((i * 97 + 23) % 80)
  if not (gx > 135 and gx < 265 and gy > 198) then
    local hgt = 1 + (i % 3)
    local c = ((i % 5) < 3) and 2 or 1
    for k = 0, hgt do px(gx, gy - k, c) end
  end
end
-- warm light pool spilling from the lit window
for y = 153, 174 do
  local sp = y - 153
  local lv = 9 - math.floor(sp / 3) * 2
  if lv > 0 then
    for x = 146 - sp, 172 + sp do
      if bay(x, y) < lv then px(x, y, 2) end
    end
  end
end

-- ---------- 9. chain-link fence ----------
for y = 125, 151 do                               -- diamond mesh, moonlit glints
  for x = 0, 399 do
    if ((x + y) % 8) == 0 or ((x - y) % 8) == 0 then
      if bay(x, y) < 9 then
        local overWin = (x >= 144 and x <= 174 and y <= 140)
        px(x, y, overWin and 1 or 2)              -- wire goes dark against the lit window
      end
    end
  end
end
rect(0, 122, 399, 123, 2)                         -- top rail
for x = 0, 399 do px(x, 124, 1) end
for _, pxx in ipairs({10, 80, 150, 220, 290, 360}) do
  rect(pxx, 120, pxx + 2, 154, 1)                 -- posts
  for y = 121, 153 do if bay(pxx + 2, y) < 10 then px(pxx + 2, y, 2) end end
  px(pxx, 120, 2); px(pxx + 1, 120, 2); px(pxx + 2, 120, 2)
end

-- ---------- 10. bushes hugging the fence ----------
local function bush(cx, cy, rx, ry, seed)
  for y = -ry, ry do
    for x = -rx, rx do
      local nx, ny = x / rx, y / ry
      local d = nx * nx + ny * ny
      if d <= 1 then
        local X, Y = cx + x, cy + y
        px(X, Y, 1)
        if d > 0.55 and ny < 0 and bay(X, Y) < 5 then px(X, Y, 2) end -- moonlit crown
        if ((X * 31 + Y * 17 + seed) % 61) == 0 then px(X, Y, 2) end  -- leaf speckle
      end
    end
  end
end
bush(18, 148, 30, 15, 3)
bush(50, 152, 26, 12, 11)
bush(2, 152, 20, 12, 7)
bush(352, 150, 36, 17, 5)
bush(394, 154, 26, 13, 13)
bush(316, 153, 22, 10, 9)

-- ---------- 11. coiled garden hose, left yard ----------
for y = -12, 12 do                                -- shadow pool under coil
  for x = -40, 40 do
    local d = (x / 40) * (x / 40) + (y / 12) * (y / 12)
    if d <= 1 then dith(88 + x, 210 + y, 1) end
  end
end
local function hoseLoop(cx, cy, rx, ry)
  ellipseOutline(cx, cy + 1, rx, ry, 1, true)
  ellipseOutline(cx, cy, rx, ry, 2, false)
end
hoseLoop(86, 206, 34, 12)
hoseLoop(86, 204, 26, 9)
hoseLoop(86, 202, 18, 6)
qcurve(60, 198, 34, 186, 30, 160, 1, true, true)  -- run back toward the spigot
px(28, 157, 2); px(29, 157, 2); px(28, 156, 2)

-- ---------- 12. concrete pad (perspective trapezoid) ----------
for y = 206, 228 do
  local f = (y - 206) / 22
  local xl = math.floor(158 - f * 12 + 0.5)
  local xr = math.floor(242 + f * 12 + 0.5)
  for x = xl, xr do
    local lv = 9
    if y > 224 then lv = 6 end                    -- front lip in shade
    dith(x, y, lv)
  end
  px(xl, y, 1); px(xr, y, 1)
end
for x = 158, 242 do px(x, 206, 1) end
for x = 146, 254 do px(x, 228, 1) end
line(174, 210, 182, 222, 1)                       -- cracks
line(182, 222, 178, 228, 1)
line(228, 212, 238, 226, 1)

-- ---------- 13. pedestal cast shadow (moon upper-right -> lower-left) ----------
for y = 208, 228 do
  local f = (y - 208) / 20
  local xl = math.floor(172 - f * 52 + 0.5)
  local xr = math.floor(228 - f * 44 + 0.5)
  for x = xl, xr do dith(x, y, 2) end
end

-- ---------- 14. THE BELL PEDESTAL (hero object, center-foreground) ----------
-- top face (brightest, catches the moon)
for y = 131, 137 do
  local f = (y - 131) / 6
  local xl = math.floor(178 - f * 6 + 0.5)
  local xr = math.floor(234 - f * 6 + 0.5)
  for x = xl, xr do dith(x, y, 12) end
  px(xl - 1, y, 1); px(xl - 2, y, 1)              -- left silhouette stroke on slope
end
for x = 177, 235 do px(x, 130, 1) end             -- black seam above rim
for x = 178, 234 do px(x, 131, 2) end             -- white top rim
-- right side face (moon-side, mid bright)
for x = 229, 234 do
  local f = (x - 228) / 6
  local yt = math.floor(137 - f * 6 + 0.5)
  local yb = math.floor(208 - f * 6 + 0.5)
  for y = yt, yb do
    dith(x, y, (y > yb - 8) and 5 or 8)
  end
end
for y = 131, 203 do
  if bay(235, y) < 12 then px(235, y, 2) end      -- bright back-right rim
  px(236, y, 1)                                    -- separation stroke
end
-- front face (in shadow, subtle brushed-metal streaks + weathering)
for y = 138, 208 do
  for x = 172, 228 do
    local lv = 4
    if (x % 12) < 2 then lv = 5 end
    if x < 176 then lv = 3 end                    -- occlusion near left edge
    if x > 220 then lv = 5 end
    if ((x * 13 + y * 29) % 89) == 0 then lv = 0 end
    dith(x, y, lv)
  end
end
for x = 172, 228 do px(x, 138, 2) end             -- lit front-top edge
-- strong silhouette strokes
for y = 138, 208 do px(170, y, 1); px(171, y, 1) end
rect(170, 207, 235, 209, 1)
-- hinged door groove
for x = 178, 222 do px(x, 146, 1); px(x, 202, 1) end
for y = 146, 202 do px(178, y, 1); px(222, y, 1) end
for x = 179, 221 do if bay(x, 147) < 11 then px(x, 147, 2) end end
for y = 147, 201 do if bay(179, y) < 9 then px(179, y, 2) end end
-- hinges on the left frame
rect(173, 154, 176, 160, 1)
for y = 154, 160 do px(176, y, 2) end
rect(173, 184, 176, 190, 1)
for y = 184, 190 do px(176, y, 2) end
-- BELL nameplate
for y = 152, 160 do for x = 189, 211 do dith(x, y, 13) end end
for x = 188, 212 do px(x, 151, 1); px(x, 161, 1) end
for y = 151, 161 do px(188, y, 1); px(212, y, 1) end
local F = {
  B = {"##.","#.#","##.","#.#","##."},
  E = {"###","#..","##.","#..","###"},
  L = {"#..","#..","#..","#..","###"},
}
local function text3x5(s, x0, y0, c)
  local x = x0
  for i = 1, #s do
    local g = F[s:sub(i, i)]
    if g then
      for r = 1, 5 do
        for k = 1, 3 do
          if g[r]:sub(k, k) == "#" then px(x + k - 1, y0 + r - 1, c) end
        end
      end
    end
    x = x + 4
  end
end
text3x5("BELL", 193, 154, 1)
-- Bell ring logo, left of door center
for y = -6, 6 do
  for x = -6, 6 do
    if x * x + y * y <= 36 then dith(192 + x, 174 + y, 3) end
  end
end
ellipseOutline(192, 174, 7, 7, 2, false)
local bellGlyph = {
  {0,-3},
  {-1,-2},{0,-2},{1,-2},
  {-1,-1},{0,-1},{1,-1},
  {-2,0},{-1,0},{0,0},{1,0},{2,0},
  {-2,1},{-1,1},{0,1},{1,1},{2,1},
  {-3,2},{-2,2},{-1,2},{0,2},{1,2},{2,2},{3,2},
  {0,4},
}
for _, p in ipairs(bellGlyph) do px(192 + p[1], 174 + p[2], 2) end
-- HEX LOCK plate (anchor point for the lock overlay)
for y = 165, 183 do for x = 205, 219 do dith(x, y, 6) end end
for x = 204, 220 do px(x, 164, 1); px(x, 184, 1) end
for y = 164, 184 do px(204, y, 1); px(220, y, 1) end
for y = -5, 5 do                                  -- bolt housing disc
  for x = -5, 5 do
    if x * x + y * y <= 25 then px(212 + x, 171 + y, 1) end
  end
end
local hv = { {216,171},{214,168},{210,168},{208,171},{210,174},{214,174} }
for i = 1, 6 do                                   -- hex head outline
  local a = hv[i]; local b = hv[(i % 6) + 1]
  line(a[1], a[2], b[1], b[2], 2)
end
for y = -2, 2 do                                  -- bolt face dither
  for x = -2, 2 do
    if math.abs(x) + math.abs(y) <= 3 and bay(212 + x, 171 + y) < 10 then
      px(212 + x, 171 + y, 2)
    end
  end
end
rect(211, 170, 213, 172, 1)                       -- socket
px(211, 170, 2)                                   -- single glint
rect(209, 179, 215, 181, 1)                       -- latch slot
-- vent louvers below the door
for x = 182, 218 do
  if (x % 6) < 4 then
    px(x, 204, 1); px(x, 206, 1)
    if bay(x, 205) < 9 then px(x, 205, 2) end
  end
end
-- grass blades lapping the box base + pad edge (grounds the object)
local blades = {
  {174,207,3,2},{181,206,4,1},{190,208,3,2},{199,207,2,1},
  {208,208,4,2},{217,206,3,1},{226,208,3,2},{233,207,4,1},
  {160,226,3,1},{247,227,3,1},
}
for _, b in ipairs(blades) do
  for k = 0, b[3] do px(b[1], b[2] - k, b[4]) end
end

-- ---------- 15. foreground blade clusters, corners only (hero zone stays clean) ----------
local function tallBlade(bx, h, bend, c)
  for k = 0, h do
    local xx = bx + math.floor(bend * k * k / (h * h) + 0.5)
    px(xx, 239 - k, c)
    if k < h // 2 then px(xx + 1, 239 - k, c) end
  end
end
local lefts  = {6, 14, 23, 31, 44, 58, 70, 85, 100, 115}
local rights = {288, 300, 315, 332, 350, 365, 378, 390}
for i, bx in ipairs(lefts) do
  tallBlade(bx, 8 + (i * 5) % 10, (i % 2 == 0) and 3 or -2, (i % 4 == 0) and 2 or 1)
end
for i, bx in ipairs(rights) do
  tallBlade(bx, 9 + (i * 7) % 9, (i % 2 == 0) and -3 or 2, (i % 4 == 0) and 2 or 1)
end

-- ---------- save ----------
spr:flatten()
local out = os.getenv("ASE_OUT_DIR")
spr:saveAs(app.fs.joinPath(out, "scene_pedestal.aseprite"))
spr:saveAs(app.fs.joinPath(out, "scene_pedestal.png"))
print("ASE_GEN_OK")