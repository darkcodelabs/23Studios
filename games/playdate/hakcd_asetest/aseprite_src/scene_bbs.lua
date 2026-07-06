-- scene_bbs.png — head-on beige CRT monitor showing a green-screen BBS
-- 400x240, 1-bit Playdate palette: 0=transparent, 1=black, 2=white
-- HAKCD house style: heavy Bayer dithering, dense 1998 detail

local OUT = os.getenv("ASE_OUT_DIR")

local sprite = Sprite(400, 240, ColorMode.INDEXED)
sprite.transparentColor = 0

local pal = Palette(3)
pal:setColor(0, Color{r=0,   g=0,   b=0,   a=0})
pal:setColor(1, Color{r=0,   g=0,   b=0,   a=255})
pal:setColor(2, Color{r=255, g=255, b=255, a=255})
sprite:setPalette(pal)

local cel = sprite.cels[1]
if not cel then cel = sprite:newCel(sprite.layers[1], 1) end
local img = cel.image

-- ---------------------------------------------------------------- helpers
local BAYER = {
  {0, 8, 2, 10},
  {12, 4, 14, 6},
  {3, 11, 1, 9},
  {15, 7, 13, 5},
}
local function bay(x, y) return BAYER[(y % 4) + 1][(x % 4) + 1] end

local function px(x, y, c)
  if x >= 0 and x < 400 and y >= 0 and y < 240 then img:putPixel(x, y, c) end
end

-- black where bayer < lvl, else white (lvl 0..16: 0=all white, 16=all black)
local function dith(x0, y0, x1, y1, lvl)
  for y = y0, y1 do
    for x = x0, x1 do
      if bay(x, y) < lvl then px(x, y, 1) else px(x, y, 2) end
    end
  end
end

local function fill(x0, y0, x1, y1, c)
  for y = y0, y1 do for x = x0, x1 do px(x, y, c) end end
end

local function hline(x0, x1, y, c) for x = x0, x1 do px(x, y, c) end end
local function vline(y0, y1, x, c) for y = y0, y1 do px(x, y, c) end end

local function rectO(x0, y0, x1, y1, c)
  hline(x0, x1, y0, c); hline(x0, x1, y1, c)
  vline(y0, y1, x0, c); vline(y0, y1, x1, c)
end

-- ------------------------------------------------------------- 3x5 font
local F = {
  ["A"]={"010","101","111","101","101"}, ["B"]={"110","101","110","101","110"},
  ["C"]={"011","100","100","100","011"}, ["D"]={"110","101","101","101","110"},
  ["E"]={"111","100","110","100","111"}, ["G"]={"011","100","101","101","011"},
  ["H"]={"101","101","111","101","101"}, ["I"]={"111","010","010","010","111"},
  ["K"]={"101","101","110","101","101"}, ["L"]={"100","100","100","100","111"},
  ["M"]={"101","111","111","101","101"}, ["N"]={"110","101","101","101","101"},
  ["O"]={"111","101","101","101","111"}, ["P"]={"110","101","110","100","100"},
  ["R"]={"110","101","110","101","101"}, ["S"]={"011","100","010","001","110"},
  ["T"]={"111","010","010","010","010"}, ["U"]={"101","101","101","101","111"},
  ["V"]={"101","101","101","101","010"}, ["W"]={"101","101","101","111","101"},
  ["Y"]={"101","101","010","010","010"},
  ["0"]={"111","101","101","101","111"}, ["1"]={"010","110","010","010","111"},
  ["2"]={"111","001","111","100","111"}, ["3"]={"111","001","011","001","111"},
  ["4"]={"101","101","111","001","001"}, ["5"]={"111","100","111","001","111"},
  ["8"]={"111","101","111","101","111"}, ["9"]={"111","101","111","001","111"},
  ["-"]={"000","000","111","000","000"}, [":"]={"000","010","000","010","000"},
  ["."]={"000","000","000","000","010"}, [">"]={"100","010","001","010","100"},
  ["_"]={"000","000","000","000","111"}, ["/"]={"001","001","010","100","100"},
  [" "]={"000","000","000","000","000"},
}

local function txt(s, x, y, c, sc)
  sc = sc or 1
  for i = 1, #s do
    local g = F[s:sub(i, i)] or F[" "]
    for r = 1, 5 do
      local row = g[r]
      for cb = 1, 3 do
        if row:sub(cb, cb) == "1" then
          for dy = 0, sc - 1 do
            for dx = 0, sc - 1 do
              px(x + (i - 1) * 4 * sc + (cb - 1) * sc + dx, y + (r - 1) * sc + dy, c)
            end
          end
        end
      end
    end
  end
end

-- ============================================================ 1. BEZEL
-- base beige plastic: light 19% dither over the whole canvas
dith(0, 0, 399, 239, 3)
-- lighting: top/left highlight, bottom/right shadow
dith(0, 0, 399, 5, 1)
dith(0, 6, 5, 233, 2)
dith(394, 6, 399, 233, 6)
dith(0, 234, 399, 239, 8)

-- plastic mottle: deterministic speckle so the beige reads as textured
for y = 1, 238 do
  for x = 1, 398 do
    if (x * 37 + y * 97) % 251 < 3 then px(x, y, 1) end
  end
end

-- canvas outline + rounded CRT case corners (dark behind the case)
rectO(0, 0, 399, 239, 1)
local corners = {{11,11},{388,11},{11,228},{388,228}}
for _, c in ipairs(corners) do
  local cx, cy = c[1], c[2]
  local x0 = (cx < 200) and 0 or 388
  local y0 = (cy < 120) and 0 or 228
  for y = y0, y0 + 11 do
    for x = x0, x0 + 11 do
      local dx, dy = x - cx, y - cy
      if dx * dx + dy * dy > 121 then px(x, y, 1) end
    end
  end
end

-- ==================================================== 2. SCREEN INSET BEVEL
-- recessed well around the glass: dark ramp toward the tube
rectO(32, 20, 367, 211, 1)
for y = 21, 27 do dith(33, y, 366, y, 6 + (y - 21)) end        -- top lip shadow
for y = 205, 210 do dith(33, y, 366, y, 10 - (y - 205)) end     -- bottom lip lit
for x = 33, 39 do dith(x, 28, x, 204, 6 + (x - 33)) end         -- left ramp
for x = 360, 366 do dith(x, 28, x, 204, 10 - (x - 360)) end     -- right ramp
rectO(39, 27, 360, 205, 1)

-- =========================================================== 3. GLASS
fill(40, 28, 359, 204, 1)

-- faint dither scanlines (sparse phosphor glow rows)
for y = 30, 202, 3 do
  local off = ((y // 3) % 2) * 4
  for x = 43 + off, 356, 8 do px(x, y, 2) end
end

-- ==================================================== 4. BBS SCREEN CONTENT
-- ASCII double-line border (two nested 1px rects = ═ ║ box)
rectO(46, 32, 353, 201, 2)
rectO(49, 35, 350, 198, 2)

-- title bar separators (double line = ╠══╣)
hline(46, 353, 54, 2); hline(46, 353, 57, 2)
hline(46, 353, 186, 2); hline(46, 353, 189, 2)

-- title, 2x scale, centered
txt("DEADLINE BBS  555-0142", 112, 40, 2, 2)

-- small skull left of the title
local SK = {
  "..#########..",
  ".###########.",
  "#############",
  "##..#####..##",
  "##..##.##..##",
  "######.######",
  ".###########.",
  ".##.#.#.#.##.",
  "..#########..",
}
for r = 1, #SK do
  local row = SK[r]
  for c = 1, #row do
    if row:sub(c, c) == "#" then px(86 + c - 1, 40 + r - 1, 2) end
  end
end

-- log lines, top region only; middle of screen stays dark for live text
txt("CONNECT 2400", 54, 64, 2)
txt("USER: GUEST", 54, 72, 2)
txt("MSG AREA: 12 NEW", 54, 80, 2)
txt("> _", 54, 88, 2)

-- bottom status bar
txt("NODE 1 - 2400 BAUD", 54, 192, 2)
txt("23:59", 326, 192, 2)

-- glass glare: two dithered diagonal streaks across top-right of the tube
for y = 28, 84 do
  for x = 41, 358 do
    local d = x - (y - 28)
    if (d >= 300 and d <= 314) or (d >= 320 and d <= 325) then
      if (x + y) % 2 == 0 then px(x, y, 2) end
    end
  end
end

-- ===================================================== 5. CONTROL STRIP
-- moulding groove across the case
hline(2, 397, 214, 1)
hline(2, 397, 215, 2)

-- power button (raised, shadowed underside, power glyph)
rectO(18, 219, 40, 233, 1)
dith(19, 220, 39, 232, 2)
dith(19, 230, 39, 232, 7)
hline(19, 39, 220, 2)
for dy = -3, 3 do
  for dx = -3, 3 do
    local d2 = dx * dx + dy * dy
    if d2 >= 7 and d2 <= 11 then px(29 + dx, 227 + dy, 1) end
  end
end
vline(222, 227, 29, 1)

-- power LED, lit, with dark halo so it pops on the beige
dith(61, 221, 71, 231, 9)
rectO(63, 223, 69, 229, 1)
fill(64, 224, 68, 228, 2)
txt("PWR", 46, 224, 1)

-- brand plate
txt("HAKCD CM-98", 178, 224, 1)

-- vent slots
for x = 244, 284, 5 do vline(222, 230, x, 1) end

-- volume knob: black rim w/ top-left highlight, dithered dome, index mark
txt("VOL", 300, 225, 1)
local kcx, kcy = 330, 227
for dy = -9, 9 do
  for dx = -9, 9 do
    local d2 = dx * dx + dy * dy
    if d2 <= 81 then
      local x, y = kcx + dx, kcy + dy
      if d2 >= 62 then
        if (dx + dy) < -8 then px(x, y, 2) else px(x, y, 1) end
      elseif d2 >= 38 then
        if bay(x, y) < 9 then px(x, y, 1) else px(x, y, 2) end
      else
        if bay(x, y) < 4 then px(x, y, 1) else px(x, y, 2) end
      end
    end
  end
end
for k = 1, 5 do
  px(kcx - k, kcy - k, 1)
  px(kcx - k + 1, kcy - k, 1)
end

-- ============================================================ 6. SAVE
sprite:saveAs(app.fs.joinPath(OUT, "scene_bbs.aseprite"))
sprite:flatten()
sprite:saveAs(app.fs.joinPath(OUT, "scene_bbs.png"))

print("ASE_GEN_OK")