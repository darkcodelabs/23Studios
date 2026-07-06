-- portrait_newb.png — 64x64 MARIO-64-style 1-bit dialogue portrait
-- scrawny cocky teen: big round head, backwards cap, headphones on neck, hoodie
local out = os.getenv("ASE_OUT_DIR")

local spr = Sprite(64, 64, ColorMode.INDEXED)
spr.transparentColor = 0
local pal = Palette(3)
pal:setColor(0, Color{r=0, g=0, b=0, a=0})
pal:setColor(1, Color{r=0, g=0, b=0, a=255})
pal:setColor(2, Color{r=255, g=255, b=255, a=255})
spr:setPalette(pal)

local cel = spr.layers[1]:cel(1)
if not cel then cel = spr:newCel(spr.layers[1], 1) end
local img = cel.image

-- ---------- dither engine (Bayer 4x4, levels 0=black .. 16=white) ----------
local BAYER = {
  {0, 8, 2, 10},
  {12, 4, 14, 6},
  {3, 11, 1, 9},
  {15, 7, 13, 5},
}
local function clamp(v, a, b)
  if v < a then return a elseif v > b then return b else return v end
end
local function sh(x, y, lv)
  if lv <= 0 then return 1 end
  if lv >= 16 then return 2 end
  if BAYER[(y % 4) + 1][(x % 4) + 1] < lv then return 2 else return 1 end
end
local function px(x, y, c)
  if x >= 0 and x <= 63 and y >= 0 and y <= 63 then img:putPixel(x, y, c) end
end
local function dpx(x, y, lv) px(x, y, sh(x, y, lv)) end
local function rect(x0, y0, x1, y1, c)
  for y = y0, y1 do for x = x0, x1 do px(x, y, c) end end
end
local function drect(x0, y0, x1, y1, lv)
  for y = y0, y1 do for x = x0, x1 do dpx(x, y, lv) end end
end

-- volumetric sphere: key light upper-left, black rim outline where d >= edge
local function ball(cx, cy, rx, ry, lo, hi, edge, ymin, ymax)
  ymin = ymin or math.floor(cy - ry)
  ymax = ymax or math.ceil(cy + ry)
  for y = math.max(0, math.floor(cy - ry)), math.min(63, math.ceil(cy + ry)) do
    if y >= ymin and y <= ymax then
      for x = math.max(0, math.floor(cx - rx)), math.min(63, math.ceil(cx + rx)) do
        local nx, ny = (x - cx) / rx, (y - cy) / ry
        local d = nx * nx + ny * ny
        if d <= 1 then
          if edge > 0 and d >= edge then
            px(x, y, 1)
          else
            local nz = math.sqrt(1 - d)
            local lum = clamp((-nx * 0.5 - ny * 0.5 + nz * 0.72 + 0.28) / 1.28, 0, 1)
            dpx(x, y, lo + (hi - lo) * lum)
          end
        end
      end
    end
  end
end

-- ---------- 1) background: radial glow + 12-ray starburst ----------
for y = 0, 63 do
  for x = 0, 63 do
    local dx, dy = x - 27, y - 22
    local dist = math.sqrt(dx * dx + dy * dy)
    local lv = 11 - dist * 0.22
    local ray = math.floor((math.atan(dy, dx) + math.pi) / (math.pi / 6))
    if ray % 2 == 0 then lv = lv + 2 end
    dpx(x, y, clamp(math.floor(lv), 1, 12))
  end
end

-- ---------- 2) backwards cap brim (behind head, pointing viewer-left) ----------
for y = 14, 21 do
  for x = 3, 17 do
    local inside = true
    local edge = (y <= 15) or (y >= 20)
    if x < 7 then
      local ex, ey = (7 - x) / 4, (y - 17.5) / 3.75
      local d = ex * ex + ey * ey
      inside = d <= 1
      if d >= 0.55 then edge = true end
    end
    if inside then
      if edge then px(x, y, 1)
      else dpx(x, y, clamp(10 - (y - 15) * 3, 1, 16)) end
    end
  end
end

-- ---------- 3) hoodie: shoulders edge-to-edge, dither wrap, top outline ----------
for x = 0, 63 do
  local t = (x - 31) / 31
  local sl = 46 + math.floor(t * t * 11 + 0.5)
  for y = sl, 63 do
    if y <= sl + 1 then px(x, y, 1)
    else
      local lv = 13 - math.floor((x / 63) * 5) - math.floor((y - sl) / 6)
      dpx(x, y, clamp(lv, 2, 13))
    end
  end
end
-- fold creases at collar bone
for i = 0, 5 do
  px(23 - i, 49 + i, 1); px(24 - i, 49 + i, 1)
  px(39 + i, 49 + i, 1); px(40 + i, 49 + i, 1)
end

-- ---------- 4) scrawny neck (AO under chin) ----------
for y = 39, 50 do
  px(27, y, 1); px(36, y, 1)
  for x = 28, 35 do
    local lv = (x < 32) and 10 or 7
    if y <= 42 then lv = lv - 5 end
    if y >= 48 then lv = lv - 2 end
    dpx(x, y, clamp(lv, 1, 16))
  end
end

-- ---------- 5) headphones resting around neck: U-band + cups ----------
for y = 44, 53 do
  for x = 15, 47 do
    local nx, ny = (x - 31) / 16, (y - 43) / 10
    local d = nx * nx + ny * ny
    if d <= 1 and d >= 0.42 then
      if d >= 0.8 or d <= 0.52 then px(x, y, 1)
      else dpx(x, y, 11 - math.floor((x - 15) / 11)) end
    end
  end
end
ball(16, 47, 4, 5, 3, 13, 0.55)
ball(47, 47, 4, 5, 3, 13, 0.55)

-- drawstrings + aglets on chest
for y = 53, 60 do
  px(26, y, 1); dpx(27, y, 15); px(28, y, 1)
  px(35, y, 1); dpx(36, y, 15); px(37, y, 1)
end
rect(26, 61, 28, 63, 1)
rect(35, 61, 37, 63, 1)

-- ---------- 6) big round head (3px rim) + ears ----------
ball(31, 27, 17, 16, 6, 17, 0.74)
ball(12, 30, 3, 4, 5, 14, 0.55)
ball(51, 30, 3, 4, 5, 14, 0.55)
px(12, 31, 1); px(51, 31, 1) -- ear canals

-- ---------- 7) face ----------
-- AO shadow line under cap edge
for x = 19, 44 do dpx(x, 23, 5) end
-- sideburns
px(16, 23, 1); px(16, 24, 1); px(17, 25, 1)
px(46, 23, 1); px(46, 24, 1); px(45, 25, 1)
-- cocked brows: viewer-left arched high, right pressed low
for x = 20, 27 do
  local yy = 23 + math.floor(math.abs(x - 23.5) / 2.5)
  px(x, yy, 1); px(x, yy + 1, 1)
end
for x = 35, 42 do
  local yy = 26 - math.floor((x - 35) / 6)
  px(x, yy, 1); px(x, yy + 1, 1)
end
-- eyes: left wide open, right smug squint, pupils glancing right
local function eye(cx, cy, rx, ry)
  for y = math.floor(cy - ry), math.ceil(cy + ry) do
    for x = math.floor(cx - rx), math.ceil(cx + rx) do
      local nx, ny = (x - cx) / rx, (y - cy) / ry
      local d = nx * nx + ny * ny
      if d <= 1 then
        if d >= 0.55 then px(x, y, 1) else px(x, y, 2) end
      end
    end
  end
end
eye(24, 29, 4, 3.2)
eye(39, 29, 3.5, 2.4)
rect(25, 28, 26, 30, 1)
rect(39, 28, 40, 29, 1)
-- small hooked nose
px(32, 31, 1); px(33, 32, 1); px(33, 33, 1); px(32, 34, 1); px(31, 34, 1)
-- cocky smirk: rises to the right, corner tick + crease shading
local mouth = {
  {24,39},{25,39},{26,39},{27,38},{28,38},{29,38},{30,38},
  {31,37},{32,37},{33,37},{34,36},{35,36},{36,35},{37,35},{38,34},
}
for _, p in ipairs(mouth) do px(p[1], p[2], 1); px(p[1], p[2] + 1, 1) end
px(39, 34, 1); px(39, 33, 1)
dpx(37, 37, 5); dpx(38, 36, 5)

-- ---------- 8) backwards cap dome over the head ----------
ball(31, 21, 18, 14, 2, 12, 0.76, 6, 22)
rect(14, 20, 48, 22, 1) -- thick cap band / brow-line outline
-- panel seams radiating from button
for y = 10, 19 do
  local off = 3 + math.floor((y - 10) * 0.7)
  px(31 - off, y, 1); px(31 + off, y, 1)
end
for y = 8, 19 do px(31, y, 1) end
-- top button with glint
rect(30, 6, 32, 8, 1)
px(30, 6, 2)
-- size-strap opening over forehead: dark hole, strap across, hair specks
rect(27, 16, 36, 22, 1)
drect(28, 18, 35, 19, 7)
for x = 28, 35 do if x % 3 == 1 then px(x, 21, 2) end end

-- ---------- save ----------
spr:saveAs(app.fs.joinPath(out, "portrait_newb.aseprite"))
spr:saveAs(app.fs.joinPath(out, "portrait_newb.png"))
print("ASE_GEN_OK")