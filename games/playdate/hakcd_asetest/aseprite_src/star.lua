-- HAKCD pack: "star" collectible token, 24x24, 4-frame spin
-- 1-bit Playdate style: black outline, white faceted body, Bayer-dithered
-- shading, sweeping diagonal glint. Palette: 0=transparent 1=black 2=white.

local spr = Sprite(24, 24, ColorMode.INDEXED)
spr.transparentColor = 0

local pal = Palette(3)
pal:setColor(0, Color{r=0,   g=0,   b=0,   a=0  })
pal:setColor(1, Color{r=0,   g=0,   b=0,   a=255})
pal:setColor(2, Color{r=255, g=255, b=255, a=255})
spr:setPalette(pal)

-- frame 1 exists; add 3 more empty frames, then collect one image per frame
spr:newEmptyFrame()
spr:newEmptyFrame()
spr:newEmptyFrame()

local layer = spr.layers[1]
local imgs = {}
imgs[1] = spr.cels[1].image
for f = 2, 4 do
  local cel = spr:newCel(layer, f)
  imgs[f] = cel.image
end

-- ---------------------------------------------------------------- constants
local TWO_PI = math.pi * 2
local STEP   = math.pi / 5          -- 36 deg between star vertices
local CX, CY = 11.5, 11.5
local ROUT   = 11.2                 -- outer point radius
local RIN    = 5.2                  -- inner (valley) radius
local LIGHT  = -3 * math.pi / 4     -- key light from upper-left

-- clustered 4x4 Bayer matrix: the shading engine (no grays, ever)
local BAYER = {
  { 0,  8,  2, 10},
  {12,  4, 14,  6},
  { 3, 11,  1,  9},
  {15,  7, 13,  5},
}

-- neighborhood offsets (Euclidean radius 3) used for edge-distance scan
local OFFS = {}
for dy = -3, 3 do
  for dx = -3, 3 do
    local d2 = dx * dx + dy * dy
    if d2 > 0 and d2 <= 9 then
      OFFS[#OFFS + 1] = {dx, dy, d2}
    end
  end
end

local function wrapAngle(a)
  return (a + math.pi) % TWO_PI - math.pi
end

local function pointInPoly(px, py, poly)
  local inside = false
  local n = #poly
  local j = n
  for i = 1, n do
    local xi, yi = poly[i][1], poly[i][2]
    local xj, yj = poly[j][1], poly[j][2]
    if ((yi > py) ~= (yj > py))
       and (px < (xj - xi) * (py - yi) / (yj - yi) + xi) then
      inside = not inside
    end
    j = i
  end
  return inside
end

-- ------------------------------------------------------------- frame render
for f = 0, 3 do
  local img  = imgs[f + 1]
  -- 18 deg per frame; star has 72 deg symmetry so 4 frames loop seamlessly
  local rot  = f * (TWO_PI / 20)
  local base = -math.pi / 2 + rot   -- first outer point angle (starts up)

  -- 10-vertex star polygon (alternating outer / inner radii)
  local poly = {}
  for i = 0, 9 do
    local ang = base + i * STEP
    local rad = (i % 2 == 0) and ROUT or RIN
    poly[#poly + 1] = {CX + rad * math.cos(ang), CY + rad * math.sin(ang)}
  end

  -- rasterize fill mask at pixel centers
  local inside = {}
  for y = 0, 23 do
    inside[y] = {}
    for x = 0, 23 do
      inside[y][x] = pointInPoly(x + 0.5, y + 0.5, poly)
    end
  end

  -- diagonal glint band sweeps upper-left -> lower-right over the 4 frames
  local glintC = 23 + (f - 1.5) * 9

  for y = 0, 23 do
    for x = 0, 23 do
      if inside[y][x] then
        -- squared distance to nearest outside pixel (capped at 9)
        local d2min = 99
        for k = 1, #OFFS do
          local o = OFFS[k]
          local nx, ny = x + o[1], y + o[2]
          local isOut = true
          if nx >= 0 and nx <= 23 and ny >= 0 and ny <= 23 then
            isOut = not inside[ny][nx]
          end
          if isOut and o[3] < d2min then d2min = o[3] end
        end

        if d2min <= 4 then
          img:putPixel(x, y, 1)               -- 2px black silhouette stroke
        else
          local px, py = x + 0.5, y + 0.5
          local dx, dy = px - CX, py - CY
          local dist = math.sqrt(dx * dx + dy * dy)
          local ang  = math.atan(dy, dx)

          -- facet = angular slice between consecutive vertices; its
          -- mid-angle acts as the facet pseudo-normal for lighting
          local rel = (ang - base) % TWO_PI
          local s   = math.floor(rel / STEP) % 10
          local mid = base + (s + 0.5) * STEP
          local b   = 0.55 + 0.45 * math.cos(mid - LIGHT)

          if d2min <= 9 then b = b * 0.7 end  -- dithered rim just inside line

          local g = math.abs((px + py) - glintC)
          if g <= 3.0 then b = b + 0.45 end   -- soft glint halo

          if b < 0.10 then b = 0.10 end
          if b > 1.0  then b = 1.0  end

          local t = (BAYER[(y % 4) + 1][(x % 4) + 1] + 0.5) / 16
          local idx = (t <= b) and 2 or 1

          -- crease + ridge lines sell the chunky 3D facets
          if dist > 2.2 then
            local bestOdd, bestEven, evA = 99, 99, 0
            for i = 0, 9 do
              local va = base + i * STEP
              local ad = math.abs(wrapAngle(ang - va))
              if i % 2 == 1 then
                if ad < bestOdd then bestOdd = ad end
              else
                if ad < bestEven then bestEven = ad; evA = va end
              end
            end
            if dist * math.sin(bestOdd) < 0.6 then
              idx = 1                          -- valley crease: shadow line
            elseif dist * math.sin(bestEven) < 0.6 then
              if math.cos(evA - LIGHT) > 0.1 then
                idx = 2                        -- lit point ridge: highlight
              else
                idx = 1                        -- far-side ridge: dark crease
              end
            end
          end

          if g <= 1.3 then idx = 2 end        -- hard glint core sweeps on top

          img:putPixel(x, y, idx)
        end
      end
    end
  end
end

local tag = spr:newTag(1, 4)
tag.name = "spin"

-- ------------------------------------------------------------------- export
local outDir = os.getenv("ASE_OUT_DIR")
spr:saveAs(app.fs.joinPath(outDir, "star.aseprite"))
app.command.ExportSpriteSheet{
  ui = false,
  askOverwrite = false,
  type = SpriteSheetType.HORIZONTAL,
  textureFilename = app.fs.joinPath(outDir, "star-table-24-24.png"),
  dataFilename = "",
}

print("ASE_GEN_OK")