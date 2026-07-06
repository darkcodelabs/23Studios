-- scene_pedestal: MARIO-64-style 2am backyard, 1-bit dither, 400x240
local out = os.getenv("ASE_OUT_DIR")
local W, H = 400, 240
local spr = Sprite(W, H, ColorMode.INDEXED)
spr.transparentColor = 0

local pal = Palette(3)
pal:setColor(0, Color{r=0, g=0, b=0, a=0})
pal:setColor(1, Color{r=0, g=0, b=0, a=255})
pal:setColor(2, Color{r=255, g=255, b=255, a=255})
spr:setPalette(pal)

local cel = spr.cels[1]
if not cel then cel = spr:newCel(spr.layers[1], 1) end
local img = cel.image

-- ---------- helpers ----------
local B = {{0,8,2,10},{12,4,14,6},{3,11,1,9},{15,7,13,5}} -- Bayer 4x4
local floor, sqrt, abs, sin, pi = math.floor, math.sqrt, math.abs, math.sin, math.pi

local function px(x, y, c)
  if x >= 0 and x < W and y >= 0 and y < H then img:putPixel(x, y, c) end
end

-- lv: 0=black .. 16=white, dithered
local function dpx(x, y, lv)
  if lv <= 0 then px(x, y, 1)
  elseif lv >= 16 then px(x, y, 2)
  elseif B[(y % 4) + 1][(x % 4) + 1] < lv then px(x, y, 2)
  else px(x, y, 1) end
end

local function ditherEllipse(cx, cy, rx, ry, lv)
  for y = cy - ry, cy + ry do
    for x = cx - rx, cx + rx do
      local dx, dy = (x - cx) / rx, (y - cy) / ry
      if dx * dx + dy * dy <= 1 then dpx(x, y, lv) end
    end
  end
end

local HORIZON = 146

-- ---------- 1. night sky ----------
for y = 0, HORIZON - 1 do
  for x = 0, W - 1 do px(x, y, 1) end
end

-- stars (skip moon zone + house zone)
for i = 1, 90 do
  local sx = (i * 137 + 53) % W
  local sy = (i * 97 + 31) % (HORIZON - 40)
  local dmx, dmy = sx - 72, sy - 52
  if (dmx * dmx + dmy * dmy) > 3600 and not (sx > 226 and sy > 60) then
    px(sx, sy, 2)
    if i % 7 == 0 then
      px(sx + 1, sy, 2); px(sx - 1, sy, 2); px(sx, sy + 1, 2); px(sx, sy - 1, 2)
    end
  end
end

-- ---------- 2. moon upper-left (key light) + glow halo ----------
local mx, my, mr = 72, 52, 34
for y = my - mr - 15, my + mr + 15 do
  for x = mx - mr - 15, mx + mr + 15 do
    local dx, dy = x - mx, y - my
    local d = sqrt(dx * dx + dy * dy)
    if d <= mr then
      -- round body: bright upper-left, dithered falloff to lower-right rim
      local t = (dx + dy) / (2 * mr)          -- -1 (UL) .. 1 (LR)
      dpx(x, y, 16 - floor((t + 1) * 5))
    elseif d <= mr + 5 then dpx(x, y, 5)      -- inner glow
    elseif d <= mr + 10 then dpx(x, y, 2)     -- mid glow
    elseif d <= mr + 15 then dpx(x, y, 1)     -- fade to sky
    end
  end
end
-- craters (soft dither pits)
ditherEllipse(80, 58, 6, 6, 9)
ditherEllipse(64, 66, 4, 4, 10)
ditherEllipse(86, 42, 3, 3, 10)
ditherEllipse(58, 44, 4, 4, 11)

-- ---------- 3. rounded dark house behind ----------
-- domed roof
for y = 68, 97 do
  local dy = (y - 98) / 30
  local hw = floor(66 * sqrt(math.max(0, 1 - dy * dy)))
  for x = 302 - hw, 302 + hw do px(x, y, 1) end
  for x = 302 - hw, 302 - hw + 2 do dpx(x, y, 6) end -- moonlit rim, upper-left
end
-- body
for y = 98, HORIZON - 1 do
  for x = 236, 368 do px(x, y, 1) end
end
for y = 100, HORIZON - 4 do
  dpx(236, y, 5); dpx(237, y, 4) -- left rim light
end

-- glowing window + halo
local wx0, wy0, wx1, wy1 = 298, 106, 322, 128
for y = wy0 - 9, wy1 + 9 do
  for x = wx0 - 9, wx1 + 9 do
    local dx = math.max(wx0 - x, 0, x - wx1)
    local dy = math.max(wy0 - y, 0, y - wy1)
    local d = sqrt(dx * dx + dy * dy)
    if d > 0 then
      if d <= 3 then dpx(x, y, 6)
      elseif d <= 6 then dpx(x, y, 3)
      elseif d <= 9 then dpx(x, y, 1) end
    end
  end
end
for y = wy0, wy1 do
  for x = wx0, wx1 do px(x, y, 2) end
end
-- rounded window corners + 2px cross mullion
px(wx0, wy0, 1); px(wx1, wy0, 1); px(wx0, wy1, 1); px(wx1, wy1, 1)
for y = wy0, wy1 do px(309, y, 1); px(310, y, 1) end
for x = wx0, wx1 do px(x, 116, 1); px(x, 117, 1) end

-- ---------- 4. moonlit grass, dither gradient (bright near moon side) ----------
for y = HORIZON, H - 1 do
  for x = 0, W - 1 do
    local lv = 8 - floor((y - HORIZON) / 22) - floor(x / 190)
    if lv < 2 then lv = 2 end
    dpx(x, y, lv)
  end
end
for x = 0, W - 1 do px(x, HORIZON, 1); px(x, HORIZON + 1, 1) end -- ground line
-- grass tufts
for i = 1, 240 do
  local tx = (i * 89 + 17) % W
  local ty = HORIZON + 8 + ((i * 61) % (H - HORIZON - 14))
  px(tx, ty, 1); px(tx, ty - 1, 1)
  if i % 2 == 0 then px(tx + 1, ty, 1) end
end

-- ---------- 5. puffy round bushes ----------
local function bush(cx, cy, r)
  ditherEllipse(cx + 5, cy + r - 1, r + 7, 4, 2) -- cast shadow, lower-right
  for y = cy - r, cy + r do
    for x = cx - r, cx + r do
      local dx, dy = x - cx, y - cy
      local d2 = dx * dx + dy * dy
      if d2 <= r * r then
        local d = sqrt(d2)
        if d > r - 2 then px(x, y, 1) -- 2px contour
        else
          local t = (dx + dy) / (2 * r)
          local lv = 9 - floor((t + 1) * 5) -- UL highlight -> dark LR
          if lv < 1 then lv = 1 end
          dpx(x, y, lv)
        end
      end
    end
  end
end
bush(34, 140, 26)
bush(70, 146, 20)
bush(232, 148, 18)
bush(378, 150, 22)

-- ---------- 6. rounded concrete pad ----------
local pcx, pcy, prx, pry = 200, 206, 72, 24
for y = pcy - pry, pcy + pry do
  for x = pcx - prx, pcx + prx do
    local nx, ny = abs(x - pcx) / prx, abs(y - pcy) / pry
    local v = nx * nx * nx * nx + ny * ny * ny * ny -- superellipse = rounded slab
    if v <= 1 then
      if v > 0.82 then px(x, y, 1) -- bold outline
      else
        local lv = 12 - floor((x - 128) / 72)
        if y < 200 then lv = lv + 2 end -- lit top face
        dpx(x, y, lv)
      end
    end
  end
end
for i = 0, 10 do px(150 + i, 216 + (i % 3), 1) end -- crack

-- ---------- 7. soft blob shadow (offset lower-right of moon) ----------
for y = 190, 214 do
  for x = 162, 258 do
    local dx, dy = (x - 210) / 48, (y - 202) / 12
    local e = dx * dx + dy * dy
    if e <= 0.55 then dpx(x, y, 1)
    elseif e <= 1 then dpx(x, y, 4) end
  end
end

-- ---------- 8. fat rounded telco pedestal ----------
local cx = 200
local function bodyLv(u, y)
  local lv
  if u < -0.88 then lv = 7        -- left edge turn-away
  elseif u < -0.15 then lv = 14   -- key highlight band
  elseif u < 0.3 then lv = 10
  elseif u < 0.62 then lv = 6
  elseif u < 0.86 then lv = 3
  else lv = 1 end
  if y > 172 then lv = lv - 1 end -- ground AO
  if y > 186 then lv = lv - 2 end
  if lv < 1 then lv = 1 end
  return lv
end

-- dome lid (98..111)
for y = 98, 111 do
  local dy = (y - 112) / 14
  local hw = floor(34 * sqrt(math.max(0, 1 - dy * dy)))
  if hw < 2 then
    for x = cx - hw - 2, cx + hw + 2 do px(x, y, 1) end
  else
    for x = cx - hw, cx + hw do
      local u = (x - cx) / hw
      dpx(x, y, 16 - floor((u + 1) * 4) - floor((112 - y) / 8))
    end
    for k = 0, 1 do px(cx - hw + k, y, 1); px(cx + hw - k, y, 1) end
  end
end
-- lid seam
for x = cx - 34, cx + 34 do dpx(x, 112, 4); dpx(x, 113, 4) end
px(cx - 34, 112, 1); px(cx + 34, 112, 1); px(cx - 34, 113, 1); px(cx + 34, 113, 1)

-- bulbous body (114..196), sides swell outward mid-height
for y = 114, 196 do
  local hw = 34 + floor(6 * sin(pi * (y - 112) / 84))
  for x = cx - hw, cx + hw do
    dpx(x, y, bodyLv((x - cx) / hw, y))
  end
  for k = 0, 1 do px(cx - hw + k, y, 1); px(cx + hw - k, y, 1) end
end
-- base skirt / ground contact
for x = cx - 34, cx + 34 do px(x, 195, 1); px(x, 196, 1) end
for y = 197, 199 do
  for x = cx - 30, cx + 30 do px(x, y, 1) end
end

-- Bell label plate above door
for y = 117, 125 do
  for x = 188, 212 do
    if x == 188 or x == 212 or y == 117 or y == 125 then px(x, y, 1)
    else dpx(x, y, 15) end
  end
end
for x = 192, 196 do px(x, 121, 1) end
for x = 200, 208 do px(x, 121, 1) end

-- hinged door, beveled panel
for y = 130, 186 do
  for x = 177, 223 do
    if x < 179 or x > 221 or y < 132 or y > 184 then px(x, y, 1)
    else
      local u = (x - cx) / 34
      local lv
      if u < -0.15 then lv = 11 elseif u < 0.3 then lv = 8 else lv = 5 end
      if y > 168 then lv = lv - 1 end
      if x <= 181 or y <= 134 then lv = lv + 4 end -- lit bevel top/left
      if x >= 219 or y >= 182 then lv = 2 end       -- shaded bevel bottom/right
      if lv < 1 then lv = 1 elseif lv > 16 then lv = 16 end
      dpx(x, y, lv)
    end
  end
end
-- hinges (left edge, two barrels)
for _, hy in ipairs({138, 168}) do
  for y = hy, hy + 5 do
    for x = 172, 177 do px(x, y, 1) end
  end
  px(173, hy + 1, 2)
end
-- hex lock (right of door center)
local hR, hS = 6, 5.2
for y = 152, 164 do
  for x = 204, 220 do
    local dx, dy = abs(x - 212), abs(y - 158)
    if dy <= hS and dx * hS + dy * (hR / 2) <= hR * hS then px(x, y, 1) end
  end
end
for y = 155, 161 do
  for x = 209, 215 do
    local dx, dy = abs(x - 212), abs(y - 158)
    if dy <= 3.4 and dx * 3.4 + dy * 2 <= 4 * 3.4 then dpx(x, y, 9) end
  end
end
px(211, 158, 1); px(212, 158, 1); px(211, 159, 1); px(212, 159, 1) -- keyway
px(209, 155, 2) -- glint

-- vent slits, moonlit edges near base
for _, vy in ipairs({190, 193}) do
  for x = 185, 193 do dpx(x, vy, 12) end
  for x = 197, 205 do dpx(x, vy, 12) end
  for x = 209, 215 do dpx(x, vy, 12) end
end

-- ---------- 9. foreground grass blades framing bottom ----------
local blades = {{18,10},{34,7},{58,9},{120,6},{290,6},{330,8},{352,11},{382,7}}
for _, b in ipairs(blades) do
  local bx, bl = b[1], b[2]
  for k = 0, bl do px(bx, 239 - k, 1); px(bx + 1, 239 - k, 1) end
end

-- ---------- save ----------
spr:flatten()
spr:saveAs(app.fs.joinPath(out, "scene_pedestal.aseprite"))
spr:saveAs(app.fs.joinPath(out, "scene_pedestal.png"))
print("ASE_GEN_OK")