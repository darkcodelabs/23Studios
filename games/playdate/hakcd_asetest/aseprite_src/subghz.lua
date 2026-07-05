-- subghz radio tuner station — 32x32 x 4 frames, HAKCD phreaker-noir
-- palette: 0 transparent, 1 black, 2 white. shading = checkerboard dither only.

local W, H, FRAMES = 32, 32, 4

local spr = Sprite(W, H, ColorMode.INDEXED)
spr.transparentColor = 0

local pal = Palette(3)
pal:setColor(0, Color{r=0,   g=0,   b=0,   a=0})
pal:setColor(1, Color{r=0,   g=0,   b=0,   a=255})
pal:setColor(2, Color{r=255, g=255, b=255, a=255})
spr:setPalette(pal)

for _ = 2, FRAMES do spr:newEmptyFrame() end

-- ---------- helpers ----------
local function px(img, x, y, c)
  if x >= 0 and x < W and y >= 0 and y < H then
    img:putPixel(x, y, c)
  end
end

local function rect(img, x0, y0, x1, y1, c)
  for y = y0, y1 do
    for x = x0, x1 do px(img, x, y, c) end
  end
end

local function line(img, x0, y0, x1, y1, c)
  local dx = math.abs(x1 - x0)
  local dy = -math.abs(y1 - y0)
  local sx = (x0 < x1) and 1 or -1
  local sy = (y0 < y1) and 1 or -1
  local err = dx + dy
  while true do
    px(img, x0, y0, c)
    if x0 == x1 and y0 == y1 then break end
    local e2 = 2 * err
    if e2 >= dy then err = err + dy; x0 = x0 + sx end
    if e2 <= dx then err = err + dx; y0 = y0 + sy end
  end
end

-- ---------- animation data ----------
-- dial needle endpoints (center 10,20), sweep left -> right across frames
local NEEDLE = {
  {7, 18},
  {9, 17},
  {11, 17},
  {13, 18},
}

-- signal dots rippling off antenna tip (~28,2), expanding arcs
local DOTS = {
  { {26,1}, {28,0}, {30,1} },
  { {24,0}, {31,0} },
  { {25,1}, {28,0}, {31,1} },
  { {23,0}, {27,0}, {31,0} },
}

-- ---------- per-frame draw ----------
local function drawFrame(img, f)
  -- whip antenna: 2px stroke rising from body top to upper right
  line(img, 23, 12, 27, 4, 1)
  line(img, 24, 12, 28, 4, 1)
  -- antenna tip knob 2x2
  rect(img, 27, 2, 28, 3, 1)

  -- signal ripple dots for this frame
  for _, d in ipairs(DOTS[f]) do
    px(img, d[1], d[2], 1)
  end

  -- boxy bench-radio body: heavy 2px black outline
  rect(img, 2, 12, 29, 29, 1)   -- black mass
  rect(img, 4, 14, 27, 27, 2)   -- white faceplate

  -- dither shadow under top lip (three-quarter read)
  for y = 14, 15 do
    for x = 4, 27 do
      if (x + y) % 2 == 0 then px(img, x, y, 1) end
    end
  end
  -- dither shade on right inner edge (side falloff)
  for y = 16, 27 do
    if y % 2 == 0 then px(img, 27, y, 1) end
  end
  -- dither floor shadow along bottom face row
  for x = 4, 16 do
    if x % 2 == 0 then px(img, x, 27, 1) end
  end

  -- speaker grille: vertical slats, right side of face
  for _, gx in ipairs({18, 20, 22, 24, 26}) do
    for y = 16, 26 do px(img, gx, y, 1) end
  end

  -- round dial: black ring, white face (center 10,20 r~5)
  for y = 15, 25 do
    for x = 5, 15 do
      local dx, dy = x - 10, y - 20
      local d2 = dx * dx + dy * dy
      if d2 <= 30 then
        if d2 >= 17 then px(img, x, y, 1) else px(img, x, y, 2) end
      end
    end
  end
  -- top tick mark
  px(img, 10, 17, 1)

  -- sweeping needle + hub
  local n = NEEDLE[f]
  line(img, 10, 20, n[1], n[2], 1)
  px(img, 9, 20, 1)
  px(img, 10, 21, 1)

  -- tuning knobs under dial
  rect(img, 6, 26, 7, 27, 1)
  rect(img, 12, 26, 13, 27, 1)

  -- feet
  rect(img, 4, 30, 7, 31, 1)
  rect(img, 24, 30, 27, 31, 1)
end

for f = 1, FRAMES do
  local img
  if f == 1 then
    img = spr.cels[1].image
  else
    img = spr:newCel(spr.layers[1], f).image
  end
  drawFrame(img, f)
end

local tag = spr:newTag(1, FRAMES)
tag.name = "scan"

-- ---------- export ----------
local out = os.getenv("ASE_OUT_DIR")
spr:saveAs(app.fs.joinPath(out, "subghz.aseprite"))
app.command.ExportSpriteSheet{
  ui = false,
  askOverwrite = false,
  type = SpriteSheetType.HORIZONTAL,
  textureFilename = app.fs.joinPath(out, "subghz-table-32-32.png"),
  dataFilename = "",
}

print("ASE_GEN_OK")