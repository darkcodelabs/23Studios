-- enemy_ice — ICE security daemon wraith for HAKCD action pack
-- 32x32, 4 frames, hover + core pulse + edge flicker, 1-bit indexed
local W, H, FRAMES = 32, 32, 4

local spr = Sprite(W, H, ColorMode.INDEXED)
spr.transparentColor = 0

local pal = Palette(3)
pal:setColor(0, Color{ r = 0,   g = 0,   b = 0,   a = 0   })  -- transparent
pal:setColor(1, Color{ r = 0,   g = 0,   b = 0,   a = 255 })  -- black
pal:setColor(2, Color{ r = 255, g = 255, b = 255, a = 255 })  -- white
spr:setPalette(pal)

for _ = 2, FRAMES do spr:newEmptyFrame() end

-- per-frame animation data
local BOB    = { 0, -1, 0, 1 }              -- hover bob
local CORE   = { 2, 2, 3, 2 }               -- diamond core radius, frame 3 = flare
local PUPIL  = { true, true, false, true }  -- dark slit in eye except on flare
local GLITCH = { 0, 1, 0, -1 }              -- horizontal shear of one hood slice
local SWAY   = { 0, 1, 0, -1 }              -- tail drift
local TL = { 3, 4, 3, 2 }                   -- left fang length (flicker)
local TC = { 5, 5, 6, 5 }                   -- center fang length
local TR = { 4, 3, 2, 3 }                   -- right fang length
local SPECKS = {                            -- stray glitch pixels off the silhouette
  [2] = { {3, 8},  {28, 13}, {26, 3} },
  [4] = { {4, 15}, {27, 6},  {6, 2}  },
}

-- angular hood halfwidths, body rows 0..13 (abrupt crystalline steps)
local HW = { 0, 1, 2, 4, 5, 7, 8, 9, 10, 10, 10, 10, 9, 8 }

local function newMask()
  local m = {}
  for y = 0, H - 1 do
    m[y] = {}
    for x = 0, W - 1 do m[y][x] = false end
  end
  return m
end

local function setSpan(m, y, x0, x1)
  if y < 0 or y > H - 1 then return end
  if x0 < 0 then x0 = 0 end
  if x1 > W - 1 then x1 = W - 1 end
  for x = x0, x1 do m[y][x] = true end
end

local function tooth(m, xa, xb, y0, hw0, len)
  for i = 0, len - 1 do
    local hw = hw0 - i
    if hw < 0 then hw = 0 end
    setSpan(m, y0 + i, xa - hw, xb + hw)
  end
end

local function buildMask(f)
  local m = newMask()
  local top = 3 + BOB[f]

  -- hood body
  for r = 0, #HW - 1 do
    local hw = HW[r + 1]
    setSpan(m, top + r, 15 - hw, 16 + hw)
  end

  -- crystalline side shards; row alternates per frame = edge flicker
  local ls = 8 + (f % 2)
  local rs = 11 - (f % 2)
  setSpan(m, top + ls,     2, 6)
  setSpan(m, top + ls + 1, 3, 6)
  setSpan(m, top + rs,     25, 29)
  setSpan(m, top + rs + 1, 25, 28)

  -- jagged hanging fangs, lengths flicker per frame
  local tY = top + 14
  tooth(m, 8,  8,  tY, 2, TL[f])
  tooth(m, 15, 16, tY, 3, TC[f])
  tooth(m, 23, 23, tY, 2, TR[f])

  -- glitch shear: shift one hood slice sideways while the eye stays put
  local g = GLITCH[f]
  if g ~= 0 then
    for y = top + 5, top + 7 do
      local nr = {}
      for x = 0, W - 1 do nr[x] = false end
      for x = 0, W - 1 do
        if m[y][x] then
          local nx = x + g
          if nx >= 0 and nx <= W - 1 then nr[nx] = true end
        end
      end
      m[y] = nr
    end
  end

  return m, top
end

-- true if any pixel within Chebyshev distance d is outside the mask
local function outsideNear(m, x, y, d)
  for dy = -d, d do
    for dx = -d, d do
      local nx, ny = x + dx, y + dy
      if nx < 0 or ny < 0 or nx > W - 1 or ny > H - 1 then return true end
      if not m[ny][nx] then return true end
    end
  end
  return false
end

-- symmetric distance from the 2px-wide center column (15|16)
local function dxc(x)
  if x <= 15 then return 15 - x end
  return x - 16
end

for f = 1, FRAMES do
  local layer = spr.layers[1]
  local cel = layer:cel(f)
  if not cel then cel = spr:newCel(layer, f) end
  local img = cel.image
  local m, top = buildMask(f)

  -- render body: black mass wrapped in a 2px white silhouette stroke,
  -- thin shards/fangs come out solid white automatically
  for y = 0, H - 1 do
    for x = 0, W - 1 do
      if m[y][x] then
        if outsideNear(m, x, y, 2) then
          img:putPixel(x, y, 2)
        else
          img:putPixel(x, y, 1)
        end
      end
    end
  end

  local ccy = top + 8
  local r = CORE[f]

  -- glow halo: checker dither ring inside the black mass, parity shifts
  -- with f so it shimmers frame to frame
  local gr = r + 2
  for y = ccy - gr, ccy + gr do
    for x = 15 - gr, 16 + gr do
      local d = dxc(x) + math.abs(y - ccy)
      if d > r and d <= gr and (x + y + f) % 2 == 0 and m[y][x] then
        img:putPixel(x, y, 2)
      end
    end
  end

  -- diamond core-eye
  for y = ccy - r, ccy + r do
    for x = 15 - r, 16 + r do
      if dxc(x) + math.abs(y - ccy) <= r then
        img:putPixel(x, y, 2)
      end
    end
  end
  if PUPIL[f] then
    img:putPixel(15, ccy, 1)
    img:putPixel(16, ccy, 1)
  end
  if f == 3 then
    -- flare frame: dotted cardinal rays off the core
    for _, i in ipairs({ r + 1, r + 3 }) do
      img:putPixel(15, ccy - i, 2); img:putPixel(16, ccy - i, 2)
      img:putPixel(15, ccy + i, 2); img:putPixel(16, ccy + i, 2)
      img:putPixel(15 - i, ccy, 2); img:putPixel(16 + i, ccy, 2)
    end
  end

  -- wispy dithered tail: 50% checker fading to 25%, drifts left, sways per frame
  for ty = 0, 7 do
    local y = top + 19 + ty
    local cxT = 14 - math.floor(ty / 2) + math.floor(SWAY[f] * ty / 5)
    local wT = 3 - math.floor(ty / 3)
    for x = cxT - wT, cxT + wT do
      local on
      if ty < 4 then
        on = ((x + y + f) % 2 == 0)
      else
        on = ((x + f) % 2 == 0) and (y % 2 == 0)
      end
      if on and x >= 0 and x <= W - 1 and y >= 0 and y <= H - 1
         and not m[y][x] then
        img:putPixel(x, y, 2)
      end
    end
  end

  -- stray glitch specks on flicker frames
  local sp = SPECKS[f]
  if sp then
    for _, p in ipairs(sp) do
      local sx, sy = p[1], p[2] + BOB[f]
      if sx >= 0 and sx <= W - 1 and sy >= 0 and sy <= H - 1 then
        img:putPixel(sx, sy, 2)
      end
    end
  end
end

local tag = spr:newTag(1, FRAMES)
tag.name = "hover"

local out = os.getenv("ASE_OUT_DIR")
spr:saveAs(app.fs.joinPath(out, "enemy_ice.aseprite"))
app.command.ExportSpriteSheet{
  ui = false,
  askOverwrite = false,
  type = SpriteSheetType.HORIZONTAL,
  textureFilename = app.fs.joinPath(out, "enemy_ice-table-32-32.png"),
  dataFilename = "",
}
print("ASE_GEN_OK")