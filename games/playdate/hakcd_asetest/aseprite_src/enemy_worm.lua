-- enemy_worm: isometric data-worm, 4-frame slither loop, 32x32 1-bit Playdate
local W, H, FRAMES = 32, 32, 4

local spr = Sprite(W, H, ColorMode.INDEXED)
spr.transparentColor = 0

local pal = Palette(3)
pal:setColor(0, Color{r=0,   g=0,   b=0,   a=0})
pal:setColor(1, Color{r=0,   g=0,   b=0,   a=255})
pal:setColor(2, Color{r=255, g=255, b=255, a=255})
spr:setPalette(pal)

for _ = 2, FRAMES do spr:newEmptyFrame() end

local layer = spr.layers[1]

local function imageFor(f)
  if f == 1 and #spr.cels > 0 then return spr.cels[1].image end
  return spr:newCel(layer, f).image
end

local function px(img, x, y, c)
  if x >= 0 and x < W and y >= 0 and y < H then img:putPixel(x, y, c) end
end

local function fillRect(img, x0, y0, x1, y1, c)
  for y = y0, y1 do
    for x = x0, x1 do px(img, x, y, c) end
  end
end

-- bright block: 2px black shell, white core, checker dither on lower rows for volume
local function block(img, cx, cy, w, h)
  local x0 = cx - math.floor(w / 2)
  local y0 = cy - math.floor(h / 2)
  local x1, y1 = x0 + w - 1, y0 + h - 1
  fillRect(img, x0, y0, x1, y1, 1)
  fillRect(img, x0 + 2, y0 + 2, x1 - 2, y1 - 2, 2)
  if h >= 9 then
    for y = y1 - 3, y1 - 2 do
      for x = x0 + 2, x1 - 2 do
        if (x + y) % 2 == 0 then px(img, x, y, 1) end
      end
    end
  end
  return x0, y0, x1, y1
end

-- travelling sine wave, +-2px, quarter-period step per frame
local function wave(i, f)
  local ph = (f - 1) * math.pi / 2
  return math.floor(2 * math.sin(ph + i * 1.3) + 0.5)
end

-- flickering dither static shed behind the tail (drawn first, body overdraws)
local function staticTrail(img, tx, ty, f)
  for dx = -9, -2 do
    for dy = -7, 5 do
      local x, y = tx + dx, ty + dy
      if math.abs(dy - math.floor(dx * 2 / 3)) <= 3 then
        local along = -dx
        if (x * 13 + y * 29 + f * 7) % (3 + along) == 0 then
          px(img, x, y, 2)
          if (x + y + f) % 2 == 0 then px(img, x + 1, y, 2) end
        end
      end
    end
  end
end

local SEG_W = {7, 8, 9, 10}   -- tail -> neck, blocks grow toward head
local SCAN  = {-2, 0, 2, 0}   -- eye ping-pong sweep

for f = 1, FRAMES do
  local img = imageFor(f)

  -- static trail anchored at tail
  local tx, ty = 9, 9 + wave(0, f)
  staticTrail(img, tx, ty, f)

  -- body segments marching down-right (isometric diagonal), tail first
  for i = 0, 3 do
    local cx = 9 + i * 4
    local cy = 9 + math.floor(i * 2.5 + 0.5) + wave(i, f)
    block(img, cx, cy, SEG_W[i + 1], SEG_W[i + 1])
  end

  -- blunt head drawn last so it reads in front
  local hx = 25
  local hy = 19 + wave(4, f)
  block(img, hx, hy, 12, 11)

  -- single scanning eye: 3x3 black lens with white glint core
  local ex = hx + SCAN[f]
  fillRect(img, ex - 1, hy - 2, ex + 1, hy, 1)
  px(img, ex, hy - 1, 2)
end

local tag = spr:newTag(1, FRAMES)
tag.name = "slither"

local outDir = os.getenv("ASE_OUT_DIR")
spr:saveAs(app.fs.joinPath(outDir, "enemy_worm.aseprite"))
app.command.ExportSpriteSheet{
  ui = false,
  askOverwrite = false,
  type = SpriteSheetType.HORIZONTAL,
  textureFilename = app.fs.joinPath(outDir, "enemy_worm-table-32-32.png"),
  dataFilename = ""
}

print("ASE_GEN_OK")