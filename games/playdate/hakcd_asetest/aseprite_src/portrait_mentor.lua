-- portrait_mentor — 64x64 1-bit dialogue portrait
-- THE MENTOR: faceless figure in a deep hood, face a dark dithered void,
-- back-lit by a daemon halo. Palette: 0=transparent, 1=black, 2=white.

local W, H = 64, 64
local spr = Sprite(W, H, ColorMode.INDEXED)
spr.transparentColor = 0

local pal = Palette(3)
pal:setColor(0, Color{ r = 0,   g = 0,   b = 0,   a = 0   })
pal:setColor(1, Color{ r = 0,   g = 0,   b = 0,   a = 255 })
pal:setColor(2, Color{ r = 255, g = 255, b = 255, a = 255 })
spr:setPalette(pal)

local cel = spr.cels[1]
if cel == nil then cel = spr:newCel(spr.layers[1], 1) end
local img = cel.image

-- 4x4 ordered Bayer; lvl 0..16 = white-dot density (dither IS the gray ramp)
local B = {
  {  0,  8,  2, 10 },
  { 12,  4, 14,  6 },
  {  3, 11,  1,  9 },
  { 15,  7, 13,  5 },
}
local function shade(x, y, lvl)
  if lvl <= 0 then return 1 end
  if lvl >= 16 then return 2 end
  if B[(y % 4) + 1][(x % 4) + 1] < lvl then return 2 end
  return 1
end

-- figure silhouette half-width per row: pointed cowl flowing into shoulders
-- that reach the canvas edges (portrait fills edge to edge)
local function silHW(y)
  local hood = -1
  if y >= 4 and y <= 42 then hood = 17 * ((y - 3) / 39) ^ 0.6 end
  local sh = -1
  if y >= 38 then sh = 17 + (y - 38) * 1.6 end
  return math.max(hood, sh)
end

for y = 0, H - 1 do
  local S = silHW(y)
  for x = 0, W - 1 do
    local dx  = x - 31.5
    local adx = math.abs(dx)
    local lvl

    -- cowl-opening ellipse (the face void), center (31.5, 27), 15x24
    local rx = dx / 7.5
    local ry = (y - 27) / 12
    local r  = math.sqrt(rx * rx + ry * ry)

    if S < 0 or adx > S then
      -- ================= background: halo glow behind the hood ============
      local gy = y - 16
      local d  = math.sqrt(dx * dx + gy * gy)
      lvl = 13 - d * 0.35
      if lvl < 0 then lvl = 0 end
      if d > 14 and (math.floor(d) % 9) == 0 then lvl = lvl + 2 end   -- aura rings
      if lvl < 1.5 and ((x * 17 + y * 29) % 131) == 0 then lvl = 16 end -- grain specks

    elseif r < 1 then
      -- ================= face: dark dithered void =========================
      if     r > 0.78 then lvl = 3   -- speckle where halo grazes the rim
      elseif r > 0.58 then lvl = 1   -- lone dying photons
      else                 lvl = 0   -- absolute nothing where a face should be
      end
      if y > 31 and lvl > 0 then lvl = lvl + 1 end -- faint bounce off the chest

    else
      -- ================= hood + robe fabric ===============================
      local rimd = S - adx
      if rimd < 1.0 then
        lvl = 0                                     -- 1px contour vs the halo
      elseif rimd < 3.2 then
        lvl = 16 - math.max(0, y - 30) * 0.45       -- 2px back-lit rim stroke
      else
        lvl = 10 - (rimd - 3.2) * 1.6               -- falloff into cloth mass
        if lvl < 2 then lvl = 2 end
        if dx < 0 then lvl = lvl + 1 end            -- key light biased left
        -- creases tracking the cowl contour
        local cf = adx / S
        if cf > 0.50 and cf < 0.58 then lvl = lvl - 5 end
        if cf >= 0.60 and cf < 0.70 then lvl = lvl + 3 end
        -- drape ripples, gentler on the hood, deep on the robe
        local amp = (y < 40) and 1.5 or 3
        lvl = lvl + amp * math.sin(dx * 0.48 + y * 0.03)
        -- coarse weave sparkle
        if ((x * 31 + y * 17) % 23) == 0 then lvl = lvl + 2 end
        -- lit inner rim of the cowl opening, bright arc over the void
        if r < 1.12 then
          local g = (y < 27) and 13 or 8
          if g > lvl then lvl = g end
        elseif r < 1.35 then
          local g = (y < 27) and 7 or 4
          if g > lvl then lvl = g end
        end
        if y > 56 then lvl = lvl - (y - 56) * 0.3 end -- robe sinks into black
      end

      -- shadow wedge spilling from the void down the chest
      if y >= 38 and y <= 52 then
        local wHW = 6.5 - (y - 38) * 0.35
        if adx < wHW and lvl > 1 then lvl = 1 end
        -- dotted drawcords catching stray light inside the shadow
        local xoff = 5.0 - (y - 38) * 0.12
        if math.floor(adx) == math.floor(xoff) and (y % 2) == 0 then
          lvl = 13
        end
      end

      -- clasp sigil: tiny hollow diamond with a burning core
      if adx <= 2.6 and math.abs(y - 47) <= 2 then
        local m = (adx - 0.5) + math.abs(y - 47)
        if m < 0.5 or (m >= 1.5 and m < 2.6) then lvl = 16 else lvl = 0 end
      end
    end

    img:putPixel(x, y, shade(x, y, math.floor(lvl + 0.5)))
  end
end

local out = os.getenv("ASE_OUT_DIR")
spr:saveAs(app.fs.joinPath(out, "portrait_mentor.aseprite"))
spr:flatten()
spr:saveAs(app.fs.joinPath(out, "portrait_mentor.png"))
print("ASE_GEN_OK")