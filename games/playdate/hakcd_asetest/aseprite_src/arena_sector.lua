-- arena_sector: isometric cyberspace arena floor, 400x240, 1-bit Playdate
-- HAKCD action style: dark tiled iso grid, dithered circuit seams, edge pillars, open center

local W, H = 400, 240

local sprite = Sprite(W, H, ColorMode.INDEXED)
sprite.transparentColor = 0

local pal = Palette(3)
pal:setColor(0, Color{ r = 0,   g = 0,   b = 0,   a = 0   })  -- transparent
pal:setColor(1, Color{ r = 0,   g = 0,   b = 0,   a = 255 })  -- black
pal:setColor(2, Color{ r = 255, g = 255, b = 255, a = 255 })  -- white
sprite:setPalette(pal)

local layer = sprite.layers[1]
local cel = sprite.cels[1]
if cel == nil then cel = sprite:newCel(layer, 1) end
local img = cel.image
if img == nil or img.width ~= W or img.height ~= H then
  img = Image(W, H, ColorMode.INDEXED)
  cel.image = img
  cel.position = Point(0, 0)
end

-- ---------- helpers ----------

local function px(x, y, c)
  if x >= 0 and x < W and y >= 0 and y < H then
    img:putPixel(x, y, c)
  end
end

local BAYER = {
  { 0,  8,  2, 10},
  {12,  4, 14,  6},
  { 3, 11,  1,  9},
  {15,  7, 13,  5},
}

local function dith(x, y, d)
  return d * 16 > BAYER[(y % 4) + 1][(x % 4) + 1]
end

-- subtle elliptical vignette, 1.0 center -> ~0 corners
local function vig(x, y)
  local nx = (x - 200) / 200
  local ny = (y - 120) / 120
  local v = 1.35 - 0.65 * (nx * nx + ny * ny)
  if v < 0 then v = 0 elseif v > 1 then v = 1 end
  return v
end

local function hash(i, j)
  local h = i * 374761393 + j * 668265263
  h = (h ~ (h >> 13)) * 1274126177
  h = h ~ (h >> 16)
  return h % 1000003
end

-- ---------- 1. fill canvas black ----------

for y = 0, H - 1 do
  for x = 0, W - 1 do
    img:putPixel(x, y, 1)
  end
end

-- ---------- 2. iso tile grid (40x20 diamonds), dithered, fading with depth + vignette ----------
-- family A: y = x//2 + c   family B: y = -x//2 + c   (c multiples of 20)

for y = 0, H - 1 do
  for x = 0, W - 1 do
    local fx = x // 2
    if ((y - fx) % 20 == 0) or ((y + fx) % 20 == 0) then
      local depth = 0.28 + 0.55 * (y / H)     -- far = sparse, near = denser
      local d = depth * vig(x, y)
      if dith(x, y, d) then px(x, y, 2) end
    end
  end
end

-- ---------- 3. circuit traces + node pads along seams ----------
-- lattice: x = 20*(i-j)+200, y = 10*(i+j)  (exact seam intersections)

local function padSmall(x, y)
  px(x, y, 2); px(x - 1, y, 2); px(x + 1, y, 2); px(x, y - 1, 2); px(x, y + 1, 2)
end

local function padBig(x, y)
  for dx = -1, 1 do px(x + dx, y - 1, 2); px(x + dx, y + 1, 2) end
  for dx = -2, 2 do px(x + dx, y, 2) end
end

-- dashed 2:1 stair trace along a seam; dir 0=DR 1=DL 2=UR 3=UL
local function trace(x0, y0, dir, len)
  local sx, sy = x0, y0
  local dx = (dir % 2 == 0) and 2 or -2
  local dy = (dir < 2) and 1 or -1
  for k = 0, len - 1 do
    if k % 3 ~= 2 then
      px(sx, sy, 2); px(sx + 1, sy, 2)
    end
    sx = sx + dx; sy = sy + dy
  end
  px(sx, sy, 2); px(sx + 1, sy, 2); px(sx, sy + 1, 2); px(sx + 1, sy + 1, 2)
end

for i = -12, 24 do
  for j = -12, 24 do
    local x = 20 * (i - j) + 200
    local y = 10 * (i + j)
    if x >= 6 and x <= 393 and y >= 8 and y <= 232 then
      local h = hash(i, j)
      local v = vig(x, y)
      local inCenter = (x > 120 and x < 280 and y > 80 and y < 190)
      if v > 0.25 then
        local pad = (h % 9 == 0)
        if inCenter then pad = (h % 27 == 0) end   -- keep combat zone sparse
        if pad then
          if h % 5 == 0 then padBig(x, y) else padSmall(x, y) end
        end
        if (h % 14 == 1) and not inCenter then
          local len = 10 * (1 + (h // 31) % 2)
          trace(x, y, (h // 7) % 4, len)
        end
      end
    end
  end
end

-- ---------- 4. angular data pillars / node blocks, EDGES only ----------
-- iso prism: base front corner (cx,cy), half-width hw, body height h

local function drawBlock(cx, cy, hw, h, seed)
  local qh = hw // 2
  -- solid black silhouette (wipes grid behind it)
  for y = cy - h - 2 * qh, cy do
    local xl, xr
    if y < cy - h - qh then
      local dy = y - (cy - h - 2 * qh)
      xl = cx - 2 * dy; xr = cx + 2 * dy
    elseif y <= cy - qh then
      xl = cx - hw; xr = cx + hw
    else
      local dy = y - (cy - qh)
      xl = cx - (hw - 2 * dy); xr = cx + (hw - 2 * dy)
    end
    for x = xl, xr do px(x, y, 1) end
  end
  -- top diamond upper edges (2px strokes)
  for dy = 0, qh do
    local y = cy - h - 2 * qh + dy
    local xl = cx - 2 * dy
    local xr = cx + 2 * dy
    px(xl, y, 2); px(xl + 1, y, 2); px(xr - 1, y, 2); px(xr, y, 2)
  end
  -- vertical silhouette sides
  for y = cy - h - qh, cy - qh do
    px(cx - hw, y, 2); px(cx - hw + 1, y, 2)
    px(cx + hw - 1, y, 2); px(cx + hw, y, 2)
  end
  -- bottom cap edges
  for dy = 0, qh do
    local y = cy - qh + dy
    local xl = cx - (hw - 2 * dy)
    local xr = cx + (hw - 2 * dy)
    px(xl, y, 2); px(xl + 1, y, 2); px(xr - 1, y, 2); px(xr, y, 2)
  end
  -- top face lower edges, meet at front corner (cx, cy-h)
  for dy = 0, qh do
    local y = cy - h - qh + dy
    local xl = cx - hw + 2 * dy
    local xr = cx + hw - 2 * dy
    px(xl, y, 2); px(xl + 1, y, 2); px(xr - 1, y, 2); px(xr, y, 2)
  end
  -- front vertical edge
  for y = cy - h, cy do
    px(cx, y, 2); px(cx + 1, y, 2)
  end
  -- right face: sparse 25% diagonal dither (lit side)
  for dx = 3, hw - 3 do
    local x = cx + dx
    local ytop = cy - h - dx // 2 + 2
    local ybot = cy - dx // 2 - 2
    for y = ytop, ybot do
      if (x + 2 * y) % 4 == 0 then px(x, y, 2) end
    end
  end
  -- left face: dithered data band following the iso slope
  local by = cy - (h * 2) // 3
  for dx = 3, hw - 3 do
    if dx % 2 == 0 then px(cx - dx, by - dx // 2, 2) end
  end
  -- left face: two 2x2 status LEDs
  local dx0 = hw - 5
  local ex = cx - dx0
  local ey = cy - h - dx0 // 2 + 4 + (seed % 3)
  px(ex, ey, 2); px(ex + 1, ey, 2); px(ex, ey + 1, 2); px(ex + 1, ey + 1, 2)
  px(ex, ey + 5, 2); px(ex + 1, ey + 5, 2); px(ex, ey + 6, 2); px(ex + 1, ey + 6, 2)
  -- node port on top face center
  padSmall(cx, cy - h - qh)
  -- ground stubs: short seam traces tying base into the floor circuit
  trace(cx + 2, cy + 1, 0, 5)
  trace(cx - 2, cy + 1, 1, 5)
end

-- all bases lattice-aligned; center (x 130-270, y 55-190) stays open
drawBlock( 60,  70, 22, 44, 1)   -- far left tall pillar
drawBlock(140,  50, 16, 30, 2)   -- far mid-left node
drawBlock(260,  50, 16, 30, 3)   -- far mid-right node
drawBlock(340,  70, 22, 44, 4)   -- far right tall pillar
drawBlock( 20, 150, 18, 36, 5)   -- left edge pillar
drawBlock(380, 150, 18, 36, 6)   -- right edge pillar
drawBlock(100, 230, 24, 14, 7)   -- near-left low block
drawBlock(300, 230, 24, 14, 8)   -- near-right low block

-- ---------- 5. flatten + save ----------

sprite:flatten()
local out = os.getenv("ASE_OUT_DIR")
sprite:saveAs(app.fs.joinPath(out, "arena_sector.aseprite"))
sprite:saveAs(app.fs.joinPath(out, "arena_sector.png"))

print("ASE_GEN_OK")