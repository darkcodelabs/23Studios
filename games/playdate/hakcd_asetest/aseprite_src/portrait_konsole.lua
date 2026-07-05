-- portrait_konsole: 64x64 dialogue portrait, k0nsole operative
-- hood up, half face in dither shadow, one sharp eye, heavy black rim
-- 1-bit Playdate palette: 0=transparent, 1=black, 2=white

local out = os.getenv("ASE_OUT_DIR")

local sprite = Sprite(64, 64, ColorMode.INDEXED)
sprite.transparentColor = 0

local pal = Palette(3)
pal:setColor(0, Color{r=0, g=0, b=0, a=0})
pal:setColor(1, Color{r=0, g=0, b=0, a=255})
pal:setColor(2, Color{r=255, g=255, b=255, a=255})
sprite:setPalette(pal)

local cel = sprite:newCel(sprite.layers[1], 1)
local img = cel.image

-- ellipse membership test
local function inE(x, y, cx, cy, rx, ry)
  local dx = (x - cx) / rx
  local dy = (y - cy) / ry
  return dx * dx + dy * dy <= 1.0
end

-- hood dome: center (32,27) radii 25x24
-- face opening: center (34,31) radii 10x12, biased right so hood overhangs left
for y = 0, 63 do
  for x = 0, 63 do
    local c = 2 -- white base, full canvas coverage

    -- background: sparse dot grid (HAKCD floor-dot canon)
    if x % 4 == 1 and y % 4 == 1 then c = 1 end

    -- cloak shoulders: flare from neck to full width, edge to edge at bottom
    local hw = 16 + (y - 44) * 2
    local shoulders = (y >= 44) and (math.abs(x - 32) <= hw)
    local hood = inE(x, y, 32, 27, 25, 24) or shoulders
    local face = inE(x, y, 34, 31, 10, 12) and y >= 21

    if hood then c = 1 end

    if face then
      c = 2

      -- brim shadow: solid under hood edge, checker falloff row
      if y <= 23 then
        c = 1
      elseif y == 24 and (x + y) % 2 == 0 then
        c = 1
      end

      -- left half of face in graded dither shadow
      if x <= 27 then
        c = 1 -- deep shadow merging into hood rim
      elseif x <= 30 then
        if (x + y) % 2 == 0 then c = 1 end -- 50% checker
      elseif x <= 33 then
        if x % 2 == 0 and y % 2 == 0 then c = 1 end -- 25% Bayer
      end

      -- hidden eye: faint dense hint buried in the checker zone
      if y == 30 and (x == 28 or x == 29) then c = 1 end

      -- sharp visible eye, lit side: slanted heavy brow
      if (y == 26 and x >= 36 and x <= 42) or
         (y == 27 and x >= 35 and x <= 40) then c = 1 end
      -- almond eye mass
      if (y == 30 and x >= 36 and x <= 41) or
         (y == 31 and x >= 37 and x <= 40) then c = 1 end
      -- single white glint inside the eye: the sharp point
      if x == 38 and y == 30 then c = 2 end

      -- nose shadow, minimal
      if (x == 33 and (y == 34 or y == 35)) or (y == 36 and x == 34) then
        c = 1
      end

      -- flat unreadable mouth
      if y == 39 and x >= 33 and x <= 37 then c = 1 end

      -- chin rolloff dither into collar
      if y >= 41 and (x + y) % 2 == 0 then c = 1 end
    end

    if hood and not face then
      -- rim light: dithered arc on upper-right of hood dome
      local dx = (x - 32) / 25
      local dy = (y - 27) / 24
      local t = dx * dx + dy * dy
      if t >= 0.70 and t <= 0.98 and x >= 36 and y <= 22 and (x + y) % 2 == 0 then
        c = 2
      end
      -- cloak detail: zipper line + fold highlights, dashed white
      if shoulders and y >= 47 then
        if x == 32 and y % 2 == 0 then c = 2 end
        if (x == 20 or x == 45) and y >= 50 and y % 2 == 1 then c = 2 end
      end
    end

    -- heavy 2px black portrait frame, overrides everything
    if x <= 1 or x >= 62 or y <= 1 or y >= 62 then c = 1 end

    img:putPixel(x, y, c)
  end
end

-- save .aseprite source, then flatten and save the png
sprite:saveAs(app.fs.joinPath(out, "portrait_konsole.aseprite"))
sprite:flatten()
sprite:saveAs(app.fs.joinPath(out, "portrait_konsole.png"))

print("ASE_GEN_OK")