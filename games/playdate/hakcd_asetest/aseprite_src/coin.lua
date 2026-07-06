-- coin: MARIO-64 style spinning coin, 16x16, 4 frames, strict 1-bit
local outDir = os.getenv("ASE_OUT_DIR")

local spr = Sprite(16, 16, ColorMode.INDEXED)
spr.transparentColor = 0

local pal = Palette(3)
pal:setColor(0, Color{r = 0, g = 0, b = 0, a = 0})       -- 0 transparent
pal:setColor(1, Color{r = 0, g = 0, b = 0, a = 255})     -- 1 black
pal:setColor(2, Color{r = 255, g = 255, b = 255, a = 255}) -- 2 white
spr:setPalette(pal)

-- frames 2..4
for _ = 2, 4 do
  spr:newEmptyFrame()
end

-- 4x4 Bayer matrix (ordered dither), values 0..15
local bayer = {
  { 0,  8,  2, 10},
  {12,  4, 14,  6},
  { 3, 11,  1,  9},
  {15,  7, 13,  5},
}

-- spin: full face -> 3/4 -> edge-on -> 3/4 back
local frames = {
  {rx = 7.0, ring = true,  glint = false, edge = false, back = false},
  {rx = 4.2, ring = false, glint = true,  edge = false, back = false},
  {rx = 1.6, ring = false, glint = false, edge = true,  back = false},
  {rx = 4.2, ring = false, glint = false, edge = false, back = true},
}

local cx, cy = 7.5, 7.5
local ry = 7.0

for fi, cfg in ipairs(frames) do
  local cel = spr:newCel(spr.layers[1], fi)
  local img = cel.image
  local rx = cfg.rx

  if cfg.edge then
    -- edge-on: tall black lens, white rim-light column (dithered lower half)
    for y = 0, 15 do
      for x = 0, 15 do
        local nx = (x - cx) / rx
        local ny = (y - cy) / ry
        if nx * nx + ny * ny <= 1.0 then
          img:putPixel(x, y, 1)
        end
      end
    end
    for y = 0, 15 do
      local nx = (7 - cx) / rx
      local ny = (y - cy) / ry
      if nx * nx + ny * ny <= 1.0 then
        if y >= 3 and y <= 7 then
          img:putPixel(7, y, 2)            -- solid highlight, key light upper-left
        elseif y <= 11 and y % 2 == 1 then
          img:putPixel(7, y, 2)            -- dithered falloff
        end
      end
    end
  else
    local rxi = rx - 2.0   -- inner ellipse => 2px outline
    local ryi = ry - 2.0
    for y = 0, 15 do
      for x = 0, 15 do
        local nx = (x - cx) / rx
        local ny = (y - cy) / ry
        local r2 = nx * nx + ny * ny
        if r2 <= 1.0 then
          local nxi = (x - cx) / rxi
          local nyi = (y - cy) / ryi
          local r2i = nxi * nxi + nyi * nyi
          if r2i > 1.0 then
            img:putPixel(x, y, 1)          -- 2px black contour
          else
            -- dither-gradient sphere shading, key light upper-left
            local grad
            if cfg.back then
              grad = ((-nxi + nyi) / 2 + 1) / 2  -- back face: light flipped
            else
              grad = ((nxi + nyi) / 2 + 1) / 2
            end
            local dark = 0.05 + 0.6 * grad + 0.3 * r2i
            if dark < 0 then dark = 0 end
            if dark > 1 then dark = 1 end
            local t = (bayer[(y % 4) + 1][(x % 4) + 1] + 0.5) / 16
            if dark > t then
              img:putPixel(x, y, 1)
            else
              img:putPixel(x, y, 2)
            end
          end
        end
      end
    end

    -- embossed inner ring (full-face frame only)
    if cfg.ring then
      for y = 0, 15 do
        for x = 0, 15 do
          local nxi = (x - cx) / rxi
          local nyi = (y - cy) / ryi
          local r2i = nxi * nxi + nyi * nyi
          if r2i <= 1.0 then
            local r = math.sqrt(r2i)
            if math.abs(r - 0.62) < 0.10 then
              img:putPixel(x, y, 1)
            end
          end
        end
      end
    end

    -- specular hotspot upper-left (round volume read)
    for y = 0, 15 do
      for x = 0, 15 do
        local nxi = (x - cx) / rxi
        local nyi = (y - cy) / ryi
        if nxi * nxi + nyi * nyi <= 1.0 then
          local dx = nxi + 0.45
          local dy = nyi + 0.45
          if dx * dx + dy * dy < 0.09 then
            img:putPixel(x, y, 2)
          end
        end
      end
    end

    -- spin glint: dithered diagonal white streak
    if cfg.glint then
      for y = 0, 15 do
        for x = 0, 15 do
          local nxi = (x - cx) / rxi
          local nyi = (y - cy) / ryi
          if nxi * nxi + nyi * nyi <= 1.0 then
            local s = x + y
            if s == 8 or s == 9 then
              img:putPixel(x, y, 2)        -- solid core of glint
            elseif (s == 7 or s == 10) and x % 2 == 0 then
              img:putPixel(x, y, 2)        -- checkered glint edge
            end
          end
        end
      end
    end
  end
end

local tag = spr:newTag(1, 4)
tag.name = "spin"

spr:saveAs(app.fs.joinPath(outDir, "coin.aseprite"))
app.command.ExportSpriteSheet{
  ui = false,
  askOverwrite = false,
  type = SpriteSheetType.HORIZONTAL,
  textureFilename = app.fs.joinPath(outDir, "coin-table-16-16.png"),
  dataFilename = "",
}

print("ASE_GEN_OK")