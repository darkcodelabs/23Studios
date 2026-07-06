-- coin — 16x16 quarter, 4-frame spin: face -> 3/4 -> edge-on -> 3/4 (reverse)
-- HAKCD house style: 1-bit, Bayer-dithered silver, 2px silhouette, glint sweep.

local outDir = os.getenv("ASE_OUT_DIR")

local spr = Sprite(16, 16, ColorMode.INDEXED)
spr.transparentColor = 0

local pal = Palette(3)
pal:setColor(0, Color{ r = 0,   g = 0,   b = 0,   a = 0   })  -- transparent
pal:setColor(1, Color{ r = 0,   g = 0,   b = 0,   a = 255 })  -- black
pal:setColor(2, Color{ r = 255, g = 255, b = 255, a = 255 })  -- white
spr:setPalette(pal)

spr:newEmptyFrame()
spr:newEmptyFrame()
spr:newEmptyFrame()

local layer = spr.layers[1]

-- coin vertical semi-axis: 14px tall disc, 1px margin top/bottom
local RY = 6.9

-- clustered 4x4 Bayer matrix — the shading engine
local bayer = {
  {  0,  8,  2, 10 },
  { 12,  4, 14,  6 },
  {  3, 11,  1,  9 },
  { 15,  7, 13,  5 },
}

-- normalized ellipse distance, pixel centers at +0.5, canvas center 8.0
local function edist(x, y, rx, ry)
  local dx = (x + 0.5 - 8.0) / rx
  local dy = (y + 0.5 - 8.0) / ry
  return dx * dx + dy * dy
end

-- frame 1 obverse: tiny Washington bust facing left, white relief glint on head
local HEADS = {
  {7,4,1},{8,4,1},
  {6,5,1},{7,5,1},{8,5,1},{9,5,1},
  {6,6,1},{7,6,2},{8,6,1},{9,6,1},
  {5,7,1},{6,7,1},{7,7,1},{8,7,1},{9,7,1},      -- nose notch at x=5
  {6,8,1},{7,8,1},{8,8,1},{9,8,1},
  {7,9,1},{8,9,1},{9,9,1},
  {6,10,1},{7,10,1},{8,10,1},{9,10,1},{10,10,1}, -- bust base
}

-- frame 2: same bust, foreshortened by the turn
local HEADS_SQZ = {
  {7,5,1},{8,5,1},
  {6,6,1},{7,6,1},{8,6,1},
  {6,7,1},{7,7,1},{8,7,1},
  {7,8,1},{8,8,1},
  {7,9,1},{8,9,1},
  {6,10,1},{7,10,1},{8,10,1},
}

-- frame 4: reverse face coming around — eagle, wings spread, foreshortened
local EAGLE_SQZ = {
  {7,5,1},{8,5,1},                                -- head
  {5,6,1},{6,6,1},{9,6,1},{10,6,1},               -- wing tips
  {6,7,1},{7,7,1},{8,7,1},{9,7,1},                -- wings
  {7,8,1},{8,8,1},                                -- body
  {7,9,1},{8,9,1},                                -- tail
  {6,10,1},{7,10,1},{8,10,1},{9,10,1},            -- olive branch
}

local function drawFace(img, rx, gA, gB, detail)
  for y = 0, 15 do
    for x = 0, 15 do
      if edist(x, y, rx, RY) <= 1.0 then
        if edist(x, y, rx - 2.0, RY - 2.0) > 1.0 then
          img:putPixel(x, y, 1)                   -- 2px silhouette stroke
        else
          local nx = (x + 0.5 - 8.0) / rx
          local ny = (y + 0.5 - 8.0) / RY
          local b = 11 - 6 * (nx + ny)            -- lit from upper-left
          if edist(x, y, rx - 3.2, RY - 3.2) > 1.0 then
            b = b - 5                             -- darker denticle rim ring
          end
          local g = (x + 0.5 - 8.0) + (y + 0.5 - 8.0)
          if g >= gA and g <= gB then
            b = 99                                -- glint sweep band, forces white
          end
          local t = bayer[(y % 4) + 1][(x % 4) + 1]
          img:putPixel(x, y, (b > t) and 2 or 1)
        end
      end
    end
  end
  for _, p in ipairs(detail) do
    img:putPixel(p[1], p[2], p[3])
  end
end

-- edge-on frame: 6px bar, 2px black rails each side, bright reeded core = flash
local function drawEdge(img)
  for y = 3, 12 do
    img:putPixel(5, y, 1)
    img:putPixel(10, y, 1)
  end
  for y = 2, 13 do
    img:putPixel(6, y, 1)
    img:putPixel(9, y, 1)
    img:putPixel(7, y, 2)
    img:putPixel(8, y, 2)
  end
  for x = 6, 9 do                                 -- rounded caps
    img:putPixel(x, 1, 1)
    img:putPixel(x, 14, 1)
  end
  for y = 3, 12, 3 do                             -- angled reeding ticks
    img:putPixel(7, y, 1)
    img:putPixel(8, y + 1, 1)
  end
end

-- glint band walks upper-left -> center -> (edge flash) -> lower-right
local frames = {
  { rx = 6.9, gA = -6, gB = -3, detail = HEADS },
  { rx = 5.2, gA = -2, gB =  1, detail = HEADS_SQZ },
  false,
  { rx = 5.2, gA =  3, gB =  6, detail = EAGLE_SQZ },
}

local function celFor(f)
  for _, c in ipairs(spr.cels) do
    if c.frameNumber == f then return c end
  end
  return spr:newCel(layer, f)
end

for f = 1, 4 do
  local img = celFor(f).image
  if f == 3 then
    drawEdge(img)
  else
    local p = frames[f]
    drawFace(img, p.rx, p.gA, p.gB, p.detail)
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