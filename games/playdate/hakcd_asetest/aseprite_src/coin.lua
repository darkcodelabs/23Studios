-- coin: quarter spin loop, 4 frames (full / narrow / edge / narrow)
-- HAKCD phreaker-noir: 2px black outline, white face, checker dither shade + glint

local outDir = os.getenv("ASE_OUT_DIR")

local spr = Sprite(16, 16, ColorMode.INDEXED)
spr.transparentColor = 0

local pal = Palette(3)
pal:setColor(0, Color{r = 0,   g = 0,   b = 0,   a = 0})   -- transparent
pal:setColor(1, Color{r = 0,   g = 0,   b = 0,   a = 255}) -- black
pal:setColor(2, Color{r = 255, g = 255, b = 255, a = 255}) -- white
spr:setPalette(pal)

-- frame 1 exists; add 2..4
spr:newEmptyFrame()
spr:newEmptyFrame()
spr:newEmptyFrame()

local layer = spr.layers[1]
local cel1  = spr.cels[1]

local CX, CY = 7.5, 7.5

local function inEllipse(x, y, rx, ry)
  local dx = (x - CX) / rx
  local dy = (y - CY) / ry
  return dx * dx + dy * dy <= 1.0
end

-- rx/ry: outer ellipse radii. Outline is 2px (inner = r-2).
-- side: +1 shades lower-right, -1 lower-left (mirrors as coin turns).
-- parity: checker phase, varies per frame so dither shimmers.
-- inner radius <= 0.4 => solid black slab (edge-on frame).
local function drawCoin(img, rx, ry, parity, side)
  local irx = rx - 2
  local iry = ry - 2
  for y = 0, 15 do
    for x = 0, 15 do
      if inEllipse(x, y, rx, ry) then
        if irx > 0.4 and iry > 0.4 and inEllipse(x, y, irx, iry) then
          -- white face with checkerboard shadow toward the turn side
          local ndx = ((x - CX) / irx) * side
          local ndy = (y - CY) / iry
          local px = 2
          if (ndx + ndy) > 0.45 and ((x + y) % 2) == parity then
            px = 1
          end
          img:putPixel(x, y, px)
        else
          img:putPixel(x, y, 1) -- 2px outline / solid edge
        end
      end
    end
  end
end

-- frame specs: full circle -> narrow ellipse -> edge-on line -> narrow ellipse
local frames = {
  { rx = 7.0, ry = 7.0, parity = 0, side =  1,
    glint = { {6, 3}, {4, 5} } },              -- dithered diagonal sparkle, upper-left
  { rx = 3.5, ry = 7.0, parity = 0, side =  1,
    glint = { {7, 4} } },
  { rx = 1.6, ry = 7.0, parity = 0, side =  1,
    glint = {} },                              -- edge-on: solid black bar, 2px min
  { rx = 3.5, ry = 7.0, parity = 1, side = -1,
    glint = { {8, 4} } },                      -- mirrored shade + glint (back face)
}

for f = 1, 4 do
  local cel
  if f == 1 then
    cel = cel1
  else
    cel = spr:newCel(layer, f)
  end
  local img = cel.image
  local spec = frames[f]
  drawCoin(img, spec.rx, spec.ry, spec.parity, spec.side)
  for _, g in ipairs(spec.glint) do
    img:putPixel(g[1], g[2], 1)
  end
end

local tag = spr:newTag(1, 4)
tag.name = "spin"

spr:saveAs(app.fs.joinPath(outDir, "coin.aseprite"))

app.command.ExportSpriteSheet{
  ui = false,
  askOverwrite = false,
  type = SpriteSheetType.HORIZONTAL,
  textureFilename = app.fs.joinPath(outDir, "coin-table-16-16.png"),
  dataFilename = "",
}

print("ASE_GEN_OK")