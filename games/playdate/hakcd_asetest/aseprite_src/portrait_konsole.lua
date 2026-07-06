-- portrait_konsole: MARIO-64 style 1-bit dialogue portrait, 64x64
-- k0nsole: hooded operative, half face in dither shadow, one sharp eye

local W, H = 64, 64
local sprite = Sprite(W, H, ColorMode.INDEXED)
sprite.transparentColor = 0

local pal = Palette(3)
pal:setColor(0, Color{r=0, g=0, b=0, a=0})
pal:setColor(1, Color{r=0, g=0, b=0, a=255})
pal:setColor(2, Color{r=255, g=255, b=255, a=255})
sprite:setPalette(pal)

local layer = sprite.layers[1]
local cel = layer:cel(1)
if not cel then cel = sprite:newCel(layer, 1) end
local img = cel.image

-- Bayer 4x4 dither: lv 0 = solid black .. 16 = solid white
local B = {
  {0, 8, 2, 10},
  {12, 4, 14, 6},
  {3, 11, 1, 9},
  {15, 7, 13, 5},
}
local function dith(x, y, lv)
  if lv <= 0 then return 1 end
  if lv >= 16 then return 2 end
  if B[(y % 4) + 1][(x % 4) + 1] < lv then return 2 else return 1 end
end

-- silhouette: big rounded hood dome + widening cloak shoulders to bottom edge
local function hoodE(x, y)
  local dx, dy = (x - 32) / 25, (y - 30) / 27
  return dx * dx + dy * dy
end
local function inHood(x, y) return hoodE(x, y) <= 1.0 end
local function inShoulders(x, y)
  if y < 46 then return false end
  local hw = 13 + (y - 46) * 1.5
  if hw > 29 then hw = 29 end
  return math.abs(x - 32) <= hw
end
local function inSil(x, y)
  return inHood(x, y) or inShoulders(x, y)
end
-- bottom edge treated as inside so bust crops open at canvas bottom
local function inSilExt(x, y)
  if y > 63 then y = 63 end
  if x < 0 or x > 63 or y < 0 then return false end
  return inSil(x, y)
end

local offs = {{3,0},{-3,0},{0,3},{0,-3},{2,2},{2,-2},{-2,2},{-2,-2}}
local function isOutline(x, y)
  if not inSil(x, y) then return false end
  for i = 1, #offs do
    if not inSilExt(x + offs[i][1], y + offs[i][2]) then return true end
  end
  return false
end

-- face opening ellipse inside hood
local function faceE(x, y)
  local dx, dy = (x - 31) / 12, (y - 36) / 13
  return dx * dx + dy * dy
end

-- face shading: lit left half, hard dither terminator, hood-overhang AO on top,
-- curvature falloff at left edge + chin, AO ring at face rim
local function faceLv(x, y, fe)
  local fx, fy = x - 31, y - 36
  local lv = 16
  local t = fx + fy * 0.25
  if t > 1 then lv = 16 - (t - 1) * 2.4 end
  if fx < -7 then lv = lv - (-7 - fx) * 1.5 end
  if fy < -7 then lv = lv - (-7 - fy) * 2.0 end
  if fy > 8 then lv = lv - (fy - 8) * 1.3 end
  if fe > 0.70 then lv = lv - (fe - 0.70) * 12 end
  return math.floor(lv)
end

for y = 0, 63 do
  for x = 0, 63 do
    local idx
    if not inSil(x, y) then
      -- background: radial glow halo behind head, dark vignette corners
      local dx, dy = x - 32, y - 28
      local d = math.sqrt(dx * dx + dy * dy)
      idx = dith(x, y, math.floor(10 - d * 0.18))
    elseif isOutline(x, y) then
      idx = 1 -- 3px contour
    else
      local fe = faceE(x, y)
      if fe <= 1.0 and y <= 49 then
        idx = dith(x, y, faceLv(x, y, fe))
      elseif fe <= 1.12 and y <= 50 then
        idx = 1 -- crisp inner line separating face from hood rim
      elseif fe <= 1.40 and y <= 51 then
        -- rounded hood rim: lit upper-left, dark lower-right
        local fx, fy = x - 31, y - 36
        idx = dith(x, y, math.floor(5 - fx * 0.35 - fy * 0.35))
      elseif inHood(x, y) then
        -- sphere-shaded hood dome, key light upper-left
        local nx, ny = (x - 32) / 25, (y - 30) / 27
        local lam = (1 - (nx + ny) * 0.707) / 2
        local lv = math.floor(2 + lam * 13)
        -- bright rim light band just inside the upper-left outline
        if hoodE(x, y) > 0.70 and (nx + ny) < -0.55 then lv = 15 end
        idx = dith(x, y, lv)
      else
        -- cloak shoulders: lateral light gradient
        idx = dith(x, y, math.floor(9 - (x - 32) * 0.22 - (y - 52) * 0.18))
      end
    end
    img:putPixel(x, y, idx)
  end
end

-- sharp angular brow slash over lit eye (2px thick)
local brow = {{21,33},{22,32},{23,32},{24,32},{25,32},{26,33},{27,33},{28,34}}
for i = 1, #brow do
  img:putPixel(brow[i][1], brow[i][2], 1)
  img:putPixel(brow[i][1], brow[i][2] + 1, 1)
end

-- the one visible eye: black almond, white glint upper-left
for x = 23, 27 do img:putPixel(x, 36, 1) end
for x = 22, 28 do img:putPixel(x, 37, 1) end
for x = 23, 27 do img:putPixel(x, 38, 1) end
img:putPixel(23, 36, 2)
img:putPixel(24, 37, 2)

-- nose shadow on the terminator
img:putPixel(31, 40, 1)
img:putPixel(31, 41, 1)
img:putPixel(32, 42, 1)

-- flat stoic mouth, fading into shadow side
for x = 26, 30 do img:putPixel(x, 46, 1) end
img:putPixel(31, 47, 1)

-- cloak fold creases
for y = 50, 63 do
  local x1 = math.floor(22 - (y - 50) * 0.2 + 0.5)
  local x2 = math.floor(41 + (y - 50) * 0.3 + 0.5)
  if inSil(x1, y) and not isOutline(x1, y) then img:putPixel(x1, y, 1) end
  if inSil(x2, y) and not isOutline(x2, y) then img:putPixel(x2, y, 1) end
end

-- tiny chest clasp gem: black plus with white sparkle center
img:putPixel(32, 54, 1)
img:putPixel(31, 55, 1)
img:putPixel(33, 55, 1)
img:putPixel(32, 56, 1)
img:putPixel(32, 55, 2)

sprite:flatten()
local out = os.getenv("ASE_OUT_DIR")
sprite:saveAs(app.fs.joinPath(out, "portrait_konsole.aseprite"))
sprite:saveAs(app.fs.joinPath(out, "portrait_konsole.png"))
print("ASE_GEN_OK")