-- portrait_mom.png — 64x64 1-bit dialogue portrait, HAKCD house style
-- Tired-but-warm mid-40s suburban mom, 90s perm, cordless phone, exasperated.

local W, H = 64, 64

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
local B = {
  {0, 8, 2, 10},
  {12, 4, 14, 6},
  {3, 11, 1, 9},
  {15, 7, 13, 5},
}

local function px(x, y, c)
  if x >= 0 and x < W and y >= 0 and y < H then img:putPixel(x, y, c) end
end

local function bay(x, y) return B[(y % 4) + 1][(x % 4) + 1] end

local function dget(x, y, lv) if bay(x, y) < lv then return 2 else return 1 end end

local function frect(x0, y0, x1, y1, c)
  for y = y0, y1 do for x = x0, x1 do px(x, y, c) end end
end

local function hline(x0, x1, y, c) for x = x0, x1 do px(x, y, c) end end
local function vline(x, y0, y1, c) for y = y0, y1 do px(x, y, c) end end

-- dither black onto whatever is there (form shadow)
local function shade(x0, y0, x1, y1, lv)
  for y = y0, y1 do for x = x0, x1 do
    if bay(x, y) < lv then px(x, y, 1) end
  end end
end

local function hh(x, y) return (x * 73856093 + y * 19349663) % 101 end

-- hair mask so texture passes only touch hair pixels
local mask = {}
local function hdisc(cx, cy, r)
  for dy = -r, r do for dx = -r, r do
    if dx * dx + dy * dy <= r * r then
      local x, y = cx + dx, cy + dy
      px(x, y, 1)
      if x >= 0 and x < W and y >= 0 and y < H then mask[y * W + x] = true end
    end
  end end
end

-- white quarter-ring highlight on a curl (top-left lit)
local function curl(cx, cy, r)
  for dy = -r, 1 do for dx = -r, 1 do
    local d = dx * dx + dy * dy
    if d <= r * r and d > (r - 1) * (r - 1) and (dx < 0 or dy < 0) then
      local x, y = cx + dx, cy + dy
      if x >= 0 and x < W and y >= 0 and y < H and mask[y * W + x] then
        px(x, y, 2)
      end
    end
  end end
end

-- ---------- 1. background: lit kitchen wall, diagonal falloff + halo ----------
for y = 0, H - 1 do
  for x = 0, W - 1 do
    local lv = 12 - math.floor((x + 2 * y) / 16)
    if x % 8 == 6 then lv = lv - 3 end        -- faint wallpaper stripe
    local dx, dy = x - 31, y - 26
    local d2 = dx * dx + dy * dy
    if d2 < 121 then lv = lv + 4
    elseif d2 < 400 then lv = lv + 2 end
    if lv < 1 then lv = 1 end
    if lv > 14 then lv = 14 end
    px(x, y, dget(x, y, lv))
  end
end

-- picture frame on the wall, top-left (dense suburban detail)
hline(3, 12, 5, 1) hline(3, 12, 14, 1)
vline(3, 5, 14, 1) vline(12, 5, 14, 1)
for y = 6, 13 do for x = 4, 11 do px(x, y, dget(x, y, 5)) end end
frect(6, 8, 9, 11, 1)

-- ---------- 2. body / blouse ----------
local function blousepx(x, y, lv)
  local c = 1
  if bay(x, y) < lv then c = 2 end
  if (x % 9 == 2 or x % 9 == 3) and y % 9 == 6 then c = 2 end   -- floral dot print
  px(x, y, c)
end

-- left shoulder, rim-lit from upper left
for x = 1, 31 do
  local yt = 56 - math.floor((x - 1) * 9 / 20)
  if x % 3 ~= 0 then px(x, yt, 2) else px(x, yt, 1) end
  px(x, yt + 1, 1) px(x, yt + 2, 1)
  for y = yt + 3, H - 1 do blousepx(x, y, 4) end
end

-- right shoulder / chest, darker side
for x = 32, 63 do
  local yt = 43 + math.floor((x - 32) / 3)
  px(x, yt, 1) px(x, yt + 1, 1)
  for y = yt + 2, H - 1 do blousepx(x, y, 3) end
end

-- raised forearm sleeve along right edge, fold streaks
for y = 38, H - 1 do
  local xl = 51 + math.floor((y - 38) / 4)
  px(xl, y, 1) px(xl + 1, y, 1)
  for x = xl + 2, 63 do
    local c = 1
    if bay(x, y) < 6 then c = 2 end
    if (x + y) % 11 == 0 then c = 2 end
    px(x, y, c)
  end
end
-- cuff at the wrist
frect(53, 42, 60, 44, 2)
hline(53, 60, 45, 1)
vline(61, 42, 44, 1)

-- ---------- 3. neck ----------
frect(27, 39, 35, 47, 2)
vline(26, 40, 46, 1)
vline(36, 40, 46, 1)

-- ---------- 4. permed hair mass (big soft cloud of discs) ----------
hdisc(31, 12, 10)
hdisc(23, 15, 7)  hdisc(39, 15, 7)
hdisc(18, 24, 7)  hdisc(44, 24, 7)
hdisc(17, 33, 6)  hdisc(45, 33, 6)
hdisc(20, 41, 5)  hdisc(43, 40, 5)
hdisc(31, 20, 9)

-- ---------- 5. face oval (rx=9, ry=11 at 31,29) ----------
for y = 18, 40 do
  for x = 22, 40 do
    local dx, dy = x - 31, y - 29
    if dx * dx * 121 + dy * dy * 81 <= 9801 then
      px(x, y, 2)
      mask[y * W + x] = nil
    end
  end
end
-- jaw / chin contour line
for y = 34, 40 do
  for x = 22, 40 do
    local dx, dy = x - 31, y - 29
    local e = dx * dx * 121 + dy * dy * 81
    if e <= 9801 and e >= 8800 and dy >= 6 then px(x, y, 1) end
  end
end

-- ---------- 6. permed bangs over the forehead ----------
hdisc(24, 16, 4) hdisc(30, 14, 4) hdisc(36, 16, 4)
hdisc(27, 14, 3) hdisc(33, 14, 3)

-- ---------- 7. face form shadow (right side + under jaw), Bayer ramp ----------
for y = 18, 40 do
  for x = 22, 40 do
    local dx, dy = x - 31, y - 29
    local e = dx * dx * 121 + dy * dy * 81
    if e <= 9801 then
      if dx >= 3 then
        local lv = (dx - 2) * 2
        if e >= 7200 then lv = lv + 3 end
        if bay(x, y) < lv then px(x, y, 1) end
      elseif e >= 8200 and dx < -5 then
        if bay(x, y) < 3 then px(x, y, 1) end
      end
      if dy >= 8 and bay(x, y) < (dy - 7) * 3 then px(x, y, 1) end
    end
  end
end
-- shadow under the chin, onto the neck
shade(28, 41, 34, 43, 10)
shade(28, 44, 34, 45, 4)
-- soft cheek texture, lit side
shade(24, 31, 27, 33, 2)

-- ---------- 8. features: tired, exasperated, mid-"ugh" ----------
-- eye whites
frect(25, 26, 29, 28, 2)
frect(33, 26, 37, 28, 2)
-- heavy upper lids
hline(25, 29, 25, 1)
hline(33, 37, 25, 1)
-- pupils rolled up under the lids (classic exasperation)
px(27, 26, 1) px(28, 26, 1)
px(34, 26, 1) px(35, 26, 1)
-- eye bags
px(26, 29, 1) px(28, 29, 1)
px(34, 29, 1) px(36, 29, 1)
-- brows: left knit down, right arched up
px(24, 22, 1) px(25, 22, 1)
px(24, 23, 1) px(25, 23, 1) px(26, 23, 1)
px(27, 24, 1) px(28, 24, 1) px(29, 25, 1)
px(33, 22, 1) px(34, 21, 1) px(35, 21, 1) px(36, 21, 1) px(37, 22, 1)
px(34, 22, 1) px(35, 22, 1) px(36, 22, 1)
-- worry-line dashes on the forehead
px(29, 22, 1) px(31, 22, 1)
-- nose: bridge shadow right of center, nostril dots
px(32, 28, 1) px(32, 29, 1) px(32, 30, 1) px(33, 31, 1)
px(29, 32, 1) px(33, 32, 1)
-- nasolabial folds
px(27, 32, 1) px(26, 33, 1)
px(35, 32, 1) px(36, 33, 1)
-- open, downturned mouth with teeth glints
hline(29, 33, 34, 1)
hline(28, 34, 35, 1)
px(30, 35, 2) px(32, 35, 2)
hline(30, 32, 36, 1)
px(30, 38, 1) px(32, 38, 1)
-- chin crease
px(30, 39, 1) px(32, 39, 1)

-- ---------- 9. hair texture: curl highlights + lit-side speckle ----------
curl(26, 8, 3)  curl(34, 7, 3)  curl(20, 12, 3) curl(40, 11, 3)
curl(15, 22, 3) curl(46, 21, 2) curl(14, 31, 2) curl(46, 30, 2)
curl(17, 39, 2) curl(44, 38, 2) curl(22, 20, 2) curl(40, 20, 2)
curl(13, 26, 2) curl(48, 26, 2) curl(19, 35, 2) curl(45, 34, 2)
curl(29, 10, 2) curl(23, 11, 2) curl(38, 9, 2)
curl(24, 15, 2) curl(30, 12, 2) curl(36, 15, 2)
for k in pairs(mask) do
  local y = math.floor(k / W)
  local x = k % W
  local h = hh(x, y)
  if (x * 2 + y) < 96 then
    if h < 6 then px(x, y, 2) end
  elseif h < 2 then
    px(x, y, 2)
  end
end

-- ---------- 10. cordless phone (big chunky 1998 handset) ----------
-- antenna with white rims so it reads over the hair
frect(46, 3, 49, 5, 1)
vline(46, 6, 19, 2) vline(49, 6, 19, 2)
vline(47, 6, 19, 1) vline(48, 6, 19, 1)
-- rounded body
frect(42, 20, 49, 42, 2)
hline(43, 48, 19, 1) hline(43, 48, 43, 1)
vline(41, 21, 41, 1) vline(50, 21, 41, 1)
px(42, 20, 1) px(49, 20, 1) px(42, 42, 1) px(49, 42, 1)
-- left-edge shade dashes
for y = 21, 41 do if y % 2 == 1 then px(42, y, 1) end end
-- earpiece grille
for yy = 21, 23 do for xx = 43, 48 do
  if (xx + yy) % 2 == 0 then px(xx, yy, 1) end
end end
-- tiny LCD
frect(43, 26, 48, 28, 1)
px(44, 27, 2) px(46, 27, 2)
-- top keypad row peeking above the grip
px(43, 30, 1) px(44, 30, 1) px(46, 30, 1) px(47, 30, 1)

-- ---------- 11. hand gripping the phone ----------
for y = 32, 43 do
  local x0, x1 = 43, 53
  if y == 32 or y == 43 then x0, x1 = 44, 52 end
  hline(x0, x1, y, 2)
end
hline(44, 52, 31, 1)
hline(44, 52, 44, 1)
vline(54, 33, 42, 1)
px(53, 32, 1) px(53, 43, 1)
-- finger seams wrapping the handset
hline(43, 53, 34, 1)
hline(43, 53, 37, 1)
hline(43, 53, 40, 1)
px(43, 33, 1) px(43, 36, 1) px(43, 39, 1) px(43, 42, 1)
-- knuckle-side shading
for y = 32, 43 do for x = 50, 53 do
  if bay(x, y) < 5 then px(x, y, 1) end
end end

-- ---------- 12. white collar V over the blouse ----------
for i = 0, 5 do
  px(25 + i, 45 + i, 2) px(26 + i, 45 + i, 2)
  px(37 - i, 45 + i, 2) px(36 - i, 45 + i, 2)
end

-- ---------- 13. portrait border ----------
hline(0, 63, 0, 1) hline(0, 63, 63, 1)
vline(0, 0, 63, 1) vline(63, 0, 63, 1)

-- ---------- save ----------
local out = os.getenv("ASE_OUT_DIR")
spr:saveAs(app.fs.joinPath(out, "portrait_mom.aseprite"))
spr:flatten()
spr:saveAs(app.fs.joinPath(out, "portrait_mom.png"))

print("ASE_GEN_OK")