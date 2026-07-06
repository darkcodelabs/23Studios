-- pickup_chip: floating microchip power-up token
-- 4-frame spin (front -> 3/4 left -> edge-on -> 3/4 right) with pulsing dither halo
-- Palette: 0=transparent, 1=black, 2=white. 16x16 per frame, horizontal strip.

local sprite = Sprite(16, 16, ColorMode.INDEXED)
sprite.transparentColor = 0

local pal = Palette(3)
pal:setColor(0, Color{r = 0, g = 0, b = 0, a = 0})
pal:setColor(1, Color{r = 0, g = 0, b = 0, a = 255})
pal:setColor(2, Color{r = 255, g = 255, b = 255, a = 255})
sprite:setPalette(pal)

-- Legend: '.' = transparent, 'B' = black ink, 'W' = white ink.
-- Chip = white 2px package ring, black epoxy well, white die window with black core,
-- white DIP pins on both sides. Halo = sparse checker sparkles, brightest on the
-- full-face frame, dimmest edge-on, so the loop reads as spin + pulse together.
local frames = {
  -- Frame 1: front face, widest silhouette, brightest halo
  {
    ".....W....W.....",
    ".W.W...WW...W.W.",
    "..WWWWWWWWWWWW..",
    "..WWWWWWWWWWWW..",
    "WWWWBBBBBBBBWWWW",
    "WWWWBBBBBBBBWWWW",
    "..WWBBWWWWBBWW..",
    "W.WWBBWBBWBBWW.W",
    "W.WWBBWBBWBBWW.W",
    "..WWBBWWWWBBWW..",
    "WWWWBBBBBBBBWWWW",
    "WWWWBBBBBBBBWWWW",
    "..WWWWWWWWWWWW..",
    "..WWWWWWWWWWWW..",
    ".W.W...WW...W.W.",
    ".....W....W.....",
  },
  -- Frame 2: 3/4 turn, body compressed and shifted left, medium halo,
  -- leading-edge glint on the right
  {
    ".....W..W.......",
    "...W......W.....",
    "...WWWWWWWW.....",
    "...WWWWWWWW.....",
    ".WWWWBBBBWWWW...",
    ".WWWWBBBBWWWW...",
    "...WWBWWBWW.....",
    "...WWBWWBWW..WW.",
    "...WWBWWBWW..WW.",
    "...WWBWWBWW.....",
    ".WWWWBBBBWWWW...",
    ".WWWWBBBBWWWW...",
    "...WWWWWWWW.....",
    "...WWWWWWWW.....",
    "...W......W.....",
    ".....W..W.......",
  },
  -- Frame 3: edge-on slab with orientation notch and pin flanges, dimmest halo
  {
    "................",
    ".......WW.......",
    "......WBBW......",
    "......WBBW......",
    "....WWWWWWWW....",
    "....WWWWWWWW....",
    "......WWWW......",
    "...W..WWWW..W...",
    "...W..WWWW..W...",
    "......WWWW......",
    "....WWWWWWWW....",
    "....WWWWWWWW....",
    "......WWWW......",
    "......WWWW......",
    ".......WW.......",
    "................",
  },
  -- Frame 4: 3/4 turn mirrored, shifted right, medium halo,
  -- trailing glint on the left
  {
    ".......W..W.....",
    ".....W......W...",
    ".....WWWWWWWW...",
    ".....WWWWWWWW...",
    "...WWWWBBBBWWWW.",
    "...WWWWBBBBWWWW.",
    ".....WWBWWBWW...",
    ".WW..WWBWWBWW...",
    ".WW..WWBWWBWW...",
    ".....WWBWWBWW...",
    "...WWWWBBBBWWWW.",
    "...WWWWBBBBWWWW.",
    ".....WWWWWWWW...",
    ".....WWWWWWWW...",
    ".....W......W...",
    ".......W..W.....",
  },
}

for _ = 2, #frames do
  sprite:newEmptyFrame()
end

local layer = sprite.layers[1]
local ink = { ["."] = 0, ["B"] = 1, ["W"] = 2 }

for f, rows in ipairs(frames) do
  local cel = layer:cel(f) or sprite:newCel(layer, f)
  local img = cel.image
  for y = 1, 16 do
    local row = rows[y]
    assert(#row == 16, "row length mismatch at frame " .. f .. " row " .. y)
    for x = 1, 16 do
      local c = ink[row:sub(x, x)]
      if c ~= 0 then
        img:putPixel(x - 1, y - 1, c)
      end
    end
  end
end

local tag = sprite:newTag(1, 4)
tag.name = "spin"

local outDir = os.getenv("ASE_OUT_DIR")
sprite:saveAs(app.fs.joinPath(outDir, "pickup_chip.aseprite"))

app.command.ExportSpriteSheet{
  ui = false,
  askOverwrite = false,
  type = SpriteSheetType.HORIZONTAL,
  textureFilename = app.fs.joinPath(outDir, "pickup_chip-table-16-16.png"),
  dataFilename = "",
}

print("ASE_GEN_OK")