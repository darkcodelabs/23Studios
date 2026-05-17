-- Player state: position, current tile id, and movement helpers.

local pulp = _G.pulp
local player = { x = 0, y = 0, tile_id = nil, start_room = nil }
pulp.player = player

function player.load(spec)
  spec = spec or {}
  player.x = tonumber(spec.start_x) or 0
  player.y = tonumber(spec.start_y) or 0
  player.tile_id = spec.start_tile
  player.start_room = spec.start_room
  if player.start_room and pulp.rooms then pulp.rooms.set_current(player.start_room) end
end

function player.set_position(x, y)
  player.x = tonumber(x) or 0
  player.y = tonumber(y) or 0
  pulp.dispatch('player', 'update', { x = player.x, y = player.y })
end

function player.position() return player.x, player.y end

-- The runtime fires `on bump` when the player tries to move into a solid tile.
function player.try_move(dx, dy)
  local nx, ny = player.x + (tonumber(dx) or 0), player.y + (tonumber(dy) or 0)
  if nx < 0 or ny < 0 or nx > 24 or ny > 14 then
    pulp.dispatch('player', 'bump', { x = nx, y = ny, dir = { dx, dy } })
    return false
  end
  if pulp.query and pulp.query.solid and pulp.query.solid(nx, ny) then
    pulp.dispatch('player', 'bump', { x = nx, y = ny, dir = { dx, dy } })
    return false
  end
  player.set_position(nx, ny)
  return true
end
