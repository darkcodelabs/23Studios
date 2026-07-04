-- SPIKE: prove headless aseprite -b can author a Playdate imagetable.
-- Pipeline fixture only — never export to a game repo.
--
-- Output: npc_walk-table-32-32.png (4 frames horizontal, 128x32)
-- plus npc_walk.aseprite as the editable canonical source.
--
-- Run: aseprite -b --script npc_walk_spike.lua
-- Env: ASE_OUT_DIR (default: script cwd)

local OUT_DIR = os.getenv("ASE_OUT_DIR") or "."
local W, H, FRAMES = 32, 32, 4

local spr = Sprite(W, H, ColorMode.INDEXED)
spr.transparentColor = 0

local pal = Palette(3)
pal:setColor(0, Color{ r = 0, g = 0, b = 0, a = 0 })   -- index 0: transparent
pal:setColor(1, Color{ r = 0, g = 0, b = 0, a = 255 }) -- index 1: black
pal:setColor(2, Color{ r = 255, g = 255, b = 255, a = 255 }) -- index 2: white
spr:setPalette(pal)

for _ = 2, FRAMES do spr:newEmptyFrame() end

-- Chunky 2px-stroke humanoid, per-frame leg/arm offsets = walk cycle.
-- rect(img, x, y, w, h, idx) fills; frames differ only in limb geometry.
local function rect(img, x, y, w, h, idx)
  for py = y, y + h - 1 do
    for px = x, x + w - 1 do
      if px >= 0 and px < W and py >= 0 and py < H then
        img:putPixel(px, py, idx)
      end
    end
  end
end

-- legPose[frame] = {backLegX, frontLegX, armSwing}
local legPose = {
  { back = 10, front = 18, arm = 0 },
  { back = 12, front = 16, arm = 1 },
  { back = 14, front = 14, arm = 0 },
  { back = 16, front = 12, arm = -1 },
}

for f = 1, FRAMES do
  local cel = spr:newCel(spr.layers[1], f)
  local img = cel.image
  local p = legPose[f]

  -- head: 12x10 white fill w/ 2px black outline
  rect(img, 10, 2, 12, 10, 1)
  rect(img, 12, 4, 8, 6, 2)
  -- eye (2x2 black inside white)
  rect(img, 17, 5, 2, 2, 1)
  -- torso: 8 wide, black
  rect(img, 12, 12, 8, 10, 1)
  -- arms: 2px, swing with pose
  rect(img, 8, 13 + p.arm, 4, 2, 1)
  rect(img, 20, 13 - p.arm, 4, 2, 1)
  -- legs: 4px wide each, positions from pose table
  rect(img, p.back, 22, 4, 8, 1)
  rect(img, p.front, 22, 4, 8, 1)
end

spr:saveAs(app.fs.joinPath(OUT_DIR, "npc_walk.aseprite"))

app.command.ExportSpriteSheet {
  ui = false,
  askOverwrite = false,
  type = SpriteSheetType.HORIZONTAL,
  textureFilename = app.fs.joinPath(OUT_DIR, "npc_walk-table-32-32.png"),
  dataFilename = "",
}

print("SPIKE_OK frames=" .. FRAMES .. " out=" .. OUT_DIR)
