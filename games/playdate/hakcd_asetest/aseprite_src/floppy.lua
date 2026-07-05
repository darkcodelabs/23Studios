-- floppy: 16x16 3.5" disk pickup, 4-frame gleam sweep across label
-- palette: 0=transparent, 1=black, 2=white (HAKCD 1-bit canon)

local spr = Sprite(16, 16, ColorMode.INDEXED)
spr.transparentColor = 0

local pal = Palette(3)
pal:setColor(0, Color{ r = 0,   g = 0,   b = 0,   a = 0   })
pal:setColor(1, Color{ r = 0,   g = 0,   b = 0,   a = 255 })
pal:setColor(2, Color{ r = 255, g = 255, b = 255, a = 255 })
spr:setPalette(pal)

-- base plate, drawn as char map:
-- . transparent | B black | w white body | m metal shutter (checker dither)
-- l label white | t label text ink
local rows = {
  "..BBBBBBBBBBBB..",  -- y0  rounded top silhouette
  ".BBBBBBBBBBBBBB.",  -- y1
  ".BBwBBBBBBBBwBB.",  -- y2  shutter top edge
  ".BBwBmmBBmmBwBB.",  -- y3  metal dither + slot hole
  ".BBwBmmBBmmBwBB.",  -- y4
  ".BBwBmmmmmmBwBB.",  -- y5
  ".BBwBBBBBBBBwBB.",  -- y6  shutter bottom edge
  ".BBwwwwwwwwwwBB.",  -- y7  body gap
  ".BBBBBBBBBBBBBB.",  -- y8  label top rule
  ".BBBlttlttllBBB.",  -- y9  label text line 1
  ".BBBllllllllBBB.",  -- y10
  ".BBBltttlttlBBB.",  -- y11 label text line 2
  ".BBBBBBBBBBBBBB.",  -- y12 label bottom rule
  ".BBwwwwwwwwwwBB.",  -- y13
  ".BBBBBBBBBBBBBB.",  -- y14
  "..BBBBBBBBBBBB..",  -- y15 rounded bottom silhouette
}

local function basePixel(x, y)
  local ch = rows[y + 1]:sub(x + 1, x + 1)
  if ch == "." then return 0 end
  if ch == "w" or ch == "l" then return 2 end
  if ch == "m" then
    -- 50% checker dither = brushed metal on 1-bit
    if (x + y) % 2 == 0 then return 2 else return 1 end
  end
  return 1 -- B and t
end

-- diagonal shine band sweeps left->right across label zone (x3..12, y8..12).
-- core 2px: ink goes white. 1px edges: checker dither for soft falloff.
-- outer 2px silhouette border sits outside the zone, stays intact.
local function gleamPixel(x, y, f, base)
  if base == 0 then return 0 end
  if x < 3 or x > 12 or y < 8 or y > 12 then return base end
  local d = (x - 3) - (y - 8)
  local c = (f - 1) * 3
  if d == c or d == c + 1 then
    return 2
  elseif d == c - 1 or d == c + 2 then
    if (x + y) % 2 == 0 then return 2 end
  end
  return base
end

for _ = 2, 4 do
  spr:newEmptyFrame()
end

local layer = spr.layers[1]
local function getCel(f)
  local ok, cel = pcall(function() return spr:newCel(layer, f) end)
  if ok and cel then return cel end
  return layer:cel(f)
end

for f = 1, 4 do
  local img = getCel(f).image
  for y = 0, 15 do
    for x = 0, 15 do
      local p = gleamPixel(x, y, f, basePixel(x, y))
      if p ~= 0 then
        img:putPixel(x, y, p)
      end
    end
  end
end

local tag = spr:newTag(1, 4)
tag.name = "gleam"

local outDir = os.getenv("ASE_OUT_DIR")
spr:saveAs(app.fs.joinPath(outDir, "floppy.aseprite"))
app.command.ExportSpriteSheet{
  ui = false,
  askOverwrite = false,
  type = SpriteSheetType.HORIZONTAL,
  textureFilename = app.fs.joinPath(outDir, "floppy-table-16-16.png"),
  dataFilename = "",
}

print("ASE_GEN_OK")