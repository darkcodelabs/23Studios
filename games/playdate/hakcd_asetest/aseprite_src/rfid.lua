-- rfid: RFID reader pedestal station, 32x32, 4 frames
-- Frame plan: badge bobs 1px; dither radio arcs pulse outward r4 -> r6 -> r9 -> emitter blink

local outDir = os.getenv("ASE_OUT_DIR")

local spr = Sprite(32, 32, ColorMode.INDEXED)
spr.transparentColor = 0

local pal = Palette(3)
pal:setColor(0, Color{r=0,   g=0,   b=0,   a=0})   -- transparent
pal:setColor(1, Color{r=0,   g=0,   b=0,   a=255}) -- black
pal:setColor(2, Color{r=255, g=255, b=255, a=255}) -- white
spr:setPalette(pal)

spr:newEmptyFrame()
spr:newEmptyFrame()
spr:newEmptyFrame()

local layer = spr.layers[1]

local function celImage(f)
  for i = 1, #spr.cels do
    local c = spr.cels[i]
    if c.frameNumber == f then return c.image end
  end
  local c = spr:newCel(layer, f)
  return c.image
end

local function px(img, x, y, c)
  if x >= 0 and x < 32 and y >= 0 and y < 32 then
    img:putPixel(x, y, c)
  end
end

local function rect(img, x0, y0, x1, y1, c)
  for y = y0, y1 do
    for x = x0, x1 do px(img, x, y, c) end
  end
end

local function dither(img, x0, y0, x1, y1, c, phase)
  for y = y0, y1 do
    for x = x0, x1 do
      if (x + y + phase) % 2 == 0 then px(img, x, y, c) end
    end
  end
end

-- static pedestal: slab reader head, column, stepped base, plinth, ground shadow
local function drawStation(img)
  -- reader slab (heavy black mass, 2px side walls)
  rect(img, 7, 10, 24, 15, 1)
  rect(img, 9, 11, 22, 13, 2)          -- lit top edge y11 + front face y12..13
  for x = 10, 18 do px(img, x, 12, 1) end   -- card swipe slot
  rect(img, 20, 12, 21, 12, 1)              -- status LED block
  dither(img, 17, 12, 22, 13, 1, 0)         -- right-side face shade
  -- emitter nub on top (arc origin)
  rect(img, 14, 8, 17, 9, 1)

  -- column (2px black flanks, dithered shadow on right of white face)
  rect(img, 11, 16, 20, 26, 1)
  rect(img, 13, 16, 18, 25, 2)
  dither(img, 16, 16, 18, 25, 1, 0)
  -- service panel detail
  rect(img, 14, 20, 17, 22, 1)
  rect(img, 15, 21, 16, 21, 2)

  -- base step with checkered lit lip
  rect(img, 9, 26, 22, 28, 1)
  dither(img, 10, 27, 21, 27, 2, 0)

  -- ground plinth
  rect(img, 7, 29, 24, 31, 1)
  dither(img, 8, 29, 23, 29, 2, 0)

  -- cast shadow dither on ground
  dither(img, 4, 30, 6, 31, 1, 0)
  dither(img, 25, 30, 27, 31, 1, 1)
end

-- hovering ID badge; dy = bob offset
local function drawBadge(img, dy)
  rect(img, 11, 1 + dy, 21, 7 + dy, 1)   -- badge block (2px shadow edge on right)
  rect(img, 12, 2 + dy, 19, 6 + dy, 2)   -- card face
  -- clip slot
  px(img, 15, 2 + dy, 1)
  px(img, 16, 2 + dy, 1)
  px(img, 17, 2 + dy, 1)
  -- photo box + face highlight
  rect(img, 13, 3 + dy, 15, 5 + dy, 1)
  px(img, 14, 4 + dy, 2)
  -- text lines
  for x = 17, 19 do px(img, x, 3 + dy, 1) end
  for x = 17, 19 do px(img, x, 5 + dy, 1) end
end

-- dithered radio arc centered on emitter nub, flattened for 3/4 view
local function drawArc(img, cx, cy, r, phase)
  for deg = 10, 170, 4 do
    local a = math.rad(deg)
    local x = math.floor(cx + r * math.cos(a) + 0.5)
    local y = math.floor(cy - r * math.sin(a) * 0.85 + 0.5)
    if (x + y + phase) % 2 == 0 then px(img, x, y, 1) end
  end
end

local bob  = {0, 1, 1, 0}
local arcR = {4, 6, 9, 0}

for f = 1, 4 do
  local img = celImage(f)
  drawStation(img)
  if arcR[f] > 0 then
    drawArc(img, 16, 9, arcR[f], f)
  end
  drawBadge(img, bob[f])   -- badge over arcs so pulses wrap around it
  if f == 4 then
    -- emitter recharge blink between pulses
    px(img, 15, 8, 2)
    px(img, 16, 8, 2)
  end
end

local tag = spr:newTag(1, 4)
tag.name = "pulse"

spr:saveAs(app.fs.joinPath(outDir, "rfid.aseprite"))
app.command.ExportSpriteSheet{
  ui = false,
  askOverwrite = false,
  type = SpriteSheetType.HORIZONTAL,
  textureFilename = app.fs.joinPath(outDir, "rfid-table-32-32.png"),
  dataFilename = ""
}

print("ASE_GEN_OK")