-- portrait_newb.png — 64x64 dialogue portrait, HAKCD phreaker-noir 1-bit
-- scrawny 17yo: backwards cap, headphones round neck, faint smirk, hoodie

local OUT = os.getenv("ASE_OUT_DIR")

local spr = Sprite(64, 64, ColorMode.INDEXED)
spr.transparentColor = 0
local pal = Palette(3)
pal:setColor(0, Color{r=0,   g=0,   b=0,   a=0})
pal:setColor(1, Color{r=0,   g=0,   b=0,   a=255})
pal:setColor(2, Color{r=255, g=255, b=255, a=255})
spr:setPalette(pal)

local img = spr.cels[1].image
local W, H = 64, 64
local K, Wt = 1, 2 -- black, white

local function px(x, y, c)
  if x >= 0 and x < W and y >= 0 and y < H then img:putPixel(x, y, c) end
end
local function hl(x1, x2, y, c) for x = x1, x2 do px(x, y, c) end end
local function rect(x1, y1, x2, y2, c) for y = y1, y2 do hl(x1, x2, y, c) end end
local function dither(x1, y1, x2, y2, c, par)
  for y = y1, y2 do for x = x1, x2 do
    if (x + y) % 2 == par then px(x, y, c) end
  end end
end

-- ============ BACKGROUND: black + sparse dot grid (fills full canvas) ======
rect(0, 0, 63, 63, K)
for y = 0, 63 do for x = 0, 63 do
  if (x % 4 == 0 and y % 4 == 0) or (x % 4 == 2 and y % 4 == 2) then
    px(x, y, Wt)
  end
end end

-- ============ HOODIE: heavy black shoulder mass, edge-to-edge bottom ======
local hood = {
  [43] = {24, 38}, [44] = {21, 41}, [45] = {18, 44}, [46] = {15, 47},
  [47] = {12, 50}, [48] = { 9, 53}, [49] = { 6, 55}, [50] = { 4, 57},
  [51] = { 3, 59}, [52] = { 2, 60}, [53] = { 1, 61}, [54] = { 0, 62},
}
for y = 43, 54 do local s = hood[y]; hl(s[1], s[2], y, K) end
rect(0, 55, 63, 63, K)
-- white 2px sloped silhouette edges so shoulders read against dark bg
for y = 44, 53 do
  local s = hood[y]
  px(s[1], y, Wt); px(s[1] + 1, y, Wt)
  px(s[2], y, Wt); px(s[2] - 1, y, Wt)
end
-- sparse fabric dither dots
for y = 48, 63 do
  local L, R = 2, 61
  local s = hood[y]
  if s then L, R = s[1] + 3, s[2] - 3 end
  for x = L, R do
    if x % 4 == 1 and y % 4 == 0 then px(x, y, Wt) end
  end
end
-- shoulder crease lines
hl(9, 13, 57, Wt)
hl(50, 54, 57, Wt)

-- ============ NECK: skinny, jaw shadow dither ============================
rect(25, 33, 36, 46, K)   -- black slab (rim)
rect(27, 34, 34, 44, Wt)  -- inner skin
dither(27, 37, 34, 39, K, 0) -- shadow under jaw

-- ============ FACE: narrow tapered jaw, 2px rim ==========================
local face = {
  [12] = {21, 41},
  [13] = {20, 42}, [14] = {20, 42}, [15] = {20, 42}, [16] = {20, 42},
  [17] = {20, 42}, [18] = {20, 42}, [19] = {20, 42}, [20] = {20, 42},
  [21] = {20, 42}, [22] = {20, 42}, [23] = {20, 42}, [24] = {20, 42},
  [25] = {20, 42}, [26] = {20, 42}, [27] = {20, 42},
  [28] = {21, 41}, [29] = {21, 40}, [30] = {22, 39}, [31] = {22, 38},
  [32] = {23, 37}, [33] = {24, 36}, [34] = {25, 35}, [35] = {26, 34},
  [36] = {27, 33},
}
for y = 12, 36 do local s = face[y]; hl(s[1], s[2], y, K) end
for y = 14, 34 do local s = face[y]; hl(s[1] + 2, s[2] - 2, y, Wt) end
-- right-side checker shadow (light from upper-left)
for y = 15, 33 do
  local s = face[y]
  for x = 37, s[2] - 2 do
    if (x + y) % 2 == 0 then px(x, y, K) end
  end
end
-- cap shadow band across forehead
dither(24, 16, 40, 17, K, 0)

-- ear (right side, 3/4 view)
hl(42, 44, 21, K)
rect(42, 22, 45, 26, K)
hl(42, 44, 27, K)
rect(43, 23, 44, 25, Wt)
px(44, 24, K)

-- ============ BACKWARDS CAP: crown + brim pointing back-right ============
local cap = {
  [5]  = {26, 36}, [6]  = {23, 39}, [7]  = {22, 40}, [8]  = {21, 41},
  [9]  = {20, 42}, [10] = {20, 42}, [11] = {19, 42}, [12] = {19, 42},
  [13] = {19, 42}, [14] = {20, 42}, [15] = {21, 41},
}
for y = 5, 15 do local s = cap[y]; hl(s[1], s[2], y, K) end
-- dither highlight on crown, upper-left
for y = 6, 9 do
  for x = cap[y][1] + 2, 30 do
    if (x + y) % 2 == 0 then px(x, y, Wt) end
  end
end
-- panel seam stitches
for y = 6, 13, 2 do px(31, y, Wt) end
-- strap-gap at front: forehead skin shows through
rect(22, 13, 26, 14, Wt)
-- brim (backwards, juts behind head)
rect(42, 11, 53, 14, K)
hl(43, 52, 10, Wt)          -- top white edge
px(53, 11, Wt); px(54, 12, Wt); px(54, 13, Wt); px(53, 14, Wt)
hl(43, 52, 15, Wt)          -- bottom white edge
for x = 44, 50, 2 do px(x, 12, Wt) end -- sheen dashes

-- ============ FEATURES: smug, faint smirk, raised brow ===================
hl(24, 28, 20, K)           -- left brow flat
hl(33, 37, 19, K)           -- right brow raised (smug)
px(37, 20, K)
rect(25, 22, 26, 23, K)     -- left eye
rect(34, 22, 35, 23, K)     -- right eye
px(30, 25, K); px(30, 26, K) -- nose bridge
px(29, 27, K); px(30, 27, K) -- nostril base
hl(26, 31, 31, K)           -- mouth
px(32, 30, K); px(33, 30, K) -- smirk corner lifts right

-- ============ HEADPHONES ROUND NECK: cups + band =========================
local function cup(x0)
  hl(x0 + 1, x0 + 6, 39, Wt)
  for y = 40, 48 do hl(x0, x0 + 7, y, Wt) end
  hl(x0 + 1, x0 + 6, 49, Wt)
  hl(x0 + 2, x0 + 5, 40, K)
  for y = 41, 47 do hl(x0 + 1, x0 + 6, y, K) end
  hl(x0 + 2, x0 + 5, 48, K)
  px(x0 + 2, 42, Wt); px(x0 + 3, 42, Wt); px(x0 + 2, 43, Wt)
end
cup(15) -- left cup
cup(39) -- right cup
-- band draped across front of neck
hl(21, 24, 42, K); hl(37, 40, 42, K)
hl(21, 25, 43, K); hl(36, 40, 43, K)
hl(22, 39, 44, K)
hl(23, 38, 45, K)
hl(25, 36, 46, K)

-- ============ HOODIE DRAWSTRINGS ========================================
for y = 47, 56 do px(27, y, Wt); px(34, y, Wt) end
rect(26, 57, 27, 58, Wt)
rect(34, 57, 35, 58, Wt)

-- ============ FLATTEN + SAVE ============================================
spr:flatten()
spr:saveAs(app.fs.joinPath(OUT, "portrait_newb.aseprite"))
spr:saveAs(app.fs.joinPath(OUT, "portrait_newb.png"))

print("ASE_GEN_OK")