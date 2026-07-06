-- room_lab: 1-bit Mario64-style empty iso room corner, 400x240, HAKCD clean
local W, H = 400, 240

local spr = Sprite(W, H, ColorMode.INDEXED)
spr.transparentColor = 0

local pal = Palette(3)
pal:setColor(0, Color{r=0,   g=0,   b=0,   a=0})
pal:setColor(1, Color{r=0,   g=0,   b=0,   a=255})
pal:setColor(2, Color{r=255, g=255, b=255, a=255})
spr:setPalette(pal)

local cel = spr.cels[1]
if cel == nil then cel = spr:newCel(spr.layers[1], 1) end
local img = cel.image

local function px(x, y, c)
  if x >= 0 and x < W and y >= 0 and y < H then img:putPixel(x, y, c) end
end

-- iso coords: a = y + x/2 (left-wall family), b = y - x/2 (right-wall family)
-- left wall base: a = 220, right wall base: b = 20
-- left wall top: y = 126 - x/2, right wall top: y = x/2 - 74, corner x = 200

-- moonlight pool on floor (iso-aligned rectangle, projected from window)
local function poolIn(x, y)
  local a = y + x * 0.5
  local b = y - x * 0.5
  return a > 226 and a < 290 and b > 88 and b < 146
end

local function floorAt(x, y)
  return (y + x * 0.5) >= 220 and (y - x * 0.5) >= 20
end

-- ============ base pass: void / walls / baseboard / floor ============
for y = 0, H - 1 do
  for x = 0, W - 1 do
    local a = y + x * 0.5
    local b = y - x * 0.5
    local c = 2
    if x < 200 and a < 220 then
      if y < 126 - x * 0.5 then
        c = 1 -- void above left wall
      elseif a >= 215 then
        c = 1 -- baseboard
      elseif x >= 187 and x <= 198 and a < 214 and y > 126 - x * 0.5 + 4
             and x % 2 == 0 and y % 2 == 0 then
        c = 1 -- light corner dither, left wall
      end
    elseif x >= 200 and b < 20 then
      if y < x * 0.5 - 74 then
        c = 1 -- void above right wall
      elseif b >= 15 then
        c = 1 -- baseboard
      elseif x >= 202 and x <= 213 and b < 14 and y > x * 0.5 - 74 + 4
             and x % 2 == 1 and y % 2 == 0 then
        c = 1 -- light corner dither, right wall
      end
    else
      -- floor: soft checker contact shadow hugging both wall bases
      if not poolIn(x, y) then
        if ((a <= 227 and x <= 210) or (b <= 27 and x >= 190))
           and (x + y) % 2 == 0 then
          c = 1
        end
      end
    end
    img:putPixel(x, y, c)
  end
end

-- ============ floor tile grid (40x20 iso diamonds, grout suppressed in light pool) ============
for a0 = 240, 420, 20 do
  for x = 0, W - 1 do
    local y = a0 - math.floor(x / 2)
    if y >= 0 and y < H and floorAt(x, y) and not poolIn(x, y) then px(x, y, 1) end
  end
end
for b0 = 40, 220, 20 do
  for x = 0, W - 1 do
    local y = b0 + math.floor(x / 2)
    if y >= 0 and y < H and floorAt(x, y) and not poolIn(x, y) then px(x, y, 1) end
  end
end

-- ============ moonlight pool: crisp border + mullion cast-shadow cross ============
for x = 80, 138 do px(x, 226 - math.floor(x / 2), 1) end
for x = 144, 202 do px(x, 290 - math.floor(x / 2), 1) end
for x = 138, 202 do px(x, 88 + math.floor(x / 2), 1) end
for x = 80, 144 do px(x, 146 + math.floor(x / 2), 1) end
for x = 112, 170 do px(x, 258 - math.floor(x / 2), 1) end
for x = 109, 173 do px(x, 117 + math.floor(x / 2), 1) end

-- ============ wall structure lines ============
-- wall top edges, 2px
for x = 0, 199 do
  local y = 126 - math.floor(x / 2)
  px(x, y, 1); px(x, y + 1, 1)
end
for x = 200, 399 do
  local y = math.floor(x / 2) - 74
  px(x, y, 1); px(x, y + 1, 1)
end
-- corner vertical, 2px
for y = 26, 119 do px(199, y, 1); px(200, y, 1) end
-- picture rail, 1px
for x = 0, 198 do px(x, 140 - math.floor(x / 2), 1) end
for x = 201, 399 do px(x, math.floor(x / 2) - 60, 1) end

-- ============ window with moon, left back wall ============
local function wTop(x) return 148 - math.floor(x / 2) end
local function wBot(x) return 194 - math.floor(x / 2) end
local function wMid(x) return 171 - math.floor(x / 2) end

for x = 60, 130 do for y = wTop(x), wBot(x) do px(x, y, 1) end end             -- frame silhouette
for x = 62, 128 do for y = wTop(x) + 2, wBot(x) - 2 do px(x, y, 2) end end     -- frame body
for x = 65, 125 do for y = wTop(x) + 5, wBot(x) - 5 do px(x, y, 1) end end     -- night panes
for x = 93, 97 do for y = wTop(x) + 5, wBot(x) - 5 do px(x, y, 2) end end      -- vertical mullion
for x = 65, 125 do for y = wMid(x) - 1, wMid(x) + 1 do px(x, y, 2) end end     -- horizontal mullion
for x = 56, 134 do for y = wBot(x) + 1, wBot(x) + 3 do px(x, y, 1) end end     -- sill

local function isPane(x, y)
  if x < 65 or x > 125 then return false end
  if x >= 93 and x <= 97 then return false end
  if y < wTop(x) + 5 or y > wBot(x) - 5 then return false end
  if y >= wMid(x) - 1 and y <= wMid(x) + 1 then return false end
  return true
end

-- full moon in upper-right pane
for dy = -7, 7 do
  for dx = -7, 7 do
    if dx * dx + dy * dy <= 42 then
      local mx, my = 112 + dx, 106 + dy
      if isPane(mx, my) then px(mx, my, 2) end
    end
  end
end
px(110, 105, 1); px(114, 108, 1) -- craters

-- stars
local stars = {{75, 120}, {85, 125}, {80, 146}, {118, 124}}
for _, s in ipairs(stars) do
  if isPane(s[1], s[2]) then px(s[1], s[2], 2) end
end
for _, d in ipairs({{0, 0}, {1, 0}, {-1, 0}, {0, 1}, {0, -1}}) do
  local sx, sy = 73 + d[1], 142 + d[2]
  if isPane(sx, sy) then px(sx, sy, 2) end
end

-- ============ helpers for props ============
local function tri(x1, y1, x2, y2, x3, y3, c, pat)
  local minx = math.max(0, math.min(x1, x2, x3))
  local maxx = math.min(W - 1, math.max(x1, x2, x3))
  local miny = math.max(0, math.min(y1, y2, y3))
  local maxy = math.min(H - 1, math.max(y1, y2, y3))
  local function ed(ax, ay, bx, by, qx, qy)
    return (bx - ax) * (qy - ay) - (by - ay) * (qx - ax)
  end
  for y = miny, maxy do
    for x = minx, maxx do
      local d1 = ed(x1, y1, x2, y2, x, y)
      local d2 = ed(x2, y2, x3, y3, x, y)
      local d3 = ed(x3, y3, x1, y1, x, y)
      local neg = (d1 < 0) or (d2 < 0) or (d3 < 0)
      local pos = (d1 > 0) or (d2 > 0) or (d3 > 0)
      if not (neg and pos) then
        if pat == nil or pat(x, y) then px(x, y, c) end
      end
    end
  end
end

local function line(x1, y1, x2, y2, c, t)
  local dx = math.abs(x2 - x1)
  local dy = math.abs(y2 - y1)
  local sx = x1 < x2 and 1 or -1
  local sy = y1 < y2 and 1 or -1
  local err = dx - dy
  local x, y = x1, y1
  while true do
    for oy = 0, t - 1 do for ox = 0, t - 1 do px(x + ox, y + oy, c) end end
    if x == x2 and y == y2 then break end
    local e2 = 2 * err
    if e2 > -dy then err = err - dy; x = x + sx end
    if e2 < dx then err = err + dx; y = y + sy end
  end
end

local dith25 = function(x, y) return x % 2 == 0 and y % 2 == 0 end

-- ============ crate, hugging right wall ============
-- top diamond N(334,164) E(358,176) S(334,188) W(310,176); base +24
tri(334, 164, 358, 176, 334, 188, 2); tri(334, 164, 334, 188, 310, 176, 2) -- top
tri(310, 176, 334, 188, 334, 212, 2); tri(310, 176, 334, 212, 310, 200, 2) -- left face
tri(334, 188, 358, 176, 358, 200, 2); tri(334, 188, 358, 200, 334, 212, 2) -- right face
tri(334, 188, 358, 176, 358, 200, 1, dith25)                               -- shade right face
tri(334, 188, 358, 200, 334, 212, 1, dith25)

line(310, 176, 334, 164, 1, 2); line(334, 164, 358, 176, 1, 2)
line(358, 176, 358, 200, 1, 2); line(358, 200, 334, 212, 1, 2)
line(334, 212, 310, 200, 1, 2); line(310, 200, 310, 176, 1, 2)
line(310, 176, 334, 188, 1, 2); line(334, 188, 358, 176, 1, 2)
line(334, 188, 334, 212, 1, 2)

-- plank panel inset on left face
for x = 314, 330 do
  local o = math.floor((x - 310) / 2)
  px(x, 180 + o, 1); px(x, 196 + o, 1)
end
for y = 182, 198 do px(314, y, 1) end
for y = 190, 206 do px(330, y, 1) end

-- crate contact shadow
for x = 310, 334 do
  local y = 200 + math.floor((x - 310) / 2)
  if (x + y) % 2 == 0 then px(x, y + 2, 1); px(x, y + 3, 1) end
end
for x = 334, 358 do
  local y = 212 - math.floor((x - 334) / 2)
  if (x + y) % 2 == 0 then px(x, y + 2, 1); px(x, y + 3, 1) end
end

-- ============ potted plant, hugging far-left wall ============
-- leaves first (bases hide under pot rim)
tri(20, 192, 26, 188, 6, 174, 1)
tri(34, 188, 40, 192, 54, 172, 1)
tri(22, 190, 30, 186, 10, 157, 1)
tri(30, 186, 38, 190, 50, 155, 1)
tri(26, 190, 34, 190, 30, 150, 1)
for y = 170, 184 do px(30, y, 2) end -- center leaf vein

-- pot rim
for y = 186, 193 do for x = 18, 42 do px(x, y, 2) end end
for x = 18, 42 do px(x, 186, 1); px(x, 187, 1); px(x, 192, 1); px(x, 193, 1) end
for y = 186, 193 do px(18, y, 1); px(19, y, 1); px(41, y, 1); px(42, y, 1) end

-- pot body
tri(21, 194, 39, 194, 36, 210, 2); tri(21, 194, 36, 210, 24, 210, 2)
line(20, 194, 24, 210, 1, 2); line(39, 194, 35, 210, 1, 2)
line(24, 210, 36, 210, 1, 2)
for x = 23, 37 do px(x, 198, 1) end -- pot band
for y = 200, 207 do
  for x = 33, 37 do
    if x % 2 == 1 and y % 2 == 0 then px(x, y, 1) end -- light shade, pot right
  end
end
-- pot contact shadow
for x = 23, 37 do
  if (x + 212) % 2 == 0 then px(x, 212, 1) else px(x, 213, 1) end
end

-- ============ save ============
spr:flatten()
local out = os.getenv("ASE_OUT_DIR")
spr:saveAs(app.fs.joinPath(out, "room_lab.aseprite"))
spr:saveAs(app.fs.joinPath(out, "room_lab.png"))
print("ASE_GEN_OK")