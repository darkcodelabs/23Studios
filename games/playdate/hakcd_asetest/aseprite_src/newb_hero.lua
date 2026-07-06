-- newb_hero — 48x64, 16 frames, 4-row walk sheet (down/up/left/right)
-- HAKCD 1-bit: Bayer-dithered hoodie kid, glasses, backpack, baggy jeans.

local W, H, FRAMES = 48, 64, 16

local spr = Sprite(W, H, ColorMode.INDEXED)
spr.transparentColor = 0

local pal = Palette(3)
pal:setColor(0, Color{r = 0, g = 0, b = 0, a = 0})
pal:setColor(1, Color{r = 0, g = 0, b = 0, a = 255})
pal:setColor(2, Color{r = 255, g = 255, b = 255, a = 255})
spr:setPalette(pal)

local layer = spr.layers[1]
for _ = 2, FRAMES do spr:newEmptyFrame() end

-- ------------------------------------------------------------------ dither
local B4 = {
  { 0,  8,  2, 10},
  {12,  4, 14,  6},
  { 3, 11,  1,  9},
  {15,  7, 13,  5},
}
local function bay(x, y, den)
  return B4[(y % 4) + 1][(x % 4) + 1] < den
end

-- ------------------------------------------------------------------ pens
local function mkP(img, mirror)
  return function(x, y, c)
    if mirror then x = W - 1 - x end
    if x >= 0 and x < W and y >= 0 and y < H then img:putPixel(x, y, c) end
  end
end

local function hl(P, x1, x2, y, c) for x = x1, x2 do P(x, y, c) end end
local function vl(P, x, y1, y2, c) for y = y1, y2 do P(x, y, c) end end
local function box(P, x1, y1, x2, y2, c)
  for y = y1, y2 do for x = x1, x2 do P(x, y, c) end end
end
local function frameBox(P, x1, y1, x2, y2)
  hl(P, x1, x2, y1, 1)
  hl(P, x1, x2, y2, 1)
  vl(P, x1, y1, y2, 1)
  vl(P, x2, y1, y2, 1)
end
local function dbox(P, x1, y1, x2, y2, den, c)
  for y = y1, y2 do for x = x1, x2 do
    if bay(x, y, den) then P(x, y, c) end
  end end
end
local function doth(P, x1, x2, y, c) for x = x1, x2, 2 do P(x, y, c) end end
local function gradx(P, x1, y1, x2, y2, denA, denB)
  for y = y1, y2 do for x = x1, x2 do
    local t = (x - x1) / math.max(1, x2 - x1)
    P(x, y, bay(x, y, denA + (denB - denA) * t) and 1 or 2)
  end end
end
local function grady(P, x1, y1, x2, y2, denA, denB)
  for y = y1, y2 do
    local t = (y - y1) / math.max(1, y2 - y1)
    for x = x1, x2 do
      P(x, y, bay(x, y, denA + (denB - denA) * t) and 1 or 2)
    end
  end
end
local function line(P, x1, y1, x2, y2, c)
  local dx, dy = math.abs(x2 - x1), math.abs(y2 - y1)
  local sx = x1 < x2 and 1 or -1
  local sy = y1 < y2 and 1 or -1
  local err = dx - dy
  while true do
    P(x1, y1, c)
    if x1 == x2 and y1 == y2 then break end
    local e2 = 2 * err
    if e2 > -dy then
      err = err - dy
      x1 = x1 + sx
    end
    if e2 < dx then
      err = err + dx
      y1 = y1 + sy
    end
  end
end
local function thickL(P, x1, y1, x2, y2, c, w)
  for i = 0, w - 1 do line(P, x1 + i, y1, x2 + i, y2, c) end
end
local function limb2(P, x1, y1, xm, ym, x2, y2, w, fillc)
  local function seg(a, b, c, d)
    for i = 0, w - 1 do line(P, a + i, b, c + i, d, fillc) end
    line(P, a - 1, b, c - 1, d, 1)
    line(P, a + w, b, c + w, d, 1)
  end
  seg(x1, y1, xm, ym)
  seg(xm, ym, x2, y2)
end
local function hand(P, x, y, far)
  box(P, x, y, x + 2, y + 2, 2)
  hl(P, x, x + 2, y - 1, 1)
  hl(P, x, x + 2, y + 3, 1)
  vl(P, x - 1, y - 1, y + 3, 1)
  vl(P, x + 3, y - 1, y + 3, 1)
  if far then P(x + 1, y + 1, 1) end
end
local function sideShoe(P, ax, ay, tilt, far)
  local oy = ay
  if tilt == 2 then oy = ay + 1 end          -- heel raised on push-off
  local x1 = ax - 6
  box(P, x1, oy, ax + 2, oy + 2, 2)
  hl(P, x1, ax + 2, oy - 1, 1)               -- top edge
  hl(P, x1 - 1, ax + 3, oy + 3, 1)           -- black sole
  vl(P, x1 - 1, oy, oy + 2, 1)               -- toe cap
  vl(P, ax + 3, oy - 1, oy + 2, 1)           -- heel
  P(x1, oy + 2, 1) P(x1 + 1, oy + 2, 1)      -- toe rubber wrap
  doth(P, x1 + 2, ax - 1, oy, 1)             -- lace eyelets
  if tilt == 1 then hl(P, x1 - 1, x1 + 1, oy - 2, 1) end  -- toe-up heel strike
  if far then
    for x = x1, ax + 2 do
      if (x + oy) % 2 == 0 then P(x, oy + 1, 1) end
    end
  end
end

-- ------------------------------------------------------------------ front/back
local function frontLeg(P, x, y1, y2)
  box(P, x, y1, x + 3, y2, 2)
  vl(P, x - 1, y1, y2, 1)
  vl(P, x + 4, y1, y2, 1)
  for y = y1 + 1, y2, 3 do P(x + 3, y, 1) end          -- seam
  for y = y1, y2 do if bay(x, y, 5) then P(x, y, 1) end end  -- denim shade
end
local function frontShoe(P, x, y)
  box(P, x, y, x + 5, y + 1, 2)
  vl(P, x - 1, y, y + 2, 1)
  vl(P, x + 6, y, y + 2, 1)
  hl(P, x, x + 5, y + 2, 1)                  -- sole
  hl(P, x + 1, x + 4, y - 1, 1)              -- tongue
  P(x + 2, y, 1) P(x + 4, y, 1)              -- lace dots
end

local function drawFront(P, ph, back)
  local ob = (ph == 1 or ph == 3) and 1 or 0
  local LD = {[0] = {0, -3}, [1] = {-1, -1}, [2] = {-3, 0}, [3] = {-1, -1}}
  local AD = {[0] = {-2, 1}, [1] = {0, 0}, [2] = {1, -2}, [3] = {0, 0}}
  local dl, dr = LD[ph][1], LD[ph][2]
  local da, db = AD[ph][1], AD[ph][2]

  -- legs + sneakers
  frontLeg(P, 18, 43, 56 + dl)
  frontLeg(P, 26, 43, 56 + dr)
  frontShoe(P, 17, 57 + dl)
  frontShoe(P, 25, 57 + dr)

  -- baggy jeans hips
  box(P, 17, 38 + ob, 30, 43, 2)
  dbox(P, 17, 40, 30, 42, 3, 1)
  vl(P, 16, 38 + ob, 43, 1)
  vl(P, 31, 38 + ob, 43, 1)
  hl(P, 23, 24, 43, 1)                       -- crotch
  hl(P, 17, 30, 38 + ob, 1)                  -- belt
  if not back then
    P(23, 38 + ob, 2) P(24, 38 + ob, 2)      -- buckle glint
    for y = 39 + ob, 42, 2 do P(24, y, 1) end  -- fly stitch
  else
    doth(P, 19, 22, 41, 1)
    doth(P, 25, 28, 41, 1)                   -- back pockets
  end

  -- hoodie torso
  box(P, 16, 22 + ob, 31, 37 + ob, 2)
  vl(P, 15, 23 + ob, 37 + ob, 1)
  vl(P, 32, 23 + ob, 37 + ob, 1)
  hl(P, 17, 30, 21 + ob, 1)
  P(16, 22 + ob, 1) P(31, 22 + ob, 1)
  dbox(P, 16, 25 + ob, 18, 37 + ob, 6, 1)    -- side shade L
  dbox(P, 29, 25 + ob, 31, 37 + ob, 6, 1)    -- side shade R
  doth(P, 17, 30, 36 + ob, 1)                -- hem stitch

  if not back then
    line(P, 20, 22 + ob, 23, 25 + ob, 1)     -- hood V
    line(P, 27, 22 + ob, 24, 25 + ob, 1)
    vl(P, 21, 26 + ob, 30 + ob, 1) P(21, 31 + ob, 1)  -- drawstrings + aglets
    vl(P, 26, 26 + ob, 29 + ob, 1) P(26, 30 + ob, 1)
    hl(P, 19, 28, 31 + ob, 1)                -- kangaroo pocket
    vl(P, 19, 31 + ob, 35 + ob, 1)
    vl(P, 28, 31 + ob, 35 + ob, 1)
    vl(P, 18, 22 + ob, 30 + ob, 1)           -- pack straps
    vl(P, 19, 22 + ob, 30 + ob, 1)
    vl(P, 28, 22 + ob, 30 + ob, 1)
    vl(P, 29, 22 + ob, 30 + ob, 1)
    for y = 24 + ob, 29 + ob, 3 do P(18, y, 2) P(29, y, 2) end  -- strap glints
  else
    box(P, 18, 21 + ob, 29, 26 + ob, 2)      -- hanging hood
    hl(P, 18, 29, 20 + ob, 1)
    hl(P, 18, 29, 27 + ob, 1)
    vl(P, 17, 21 + ob, 26 + ob, 1)
    vl(P, 30, 21 + ob, 26 + ob, 1)
    dbox(P, 19, 22 + ob, 28, 26 + ob, 4, 1)
    box(P, 17, 28 + ob, 30, 38 + ob, 2)      -- backpack
    grady(P, 18, 29 + ob, 29, 37 + ob, 2, 7)
    vl(P, 16, 28 + ob, 38 + ob, 1)
    vl(P, 31, 28 + ob, 38 + ob, 1)
    hl(P, 17, 30, 39 + ob, 1)
    frameBox(P, 20, 31 + ob, 27, 37 + ob)    -- pocket
    doth(P, 21, 26, 33 + ob, 1)              -- zipper
    P(26, 34 + ob, 1)                        -- zip pull
  end

  -- arms (swing opposite legs)
  box(P, 12, 24 + ob, 14, 34 + ob + da, 2)
  vl(P, 11, 24 + ob, 34 + ob + da, 1)
  vl(P, 15, 24 + ob, 30 + ob, 1)
  hl(P, 12, 14, 23 + ob, 1)
  dbox(P, 12, 27 + ob, 13, 33 + ob + da, 5, 1)
  hand(P, 12, 35 + ob + da, false)
  box(P, 33, 24 + ob, 35, 34 + ob + db, 2)
  vl(P, 36, 24 + ob, 34 + ob + db, 1)
  vl(P, 32, 24 + ob, 30 + ob, 1)
  hl(P, 33, 35, 23 + ob, 1)
  dbox(P, 34, 27 + ob, 35, 33 + ob + db, 5, 1)
  hand(P, 33, 35 + ob + db, false)

  -- head
  box(P, 17, 5 + ob, 30, 10 + ob, 1)         -- hair crown
  P(18, 4 + ob, 1) P(22, 4 + ob, 1) P(27, 4 + ob, 1)  -- stray spikes
  for y = 5 + ob, 9 + ob do for x = 18, 29 do
    if bay(x, y, 3) then P(x, y, 2) end      -- hair sheen
  end end
  if back then
    box(P, 17, 11 + ob, 30, 16 + ob, 1)      -- full mop
    for x = 17, 30 do if x % 2 == 0 then P(x, 17 + ob, 1) end end  -- ragged ends
    for y = 11 + ob, 15 + ob do for x = 18, 29 do
      if bay(x, y, 3) then P(x, y, 2) end
    end end
    box(P, 21, 18 + ob, 26, 20 + ob, 2)      -- nape of neck
    vl(P, 20, 18 + ob, 20 + ob, 1)
    vl(P, 27, 18 + ob, 20 + ob, 1)
  else
    box(P, 18, 12 + ob, 29, 18 + ob, 2)      -- face
    for x = 17, 30 do if x % 3 ~= 0 then P(x, 11 + ob, 1) end end  -- fringe jags
    P(17, 12 + ob, 1) P(18, 12 + ob, 1) P(29, 12 + ob, 1) P(30, 12 + ob, 1)
    vl(P, 17, 13 + ob, 16 + ob, 1)
    vl(P, 30, 13 + ob, 16 + ob, 1)
    hl(P, 20, 27, 19 + ob, 1)                -- chin
    P(18, 18 + ob, 1) P(29, 18 + ob, 1)
    P(19, 19 + ob, 1) P(28, 19 + ob, 1)
    frameBox(P, 19, 13 + ob, 22, 16 + ob)    -- round glasses
    frameBox(P, 25, 13 + ob, 28, 16 + ob)
    hl(P, 23, 24, 14 + ob, 1)                -- bridge
    P(18, 14 + ob, 1) P(29, 14 + ob, 1)      -- temple arms
    P(21, 15 + ob, 1) P(26, 15 + ob, 1)      -- eyes
    P(23, 16 + ob, 1)                        -- nose
    hl(P, 22, 25, 18 + ob, 1)                -- mouth
    vl(P, 15, 14 + ob, 16 + ob, 1)           -- ears
    P(16, 14 + ob, 2) P(16, 15 + ob, 2) P(16, 16 + ob, 2) P(16, 17 + ob, 1)
    vl(P, 32, 14 + ob, 16 + ob, 1)
    P(31, 14 + ob, 2) P(31, 15 + ob, 2) P(31, 16 + ob, 2) P(31, 17 + ob, 1)
    box(P, 21, 20 + ob, 26, 21 + ob, 2)      -- neck
    vl(P, 20, 20 + ob, 21 + ob, 1)
    vl(P, 27, 20 + ob, 21 + ob, 1)
  end
end

-- ------------------------------------------------------------------ side view
local Lg = {
  [0] = {23, 41, 18, 49, 14, 56, 1},   -- heel strike out front
  [1] = {23, 42, 23, 50, 22, 57, 0},   -- support under body
  [2] = {23, 41, 27, 49, 30, 55, 2},   -- toe-off behind
  [3] = {23, 42, 22, 49, 20, 53, 0},   -- swing through, foot lifted
}
local Na = {
  [0] = {27, 31, 30, 37},              -- arm swung back
  [1] = {25, 31, 26, 38},
  [2] = {21, 31, 17, 36},              -- arm swung forward
  [3] = {24, 31, 23, 38},
}

local function drawSide(P, ph)
  local ob = (ph == 1 or ph == 3) and 1 or 0

  -- far leg: opposite phase, set back, hatched to recede
  local fl = Lg[(ph + 2) % 4]
  limb2(P, fl[1] + 3, fl[2] - 1, fl[3] + 3, fl[4] - 1, fl[5] + 3, fl[6] - 1, 4, 2)
  line(P, fl[3] + 4, fl[4] - 1, fl[5] + 4, fl[6] - 1, 1)
  sideShoe(P, fl[5] + 3, fl[6], fl[7], true)

  -- backpack behind torso
  box(P, 30, 26 + ob, 37, 39 + ob, 2)
  gradx(P, 31, 27 + ob, 36, 38 + ob, 3, 10)
  hl(P, 30, 37, 25 + ob, 1)
  vl(P, 38, 26 + ob, 39 + ob, 1)
  hl(P, 30, 37, 40 + ob, 1)
  frameBox(P, 32, 33 + ob, 37, 38 + ob)      -- side pocket
  doth(P, 33, 36, 35 + ob, 1)

  -- hoodie torso
  box(P, 17, 22 + ob, 30, 40 + ob, 2)
  gradx(P, 25, 24 + ob, 29, 38 + ob, 1, 6)   -- back shade into pack
  vl(P, 16, 23 + ob, 40 + ob, 1)             -- chest edge
  hl(P, 17, 29, 21 + ob, 1)                  -- shoulder top
  P(16, 22 + ob, 1)
  doth(P, 17, 29, 37 + ob, 1)                -- hem stitch

  -- hood bunched at the nape
  box(P, 24, 19 + ob, 31, 24 + ob, 2)
  hl(P, 24, 31, 18 + ob, 1)
  vl(P, 32, 19 + ob, 24 + ob, 1)
  line(P, 26, 24 + ob, 30, 20 + ob, 1)       -- fold
  dbox(P, 27, 20 + ob, 31, 23 + ob, 5, 1)
  hl(P, 25, 31, 25 + ob, 1)                  -- underseam

  -- head profile (faces left)
  box(P, 16, 5 + ob, 29, 11 + ob, 1)         -- hair mop
  box(P, 24, 12 + ob, 29, 16 + ob, 1)        -- back of skull
  P(17, 4 + ob, 1) P(21, 4 + ob, 1) P(26, 4 + ob, 1)
  for y = 6 + ob, 10 + ob do for x = 17, 28 do
    if bay(x, y, 4) then P(x, y, 2) end
  end end
  box(P, 14, 12 + ob, 23, 17 + ob, 2)        -- face
  for x = 16, 21 do if x % 3 ~= 2 then P(x, 12 + ob, 1) end end  -- fringe
  for x = 24, 29 do if x % 2 == 0 then P(x, 17 + ob, 1) end end  -- ragged nape
  vl(P, 13, 12 + ob, 13 + ob, 1)             -- brow edge
  P(13, 14 + ob, 2) P(12, 14 + ob, 1)        -- nose
  P(12, 15 + ob, 1) P(13, 15 + ob, 1)
  P(14, 16 + ob, 1) P(15, 16 + ob, 1)        -- mouth
  hl(P, 14, 20, 18 + ob, 1)                  -- jaw
  frameBox(P, 15, 13 + ob, 18, 15 + ob)      -- glasses lens
  P(16, 14 + ob, 1)                          -- eye
  hl(P, 19, 20, 13 + ob, 1)                  -- temple arm
  frameBox(P, 20, 14 + ob, 22, 17 + ob)      -- ear
  P(21, 15 + ob, 2) P(21, 16 + ob, 2)
  box(P, 19, 19 + ob, 24, 21 + ob, 2)        -- neck
  vl(P, 18, 19 + ob, 21 + ob, 1)

  local st = {
    {27, 23}, {28, 23}, {26, 24}, {27, 24}, {26, 25}, {27, 25},
    {25, 26}, {26, 26}, {25, 27}, {26, 27}, {24, 28}, {25, 28},
    {24, 29}, {25, 29}, {23, 30}, {24, 30}, {23, 31}, {24, 31},
    {22, 32}, {23, 32}, {22, 33}, {23, 33}, {21, 34}, {22, 34},
    {21, 35}, {22, 35},
  }
  for _, q in ipairs(st) do P(q[1], q[2] + ob, 1) end  -- pack strap over chest

  local lg = Lg[ph]
  limb2(P, lg[1], lg[2], lg[3], lg[4], lg[5], lg[6], 5, 2)
  thickL(P, lg[3] + 1, lg[4] - 2, lg[5] + 1, lg[6], 1, 3)  -- shin shade stripe
  P(lg[3], lg[4], 1) P(lg[3] + 1, lg[4], 1)                -- knee crease
  doth(P, lg[5] - 2, lg[5] + 2, lg[6], 1)                  -- cuff bunch at ankle
  -- re-blend baggy hips over the near-thigh root
  gradx(P, 20, 39 + ob, 29, 41 + ob, 2, 6)
  vl(P, 19, 39 + ob, 41 + ob, 1)
  vl(P, 30, 39 + ob, 41 + ob, 1)
  hl(P, 19, 30, 38 + ob, 1)
  sideShoe(P, lg[5], lg[6] + 1, lg[7], false)

  local na = Na[ph]
  limb2(P, 24, 23 + ob, na[1], na[2], na[3], na[4], 3, 2)
  P(na[1], na[2], 1) P(na[1] + 1, na[2] + 1, 1)            -- elbow fold
  hand(P, na[3], na[4] + 1, false)
end

-- ------------------------------------------------------------------ assemble
local function celImage(f)
  local c = layer:cel(f)
  if c == nil then c = spr:newCel(layer, f) end
  return c.image
end

for f = 1, FRAMES do
  local img = celImage(f)
  local row = math.floor((f - 1) / 4)   -- 0 down, 1 up, 2 left, 3 right
  local ph  = (f - 1) % 4
  local P = mkP(img, row == 3)          -- right row = mirrored left row
  if row == 0 then drawFront(P, ph, false)
  elseif row == 1 then drawFront(P, ph, true)
  else drawSide(P, ph) end
end

local t1 = spr:newTag(1, 4)   t1.name = "walk_down"
local t2 = spr:newTag(5, 8)   t2.name = "walk_up"
local t3 = spr:newTag(9, 12)  t3.name = "walk_left"
local t4 = spr:newTag(13, 16) t4.name = "walk_right"

local OUT = os.getenv("ASE_OUT_DIR")
spr:saveAs(app.fs.joinPath(OUT, "newb_hero.aseprite"))
app.command.ExportSpriteSheet{
  ui = false,
  askOverwrite = false,
  type = SpriteSheetType.ROWS,
  columns = 4,
  textureFilename = app.fs.joinPath(OUT, "newb_hero-table-48-64.png"),
  dataFilename = "",
}

print("ASE_GEN_OK")