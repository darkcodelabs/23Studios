-- vault: squat bank-vault door, 48x48, 4 frames
-- wheel rotates 15deg/frame (6 spokes @60deg => seamless loop)
-- coin glint sweeps down the right-side seam
local W, H = 48, 48

local spr = Sprite(W, H, ColorMode.INDEXED)
spr.transparentColor = 0

local pal = Palette(3)
pal:setColor(0, Color{r=0,   g=0,   b=0,   a=0})
pal:setColor(1, Color{r=0,   g=0,   b=0,   a=255})
pal:setColor(2, Color{r=255, g=255, b=255, a=255})
spr:setPalette(pal)

for _ = 2, 4 do spr:newEmptyFrame() end

local function px(img, x, y, c)
  if x >= 0 and x < W and y >= 0 and y < H then
    img:putPixel(x, y, c)
  end
end

local function rectfill(img, x0, y0, x1, y1, c)
  for y = y0, y1 do
    for x = x0, x1 do px(img, x, y, c) end
  end
end

local CX, CY = 23.5, 26.0

local function draw(img, f)
  -- === wall backdrop, sparse Bayer-ish dither ===
  rectfill(img, 0, 0, 47, 47, 2)
  for y = 0, 47 do
    for x = 0, 47 do
      if x < 2 or x > 45 or y < 5 then
        if (x % 4 == 0 and y % 4 == 1) or (x % 4 == 2 and y % 4 == 3) then
          px(img, x, y, 1)
        end
      end
    end
  end

  -- === squat wall-frame plate, 2px black outline ===
  rectfill(img, 2, 5, 45, 47, 1)
  rectfill(img, 4, 7, 43, 45, 2)

  -- plate inner shading: dithered right edge + floor contact
  for y = 7, 45 do
    for x = 42, 43 do
      if (x + y) % 2 == 0 then px(img, x, y, 1) end
    end
  end
  for y = 44, 45 do
    for x = 4, 43 do
      if (x + y) % 2 == 0 then px(img, x, y, 1) end
    end
  end

  -- plate corner bolts (2x2, white top-left glint)
  local bolts = {{6, 9}, {40, 9}, {6, 41}, {40, 41}}
  for _, b in ipairs(bolts) do
    rectfill(img, b[1], b[2], b[1] + 1, b[2] + 1, 1)
    px(img, b[1], b[2], 2)
  end

  -- === hinge blocks on the left (three-quarter weight) ===
  rectfill(img, 2, 20, 7, 25, 1)
  for x = 3, 6 do px(img, x, 22, 2) end
  rectfill(img, 2, 31, 7, 36, 1)
  for x = 3, 6 do px(img, x, 33, 2) end

  -- === door frame ring + seam: solid black band r15.8..18.8 ===
  for y = 0, 47 do
    for x = 0, 47 do
      local dx, dy = x - CX, y - CY
      local d2 = dx * dx + dy * dy
      if d2 <= 18.8 * 18.8 and d2 >= 15.8 * 15.8 then
        px(img, x, y, 1)
      end
    end
  end

  -- === door face: white disc, beveled edge dither, lower-right shade ===
  for y = 0, 47 do
    for x = 0, 47 do
      local dx, dy = x - CX, y - CY
      local d2 = dx * dx + dy * dy
      if d2 < 15.8 * 15.8 then
        px(img, x, y, 2)
        if d2 >= 14.2 * 14.2 and (dx + dy) > 0 and (x + y) % 2 == 0 then
          px(img, x, y, 1)  -- machined bevel, shadow side only
        end
        if d2 < 14.2 * 14.2 and (0.7 * dx + dy) > 8.5 and (x + y) % 2 == 0 then
          px(img, x, y, 1)  -- checkerboard form shadow, light from top-left
        end
      end
    end
  end

  -- === 12 rivets around the rim, r13.2, 2x2 with highlight ===
  for i = 0, 11 do
    local a = math.rad(i * 30 + 15)
    local rx = CX + 13.2 * math.cos(a)
    local ry = CY + 13.2 * math.sin(a)
    local bx = math.floor(rx - 0.5)
    local by = math.floor(ry - 0.5)
    rectfill(img, bx, by, bx + 1, by + 1, 1)
    px(img, bx, by, 2)
  end

  -- === spoked wheel: ring r7.4..9.4 ===
  for y = 15, 37 do
    for x = 12, 36 do
      local dx, dy = x - CX, y - CY
      local d2 = dx * dx + dy * dy
      if d2 <= 9.4 * 9.4 and d2 >= 7.4 * 7.4 then
        px(img, x, y, 1)
      end
    end
  end

  -- 6 spokes, 2px thick, knobs past the ring; 15deg per frame
  local rot = math.rad((f - 1) * 15 - 90)
  for i = 0, 5 do
    local a = rot + math.rad(i * 60)
    local ca, sa = math.cos(a), math.sin(a)
    for t = 0, 120 do
      local tt = 2 + t * 0.08
      for s = -1, 1, 2 do
        local sx = CX + ca * tt - sa * 0.45 * s
        local sy = CY + sa * tt + ca * 0.45 * s
        px(img, math.floor(sx + 0.5), math.floor(sy + 0.5), 1)
      end
    end
    local kx = math.floor(CX + ca * 11.6 + 0.5)
    local ky = math.floor(CY + sa * 11.6 + 0.5)
    for yy = ky - 1, ky + 1 do
      for xx = kx - 1, kx + 1 do
        local ddx, ddy = xx - kx, yy - ky
        if ddx * ddx + ddy * ddy <= 2 then px(img, xx, yy, 1) end
      end
    end
  end

  -- hub, r3.4, with two-pixel top-left highlight
  for y = 22, 30 do
    for x = 19, 28 do
      local dx, dy = x - CX, y - CY
      if dx * dx + dy * dy <= 3.4 * 3.4 then px(img, x, y, 1) end
    end
  end
  px(img, 22, 25, 2)
  px(img, 23, 24, 2)

  -- === coin glint sweeping down the right seam: -75 -> +30 deg ===
  local ga = math.rad(-75 + (f - 1) * 35)
  for k = -1, 1 do
    local aa = ga + k * 0.12
    local gx = math.floor(CX + 17.3 * math.cos(aa) + 0.5)
    local gy = math.floor(CY + 17.3 * math.sin(aa) + 0.5)
    px(img, gx, gy, 2)
  end
  local gx = math.floor(CX + 17.3 * math.cos(ga) + 0.5)
  local gy = math.floor(CY + 17.3 * math.sin(ga) + 0.5)
  px(img, gx + 1, gy, 2)
  px(img, gx - 1, gy, 2)
  px(img, gx, gy + 1, 2)
  px(img, gx, gy - 1, 2)
end

for f = 1, 4 do
  local img
  if f == 1 then
    img = spr.cels[1].image
  else
    img = spr:newCel(spr.layers[1], f).image
  end
  draw(img, f)
end

local tag = spr:newTag(1, 4)
tag.name = "spin"

local out = os.getenv("ASE_OUT_DIR")
spr:saveAs(app.fs.joinPath(out, "vault.aseprite"))
app.command.ExportSpriteSheet{
  ui = false,
  askOverwrite = false,
  type = SpriteSheetType.HORIZONTAL,
  textureFilename = app.fs.joinPath(out, "vault-table-48-48.png"),
  dataFilename = ""
}

print("ASE_GEN_OK")