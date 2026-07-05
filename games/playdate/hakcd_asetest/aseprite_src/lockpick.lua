-- lockpick.lua — HAKCD phreaker-noir workbench lockpick rig
-- 32x32 x 4 frames: padlock clamped in bench vise, two picks crossed in keyway.
-- Anim: picks wiggle 1px alternately, one lock pin glints per frame.

local spr = Sprite(32, 32, ColorMode.INDEXED)
spr.transparentColor = 0

local pal = Palette(3)
pal:setColor(0, Color{r = 0,   g = 0,   b = 0,   a = 0})   -- transparent
pal:setColor(1, Color{r = 0,   g = 0,   b = 0,   a = 255}) -- black
pal:setColor(2, Color{r = 255, g = 255, b = 255, a = 255}) -- white
spr:setPalette(pal)

local TRN, BLK, WHT = 0, 1, 2
local W, H = 32, 32

-- ---------------------------------------------------------------- helpers
local function px(img, x, y, c)
  if x >= 0 and x < W and y >= 0 and y < H then img:putPixel(x, y, c) end
end

local function hline(img, x1, x2, y, c)
  for x = x1, x2 do px(img, x, y, c) end
end

local function vline(img, x, y1, y2, c)
  for y = y1, y2 do px(img, x, y, c) end
end

local function rect(img, x1, y1, x2, y2, c)
  for y = y1, y2 do hline(img, x1, x2, y, c) end
end

-- Bresenham line, thickened downward for 2px silhouette strokes
local function line(img, x1, y1, x2, y2, c, th)
  local dx, dy = math.abs(x2 - x1), math.abs(y2 - y1)
  local sx = (x1 < x2) and 1 or -1
  local sy = (y1 < y2) and 1 or -1
  local err = dx - dy
  while true do
    for t = 0, (th or 1) - 1 do px(img, x1, y1 + t, c) end
    if x1 == x2 and y1 == y2 then break end
    local e2 = 2 * err
    if e2 > -dy then err = err - dy; x1 = x1 + sx end
    if e2 <  dx then err = err + dx; y1 = y1 + sy end
  end
end

-- ---------------------------------------------------------------- one frame
local PINS = {12, 14, 16, 18}        -- pin x positions in tumbler window
local WIG_A = {0, -1, 0, 1}          -- hook pick handle wiggle per frame
local WIG_B = {0, 1, 0, -1}          -- tension wrench wiggle, opposed

local function drawFrame(img, f)
  -- ---- workbench: heavy black mass, checker highlight on the worn edge
  rect(img, 0, 26, 31, 31, BLK)
  for x = 0, 31, 2 do px(img, x, 26, WHT) end
  hline(img, 10, 14, 28, WHT)        -- spare pick lying on the bench
  px(img, 20, 29, WHT)               -- stray screw glint
  px(img, 21, 29, WHT)

  -- ---- bench vise (C-clamp) gripping the lock from the left
  rect(img, 2, 10, 4, 26, BLK)       -- spine, planted on the bench
  rect(img, 5, 11, 9, 13, BLK)       -- top jaw onto lock shoulder
  rect(img, 5, 23, 9, 25, BLK)       -- bottom jaw under lock base
  rect(img, 0, 15, 1, 21, BLK)       -- screw handle bar at frame edge
  rect(img, 1, 17, 3, 18, BLK)       -- screw shaft into spine
  px(img, 3, 11, WHT)                -- worn-metal glint on spine

  -- ---- shackle: 2px black arc over the body
  rect(img, 11, 5, 20, 6, BLK)       -- top bar
  rect(img, 11, 7, 12, 12, BLK)      -- left leg
  rect(img, 19, 7, 20, 12, BLK)      -- right leg
  px(img, 12, 6, WHT)                -- static chrome catch-light

  -- ---- padlock body: 2px outline, white face
  rect(img, 9, 13, 22, 24, BLK)
  rect(img, 11, 15, 20, 22, WHT)

  -- rounded-metal shading: checkerboard dither, right flank + base
  for y = 15, 22 do
    for x = 19, 20 do
      if (x + y) % 2 == 0 then px(img, x, y, BLK) end
    end
  end
  for x = 11, 20 do
    if (x + 22) % 2 == 0 then px(img, x, 22, BLK) end
  end

  -- ---- pin tumbler window: dark chamber, four pins, one glints per frame
  rect(img, 12, 16, 19, 17, BLK)
  for i = 1, 4 do px(img, PINS[i], 17, WHT) end
  px(img, PINS[f], 16, WHT)          -- the set pin flashes bright

  -- ---- keyway: black slot dropping from the pin chamber, flared mouth
  rect(img, 15, 18, 16, 22, BLK)
  hline(img, 14, 17, 22, BLK)

  -- ---- picks: crossed in the keyway, handles fan out lower/upper right
  local wA, wB = WIG_A[f], WIG_B[f]
  -- hook pick: tip at keyway top, shaft down to lower-right handle
  line(img, 16, 19, 30, 24 + wA, BLK, 2)
  rect(img, 28, 23 + wA, 31, 25 + wA, BLK)
  px(img, 29, 24 + wA, WHT)          -- grip highlight
  -- tension wrench: tip at keyway base, shaft up to upper-right handle
  line(img, 16, 22, 31, 12 + wB, BLK, 2)
  rect(img, 29, 11 + wB, 31, 13 + wB, BLK)
  px(img, 30, 12 + wB, WHT)          -- grip highlight
end

-- ---------------------------------------------------------------- frames
for _ = 2, 4 do spr:newEmptyFrame() end

local function frameImage(f)
  for _, c in ipairs(spr.cels) do
    if c.frameNumber == f then return c.image end
  end
  return spr:newCel(spr.layers[1], f).image
end

for f = 1, 4 do
  drawFrame(frameImage(f), f)
end

local tag = spr:newTag(1, 4)
tag.name = "work"

-- ---------------------------------------------------------------- export
local out = os.getenv("ASE_OUT_DIR")
spr:saveAs(app.fs.joinPath(out, "lockpick.aseprite"))
app.command.ExportSpriteSheet{
  ui = false,
  askOverwrite = false,
  type = SpriteSheetType.HORIZONTAL,
  textureFilename = app.fs.joinPath(out, "lockpick-table-32-32.png"),
  dataFilename = "",
}

print("ASE_GEN_OK")