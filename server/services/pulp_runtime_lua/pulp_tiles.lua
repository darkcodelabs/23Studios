-- Tile registry + frame/play/swap operations.
-- Tiles are loaded from game_data.lua via pulp.boot().
--
-- Animation:
--   t.fps         > 0 -> animated, advance frame index from elapsed ms
--   t.loop        ~= false -> wrap; else clamp at last frame
--   t.image_kind  'imagetable' -> load as gfx.imagetable.new
--                 'image'      -> load as gfx.image.new (single-frame)
--   t.frame_count number of frames in the sprite sheet
--
-- Image lookup: assets/tiles/<id>-table-<W>-<H>.png compiles to a .pdt that
-- pdc names <id>-table-<W>-<H>; gfx.imagetable.new resolves the suffix when
-- given the base name. We pass "assets/tiles/<id>" and let the SDK find it.

local gfx <const> = playdate and playdate.graphics or nil

local pulp = _G.pulp
local tiles = { _by_id = {}, _frame_state = {}, _img = {}, _table = {} }
pulp.tiles = tiles

local function loadImageFor(t)
  if not gfx or not t or not t.id then return end
  local base = 'assets/tiles/' .. tostring(t.id)
  if t.image_kind == 'imagetable' and t.frame_count and t.frame_count > 1 then
    local ok, it = pcall(gfx.imagetable.new, base)
    if ok and it then tiles._table[t.id] = it end
  else
    -- Single-frame tiles emit "<id>__0.png" -> "<id>__0.pdi". Try both
    -- names so an art swap doesn't break the load.
    local ok, im = pcall(gfx.image.new, base .. '__0')
    if not ok or not im then
      ok, im = pcall(gfx.image.new, base)
    end
    if ok and im then tiles._img[t.id] = im end
  end
end

function tiles.load(list)
  tiles._by_id = {}
  tiles._frame_state = {}
  tiles._img = {}
  tiles._table = {}
  for _, t in ipairs(list or {}) do
    tiles._by_id[t.id] = t
    -- Animated tiles start "playing" by default; static tiles freeze on
    -- frame 0 until pulp.frame() or pulp.play() touches them.
    local autoplay = (t.fps and t.fps > 0 and t.frame_count and t.frame_count > 1) and true or false
    tiles._frame_state[t.id] = {
      frame = 0,
      playing = autoplay,
      start_ms = playdate and playdate.getCurrentTimeMilliseconds and playdate.getCurrentTimeMilliseconds() or 0,
    }
    loadImageFor(t)
  end
end

function tiles.get(id)
  return tiles._by_id[tostring(id)]
end

-- Returns the image to render for tile `id` based on its current animation
-- state. Animated tiles compute the frame from elapsed ms * fps so the
-- visible playback rate doesn't depend on the game loop tick rate.
function tiles.image_for(id)
  local sid = tostring(id)
  local t = tiles._by_id[sid]
  if not t then return nil end
  if t.image_kind == 'imagetable' then
    local it = tiles._table[sid]
    if not it then return nil end
    local st = tiles._frame_state[sid] or { frame = 0 }
    local fc = t.frame_count or 1
    local idx
    if st.playing and t.fps and t.fps > 0 and fc > 1 then
      local now = playdate and playdate.getCurrentTimeMilliseconds and playdate.getCurrentTimeMilliseconds() or 0
      local start = st.start_ms or now
      local raw = math.floor((now - start) * t.fps / 1000)
      if t.loop == false then
        idx = math.min(fc - 1, math.max(0, raw))
      else
        idx = raw % fc
      end
      st.frame = idx
    else
      idx = st.frame or 0
    end
    return it:getImage(idx + 1) -- imagetable indices are 1-based
  end
  return tiles._img[sid]
end

-- Replace the tile at the current target with `new_id`.
-- target_or_new_id may be (new_id) when used inside a `tell` block.
function pulp.swap(target_or_new_id, maybe_new_id)
  local target, new_id
  if maybe_new_id == nil then
    target = pulp.current_target()
    new_id = target_or_new_id
  else
    target, new_id = target_or_new_id, maybe_new_id
  end
  if not target or not new_id then return end
  if pulp.rooms and pulp.rooms.swap_cell then
    pulp.rooms.swap_cell(target, tostring(new_id))
  end
end

-- Set the current animation frame index on a tile instance.
function pulp.frame(target_or_idx, maybe_idx)
  local target, idx
  if maybe_idx == nil then
    target = pulp.current_target()
    idx = target_or_idx
  else
    target, idx = target_or_idx, maybe_idx
  end
  if not target then return end
  local sid = tostring(target)
  tiles._frame_state[sid] = tiles._frame_state[sid] or { frame = 0 }
  tiles._frame_state[sid].frame = tonumber(idx) or 0
  tiles._frame_state[sid].playing = false -- manual frame pin
end

function pulp.play(target)
  target = target or pulp.current_target()
  if not target then return end
  local sid = tostring(target)
  tiles._frame_state[sid] = tiles._frame_state[sid] or { frame = 0 }
  tiles._frame_state[sid].playing = true
  tiles._frame_state[sid].start_ms = playdate
    and playdate.getCurrentTimeMilliseconds
    and playdate.getCurrentTimeMilliseconds()
    or 0
end

function tiles.get_frame(target)
  local st = tiles._frame_state[tostring(target)]
  return st and st.frame or 0
end

function tiles.tick()
  -- Time-based animation reads happen in `tiles.image_for`; tick() is left
  -- as a no-op for callers that still hook it. We intentionally don't drive
  -- frame advance here because per-frame render reads compute the index
  -- from the wall clock, matching the browser interpreter's behavior.
end
