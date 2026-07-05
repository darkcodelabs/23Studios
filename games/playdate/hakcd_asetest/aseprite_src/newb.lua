-- newb — 90s hacker kid, 4-frame side-view walk cycle, 32x32, 1-bit Playdate
-- Backwards cap, baggy hoodie (dithered front), high-top sneakers.
-- Frames: 1 contact (near leg fwd), 2 pass, 3 contact (near leg back), 4 pass.

local W, H, FRAMES = 32, 32, 4

local spr = Sprite(W, H, ColorMode.INDEXED)
spr.transparentColor = 0

local pal = Palette(3)
pal:setColor(0, Color{r = 0, g = 0, b = 0, a = 0})
pal:setColor(1, Color{r = 0, g = 0, b = 0, a = 255})
pal:setColor(2, Color{r = 255, g = 255, b = 255, a = 255})
spr:setPalette(pal)

for _ = 2, FRAMES do spr:newEmptyFrame() end

local layer = spr.layers[1]

local function getImage(f)
  local ok, cel = pcall(spr.newCel, spr, layer, f)
  if ok and cel then return cel.image end
  for _, c in ipairs(spr.cels) do
    if c.frameNumber == f then return c.image end
  end
  error("no cel for frame " .. f)
end

local function px(img, x, y, c)
  if x >= 0 and x < W and y >= 0 and y < H then img:putPixel(x, y, c) end
end

local function rect(img, x0, y0, x1, y1, c)
  for y = y0, y1 do
    for x = x0, x1 do px(img, x, y, c) end
  end
end

-- thick Bresenham line, w x w block per step
local function tline(img, x0, y0, x1, y1, w, c)
  local dx, dy = math.abs(x1 - x0), math.abs(y1 - y0)
  local sx = x0 < x1 and 1 or -1
  local sy = y0 < y1 and 1 or -1
  local err = dx - dy
  while true do
    for oy = 0, w - 1 do
      for ox = 0, w - 1 do px(img, x0 + ox, y0 + oy, c) end
    end
    if x0 == x1 and y0 == y1 then break end
    local e2 = 2 * err
    if e2 > -dy then err = err - dy; x0 = x0 + sx end
    if e2 < dx then err = err + dx; y0 = y0 + sy end
  end
end

-- high-top sneaker: ankle at (ax, ay), toe to the right, rows ay..ay+3
-- near foot gets white leather panel + lace dots; far foot stays solid black
local function shoe(img, ax, ay, near)
  rect(img, ax - 2, ay,     ax + 1, ay,     1) -- hightop cuff
  rect(img, ax - 3, ay + 1, ax + 3, ay + 2, 1) -- body
  rect(img, ax - 3, ay + 3, ax + 4, ay + 3, 1) -- sole
  if near then
    rect(img, ax - 2, ay + 1, ax + 2, ay + 1, 2) -- white upper
    px(img, ax - 1, ay + 2, 2)                   -- lace dot
    px(img, ax + 1, ay + 2, 2)                   -- lace dot
    px(img, ax + 3, ay + 2, 2)                   -- toe-cap shine
  end
end

-- b = body bob (contact frames sit 1px lower, feet stay grounded)
-- nlx/nly near-leg ankle, flx/fly far-leg ankle (planted sole lands on y=29)
-- hax/hay near-arm hand target, farm = far-arm swing (-1 back, 0 hidden, 1 fwd)
local poses = {
  {b = 1, nlx = 21, nly = 26, flx = 8,  fly = 25, hax = 9,  hay = 20, farm = 1},
  {b = 0, nlx = 15, nly = 26, flx = 11, fly = 23, hax = 13, hay = 22, farm = 0},
  {b = 1, nlx = 9,  nly = 25, flx = 20, fly = 26, hax = 21, hay = 19, farm = -1},
  {b = 0, nlx = 12, nly = 23, flx = 15, fly = 26, hax = 14, hay = 22, farm = 0},
}

local function drawFrame(img, p)
  local b = p.b

  -- far arm: solid black nub, only when swung past the torso
  if p.farm == 1 then
    tline(img, 18, 15 + b, 22, 19, 3, 1)
  elseif p.farm == -1 then
    tline(img, 12, 15 + b, 7, 19, 3, 1)
  end

  -- far leg + far sneaker (solid black, behind everything)
  tline(img, 14, 20 + b, p.flx, p.fly - 1, 3, 1)
  shoe(img, p.flx, p.fly, false)

  -- baggy hoodie: heavy black mass, wider than the head
  rect(img, 10, 13 + b, 21, 13 + b, 1)          -- shoulder line
  rect(img, 9,  14 + b, 22, 21 + b, 1)          -- body
  rect(img, 10, 22 + b, 21, 22 + b, 1)          -- hem
  rect(img, 8,  12 + b, 10, 15 + b, 1)          -- bunched hood behind neck

  -- checkerboard dither on the front of the hoodie (CRT-glow side),
  -- pattern locked to the body so it rides the bob instead of crawling
  for y = 15 + b, 19 + b do
    for x = 13, 20 do
      if (x + y - b) % 2 == 0 then px(img, x, y, 2) end
    end
  end
  px(img, 15, 14 + b, 2)                        -- drawstring
  px(img, 17, 14 + b, 2)                        -- drawstring
  rect(img, 13, 20 + b, 18, 20 + b, 2)          -- kangaroo pocket top edge

  -- backwards cap: crown up top, 2px brim jutting behind (left)
  rect(img, 12, 3 + b, 19, 3 + b, 1)
  rect(img, 11, 4 + b, 20, 5 + b, 1)
  rect(img, 6,  6 + b, 20, 7 + b, 1)            -- band + backwards brim
  px(img, 12, 4 + b, 2)                          -- panel seam stitches
  px(img, 14, 4 + b, 2)
  px(img, 16, 4 + b, 2)
  px(img, 18, 4 + b, 2)

  -- head: black block, white face patch facing right
  rect(img, 11, 8 + b, 20, 13 + b, 1)
  rect(img, 14, 8 + b, 19, 11 + b, 2)           -- white face patch
  px(img, 18, 9 + b, 1)                          -- eye
  px(img, 17, 11 + b, 1)                         -- mouth

  -- near leg + white-detailed sneaker
  tline(img, 16, 20 + b, p.nlx, p.nly - 1, 3, 1)
  shoe(img, p.nlx, p.nly, true)

  -- near arm: white rim under black core so the sleeve reads on the black torso
  tline(img, 15, 14 + b, p.hax, p.hay, 4, 2)
  tline(img, 16, 15 + b, p.hax + 1, p.hay + 1, 2, 1)
  rect(img, p.hax, p.hay + 2, p.hax + 1, p.hay + 3, 2) -- hand
end

for f = 1, FRAMES do
  drawFrame(getImage(f), poses[f])
end

local tag = spr:newTag(1, FRAMES)
tag.name = "walk"

local out = os.getenv("ASE_OUT_DIR")
spr:saveAs(app.fs.joinPath(out, "newb.aseprite"))
app.command.ExportSpriteSheet{
  ui = false,
  askOverwrite = false,
  type = SpriteSheetType.HORIZONTAL,
  textureFilename = app.fs.joinPath(out, "newb-table-32-32.png"),
  dataFilename = "",
}

print("ASE_GEN_OK")