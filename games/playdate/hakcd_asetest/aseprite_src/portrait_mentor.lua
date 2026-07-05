-- portrait_mentor.png — 64x64 dialogue portrait, HAKCD phreaker-noir
-- THE MENTOR: weary bearded hacker, 40s, glasses + headset, half-smile
-- Strict 1-bit: 0=transparent, 1=black, 2=white. Shading = dither only.

local W, H = 64, 64
local sprite = Sprite(W, H, ColorMode.INDEXED)
sprite.transparentColor = 0

local pal = Palette(3)
pal:setColor(0, Color{ r = 0,   g = 0,   b = 0,   a = 0   })
pal:setColor(1, Color{ r = 0,   g = 0,   b = 0,   a = 255 })
pal:setColor(2, Color{ r = 255, g = 255, b = 255, a = 255 })
sprite:setPalette(pal)

local cel = sprite.cels[1]
if cel == nil then cel = sprite:newCel(sprite.layers[1], 1) end
local img = cel.image

-- ---------- helpers ----------
local function px(x, y, c)
  if x >= 0 and x < W and y >= 0 and y < H then img:putPixel(x, y, c) end
end

local function hline(x0, x1, y, c)
  for x = x0, x1 do px(x, y, c) end
end

local function rectf(x0, y0, x1, y1, c)
  for y = y0, y1 do hline(x0, x1, y, c) end
end

local function ellipsef(cx, cy, rx, ry, c, pred)
  for y = cy - ry, cy + ry do
    for x = cx - rx, cx + rx do
      local dx, dy = (x - cx) / rx, (y - cy) / ry
      if dx * dx + dy * dy <= 1.0 then
        if pred == nil or pred(x, y) then px(x, y, c) end
      end
    end
  end
end

local function checker(x0, y0, x1, y1, c, mod, phase)
  for y = y0, y1 do
    for x = x0, x1 do
      if (x + y) % mod == phase then px(x, y, c) end
    end
  end
end

-- ---------- 1. backdrop: white with sparse Bayer dot-grid ----------
rectf(0, 0, 63, 63, 2)
for y = 0, 60, 4 do
  for x = 0, 60, 4 do
    px(x, y, 1)
    px(x + 2, y + 2, 1)
  end
end

-- ---------- 2. torso: black hoodie with white rim halo ----------
local rimHW = { [44] = 11, [45] = 15, [46] = 19, [47] = 23 }
for y = 44, 63 do
  local hw = rimHW[y] or 28
  hline(32 - hw, 32 + hw, y, 2)
end
local bodHW = { [45] = 9, [46] = 13, [47] = 17, [48] = 21, [49] = 24 }
for y = 45, 63 do
  local hw = bodHW[y] or 26
  hline(32 - hw, 32 + hw, y, 1)
end
-- collar V + zipper (white on black)
px(29, 46, 2); px(30, 47, 2); px(31, 48, 2)
px(35, 46, 2); px(34, 47, 2); px(33, 48, 2)
for y = 49, 61 do px(32, y, 2) end
-- shoulder sheen: sparse white dots on the black mass
for y = 49, 55, 2 do
  for x = 10, 20, 2 do px(x, y, 2) end
  for x = 44, 54, 2 do px(x, y, 2) end
end

-- ---------- 3. head: 2px black outline ring, white skin ----------
ellipsef(32, 25, 15, 17, 1)              -- outline mass
ellipsef(32, 25, 13, 15, 2)              -- skin fill

-- ---------- 4. hair: heavy black cap, receding, gray flecks ----------
ellipsef(32, 25, 13, 15, 1, function(x, y) return y <= 15 end)
-- messy fringe jags
for _, x in ipairs({ 22, 23, 26, 29, 35, 38, 41, 42 }) do px(x, 16, 1) end
px(23, 17, 1); px(41, 17, 1)
-- widow's peak
px(31, 16, 1); px(32, 16, 1); px(33, 16, 1); px(32, 17, 1)
-- receding temples (skin notches carved into hair)
rectf(25, 14, 26, 15, 2)
rectf(38, 14, 39, 15, 2)
-- gray-hair flecks (white dots in black hair)
px(26, 13, 2); px(29, 12, 2); px(35, 12, 2)
px(38, 13, 2); px(24, 14, 2); px(40, 14, 2)
-- sideburns flowing down toward the beard
rectf(19, 16, 20, 32, 1)
rectf(44, 16, 45, 32, 1)

-- ---------- 5. forehead creases (weary) ----------
hline(27, 29, 18, 1)
hline(34, 36, 18, 1)

-- ---------- 6. heavy tired brows ----------
rectf(23, 20, 29, 21, 1)
rectf(35, 20, 41, 21, 1)
px(22, 21, 1); px(42, 21, 1)             -- drooping outer ends

-- ---------- 7. glasses ----------
hline(20, 44, 22, 1)                     -- top bar spans both lenses
hline(31, 33, 23, 1)                     -- thick bridge
hline(17, 20, 23, 1)                     -- left temple arm
hline(44, 46, 23, 1)                     -- right temple arm
-- lens boxes
hline(21, 29, 28, 1); hline(35, 43, 28, 1)
for y = 22, 28 do
  px(21, y, 1); px(29, y, 1)
  px(35, y, 1); px(43, y, 1)
end
-- clear lens interiors
rectf(22, 23, 28, 27, 2)
rectf(36, 23, 42, 27, 2)
-- glass sheen: checker dither on lower lens halves
checker(22, 26, 28, 27, 1, 2, 0)
checker(36, 26, 42, 27, 1, 2, 0)

-- ---------- 8. tired kind eyes: half-lidded, slight off-gaze ----------
hline(23, 27, 24, 1)                     -- left heavy lid
hline(37, 41, 24, 1)                     -- right heavy lid
rectf(25, 25, 26, 26, 1)                 -- left pupil
rectf(38, 25, 39, 26, 1)                 -- right pupil (a hair inward)
-- eye bags under the frames
hline(24, 26, 30, 1)
hline(38, 40, 30, 1)

-- ---------- 9. nose ----------
px(31, 28, 1); px(31, 29, 1); px(31, 30, 1); px(31, 31, 1)
px(30, 32, 1); px(31, 32, 1); px(34, 32, 1)
px(33, 30, 1)                            -- side shade dot
-- left-cheek form dither (light source on viewer right)
checker(21, 27, 23, 31, 1, 3, 0)

-- ---------- 10. beard: heavy black mass, salt-and-pepper dither ----------
ellipsef(32, 37, 12, 8, 1, function(x, y) return y >= 33 end)
px(21, 33, 1); px(43, 33, 1)             -- close gaps to sideburns
px(22, 32, 1); px(42, 32, 1)             -- jagged cheek line
-- gray flecks low in the beard
ellipsef(32, 37, 12, 8, 2, function(x, y)
  return y >= 39 and (x + y) % 3 == 0
end)
-- knowing half-smile: white line, right corner kicked up
hline(27, 33, 36, 2)
px(34, 35, 2); px(35, 35, 2); px(36, 34, 2)

-- ---------- 11. left ear ----------
rectf(15, 23, 16, 29, 1)                 -- outer black backing
rectf(17, 24, 18, 28, 2)                 -- ear skin
px(17, 26, 1)                            -- inner fold

-- ---------- 12. headset: right ear cup, band glint, mic boom ----------
rectf(44, 22, 49, 31, 1)                 -- ear cup mass
for y = 23, 30 do px(50, y, 2) end       -- white rim vs backdrop
px(46, 24, 2); px(47, 24, 2); px(46, 25, 2)  -- cup highlight
px(47, 28, 2)
-- band glint: white arc riding over the black hair
local band = { {44,18},{43,16},{42,14},{41,12},{39,11},{37,10},{35,9},{33,9} }
for _, p in ipairs(band) do px(p[1], p[2], 2) end
-- mic boom: 2px black arm from cup down across the jaw
local boom = { {46,31},{45,32},{44,33},{43,34},{42,35},{41,36},{40,37} }
for _, p in ipairs(boom) do
  px(p[1], p[2], 1)
  px(p[1] - 1, p[2], 1)
end
-- mic capsule: black core with white ring so it reads inside the beard
rectf(37, 36, 41, 40, 2)
rectf(38, 37, 40, 39, 1)

-- ---------- 13. heavy 2px black portrait rim, edge to edge ----------
rectf(0, 0, 63, 1, 1)
rectf(0, 62, 63, 63, 1)
rectf(0, 0, 1, 63, 1)
rectf(62, 0, 63, 63, 1)

-- ---------- save ----------
sprite:flatten()
local out = os.getenv("ASE_OUT_DIR")
sprite:saveAs(app.fs.joinPath(out, "portrait_mentor.aseprite"))
sprite:saveAs(app.fs.joinPath(out, "portrait_mentor.png"))
print("ASE_GEN_OK")