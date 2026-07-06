-- scene_payphone : Mario64-style 1-bit night exterior, 400x240
-- 3 rounded payphones on curved brick wall, glow lamp, dangling handset

local spr = Sprite(400, 240, ColorMode.INDEXED)
spr.transparentColor = 0
local pal = Palette(3)
pal:setColor(0, Color{r=0,   g=0,   b=0,   a=0})
pal:setColor(1, Color{r=0,   g=0,   b=0,   a=255})
pal:setColor(2, Color{r=255, g=255, b=255, a=255})
spr:setPalette(pal)

local cel = spr.cels[1]
if not cel then cel = spr:newCel(spr.layers[1], 1) end
local img = cel.image

local floor, sqrt, abs, sin = math.floor, math.sqrt, math.abs, math.sin
local W, H = 400, 240

-- 4x4 Bayer matrix: dither IS the shading engine
local B = {0,8,2,10, 12,4,14,6, 3,11,1,9, 15,7,13,5}
local function D(x, y, l)
  if l >= 16 then return true end
  if l <= 0 then return false end
  return l > B[(y % 4) * 4 + (x % 4) + 1]
end

local function set(x, y, c)
  if x >= 0 and x < W and y >= 0 and y < H then img:putPixel(x, y, c) end
end
local function shade(x, y, l) set(x, y, D(x, y, l) and 2 or 1) end

-- rounded-rect signed distance (negative = inside)
local function rrd(x, y, x0, y0, x1, y1, r)
  local cx = x; if cx < x0 + r then cx = x0 + r elseif cx > x1 - r then cx = x1 - r end
  local cy = y; if cy < y0 + r then cy = y0 + r elseif cy > y1 - r then cy = y1 - r end
  local dx, dy = x - cx, y - cy
  return sqrt(dx * dx + dy * dy) - r
end

-- geometry: wall bulges toward viewer (arc top + arc base)
local function wallTop(x)  local d = x - 200 return 46  + d * d / 2800 end
local function wallBase(x) local d = x - 200 return 182 + d * d / 4000 end
-- key light: lamp at (200,52)
local function lampL(x, y)
  local dx, dy = x - 200, y - 52
  return 16 - sqrt(dx * dx * 0.55 + dy * dy * 1.1) / 11
end

-- soft cast shadow ellipses on ground: {cx, cy, rx, ry, depth}
local shE = {
  {100, 193, 34, 7, 7}, {200, 190, 34, 7, 7}, {300, 193, 34, 7, 7},
  {87, 225, 12, 4, 6},   -- under dangling handset
}

------------------------------------------------------------------
-- PASS 1: full-canvas sky / wall / ground (edge to edge, no holes)
------------------------------------------------------------------
for y = 0, H - 1 do
  for x = 0, W - 1 do
    local wt, wb = wallTop(x), wallBase(x)
    local c
    if y < wt then
      -- night sky sliver: stars + dither glow dome around the lamp
      local dx, dy = x - 200, y - 52
      local g = 11 - sqrt(dx * dx + dy * dy * 1.2) / 5
      local star = ((x * 73 + y * 151) % 337) == 17
      c = (D(x, y, g) or star) and 2 or 1
    elseif y < wb then
      if y - wt < 2 then
        c = 1 -- bold contour: wall silhouette against sky
      else
        local dx, dyw = x - 200, y - 52
        local lvl = 15 - sqrt(dx * dx + dyw * dyw * 1.2) / 15 -- radial lamp falloff = curved wall volume
        local v = floor(y - wt)
        local m = v % 13
        local row = floor(v / 13)
        local xo = (row % 2) * 19
        if v >= 2 and m == 0 then
          c = 1 -- horizontal mortar
        elseif v >= 2 and ((x + xo) % 38) < 2 and m > 0 then
          c = 1 -- staggered vertical joint
        else
          if m == 1 then lvl = lvl + 3      -- brick top bevel catches lamp
          elseif m == 12 then lvl = lvl - 3 -- brick underside AO
          end
          c = D(x, y, lvl) and 2 or 1
        end
      end
    else
      -- rounded concrete ground
      local r = y - wb
      if r < 2 then
        c = 1 -- curb contour line
      else
        local glvl = 14 - abs(x - 200) / 22 - (y - 184) / 5
        if r < 4 then glvl = glvl + 5                 -- lit curb top
        elseif r < 8 then glvl = glvl - (8 - r) * 0.9 -- AO under wall
        end
        for i = 1, #shE do
          local s = shE[i]
          local nx, ny = (x - s[1]) / s[3], (y - s[2]) / s[4]
          local e = nx * nx + ny * ny
          if e < 1 then glvl = glvl - s[5] * (1 - e) end
        end
        c = D(x, y, glvl) and 2 or 1
        -- curved expansion seams (skip in already-dark zones)
        if glvl > 1.5 then
          local d2 = (x - 200) * (x - 200)
          if y == floor(204 + d2 / 2200) or y == floor(224 + d2 / 3500) then c = 1 end
        end
      end
    end
    img:putPixel(x, y, c)
  end
end

------------------------------------------------------------------
-- PASS 2: big plus-shaped stars
------------------------------------------------------------------
local bigStars = {{40,14},{90,30},{140,10},{260,12},{320,26},{372,12}}
for i = 1, #bigStars do
  local sx, sy = bigStars[i][1], bigStars[i][2]
  set(sx, sy, 2); set(sx - 1, sy, 2); set(sx + 1, sy, 2)
  set(sx, sy - 1, 2); set(sx, sy + 1, 2)
end

------------------------------------------------------------------
-- PASS 3: lamp fixture (cap + stem + glowing globe)
------------------------------------------------------------------
for yy = 34, 48 do for xx = 197, 203 do set(xx, yy, 1) end end -- stem
for yy = 28, 36 do for xx = 191, 209 do set(xx, yy, 1) end end -- cap
for xx = 193, 200 do set(xx, 29, 2) end                        -- cap rim highlight
for yy = 42, 70 do
  for xx = 186, 214 do
    local dx, dy = xx - 200, yy - 56
    local dd = sqrt(dx * dx + dy * dy) - 13
    if dd <= 0 then
      if dd > -2.5 then set(xx, yy, 1)          -- bold ring outline
      else shade(xx, yy, 4 - dd * 1.2) end      -- white core, dither rim falloff
    end
  end
end

------------------------------------------------------------------
-- helpers for props
------------------------------------------------------------------
local function blob(bx, by, r)
  for yy = floor(by - r) - 1, floor(by + r) + 1 do
    for xx = floor(bx - r) - 1, floor(bx + r) + 1 do
      local dx, dy = xx - bx, yy - by
      local dd = sqrt(dx * dx + dy * dy) - r
      if dd <= 0 then
        if dd > -2 then set(xx, yy, 1)
        else
          local l = lampL(xx, yy) + 1
          if dd > -3.5 then l = l - 3 end          -- rounded edge AO
          if dx < -1 and dy < -1 then l = l + 3 end -- upper-left sheen
          shade(xx, yy, l)
        end
      end
    end
  end
end

local function capsuleV(hx, ya, yb, r)
  for yy = floor(ya - r), floor(yb + r) do
    for xx = floor(hx - r) - 1, floor(hx + r) + 1 do
      local d = rrd(xx, yy, hx - r, ya, hx + r, yb, r)
      if d <= 0 then
        if d > -2 then set(xx, yy, 1)
        else
          local l = lampL(xx, yy) - 1
          if d > -3 then l = l - 3 end
          shade(xx, yy, l)
        end
      end
    end
  end
end

------------------------------------------------------------------
-- PASS 4: three chunky rounded payphones
------------------------------------------------------------------
local function drawPhone(cx, dangle)
  local x0, y0, x1, y1, r = cx - 31, 86, cx + 31, 176, 12

  -- volumetric body: lamp-lit dither ramp + edge AO + spec highlight
  for yy = y0, y1 do
    for xx = x0, x1 do
      local d = rrd(xx, yy, x0, y0, x1, y1, r)
      if d <= 0 then
        if d > -3 then set(xx, yy, 1) -- bold 3px contour
        else
          local l = lampL(xx, yy)
          if d > -7 then l = l - (d + 7) * 1.5 end -- curved-shoulder AO
          local hx = cx + (200 - cx) * 0.12 - 6
          local ddx, ddy = xx - hx, yy - 102
          if ddx * ddx + ddy * ddy < 90 then l = l + 5 end -- glossy spec
          shade(xx, yy, l)
        end
      end
    end
  end

  -- top sign plate with dark glass window
  for yy = 94, 108 do
    for xx = x0 + 8, x1 - 8 do
      if yy == 94 or yy == 108 or xx == x0 + 8 or xx == x1 - 8 then set(xx, yy, 1)
      else
        local l = lampL(xx, yy) + 3
        if yy >= 97 and yy <= 105 and xx >= cx - 19 and xx <= cx + 19 then l = 2.5 end
        shade(xx, yy, l)
      end
    end
  end

  -- inset face panel (recessed = darker)
  for yy = 112, 168 do
    for xx = x0 + 7, x1 - 5 do
      local d2 = rrd(xx, yy, x0 + 7, 112, x1 - 5, 168, 6)
      if d2 <= 0 then
        if d2 > -1.5 then set(xx, yy, 1)
        else
          local l = lampL(xx, yy) - 2
          if d2 > -3.5 then l = l - 1 end
          shade(xx, yy, l)
        end
      end
    end
  end

  -- cradle back plate (dark recess) on the left
  for yy = 120, 156 do
    for xx = cx - 20, cx - 6 do
      if yy == 120 or yy == 156 or xx == cx - 20 or xx == cx - 6 then set(xx, yy, 1)
      else shade(xx, yy, lampL(xx, yy) - 6) end
    end
  end

  local hsx = cx - 13
  if not dangle then
    -- handset resting: bar + two round knobs (dumbbell)
    capsuleV(hsx, 130, 146, 4)
    blob(hsx, 128, 6)
    blob(hsx, 149, 6)
  else
    -- empty cradle hook
    for yy = 132, 138 do for xx = cx - 17, cx - 9 do set(xx, yy, 1) end end
    for xx = cx - 16, cx - 12 do set(xx, 133, 2) end
  end

  -- keypad: white backing, black chunky buttons
  local kx0, ky0, kx1, ky1 = cx + 2, 122, cx + 24, 152
  for yy = ky0, ky1 do
    for xx = kx0, kx1 do
      if yy == ky0 or yy == ky1 or xx == kx0 or xx == kx1 then set(xx, yy, 1)
      else set(xx, yy, 2) end
    end
  end
  for ri = 0, 3 do
    for ci = 0, 2 do
      local bx, by = kx0 + 3 + ci * 7, ky0 + 3 + ri * 7
      for yy = by, by + 3 do for xx = bx, bx + 3 do set(xx, yy, 1) end end
    end
  end

  -- coin return slot
  for yy = 157, 164 do for xx = cx + 4, cx + 18 do set(xx, yy, 1) end end
  for xx = cx + 6, cx + 16 do set(xx, 158, 2) end

  -- dangling handset: wavy cord + hanging dumbbell over the ground
  if dangle then
    for yy = 174, 198 do
      local xx = hsx + floor(3 * sin((yy - 174) * 0.55) + 0.5)
      set(xx, yy, 1); set(xx + 1, yy, 1)
    end
    capsuleV(hsx, 204, 214, 4)
    blob(hsx, 202, 6)
    blob(hsx, 217, 6)
  end
end

drawPhone(100, true)   -- left phone: handset dangles
drawPhone(200, false)
drawPhone(300, false)

------------------------------------------------------------------
-- save: flat single image (no sprite sheet)
------------------------------------------------------------------
spr:flatten()
local out = os.getenv("ASE_OUT_DIR")
spr:saveAs(app.fs.joinPath(out, "scene_payphone.aseprite"))
spr:saveAs(app.fs.joinPath(out, "scene_payphone.png"))
print("ASE_GEN_OK")