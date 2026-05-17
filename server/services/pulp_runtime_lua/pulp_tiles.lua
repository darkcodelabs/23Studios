-- Tile registry + frame/play/swap operations.
-- Tiles are loaded from game_data.lua via pulp.boot().

local pulp = _G.pulp
local tiles = { _by_id = {}, _frame_state = {} }
pulp.tiles = tiles

function tiles.load(list)
  tiles._by_id = {}
  for _, t in ipairs(list or {}) do
    tiles._by_id[t.id] = t
    tiles._frame_state[t.id] = { frame = 0, playing = false }
  end
end

function tiles.get(id)
  return tiles._by_id[tostring(id)]
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
  tiles._frame_state[tostring(target)] = tiles._frame_state[tostring(target)] or { frame = 0 }
  tiles._frame_state[tostring(target)].frame = tonumber(idx) or 0
end

function pulp.play(target)
  target = target or pulp.current_target()
  if not target then return end
  tiles._frame_state[tostring(target)] = tiles._frame_state[tostring(target)] or { frame = 0 }
  tiles._frame_state[tostring(target)].playing = true
end

function tiles.get_frame(target)
  local st = tiles._frame_state[tostring(target)]
  return st and st.frame or 0
end

function tiles.tick()
  -- Advance any tiles whose fps > 0 and that are marked playing.
  for id, st in pairs(tiles._frame_state) do
    local t = tiles._by_id[id]
    if t and st.playing and t.fps and t.fps > 0 and t.frames and #t.frames > 0 then
      st._accum = (st._accum or 0) + 1
      local step = math.floor(60 / t.fps)
      if step <= 0 then step = 1 end
      if st._accum >= step then
        st._accum = 0
        st.frame = (st.frame + 1) % #t.frames
      end
    end
  end
end
