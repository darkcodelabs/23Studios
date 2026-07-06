-- portrait_mentor: MARIO-64 style 1-bit dialogue portrait, 64x64
-- weary bearded 40s hacker mentor — big round head, glasses, knowing half-smile
-- key light upper-left, Bayer-dither gradient ramps for volume, 3px silhouette

local floor, sqrt, max = math.floor, math.sqrt, math.max

local spr = Sprite(64, 64, ColorMode.INDEXED)
spr.transparentColor = 0
local pal = Palette(3)
pal:setColor(0, Color{r = 0, g = 0, b = 0, a = 0})
pal:setColor(1, Color{r = 0, g = 0, b = 0, a = 255})
pal:setColor(2, Color{r = 255, g = 255, b = 255, a = 255})
spr:setPalette(pal)

local img = spr.cels[1].image

-- 4x4 Bayer matrix: lv in [0,1] -> black(1) or white(2)
local B = {
  {0, 8, 2, 10},
  {12, 4, 14, 6},
  {3, 11, 1, 9},
  {15, 7, 13, 5},
}
local function sh(x, y, lv)
  if lv >= 1 then return 2 end
  if lv <= 0 then return 1 end
  return lv > (B[y % 4 + 1][x % 4 + 1] + 0.5) / 16 and 2 or 1
end

-- head ellipse: big rounded N64 noggin
local CX, CY, RX, RY = 32, 27, 18, 20

-- messy hairline, deterministic jitter
local function hairY(x)
  return 13 + ((x * 5 + 2) % 7) * 0.5
end

-- ============ base pass: full canvas, edge to edge ============
for y = 0, 63 do
  for x = 0, 63 do
    local dx = x - CX
    local adx = dx < 0 and -dx or dx
    local nx, ny = dx / RX, (y - CY) / RY
    local rr = nx * nx + ny * ny
    local lv

    if rr <= 1 then
      -- HEAD
      local ix, iy = dx / (RX - 3), (y - CY) / (RY - 3)
      if ix * ix + iy * iy > 1 then
        lv = 0 -- 3px black contour ring on silhouette
      elseif y < hairY(x) or (adx >= 15 and y <= 30) then
        -- messy dark hair + side hair, upper-left sheen band
        lv = 0.12
        local hx, hy = (x - 25) / 9, (y - 11) / 5
        if hx * hx + hy * hy <= 1 then lv = 0.55 end
        if (x * 3 + y) % 7 == 0 then lv = lv + 0.18 end
      elseif (y >= 36 or (y >= 31 and adx >= 11))
          and not (y >= 39 and y <= 42 and adx <= 5) then
        -- full beard + mustache (mouth patch cut out), salt-and-pepper
        lv = 0.42 - 0.25 * nx - 0.12 * (y - 34) / 12
        if (x * 2 + y) % 5 == 0 then lv = lv - 0.15 end
        if (x * 7 + y * 3) % 11 == 0 then lv = lv + 0.35 end
      else
        -- SKIN: lambert-ish ramp from upper-left + AO ring at rim
        lv = 0.92 - 0.38 * nx - 0.28 * ny - max(0, rr - 0.55) * 0.9
        -- tired under-eye bags
        local ex = (x - 24) / 3.5
        local ey = (y - 33) / 2.0
        if ex * ex + ey * ey <= 1 then lv = lv - 0.3 end
        ex = (x - 40) / 3.5
        if ex * ex + ey * ey <= 1 then lv = lv - 0.3 end
        -- lens interiors catch light
        local ld = (x - 24) ^ 2 + (y - 29) ^ 2
        if ld <= 21 then lv = lv + 0.12 end
        ld = (x - 40) ^ 2 + (y - 29) ^ 2
        if ld <= 21 then lv = lv + 0.12 end
      end
    else
      local t = 49 + dx * dx / 56 -- rounded shoulder top curve
      if y >= 44 and y <= 52 and adx <= 5 then
        lv = 0.12 -- neck sunk in chin shadow
      elseif y >= t then
        if y < t + 3 then
          lv = 0 -- 3px shoulder contour
        else
          -- hoodie: lit from upper-left, gentle vertical falloff
          lv = 0.62 - 0.5 * x / 64 - 0.015 * (y - 50)
          if adx < 16 and y < t + 6 then lv = 0.15 end -- collar band
          local sx, sy = dx / 12, (y - 52) / 5
          if sx * sx + sy * sy <= 1 then lv = lv * 0.3 end -- head cast shadow
        end
      else
        -- background: soft dither halo glow around the head, black corners
        local d = sqrt(dx * dx + (y - 26) * (y - 26))
        lv = max(0, 0.9 - d / 30)
      end
    end
    img:putPixel(x, y, sh(x, y, lv))
  end
end

-- ============ detail overlays ============
local function pp(x, y, c) img:putPixel(x, y, c) end

-- forehead worry lines (dashed, subtle)
for x = 27, 37, 2 do pp(x, 18, 1) end
for x = 25, 39, 2 do pp(x, 21, 1) end

-- round glasses rims, 2px thick
for i = 0, 1 do
  local lcx = i == 0 and 24 or 40
  for yy = 22, 36 do
    for xx = lcx - 7, lcx + 7 do
      local d = (xx - lcx) ^ 2 + (yy - 29) ^ 2
      if d >= 21.16 and d <= 43.56 then pp(xx, yy, 1) end
    end
  end
end
-- bridge + temple arms
for xx = 29, 35 do pp(xx, 27, 1); pp(xx, 28, 1) end
for xx = 15, 18 do pp(xx, 28, 1); pp(xx, 29, 1) end
for xx = 46, 49 do pp(xx, 28, 1); pp(xx, 29, 1) end
-- lens glints, upper-left
pp(21, 26, 2); pp(22, 26, 2); pp(21, 27, 2)
pp(37, 26, 2); pp(38, 26, 2); pp(37, 27, 2)

-- weary-kind brows: inner ends raised
for i = 0, 8 do
  local by = 24 - floor(i / 4)
  pp(19 + i, by, 1); pp(19 + i, by + 1, 1)
  pp(45 - i, by, 1); pp(45 - i, by + 1, 1)
end

-- tired half-lidded eyes: droopy lid line, pupils peeking under
for xx = 21, 27 do pp(xx, 29, 1) end
for xx = 37, 43 do pp(xx, 29, 1) end
pp(24, 30, 1); pp(25, 30, 1); pp(24, 31, 1); pp(25, 31, 1)
pp(39, 30, 1); pp(40, 30, 1); pp(39, 31, 1); pp(40, 31, 1)
-- kind spark in each pupil (upper-left catchlight)
pp(24, 30, 2); pp(39, 30, 2)
-- under-eye bag dashes
pp(22, 33, 1); pp(24, 33, 1); pp(26, 33, 1)
pp(38, 33, 1); pp(40, 33, 1); pp(42, 33, 1)

-- nose: ridge shadow on dark side, nostrils
pp(34, 30, 1); pp(34, 32, 1); pp(34, 34, 1)
pp(29, 35, 1); pp(30, 35, 1); pp(34, 35, 1); pp(35, 35, 1)

-- knowing half-smile: rises to the right, corner curl
for xx = 28, 36 do
  pp(xx, 41 - floor((xx - 28) / 4), 1)
end
pp(37, 39, 1); pp(37, 40, 1)
-- lower lip sheen
pp(29, 42, 2); pp(30, 42, 2); pp(31, 42, 2)

-- hoodie drawstrings
for yy = 56, 63 do
  pp(27, yy, 1); pp(28, yy, 1)
  pp(36, yy, 1); pp(37, yy, 1)
end

-- collectathon sparkles in the backdrop
local function spark(sx, sy)
  pp(sx, sy, 2); pp(sx - 1, sy, 2); pp(sx + 1, sy, 2)
  pp(sx, sy - 1, 2); pp(sx, sy + 1, 2)
end
spark(9, 10); spark(54, 13); spark(6, 40)

-- ============ save ============
local out = os.getenv("ASE_OUT_DIR")
spr:saveAs(app.fs.joinPath(out, "portrait_mentor.aseprite"))
spr:saveAs(app.fs.joinPath(out, "portrait_mentor.png"))
print("ASE_GEN_OK")