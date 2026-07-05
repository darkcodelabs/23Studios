-- HAKCD phreaker-noir: suburban backyard, 2am — Bell telco pedestal scene
-- 400x240, 1-bit indexed (0 transparent, 1 black, 2 white), Bayer dithering

local W, H = 400, 240
local spr = Sprite(W, H, ColorMode.INDEXED)
spr.transparentColor = 0

local pal = Palette(3)
pal:setColor(0, Color{r=0, g=0, b=0, a=0})
pal:setColor(1, Color{r=0, g=0, b=0, a=255})
pal:setColor(2, Color{r=255, g=255, b=255, a=255})
spr:setPalette(pal)

local cel = spr.cels[1]
local img = cel.image

-- ---------- helpers ----------
local function px(x, y, c)
  if x >= 0 and x < W and y >= 0 and y < H then
    img:putPixel(x, y, c)
  end
end

-- 4x4 Bayer matrix
local B = {
  {0, 8, 2, 10},
  {12, 4, 14, 6},
  {3, 11, 1, 9},
  {15, 7, 13, 5},
}

-- dithered pixel: white if under threshold, else black (opaque)
local function dpx(x, y, lvl)
  if B[(y % 4) + 1][(x % 4) + 1] < lvl then px(x, y, 2) else px(x, y, 1) end
end

-- additive white dots only (glow over black)
local function glow(x, y, lvl)
  if B[(y % 4) + 1][(x % 4) + 1] < lvl then px(x, y, 2) end
end

-- additive black dots only (shade over white/dither)
local function dark(x, y, lvl)
  if B[(y % 4) + 1][(x % 4) + 1] < lvl then px(x, y, 1) end
end

local function frect(x0, y0, x1, y1, c)
  for y = y0, y1 do
    for x = x0, x1 do px(x, y, c) end
  end
end

-- deterministic scatter hash -> 0..999
local function hash(x, y)
  local n = x * 374761 + y * 668265 + 12345
  n = (n * 1103515245 + 12345) % 2147483648
  return n % 1000
end

-- ---------- 1. night sky ----------
frect(0, 0, W - 1, 121, 1)

-- ---------- 2. stars (skip near moon) ----------
local MX, MY, MR = 72, 52, 34
for y = 0, 104 do
  for x = 0, W - 1 do
    local dx, dy = x - MX, y - MY
    if dx * dx + dy * dy > 52 * 52 then
      local h = hash(x, y)
      if h == 17 then
        px(x, y, 2)
      elseif h == 18 then
        px(x, y, 2); px(x - 1, y, 2); px(x + 1, y, 2)
        px(x, y - 1, 2); px(x, y + 1, 2)
      end
    end
  end
end

-- ---------- 3. moon: halo, disc, terminator shade, craters ----------
for y = MY - 46, MY + 46 do
  for x = MX - 46, MX + 46 do
    local dx, dy = x - MX, y - MY
    local d = math.sqrt(dx * dx + dy * dy)
    if d > MR and d <= MR + 10 then
      local lvl = 5 - math.floor((d - MR) / 2)
      if lvl > 0 then glow(x, y, lvl) end
    end
  end
end
for y = MY - MR, MY + MR do
  for x = MX - MR, MX + MR do
    local dx, dy = x - MX, y - MY
    if dx * dx + dy * dy <= MR * MR then px(x, y, 2) end
  end
end
-- crescent shading on lower-right rim
for y = MY - MR, MY + MR do
  for x = MX - MR, MX + MR do
    local dx, dy = x - MX, y - MY
    if dx * dx + dy * dy <= MR * MR then
      local sx, sy = x - (MX - 9), y - (MY - 9)
      if sx * sx + sy * sy > MR * MR then dark(x, y, 6) end
    end
  end
end
-- craters
local craters = {{60,46,6},{82,62,7},{72,68,4},{84,42,4},{66,58,3}}
for _, c in ipairs(craters) do
  for y = c[2] - c[3], c[2] + c[3] do
    for x = c[1] - c[3], c[1] + c[3] do
      local dx, dy = x - c[1], y - c[2]
      if dx * dx + dy * dy <= c[3] * c[3] then dark(x, y, 7) end
    end
  end
end

-- ---------- 4. house silhouette + lit window ----------
frect(228, 80, 384, 121, 1)                 -- body
for i = 0, 24 do                            -- gable roof, peak at x=306
  local hw = math.floor(6 + i * 3.9)
  frect(306 - hw, 56 + i, 306 + hw, 56 + i, 1)
end
frect(352, 44, 364, 70, 1)                  -- chimney
-- lit window
frect(258, 92, 284, 114, 2)
frect(270, 92, 271, 114, 1)                 -- vertical mullion
frect(258, 102, 284, 103, 1)                -- horizontal mullion
-- window glow bleeding onto wall
for y = 84, 121 do
  for x = 248, 294 do
    local dx = 0
    if x < 258 then dx = 258 - x elseif x > 284 then dx = x - 284 end
    local dy = 0
    if y < 92 then dy = 92 - y elseif y > 114 then dy = y - 114 end
    local d = math.max(dx, dy)
    if d > 0 then
      local lvl = 5 - math.floor(d / 2)
      if lvl > 0 then glow(x, y, lvl) end
    end
  end
end

-- ---------- 5. moonlit grass (dither gradient + moonlight pool) ----------
for y = 122, 239 do
  for x = 0, W - 1 do
    local lvl = 2 + math.floor((y - 122) / 40)
    local ex = (x - 180) / 170
    local ey = (y - 190) / 85
    if ex * ex + ey * ey < 1 then lvl = lvl + 2 end
    dpx(x, y, lvl)
  end
end

-- ---------- 6. bushes ----------
local function bush(cx, cy, r)
  for y = cy - r, cy + r do
    for x = cx - r, cx + r do
      local dx, dy = x - cx, y - cy
      if dx * dx + dy * dy <= r * r then px(x, y, 1) end
    end
  end
  -- moonlit rim, upper-left
  local inner = (r - 5) * (r - 5)
  for y = cy - r, cy do
    for x = cx - r, cx do
      local dx, dy = x - cx, y - cy
      local d2 = dx * dx + dy * dy
      if d2 <= r * r and d2 >= inner then glow(x, y, 4) end
    end
  end
end
bush(26, 120, 20)
bush(56, 126, 15)
bush(6, 128, 17)
bush(396, 124, 18)
bush(372, 130, 13)
bush(122, 128, 11)

-- ---------- 7. mid-ground grass tufts ----------
for gy = 128, 236, 7 do
  for gx = 3, 396, 9 do
    local h = hash(gx, gy)
    if h % 10 < 4 then
      local x = gx + h % 5
      local y = gy + h % 3
      px(x, y - 1, 1); px(x - 1, y, 1); px(x + 1, y, 1)
    end
  end
end

-- ---------- 8. concrete pad ----------
frect(148, 196, 252, 197, 1)                -- top stroke
for y = 198, 207 do                         -- pad top surface
  for x = 150, 250 do dpx(x, y, 9) end
end
for y = 208, 212 do                         -- front face, darker
  for x = 150, 250 do dpx(x, y, 4) end
end
frect(148, 213, 252, 214, 1)                -- bottom stroke
frect(148, 196, 149, 214, 1)                -- left stroke
frect(251, 196, 252, 214, 1)                -- right stroke
frect(154, 200, 155, 201, 1)                -- anchor bolts
frect(245, 200, 246, 201, 1)

-- ---------- 9. pedestal body (rounded metal box) ----------
local function metal(x, y)
  local lvl = 11 - math.floor((x - 164) / 26) * 2
  if y < 108 then lvl = lvl + 2 end         -- cap catches moonlight
  if y > 168 then lvl = lvl - 1 end
  dpx(x, y, lvl)
end

for y = 90, 200 do
  local x0, x1
  if y <= 91 then x0, x1 = 176, 224
  elseif y <= 93 then x0, x1 = 170, 230
  elseif y <= 95 then x0, x1 = 166, 234
  else x0, x1 = 164, 236 end
  if y <= 91 or y >= 199 then
    for x = x0, x1 do px(x, y, 1) end
  else
    local bl
    if y <= 93 then bl = 8 elseif y <= 95 then bl = 6 else bl = 2 end
    for x = x0, x1 do
      if x < x0 + bl or x > x1 - bl then px(x, y, 1) else metal(x, y) end
    end
  end
end

-- cap seam + lip highlight
frect(166, 108, 234, 109, 1)
for x = 167, 233 do dpx(x, 110, 14) end

-- vent slits, lower-left of body
frect(171, 116, 177, 117, 1)
frect(171, 120, 177, 121, 1)

-- Bell emblem on cap: ring + bell glyph
for dy = -7, 7 do
  for dx = -7, 7 do
    local d2 = dx * dx + dy * dy
    if d2 >= 25 and d2 <= 40 then px(200 + dx, 99 + dy, 1) end
  end
end
local bell = {
  {0,-3},{-1,-2},{0,-2},{1,-2},{-1,-1},{0,-1},{1,-1},
  {-2,0},{-1,0},{0,0},{1,0},{2,0},
  {-3,1},{-2,1},{-1,1},{0,1},{1,1},{2,1},{3,1},{0,3}
}
for _, p in ipairs(bell) do px(200 + p[1], 99 + p[2], 1) end

-- ---------- 10. hinged door (kept clean for lock overlay) ----------
for y = 126, 186 do
  for x = 180, 224 do
    if y <= 127 or y >= 185 or x <= 181 or x >= 223 then
      px(x, y, 1)
    else
      dpx(x, y, 13)
    end
  end
end
-- hinge tabs, left side
frect(175, 134, 181, 142, 1)
frect(175, 170, 181, 178, 1)
-- hex lock: black bezel, white face, black hex recess
local LX, LY = 212, 156
for dy = -7, 7 do
  for dx = -7, 7 do
    if dx * dx + dy * dy <= 49 then px(LX + dx, LY + dy, 1) end
  end
end
for dy = -4, 4 do
  for dx = -4, 4 do
    if dx * dx + dy * dy <= 16 then px(LX + dx, LY + dy, 2) end
  end
end
local hexw = {[-2]=1, [-1]=2, [0]=2, [1]=2, [2]=1}
for dy = -2, 2 do
  for dx = -hexw[dy], hexw[dy] do px(LX + dx, LY + dy, 1) end
end

-- ---------- 11. moon shadow cast to lower-right ----------
for y = 202, 220 do
  local sx = 250 + (y - 202) * 2
  local len = 70 - (y - 202) * 3
  if len > 0 then
    for x = sx, sx + len do dark(x, y, 8) end
  end
end

-- ---------- 12. foreground grass blades along bottom edge ----------
for x = 0, 397, 3 do
  local h = hash(x, 777)
  if h % 10 < 6 then
    local extra = ((x < 70 or x > 330) and 10 or 0)
    local ht = 6 + h % 16 + extra
    local top = 239 - ht
    local c = (h % 13 == 0) and 2 or 1
    for y = top, 239 do
      px(x, y, c); px(x + 1, y, c)
    end
    px(x + ((h % 2 == 0) and -1 or 2), top + 1, c)  -- bent tip
  end
end

-- ---------- save + export ----------
local out = os.getenv("ASE_OUT_DIR")
spr:saveAs(app.fs.joinPath(out, "scene_pedestal.aseprite"))
app.command.ExportSpriteSheet{
  ui = false,
  askOverwrite = false,
  type = SpriteSheetType.HORIZONTAL,
  textureFilename = app.fs.joinPath(out, "scene_pedestal-table-400-240.png"),
  dataFilename = ""
}

print("ASE_GEN_OK")