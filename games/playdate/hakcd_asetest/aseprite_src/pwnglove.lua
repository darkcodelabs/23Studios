-- PWNGLOVE — chunky cyber power-glove on museum pedestal, ribbon cable, LED knuckle studs
-- 4-frame idle pulse: LEDs chase in sequence, dither aura breathes. 80x40 frames, 1-bit.

local W, H, FRAMES = 80, 40, 4

local sp = Sprite(W, H, ColorMode.INDEXED)
sp.transparentColor = 0

local pal = Palette(3)
pal:setColor(0, Color{ r = 0,   g = 0,   b = 0,   a = 0   }) -- transparent
pal:setColor(1, Color{ r = 0,   g = 0,   b = 0,   a = 255 }) -- black
pal:setColor(2, Color{ r = 255, g = 255, b = 255, a = 255 }) -- white
sp:setPalette(pal)

for _ = 2, FRAMES do sp:newEmptyFrame() end

-- ---------- pixel buffer helpers (compose in Lua, blit once) ----------
local function newbuf()
  local b = {}
  for y = 1, H do
    b[y] = {}
    for x = 1, W do b[y][x] = 0 end
  end
  return b
end

local function px(b, x, y, c)
  if x >= 0 and x < W and y >= 0 and y < H then b[y + 1][x + 1] = c end
end

local function rect(b, x0, y0, x1, y1, c)
  for y = y0, y1 do
    for x = x0, x1 do px(b, x, y, c) end
  end
end

local function dith(b, x0, y0, x1, y1, c, off)
  for y = y0, y1 do
    for x = x0, x1 do
      if (x + y + off) % 2 == 0 then px(b, x, y, c) end
    end
  end
end

-- ---------- scene ----------
local LED_X  = { 49, 54, 59, 64 }   -- knuckle stud columns
local AURA_W = { 2, 4, 6, 4 }       -- aura band width per frame (grow/shrink)

local function drawScene(b, f)
  -- === museum pedestal ===
  rect(b, 26, 30, 74, 33, 1)                 -- slab: heavy black mass
  for x = 27, 73, 2 do px(b, x, 30, 2) end   -- dotted specular on slab top edge
  rect(b, 32, 34, 68, 39, 2)                 -- column face
  rect(b, 32, 34, 33, 39, 1)                 -- column left stroke (2px)
  rect(b, 67, 34, 68, 39, 1)                 -- column right stroke (2px)
  dith(b, 60, 34, 66, 37, 1, 0)              -- column shade, right side
  rect(b, 28, 38, 72, 39, 1)                 -- plinth base
  -- plaque
  rect(b, 43, 34, 55, 37, 1)
  rect(b, 44, 35, 54, 36, 2)
  px(b, 46, 35, 1) px(b, 49, 35, 1) px(b, 52, 35, 1)

  -- === ribbon cable trailing left (drawn before glove so connector overlaps) ===
  for x = 0, 30 do
    local yc = 27 + math.floor(3 * math.sin(x / 5.0) + 0.5)
    px(b, x, yc - 3, 1)                      -- top stroke (2px)
    px(b, x, yc - 2, 1)
    px(b, x, yc - 1, 2)                      -- wire A
    if x % 2 == 0 then px(b, x, yc, 1) else px(b, x, yc, 2) end -- wire seam (dither)
    px(b, x, yc + 1, 2)                      -- wire B
    px(b, x, yc + 2, 1)                      -- bottom stroke (2px)
    px(b, x, yc + 3, 1)
  end
  -- cable connector into cuff
  rect(b, 29, 21, 34, 29, 1)
  rect(b, 31, 23, 32, 27, 2)

  -- === forearm cuff (ribbed) ===
  rect(b, 32, 15, 45, 29, 1)                 -- cuff mass / 2px outline
  rect(b, 34, 17, 43, 27, 2)                 -- cuff face
  rect(b, 37, 17, 37, 27, 1)                 -- rib
  rect(b, 41, 17, 41, 27, 1)                 -- rib
  dith(b, 34, 24, 43, 27, 1, 1)              -- underside shade

  -- === hand mass ===
  rect(b, 44, 9, 71, 29, 1)                  -- full black fist block
  -- round outer top corners
  px(b, 44, 9, 0)  px(b, 45, 9, 0)  px(b, 44, 10, 0)
  px(b, 70, 9, 0)  px(b, 71, 9, 0)  px(b, 71, 10, 0)
  px(b, 71, 29, 0)
  rect(b, 46, 16, 69, 27, 2)                 -- palm face; y9..15 stays black = knuckle plate
  px(b, 46, 27, 1) px(b, 69, 27, 1)          -- inner corner rounding
  -- curled finger creases on the fist front
  rect(b, 62, 18, 69, 18, 1)
  rect(b, 62, 22, 69, 22, 1)
  rect(b, 62, 26, 69, 26, 1)
  -- thumb crease
  local th = { {60,29},{61,28},{62,27},{63,26},{64,26},{65,26},{66,27},{67,28},{68,29} }
  for _, p in ipairs(th) do
    px(b, p[1], p[2], 1)
    if p[2] + 1 <= 29 then px(b, p[1], p[2] + 1, 1) end
  end
  -- control pad on back of hand
  rect(b, 49, 18, 58, 23, 1)
  rect(b, 50, 19, 57, 22, 2)
  rect(b, 51, 20, 52, 21, 1)
  rect(b, 54, 20, 55, 21, 1)
  -- underside shade of fist
  dith(b, 47, 25, 61, 27, 1, 0)

  -- === LED knuckle studs: chase sequence ===
  local prev = f - 1
  if prev == 0 then prev = 4 end
  for i = 1, 4 do
    local x0 = LED_X[i]
    if i == f then
      -- lit: solid stud + glow rays
      rect(b, x0, 11, x0 + 2, 13, 2)
      px(b, x0 + 1, 10, 2)
      px(b, x0 - 1, 12, 2)
      px(b, x0 + 3, 12, 2)
      px(b, x0 + 1, 8, 2)                    -- glow spill above silhouette
    elseif i == prev then
      -- fading trail: checkered stud
      for dy = 11, 13 do
        for dx = x0, x0 + 2 do
          if (dx + dy) % 2 == 0 then px(b, dx, dy, 2) end
        end
      end
    else
      px(b, x0 + 1, 12, 2)                   -- dark stud: single glint
    end
  end

  -- === breathing dither aura (only over transparent pixels) ===
  local aw = AURA_W[f]
  for y = 0, 33 do
    for x = 0, W - 1 do
      if b[y + 1][x + 1] == 0 then
        local dx = (x - 57) / 1.5
        local dy = (y - 19)
        local d = math.sqrt(dx * dx + dy * dy)
        if d >= 11 and d <= 11 + aw and (x + y + f) % 2 == 0 then
          px(b, x, y, 2)
        end
      end
    end
  end
end

-- ---------- render frames ----------
for f = 1, FRAMES do
  local cel
  if f == 1 and #sp.cels > 0 then
    cel = sp.cels[1]
  else
    cel = sp:newCel(sp.layers[1], f)
  end
  local img = cel.image
  local b = newbuf()
  drawScene(b, f)
  for y = 0, H - 1 do
    for x = 0, W - 1 do
      local v = b[y + 1][x + 1]
      if v > 0 then img:putPixel(x, y, v) end
    end
  end
end

local tag = sp:newTag(1, FRAMES)
tag.name = "idle"

-- ---------- export ----------
local out = os.getenv("ASE_OUT_DIR")
sp:saveAs(app.fs.joinPath(out, "pwnglove.aseprite"))
app.command.ExportSpriteSheet{
  ui = false,
  askOverwrite = false,
  type = SpriteSheetType.HORIZONTAL,
  textureFilename = app.fs.joinPath(out, "pwnglove-table-80-40.png"),
  dataFilename = ""
}

print("ASE_GEN_OK")