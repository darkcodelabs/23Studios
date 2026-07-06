-- HAKCD launcher card 350x155 — Mario-64-style chunky extruded letters, 1-bit dither
local W, H = 350, 155
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

-- 4x4 Bayer: level 0..16 -> white density
local B = {0,8,2,10, 12,4,14,6, 3,11,1,9, 15,7,13,5}
local function dpx(x, y, lvl)
  if lvl > B[(y % 4) * 4 + (x % 4) + 1] then px(x, y, 2) else px(x, y, 1) end
end

-- rounded-rect membership (squared-distance corners, no sqrt)
local function inRR(px_, py_, x, y, w, h, r)
  if px_ < x or py_ < y or px_ > x + w - 1 or py_ > y + h - 1 then return false end
  local dx, dy = 0, 0
  if px_ < x + r then dx = x + r - px_ end
  if px_ > x + w - 1 - r then dx = px_ - (x + w - 1 - r) end
  if py_ < y + r then dy = y + r - py_ end
  if py_ > y + h - 1 - r then dy = py_ - (y + h - 1 - r) end
  return dx * dx + dy * dy <= r * r
end

-- capsule (thick segment) membership
local function inSeg(px_, py_, x0, y0, x1, y1, hw)
  local vx, vy = x1 - x0, y1 - y0
  local wx, wy = px_ - x0, py_ - y0
  local t = (wx * vx + wy * vy) / (vx * vx + vy * vy)
  if t < 0 then t = 0 elseif t > 1 then t = 1 end
  local dx, dy = wx - t * vx, wy - t * vy
  return dx * dx + dy * dy <= hw * hw
end

local function buildMask(w, h, fn)
  local m = {}
  for ly = 0, h - 1 do
    local row = {}
    for lx = 0, w - 1 do row[lx] = fn(lx, ly) or false end
    m[ly] = row
  end
  return m
end

local function mget(m, mw, mh, x, y)
  if x < 0 or y < 0 or x >= mw or y >= mh then return false end
  return m[y][x]
end

------------------------------------------------------------------
-- letter silhouettes, local coords 0..45 x 0..91, 14px strokes
------------------------------------------------------------------
local LW, LH = 46, 92

local function fH(x, y)
  return inRR(x,y, 0,0,14,92,6) or inRR(x,y, 32,0,14,92,6) or inRR(x,y, 0,39,46,14,5)
end
local function fA(x, y)
  return inRR(x,y, 0,0,46,26,16) or inRR(x,y, 0,12,14,80,5)
      or inRR(x,y, 32,12,14,80,5) or inRR(x,y, 10,48,26,12,4)
end
local function fK(x, y)
  return inRR(x,y, 0,0,14,92,6)
      or inSeg(x,y, 13,46, 39,7, 7.4)
      or inSeg(x,y, 13,46, 39,85, 7.4)
end
local function fC(x, y)
  if not inRR(x,y, 0,0,46,92,18) then return false end
  if inRR(x,y, 14,14,24,64,10) then return false end
  if x >= 32 and y >= 28 and y <= 63 then return false end
  return true
end
local function fD(x, y)
  if inRR(x,y, 14,14,20,64,9) then return false end
  return inRR(x,y, 0,0,46,92,20) or inRR(x,y, 0,0,16,92,5)
end

local letterFns = {fH, fA, fK, fC, fD}
local masks = {}
for i, f in ipairs(letterFns) do masks[i] = buildMask(LW, LH, f) end

local LX = {4, 56, 108, 160, 212}
local LY = 26
local EXD = 7 -- extrusion depth (down-right)

------------------------------------------------------------------
-- glove silhouette (absolute coords), mitt = palm + 3 fingers + thumb + cuff
------------------------------------------------------------------
local GX0, GY0, GW, GH = 268, 34, 80, 96
local function fGlove(ax, ay)
  local dx, dy = ax - 306, ay - 86
  if dx * dx + dy * dy <= 576 then return true end            -- palm r24
  if inSeg(ax,ay, 287,58, 292,78, 9)  then return true end    -- finger 1
  if inSeg(ax,ay, 305,52, 305,78, 10) then return true end    -- finger 2
  if inSeg(ax,ay, 322,60, 317,78, 9)  then return true end    -- finger 3
  if inSeg(ax,ay, 331,90, 315,98, 9)  then return true end    -- thumb
  if inRR(ax,ay, 290,106,34,18,7)     then return true end    -- cuff
  return false
end
local gmask = buildMask(GW, GH, function(lx, ly) return fGlove(lx + GX0, ly + GY0) end)
local function Gg(x, y) return mget(gmask, GW, GH, x - GX0, y - GY0) end

------------------------------------------------------------------
-- 1) background: vertical dither gradient, dark sky -> lighter floor
------------------------------------------------------------------
for y = 0, H - 1 do
  local lvl
  if y < 44 then lvl = 1 elseif y < 92 then lvl = 2 elseif y < 122 then lvl = 3 else lvl = 4 end
  for x = 0, W - 1 do dpx(x, y, lvl) end
end

------------------------------------------------------------------
-- 2) cast shadows (solid black blob + dithered soft rim)
------------------------------------------------------------------
local function castShadow(m, mw, mh, OX, OY)
  for y = OY - 2, OY + mh + 1 do
    for x = OX - 2, OX + mw + 1 do
      if mget(m, mw, mh, x - OX, y - OY) then
        px(x, y, 1)
      else
        local n = mget(m,mw,mh, x-OX-2, y-OY) or mget(m,mw,mh, x-OX+2, y-OY)
               or mget(m,mw,mh, x-OX, y-OY-2) or mget(m,mw,mh, x-OX, y-OY+2)
               or mget(m,mw,mh, x-OX-1, y-OY-1) or mget(m,mw,mh, x-OX+1, y-OY+1)
        if n then dpx(x, y, 2) end
      end
    end
  end
end

for i = 1, 5 do castShadow(masks[i], LW, LH, LX[i] + 6, LY + 14) end

-- glove blob shadow: ellipse (308,132) rx30 ry7, soft rim
for y = 122, 142 do
  for x = 274, 342 do
    local ex, ey = (x - 308) / 30, (y - 132) / 7
    local e = ex * ex + ey * ey
    if e <= 1.0 then px(x, y, 1)
    elseif e <= 1.45 then dpx(x, y, 2) end
  end
end

------------------------------------------------------------------
-- 3) body renderer: white face + BR bevel dither, extruded dither
--    side wall, 2px black contour, black face/side separation
------------------------------------------------------------------
local function renderBody(m, mw, mh, OX, OY, D)
  local function S(x, y) return mget(m, mw, mh, x - OX, y - OY) end
  local function Bd(x, y)
    for k = 0, D do
      if mget(m, mw, mh, x - OX - k, y - OY - k) then return true end
    end
    return false
  end
  for y = OY - 3, OY + mh + D + 2 do
    for x = OX - 3, OX + mw + D + 2 do
      if S(x, y) then
        -- face: white with dither bevel toward bottom-right (key light UL)
        if not S(x + 2, y + 2) then dpx(x, y, 6)
        elseif not S(x + 5, y + 5) then dpx(x, y, 11)
        else px(x, y, 2) end
      else
        local nf = S(x-1,y) or S(x+1,y) or S(x,y-1) or S(x,y+1)
                or S(x-2,y) or S(x+2,y) or S(x,y-2) or S(x,y+2)
                or S(x-1,y-1) or S(x+1,y+1) or S(x+1,y-1) or S(x-1,y+1)
                or S(x-2,y-2) or S(x+2,y+2) or S(x+2,y-2) or S(x-2,y+2)
        if nf then
          px(x, y, 1) -- contour / face-vs-side separation, 2px
        elseif D > 0 and Bd(x, y) then
          -- extrusion side wall: mid dither, darker AO at trailing edge
          if not Bd(x + 3, y + 3) then dpx(x, y, 2) else dpx(x, y, 5) end
        elseif D > 0 then
          local nb = Bd(x-2,y) or Bd(x+2,y) or Bd(x,y-2) or Bd(x,y+2)
                  or Bd(x-1,y-1) or Bd(x+1,y+1) or Bd(x+1,y-1) or Bd(x-1,y+1)
                  or Bd(x-2,y-2) or Bd(x+2,y+2)
          if nb then px(x, y, 1) end -- outline around extruded volume
        end
      end
    end
  end
end

for i = 1, 5 do renderBody(masks[i], LW, LH, LX[i], LY, EXD) end

------------------------------------------------------------------
-- 4) glove (round, no extrusion) + detail lines
------------------------------------------------------------------
renderBody(gmask, GW, GH, GX0, GY0, 0)

local function blackSeg2(x0, y0, x1, y1)
  local n = 24
  for i = 0, n do
    local t = i / n
    local xx = math.floor(x0 + (x1 - x0) * t + 0.5)
    local yy = math.floor(y0 + (y1 - y0) * t + 0.5)
    px(xx, yy, 1); px(xx + 1, yy, 1)
  end
end

blackSeg2(296, 58, 297, 74)  -- finger gap 1/2
blackSeg2(313, 56, 312, 74)  -- finger gap 2/3
blackSeg2(317, 90, 328, 89)  -- thumb crease

-- cuff separation line, only where glove is white
for y = 104, 105 do
  for x = 289, 325 do
    if Gg(x, y) then px(x, y, 1) end
  end
end

------------------------------------------------------------------
-- 5) save flat single image + source (single layer = already flat)
------------------------------------------------------------------
local out = os.getenv("ASE_OUT_DIR")
spr:saveAs(app.fs.joinPath(out, "card.aseprite"))
spr:saveAs(app.fs.joinPath(out, "card.png"))

print("ASE_GEN_OK")