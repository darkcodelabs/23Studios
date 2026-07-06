local OUT = os.getenv("ASE_OUT_DIR")
local W, H, N = 24, 24, 4
local CX, CY = 11.5, 12.0
local R, RIN = 10.9, 5.6
-- fake Y-axis spin: horizontal squash per frame
local SX = {1.0, 0.64, 0.32, 0.64}
-- diagonal glint band sweeps left-to-right across the loop
local GLINT = {-7.0, -2.5, 2.0, 6.5}
-- twinkle sparkles: {x, y, radius}, travel with the spin
local SPARK = {
  {{4, 3, 1}}, {{3, 6, 2}}, {{19, 4, 2}}, {{20, 8, 1}},
}
local BAYER = {
  {0, 8, 2, 10}, {12, 4, 14, 6}, {3, 11, 1, 9}, {15, 7, 13, 5},
}

local spr = Sprite(W, H, ColorMode.INDEXED)
spr.transparentColor = 0
local pal = Palette(3)
pal:setColor(0, Color{r = 0, g = 0, b = 0, a = 0})
pal:setColor(1, Color{r = 0, g = 0, b = 0, a = 255})
pal:setColor(2, Color{r = 255, g = 255, b = 255, a = 255})
spr:setPalette(pal)

for _ = 2, N do spr:newEmptyFrame() end
local layer = spr.layers[1]

local function frameImage(f)
  for _, c in ipairs(spr.cels) do
    if c.frameNumber == f then return c.image end
  end
  return spr:newCel(layer, f).image
end

local STEP = math.pi * 2 / 5
-- polar-interpolated 5-point star: linear polar blend bulges the arm
-- edges outward, which is what makes it read chunky/rounded
local function inStar(lx, ly)
  local rr = math.sqrt(lx * lx + ly * ly)
  if rr > R then return false end
  if rr <= RIN then return true end
  local a = math.atan(ly, lx)
  local rel = (a + math.pi / 2) % STEP
  local d = math.min(rel, STEP - rel) / (STEP / 2)
  return rr <= R + (RIN - R) * (d ^ 1.15)
end

for f = 1, N do
  local sx = SX[f]
  local img = frameImage(f)

  -- coverage mask, 2x2 supersampled so squashed frames keep soft tips
  local mask = {}
  for y = 0, H - 1 do
    mask[y] = {}
    for x = 0, W - 1 do
      local hits = 0
      for _, oy in ipairs({0.25, 0.75}) do
        for _, ox in ipairs({0.25, 0.75}) do
          if inStar((x + ox - CX) / sx, y + oy - CY) then hits = hits + 1 end
        end
      end
      mask[y][x] = hits >= 2
    end
  end

  local function m(x, y)
    if x < 0 or y < 0 or x >= W or y >= H then return false end
    return mask[y][x]
  end

  -- two erosion rings = 2px black silhouette stroke
  local ring1, ring2 = {}, {}
  for y = 0, H - 1 do
    ring1[y] = {}
    for x = 0, W - 1 do
      if mask[y][x] then
        local edge = false
        for dy = -1, 1 do
          for dx = -1, 1 do
            if not m(x + dx, y + dy) then edge = true end
          end
        end
        ring1[y][x] = edge
      end
    end
  end
  for y = 0, H - 1 do
    ring2[y] = {}
    for x = 0, W - 1 do
      if mask[y][x] and not ring1[y][x] then
        local edge = false
        for dy = -1, 1 do
          for dx = -1, 1 do
            local nx, ny = x + dx, y + dy
            if nx >= 0 and ny >= 0 and nx < W and ny < H and ring1[ny][nx] then
              edge = true
            end
          end
        end
        ring2[y][x] = edge
      end
    end
  end

  for y = 0, H - 1 do
    for x = 0, W - 1 do
      if mask[y][x] then
        if ring1[y][x] or ring2[y][x] then
          img:putPixel(x, y, 1)
        else
          -- fake sphere normal + key light upper-left, Bayer-thresholded:
          -- bright hotspot top-left, dither ramp through the middle,
          -- near-solid black ambient occlusion hugging the lower-right rim
          local xs, ys = x + 0.5 - CX, y + 0.5 - CY
          local ux, uy = (xs / sx) / R, ys / R
          local r2 = math.min(1, ux * ux + uy * uy)
          local nz = math.sqrt(math.max(0, 1 - 0.85 * r2))
          local b = 0.2 + 0.85 * (-0.5 * ux - 0.5 * uy + 0.72 * nz)
          local gd = math.abs((xs - 0.45 * ys) - GLINT[f])
          if gd < 1.6 then
            b = 1
          elseif gd < 2.6 then
            b = b + 0.35
          end
          if b < 0 then b = 0 elseif b > 1 then b = 1 end
          local t = (BAYER[y % 4 + 1][x % 4 + 1] + 0.5) / 16
          img:putPixel(x, y, b > t and 2 or 1)
        end
      end
    end
  end

  -- happy face; eye columns narrow with the squash, hidden edge-on
  if f ~= 3 then
    local cols
    if sx > 0.8 then cols = {8, 9, 14, 15} else cols = {9, 14} end
    for _, ex in ipairs(cols) do
      for ey = 9, 12 do img:putPixel(ex, ey, 1) end
    end
    for _, p in ipairs({{10, 15}, {13, 15}, {11, 16}, {12, 16}}) do
      img:putPixel(p[1], p[2], 1)
    end
  end

  -- twinkle drawn only on transparent background so it never cuts the body
  local function plot(x, y)
    if x >= 0 and y >= 0 and x < W and y < H and not mask[y][x] then
      img:putPixel(x, y, 1)
    end
  end
  for _, s in ipairs(SPARK[f]) do
    local px, py, r = s[1], s[2], s[3]
    for i = -r, r do
      plot(px + i, py)
      plot(px, py + i)
    end
    if r >= 2 then
      plot(px - 1, py - 1); plot(px + 1, py - 1)
      plot(px - 1, py + 1); plot(px + 1, py + 1)
    end
  end
end

local tag = spr:newTag(1, N)
tag.name = "spin"

spr:saveAs(app.fs.joinPath(OUT, "star.aseprite"))
app.command.ExportSpriteSheet{
  ui = false,
  askOverwrite = false,
  type = SpriteSheetType.HORIZONTAL,
  textureFilename = app.fs.joinPath(OUT, "star-table-24-24.png"),
  dataFilename = "",
}
print("ASE_GEN_OK")