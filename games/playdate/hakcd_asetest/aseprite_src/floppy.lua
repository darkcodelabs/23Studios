-- floppy: 16x16 4-frame gleam loop, HAKCD 1-bit house style
-- palette: 0 transparent, 1 black, 2 white (hard rule)

local outDir = os.getenv("ASE_OUT_DIR")

local spr = Sprite(16, 16, ColorMode.INDEXED)
spr.transparentColor = 0

local pal = Palette(3)
pal:setColor(0, Color{ r = 0,   g = 0,   b = 0,   a = 0   })
pal:setColor(1, Color{ r = 0,   g = 0,   b = 0,   a = 255 })
pal:setColor(2, Color{ r = 255, g = 255, b = 255, a = 255 })
spr:setPalette(pal)

-- Base plate, hand-authored per pixel.
-- '.' transparent  '#' outline black (gleam never touches)
-- 'w' white plastic/label  'b' black detail (label lines, shutter slot,
-- write-protect holes)  'm' shutter metal = checkerboard dither
-- Silhouette: clipped insertion corner top-right, metal shutter y2..y6
-- with read-window slot, big white label y8..y14 with print lines,
-- two HD write-protect holes on the bottom rail.
local rows = {
  ".############...",
  ".#wwwwwwwwwww#..",
  ".#ww########ww#.",
  ".#ww#mbbmmm#ww#.",
  ".#ww#mbbmmm#ww#.",
  ".#ww#mbbmmm#ww#.",
  ".#ww########ww#.",
  ".#wwwwwwwwwwww#.",
  ".#w##########w#.",
  ".#w#wwwwwwww#w#.",
  ".#w#bbbbbbbw#w#.",
  ".#w#wwwwwwww#w#.",
  ".#w#bbbbbwww#w#.",
  ".#b#wwwwwwww#b#.",
  ".#w##########w#.",
  ".##############.",
}

local function baseChar(x, y)
  return rows[y + 1]:sub(x + 1, x + 1)
end

local function basePixel(x, y)
  local c = baseChar(x, y)
  if c == "." then return 0 end
  if c == "#" or c == "b" then return 1 end
  if c == "w" then return 2 end
  -- metal: 50% checkerboard dither
  if ((x + y) % 2) == 0 then return 1 else return 2 end
end

-- Gleam: diagonal band (d = x - y, 3px wide) sweeping lower-left ->
-- upper-right across label then shutter, 5px step per frame.
-- Band core: checker-dither sheen on white, full glint on black detail,
-- parity-flip shimmer on metal. Band edges: sparse Bayer-ish dust so the
-- streak has soft shoulders instead of hard rails. Outline immune.
local function framePixel(x, y, f)
  local c = baseChar(x, y)
  local base = basePixel(x, y)
  if c == "." or c == "#" then return base end

  local p = -9 + (f - 1) * 5
  local o = (x - y) - p
  if o < 0 or o > 2 then return base end

  if o == 1 then -- band core
    if c == "w" then
      if ((x + y) % 2) == 0 then return 1 else return 2 end
    elseif c == "b" then
      return 2 -- glint wipes the printed line
    else -- metal: flip dither parity = moving shimmer
      if ((x + y) % 2) == 0 then return 2 else return 1 end
    end
  else -- band shoulders, lighter touch
    if c == "w" then
      if ((x + y) % 4) == 0 then return 1 else return 2 end
    elseif c == "b" then
      if ((x + y) % 2) == 0 then return 2 else return 1 end
    else
      return base
    end
  end
end

-- frames 2..4
spr:newEmptyFrame()
spr:newEmptyFrame()
spr:newEmptyFrame()

local layer = spr.layers[1]

local function celFor(frame)
  local ok, cel = pcall(function() return spr:newCel(layer, frame) end)
  if ok and cel then return cel end
  -- frame 1 of a fresh sprite already owns a cel; reuse it
  for _, c in ipairs(spr.cels) do
    if c.frameNumber == frame then return c end
  end
end

for f = 1, 4 do
  local img = celFor(f).image
  for y = 0, 15 do
    for x = 0, 15 do
      img:putPixel(x, y, framePixel(x, y, f))
    end
  end
end

local tag = spr:newTag(1, 4)
tag.name = "gleam"

spr:saveAs(app.fs.joinPath(outDir, "floppy.aseprite"))

app.command.ExportSpriteSheet{
  ui = false,
  askOverwrite = false,
  type = SpriteSheetType.HORIZONTAL,
  textureFilename = app.fs.joinPath(outDir, "floppy-table-16-16.png"),
  dataFilename = "",
}

print("ASE_GEN_OK")