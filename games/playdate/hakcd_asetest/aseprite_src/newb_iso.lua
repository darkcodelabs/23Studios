-- newb_iso: 24x32 isometric hacker-teen walk cycle, 4 rows x 4 frames
-- Row 1 down, Row 2 up, Row 3 left, Row 4 right. 1-bit Playdate palette.

local W, H = 24, 32
local FRAMES = 16

local sprite = Sprite(W, H, ColorMode.INDEXED)
sprite.transparentColor = 0

local palette = Palette(3)
palette:setColor(0, Color{r=0,   g=0,   b=0,   a=0})
palette:setColor(1, Color{r=0,   g=0,   b=0,   a=255})
palette:setColor(2, Color{r=255, g=255, b=255, a=255})
sprite:setPalette(palette)

for _ = 2, FRAMES do
  sprite:newEmptyFrame()
end

-- ---------- pixel helpers (flip mirrors around vertical axis) ----------

local function P(img, x, y, c, flip)
  if flip then x = W - 1 - x end
  if x >= 0 and x < W and y >= 0 and y < H then
    img:putPixel(x, y, c)
  end
end

local function HL(img, x1, x2, y, c, flip)
  for x = x1, x2 do P(img, x, y, c, flip) end
end

local function VL(img, x, y1, y2, c, flip)
  for y = y1, y2 do P(img, x, y, c, flip) end
end

local function RECT(img, x1, y1, x2, y2, c, flip)
  for y = y1, y2 do HL(img, x1, x2, y, c, flip) end
end

local function BOX(img, x1, y1, x2, y2, flip)
  HL(img, x1, x2, y1, 1, flip)
  HL(img, x1, x2, y2, 1, flip)
  VL(img, x1, y1, y2, 1, flip)
  VL(img, x2, y1, y2, 1, flip)
end

-- checkerboard dither: hoodie fabric shading, no midtones ever
local function DITHER(img, x1, y1, x2, y2, flip)
  for y = y1, y2 do
    for x = x1, x2 do
      P(img, x, y, ((x + y) % 2 == 0) and 1 or 2, flip)
    end
  end
end

-- ---------- shared body parts ----------

-- front/back leg: baggy black pant leg + white high-top, lift raises foot off ground
local function legFront(img, cx, lift)
  RECT(img, cx, 22, cx + 2, 26 - lift, 1, false)          -- pant leg
  RECT(img, cx, 27 - lift, cx + 2, 29 - lift, 2, false)   -- shoe white body
  BOX(img, cx - 1, 26 - lift, cx + 3, 30 - lift, false)   -- shoe outline + sole
  P(img, cx + 1, 27 - lift, 1, false)                     -- lace dot
end

-- front/back arm: black sleeve column, delta swings hand up/down, white cuff band
local function armFront(img, ax, ty, delta)
  RECT(img, ax, ty + 2, ax + 1, 19 + delta, 1, false)
  HL(img, ax, ax + 1, 18 + delta, 2, false)               -- cuff
end

-- side leg: longer sneaker profile
local function legSide(img, cx, lift, flip)
  RECT(img, cx, 22, cx + 2, 26 - lift, 1, flip)           -- pant leg
  RECT(img, cx, 27 - lift, cx + 3, 29 - lift, 2, flip)    -- shoe white body
  BOX(img, cx - 1, 26 - lift, cx + 4, 30 - lift, flip)    -- shoe outline + sole
  P(img, cx + 1, 27 - lift, 1, flip)                      -- lace dot
end

-- ---------- facing: down (front) ----------

local function drawDown(img, f)
  local bob   = (f % 2 == 1) and 1 or 0
  local liftL = ({0, 1, 2, 1})[f + 1]
  local liftR = ({2, 1, 0, 1})[f + 1]
  local armL  = ({2, 0, -2, 0})[f + 1]
  local armR  = ({-2, 0, 2, 0})[f + 1]

  legFront(img, 8,  liftL)
  legFront(img, 13, liftR)

  local ty = 11 + bob
  -- hoodie torso
  RECT(img, 6, ty + 1, 17, 20, 2, false)
  DITHER(img, 7, ty + 2, 16, 19, false)
  BOX(img, 5, ty, 18, 21, false)
  RECT(img, 8, ty, 15, ty + 1, 1, false)                  -- bunched hood collar
  P(img, 10, ty + 2, 1, false); P(img, 10, ty + 3, 1, false)  -- drawstrings
  P(img, 13, ty + 2, 1, false); P(img, 13, ty + 3, 1, false)
  HL(img, 9, 14, 18, 1, false)                            -- kangaroo pocket
  VL(img, 9, 18, 20, 1, false)
  VL(img, 14, 18, 20, 1, false)

  armFront(img, 3,  ty, armL)
  armFront(img, 19, ty, armR)

  -- head + backwards cap
  local hy = 2 + bob
  RECT(img, 7, hy, 16, hy + 2, 1, false)                  -- cap crown
  HL(img, 5, 6, hy + 2, 1, false)                         -- brim nub peeking (back-left)
  HL(img, 17, 18, hy + 2, 1, false)                       -- brim nub peeking (back-right)
  P(img, 11, hy + 1, 2, false); P(img, 12, hy + 1, 2, false)  -- cap seam
  VL(img, 7, hy + 3, hy + 8, 1, false)
  VL(img, 16, hy + 3, hy + 8, 1, false)
  RECT(img, 8, hy + 3, 15, hy + 7, 2, false)              -- white face patch
  HL(img, 8, 15, hy + 8, 1, false)                        -- chin
  P(img, 10, hy + 5, 1, false); P(img, 13, hy + 5, 1, false)  -- eyes
end

-- ---------- facing: up (back) ----------

local function drawUp(img, f)
  local bob   = (f % 2 == 1) and 1 or 0
  local liftL = ({2, 1, 0, 1})[f + 1]
  local liftR = ({0, 1, 2, 1})[f + 1]
  local armL  = ({-2, 0, 2, 0})[f + 1]
  local armR  = ({2, 0, -2, 0})[f + 1]

  legFront(img, 8,  liftL)
  legFront(img, 13, liftR)

  local ty = 11 + bob
  -- hoodie torso (plain back)
  RECT(img, 6, ty + 1, 17, 20, 2, false)
  DITHER(img, 7, ty + 2, 16, 19, false)
  BOX(img, 5, ty, 18, 21, false)
  -- hood hanging on the back
  BOX(img, 7, ty, 16, ty + 4, false)
  RECT(img, 8, ty + 1, 15, ty + 3, 2, false)

  armFront(img, 3,  ty, armL)
  armFront(img, 19, ty, armR)

  -- back of head: cap brim points at camera
  local hy = 2 + bob
  RECT(img, 7, hy, 16, hy + 2, 1, false)                  -- crown
  P(img, 11, hy + 1, 2, false); P(img, 12, hy + 1, 2, false)  -- seam
  RECT(img, 5, hy + 3, 18, hy + 4, 1, false)              -- wide backwards brim
  RECT(img, 8, hy + 5, 15, hy + 8, 1, false)              -- hair / back of skull
end

-- ---------- facing: side (drawn facing right; flip=true mirrors to left) ----------

local function drawSide(img, f, flip)
  local bob = (f % 2 == 1) and 1 or 0

  -- stride: contact / pass / contact-swapped / pass
  local Ax    = {13, 10, 7,  9}
  local Alift = {0,  1,  0,  0}
  local Bx    = {7,  9,  13, 10}
  local Blift = {0,  0,  0,  1}

  legSide(img, Bx[f + 1], Blift[f + 1], flip)             -- far leg first
  legSide(img, Ax[f + 1], Alift[f + 1], flip)             -- near leg on top

  local ty = 11 + bob
  -- hoodie torso profile
  RECT(img, 7, ty + 1, 15, 20, 2, flip)
  DITHER(img, 8, ty + 2, 14, 19, flip)
  BOX(img, 6, ty, 16, 21, flip)
  RECT(img, 5, ty, 7, ty + 3, 1, flip)                    -- hood bunched behind neck
  HL(img, 12, 15, 19, 1, flip)                            -- pocket hint

  -- near arm swing: diagonal 2px sleeve, cuff, hand tip
  local armoff = {
    {0, 1, 1, 2, 2, 3},                                   -- forward
    {0, 0, 0, 0, 0, 0},                                   -- pass
    {0, -1, -1, -2, -2, -3},                              -- back
    {0, 0, 0, 0, 0, 0},                                   -- pass
  }
  local offs = armoff[f + 1]
  for i = 1, 6 do
    local o = offs[i]
    P(img, 11 + o, ty + 2 + i, 1, flip)
    P(img, 12 + o, ty + 2 + i, 1, flip)
  end
  P(img, 11 + offs[5], ty + 7, 2, flip)                   -- cuff
  P(img, 12 + offs[5], ty + 7, 2, flip)

  -- head profile, brim pointing backwards
  local hy = 2 + bob
  RECT(img, 8, hy, 16, hy + 2, 1, flip)                   -- crown
  RECT(img, 4, hy + 2, 8, hy + 3, 1, flip)                -- backwards brim
  RECT(img, 10, hy + 3, 15, hy + 7, 2, flip)              -- white face patch
  RECT(img, 8, hy + 3, 9, hy + 7, 1, flip)                -- back hair
  VL(img, 16, hy + 3, hy + 7, 1, flip)                    -- face front edge
  HL(img, 10, 15, hy + 8, 1, flip)                        -- chin
  P(img, 14, hy + 5, 1, flip)                             -- eye
end

-- ---------- render all 16 frames ----------

local layer = sprite.layers[1]

local function getImage(frameNum)
  local ok, cel = pcall(function() return sprite:newCel(layer, frameNum) end)
  if not ok or cel == nil then
    for _, c in ipairs(sprite.cels) do
      if c.frameNumber == frameNum then cel = c break end
    end
  end
  return cel.image
end

for fr = 1, FRAMES do
  local img = getImage(fr)
  local f = (fr - 1) % 4
  local row = math.floor((fr - 1) / 4)
  if row == 0 then
    drawDown(img, f)
  elseif row == 1 then
    drawUp(img, f)
  elseif row == 2 then
    drawSide(img, f, true)    -- left
  else
    drawSide(img, f, false)   -- right
  end
end

local tDown = sprite:newTag(1, 4);   tDown.name  = "walk_down"
local tUp   = sprite:newTag(5, 8);   tUp.name    = "walk_up"
local tLeft = sprite:newTag(9, 12);  tLeft.name  = "walk_left"
local tRight= sprite:newTag(13, 16); tRight.name = "walk_right"

-- ---------- export ----------

local outDir = os.getenv("ASE_OUT_DIR")
sprite:saveAs(app.fs.joinPath(outDir, "newb_iso.aseprite"))

app.command.ExportSpriteSheet{
  ui = false,
  askOverwrite = false,
  type = SpriteSheetType.ROWS,
  columns = 4,
  textureFilename = app.fs.joinPath(outDir, "newb_iso-table-24-32.png"),
  dataFilename = "",
}

print("ASE_GEN_OK")