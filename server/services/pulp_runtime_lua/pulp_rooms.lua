-- Room registry. Rooms have a 25x15 grid of tile IDs.

local pulp = _G.pulp
local rooms = { _by_id = {}, _current = nil, _grid = nil }
pulp.rooms = rooms

function rooms.load(list)
  rooms._by_id = {}
  for _, r in ipairs(list or {}) do
    rooms._by_id[r.id] = {
      id = r.id,
      name = r.name,
      song = r.song,
      grid = r.grid,    -- 15 rows x 25 cols
      script = r.script
    }
  end
end

function rooms.set_current(id)
  local r = rooms._by_id[tostring(id)]
  if not r then return false end
  rooms._current = r.id
  rooms._grid = r.grid
  if r.song and pulp.songs and pulp.songs.loop then
    pulp.songs.loop(r.song)
  end
  pulp.dispatch('room_' .. r.id, 'enter', { room_id = r.id })
  return true
end

function rooms.current()
  return rooms._by_id[rooms._current or '']
end

function rooms.tile_at(x, y)
  if not rooms._grid then return nil end
  local row = rooms._grid[(tonumber(y) or 0) + 1]
  if not row then return nil end
  local tid = row[(tonumber(x) or 0) + 1]
  if not tid or tid == '' then return nil end
  return pulp.tiles and pulp.tiles.get(tid) or nil
end

function rooms.swap_cell(target, new_id)
  -- target can be {x, y} table or a tile_id (use player position).
  local x, y
  if type(target) == 'table' and target[1] ~= nil then
    x, y = target[1], target[2]
  elseif pulp.player and pulp.player.position then
    x, y = pulp.player.position()
  end
  if not x or not y or not rooms._grid then return end
  local row = rooms._grid[y + 1]
  if not row then return end
  row[x + 1] = tostring(new_id)
end

-- goto x, y [in "room"]
function pulp.goto(x, y, maybe_room_or_none)
  if maybe_room_or_none and type(maybe_room_or_none) == 'string' then
    rooms.set_current(maybe_room_or_none)
  end
  if pulp.player and pulp.player.set_position then
    pulp.player.set_position(tonumber(x) or 0, tonumber(y) or 0)
  end
end
