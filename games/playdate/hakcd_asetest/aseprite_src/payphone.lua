-- payphone.lua — HAKCD phreaker-noir prop: 1990s street payphone, 4-frame ring
-- 32x32 imagetable, indexed 1-bit: 0=transparent, 1=black, 2=white

local spr = Sprite(32, 32, ColorMode.INDEXED)
spr.transparentColor = 0

local pal = Palette(3)
pal:setColor(0, Color{ r = 0,   g = 0,   b = 0,   a = 0   })
pal:setColor(1, Color{ r = 0,   g = 0,   b = 0,   a = 255 })
pal:setColor(2, Color{ r = 255, g = 255, b = 255, a = 255 })
spr:setPalette(pal)

for _ = 1, 3 do spr:newEmptyFrame() end -- frames 2..4

local layer = spr.layers[1]

local function getCel(f)
  local ok, cel = pcall(function() return spr:newCel(layer, f) end)
  if ok and cel then return cel end
  for _, c in ipairs(spr.cels) do
    if c.frameNumber == f then return c end
  end
end

-- ---- pixel helpers -------------------------------------------------------
local function px(img, x, y, c)
  if x >= 0 and x < 32 and y >= 0 and y < 32 then img:putPixel(x, y, c) end
end

local function fill(img, x1, y1, x2, y2, c)
  for y = y1, y2 do
    for x = x1, x2 do px(img, x, y, c) end
  end
end

-- checkerboard dither: plot color c only on (x+y) even cells
local function dither(img, x1, y1, x2, y2, c)
  for y = y1, y2 do
    for x = x1, x2 do
      if (x + y) % 2 == 0 then px(img, x, y, c) end
    end
  end
end

-- expanding bell-wave arc, dithered, upper half-plane around (cx,cy)
local function bellArc(img, cx, cy, r)
  for y = 0, cy do
    for x = 0, 20 do
      local dx, dy = x - cx, y - cy
      if dy <= 0 then
        local d = math.sqrt(dx * dx + dy * dy)
        if math.abs(d - r) < 0.7 and (x + y) % 2 == 0 then
          px(img, x, y, 1)
        end
      end
    end
  end
end

-- ---- per-frame handset jitter (1px rattle) -------------------------------
local offs = { {0, 0}, {0, -1}, {-1, 0}, {0, 1} }

local function draw(img, f)
  -- 1) bell waves radiating from the hook/bell zone; radius grows per frame,
  --    with a trailing wave once the front expands far enough
  local r1 = 1 + 2 * f            -- 3, 5, 7, 9
  bellArc(img, 7, 9, r1)
  if r1 - 4 >= 3 then bellArc(img, 7, 9, r1 - 4) end

  -- 2) body: heavy black box, drawn over arc spill (arcs live outside it)
  fill(img, 12, 6, 29, 29, 1)          -- full black mass, 2px+ strokes all around
  fill(img, 14, 8, 26, 27, 2)          -- white faceplate
  dither(img, 27, 28, 8, 27 - 0, 2)    -- (kept via explicit call below)
  -- right side face: white checker on black = 3/4-view depth
  for y = 8, 27 do
    for x = 27, 28 do
      if (x + y) % 2 == 0 then px(img, x, y, 2) end
    end
  end

  -- instruction card band (top): black band, dithered "text" row
  fill(img, 15, 9, 21, 11, 1)
  for x = 16, 20, 2 do px(img, x, 10, 2) end

  -- coin slot: vertical black slit, upper right of faceplate
  fill(img, 23, 9, 24, 12, 1)

  -- keypad: 3x3 grid of 2x2 black keys
  for _, ky in ipairs({14, 17, 20}) do
    for _, kx in ipairs({15, 18, 21}) do
      fill(img, kx, ky, kx + 1, ky + 1, 1)
    end
  end

  -- coin return door: black hatch with dithered recess
  fill(img, 16, 23, 21, 26, 1)
  dither(img, 17, 24, 20, 25, 2)

  -- 3) hook arm (fixed to body — does not rattle)
  fill(img, 9, 14, 11, 15, 1)

  -- 4) handset on hook, jittered by frame offset
  local ox, oy = offs[f][1], offs[f][2]
  fill(img, 5 + ox, 8 + oy, 9 + ox, 11 + oy, 1)    -- earpiece
  fill(img, 6 + ox, 11 + oy, 8 + ox, 21 + oy, 1)   -- grip bar
  fill(img, 5 + ox, 21 + oy, 9 + ox, 24 + oy, 1)   -- mouthpiece
  -- specular dither highlight down the grip + ear cap glint
  for y = 12, 20, 2 do px(img, 7 + ox, y + oy, 2) end
  px(img, 6 + ox, 9 + oy, 2)
  px(img, 8 + ox, 10 + oy, 2)

  -- 5) cord: 2px sag from mouthpiece into body base
  local cord = { {8, 25}, {8, 26}, {9, 26}, {9, 27}, {10, 27}, {10, 28}, {11, 28} }
  for _, p in ipairs(cord) do
    px(img, p[1], p[2], 1)
    px(img, p[1] + 1, p[2], 1)
  end
end

for f = 1, 4 do
  local cel = getCel(f)
  draw(cel.image, f)
end

local tag = spr:newTag(1, 4)
tag.name = "ring"

local out = os.getenv("ASE_OUT_DIR")
spr:saveAs(app.fs.joinPath(out, "payphone.aseprite"))
app.command.ExportSpriteSheet{
  ui = false,
  askOverwrite = false,
  type = SpriteSheetType.HORIZONTAL,
  textureFilename = app.fs.joinPath(out, "payphone-table-32-32.png"),
  dataFilename = ""
}

print("ASE_GEN_OK")