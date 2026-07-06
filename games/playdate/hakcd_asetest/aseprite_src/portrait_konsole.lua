-- k0nsole — 64x64 1-bit dialogue portrait, HAKCD house style
-- hooded operative, half face in Bayer shadow, one sharp eye
local OUT = os.getenv("ASE_OUT_DIR")
local W, H = 64, 64

local spr = Sprite(W, H, ColorMode.INDEXED)
spr.transparentColor = 0
local pal = Palette(3)
pal:setColor(0, Color{r=0, g=0, b=0, a=0})
pal:setColor(1, Color{r=0, g=0, b=0, a=255})
pal:setColor(2, Color{r=255, g=255, b=255, a=255})
spr:setPalette(pal)

local cel = spr:newCel(spr.layers[1], 1)
local img = cel.image
local B, Wt = 1, 2

local function px(x, y, c)
  if x >= 0 and x < W and y >= 0 and y < H then img:putPixel(x, y, c) end
end

-- 4x4 ordered Bayer matrix: lvl 0 = solid black .. 16 = solid white
local bayer = {
  {0, 8, 2, 10},
  {12, 4, 14, 6},
  {3, 11, 1, 9},
  {15, 7, 13, 5},
}
local function dpx(x, y, lvl)
  if bayer[(y % 4) + 1][(x % 4) + 1] < lvl then px(x, y, Wt) else px(x, y, B) end
end

local function clamp(v, a, b)
  if v < a then return a elseif v > b then return b else return v end
end

local function seg(x0, y0, x1, y1, c)
  local n = math.max(math.abs(x1 - x0), math.abs(y1 - y0))
  if n == 0 then px(x0, y0, c) return end
  for i = 0, n do
    px(math.floor(x0 + (x1 - x0) * i / n + 0.5),
       math.floor(y0 + (y1 - y0) * i / n + 0.5), c)
  end
end

local function segd(x0, y0, x1, y1, lvl)
  local n = math.max(math.abs(x1 - x0), math.abs(y1 - y0))
  if n == 0 then dpx(x0, y0, lvl) return end
  for i = 0, n do
    dpx(math.floor(x0 + (x1 - x0) * i / n + 0.5),
        math.floor(y0 + (y1 - y0) * i / n + 0.5), lvl)
  end
end

-- hood silhouette half-width per row: domed peak -> wide hood -> shoulders to edges
local function hoodHW(y)
  if y < 4 then return -1 end
  if y <= 40 then return 3 + math.floor(21 * math.sqrt((y - 4) / 36) + 0.5) end
  if y <= 50 then return 24 + math.floor((y - 40) / 8) end
  return 25 + math.floor((y - 50) * 2.3)
end

-- hood opening ellipse (face window), offset right for 3/4 view
local function eface(x, y)
  local dx = (x - 33) / 12
  local dy = (y - 36) / 15
  return dx * dx + dy * dy
end

-- ================= full-canvas region render =================
for y = 0, H - 1 do
  local hwv = hoodHW(y)
  local sbv = 31 + math.floor((y - 27) / 6) -- light/shadow terminator across face
  for x = 0, W - 1 do
    if hwv < 0 or math.abs(x - 32) > hwv then
      -- background: radial glow behind silhouette + CRT scanlines + code-rain dashes
      local g = math.sqrt((x - 32) ^ 2 + (y - 30) ^ 2)
      local lvl = 10 - g / 5.5
      if y % 2 == 0 then lvl = lvl - 1 end
      if x % 9 == 4 and ((y + x * 3) % 13) < 3 then lvl = lvl + 6 end
      dpx(x, y, clamp(math.floor(lvl + 0.5), 0, 16))
    elseif math.abs(x - 32) >= hwv - 1 or y <= 5 then
      px(x, y, B) -- 2px silhouette stroke
    else
      local e = eface(x, y)
      local covered = y < 27 + ((x - 33) ^ 2) / 45 -- hood brow overhang
      if e <= 1.0 and not covered then
        if y >= 49 then
          dpx(x, y, 1) -- neck drops into shadow
        elseif x >= sbv then
          -- lit half of face: stepped dither ramp toward the rim
          local lvl = 12
          if e > 0.5 then lvl = 10 end
          if e > 0.72 then lvl = 8 end
          if e > 0.88 then lvl = 6 end
          if y <= 30 then lvl = lvl - 5 end                          -- under-brow
          if y >= 44 then lvl = lvl - 2 end                          -- jaw turn
          if y >= 38 and y <= 42 and x >= 41 then lvl = lvl - 2 end  -- cheek hollow
          dpx(x, y, clamp(lvl, 0, 16))
        else
          -- shadow half: near-black with soft dither terminator
          local lvl = 2
          if x >= sbv - 2 then lvl = 5 elseif x >= sbv - 4 then lvl = 3 end
          if e > 0.8 then lvl = 0 end
          if y <= 31 then lvl = 0 end
          dpx(x, y, lvl)
        end
      elseif e <= 1.0 then
        -- hood interior above the brow: pit black, faint bounce on lit edge
        local lvl = 0
        if x >= 33 and e > 0.8 then lvl = 2 end
        dpx(x, y, lvl)
      elseif e <= 1.35 then
        -- opening rim: hot highlight on lit side, dead dark on shadow side
        local lvl
        if x >= 33 then
          if e <= 1.15 then lvl = 15 else lvl = 11 end
          if y < 24 then lvl = lvl - 4 end
          if y > 46 then lvl = lvl - 5 end
        else
          if e <= 1.15 then lvl = 5 else lvl = 3 end
          if y > 46 then lvl = 1 end
        end
        dpx(x, y, clamp(lvl, 0, 16))
      else
        -- hood / cloak fabric, key light top-right, weave noise
        local d = math.sqrt((x - 50) ^ 2 + (y - 10) ^ 2)
        local lvl
        if y >= 50 then lvl = 11 - d / 5 else lvl = 13 - d / 4 end
        if (x + y) % 7 == 0 then lvl = lvl + 1 end
        dpx(x, y, clamp(math.floor(lvl + 0.5), 0, 12))
      end
    end
  end
end

-- ================= fabric folds =================
seg(29, 7, 25, 14, B) seg(25, 14, 22, 24, B) seg(22, 24, 20, 34, B)
seg(35, 7, 41, 14, B) seg(41, 14, 45, 24, B) seg(45, 24, 47, 34, B)
segd(36, 8, 42, 15, 9) segd(42, 15, 46, 24, 9)
seg(31, 7, 33, 14, B) seg(33, 14, 34, 19, B)
segd(15, 36, 13, 46, 5) segd(13, 46, 12, 54, 5)
seg(49, 36, 51, 44, B) seg(51, 44, 53, 50, B)
segd(50, 36, 52, 44, 9)

-- shoulder rim catch-light (right) and faint left edge lift
for y = 50, 56 do
  local hwv = hoodHW(y)
  local xr = 32 + hwv - 3
  if xr < W then dpx(xr, y, 11) dpx(xr - 1, y, 8) end
  local xl = 32 - hwv + 3
  if xl >= 0 then dpx(xl, y, 3) end
end

-- collar V crease with stitched highlight
seg(24, 53, 31, 59, B) seg(42, 53, 33, 59, B)
segd(24, 52, 31, 58, 7) segd(42, 52, 34, 58, 7)

-- hood drawstrings
seg(29, 50, 28, 55, Wt) seg(28, 55, 29, 60, Wt) px(29, 61, B)
seg(37, 50, 38, 55, Wt) seg(38, 55, 37, 59, Wt) px(37, 60, B)

-- ================= the sharp eye (lit side) =================
seg(35, 30, 43, 30, B) px(44, 31, B)            -- brow
seg(36, 32, 43, 32, B)                          -- upper lid
for x = 37, 42 do px(x, 33, Wt) end             -- sclera
for x = 37, 41 do px(x, 34, Wt) end
px(39, 33, B) px(40, 33, B) px(39, 34, B) px(40, 34, B) -- pupil
px(40, 33, Wt)                                  -- hard glint
px(36, 33, B) px(43, 33, B)                     -- corners
px(37, 35, B) px(39, 35, B) px(41, 35, B)       -- lower lash

-- ghost glint in the shadow half — the other eye barely exists
px(26, 33, B) px(28, 33, B) px(27, 33, Wt)

-- ================= nose / mouth / chin =================
seg(34, 36, 34, 40, B)                          -- bridge shadow at terminator
px(35, 41, B) px(36, 41, B)                     -- nostril
px(35, 37, Wt) px(35, 38, Wt) px(36, 39, Wt)    -- bridge highlight
for x = 35, 38 do dpx(x, 42, 4) end             -- under-nose shade
seg(34, 45, 40, 45, B)                          -- mouth, neutral
for x = 35, 39 do dpx(x, 46, 9) end             -- lower lip catch
px(35, 47, B) px(37, 47, B) px(39, 47, B)       -- lip shadow dashes
for x = 34, 39 do dpx(x, 48, 5) end             -- chin turn

-- ================= export =================
spr:flatten()
spr:saveAs(app.fs.joinPath(OUT, "portrait_konsole.aseprite"))
spr:saveAs(app.fs.joinPath(OUT, "portrait_konsole.png"))
print("ASE_GEN_OK")